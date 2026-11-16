/*
 * AcFun 直播（live.acfun.cn）—— SimpleLive 直播源脚本，接口见 doc/live_source_api.md（v1）
 *
 * 房间号 = 主播 uid（https://live.acfun.cn/live/<uid>）。只用游客身份，不登录。
 *
 * 接口（2026-10 验证）：
 * - 列表 / 分类：live.acfun.cn/api/channel/list?count=&pcursor=<页序号，从 0 起>&filters=
 *   filters 为 [{"filterType":1,"filterId":<大类>}] 或 [{"filterType":2,"filterId":<小类>}]；
 *   返回的 pcursor 是下一页序号，没有更多时为 "no_more"。全站在播一般只有几十个直播间。
 * - 分类表：member.acfun.cn/common/api/getLiveTypeList（POST，游客可用），失败时用内置表；
 *   大类图标来自 channel/list 的 channelFilters。
 * - 搜索直播间：站内没有直播搜索，取全部在播列表按标题 / 主播名 / 分区名过滤。
 * - 搜索主播：api-new.app.acfun.cn/rest/app/search/user（pCursor 为页序号，pageNum 为总页数），
 *   在播的用户带 liveId。
 * - 房间：live.acfun.cn/api/live/info?authorId=（未开播时没有 liveId / title；不存在的 uid 返回
 *   href 为 "0" 的空用户）。
 * - 播放：id.app.acfun.cn/rest/app/visitor/login（sid=acfun.api.visitor，带 _did Cookie）→
 *   api.kuaishouzt.com/rest/zt/live/web/startPlay（POST authorId、pullStreamType=FLV，会验证
 *   Referer）。data.videoPlayRes 是 JSON 字符串，liveAdaptiveManifest[].adaptationSet.representation
 *   里每个清晰度一条 FLV（高清 / 超清 / 蓝光 4M / 蓝光 8M），auth_key 约 30 天有效，播放不需要请求头。
 *   pullStreamType=HLS 会被拒绝（129001），把 .flv 改成 .m3u8 也 403，所以 avPlayerUrls 返回 null
 *   （iOS 画中画改用 mpv）。
 * - 弹幕：wss://klink-newproduct-ws3.kwaizt.com/ 长连接（快手 zt 直播的 klink 协议）：
 *   帧 = 0xABCD0001 + 头长度 + 负载长度（均为 4 字节大端）+ PacketHeader（protobuf）+ 负载；
 *   负载 = UpstreamPayload / DownstreamPayload（protobuf）经 AES-128-CBC（PKCS#7）加密，
 *   前 16 字节为 IV。Register 用游客登录给的 acSecurity（base64）作密钥、头里带 serviceToken；
 *   之后用 Register 返回的 sessKey。流程：Register → KeepAlive + EnterRoom（ZtLiveCsCmd，带
 *   ticket / liveId / enterRoomAttach）→ 按 EnterRoomAck 的间隔发 Heartbeat（每 5 次带一次
 *   KeepAlive）；每条 Push.ZtLiveInteractive.Message 都要回 ACK。推送为 ZtLiveScMessage
 *   （payload 可能 gzip），其中 ScActionSignal 里的 CommonActionSignalComment 是弹幕，
 *   ScStateSignal 里的 CommonStateSignalDisplayInfo.watchingCount 是在线人数、
 *   CommonStateSignalRecentComment 是进房时的最近弹幕，ScStatusChanged 为下播 / 封禁，
 *   ScTicketInvalid 时换下一个 ticket 重新 EnterRoom。
 *   协议参考 orzogc/acfundanmu（Go）及其 proto 定义，已对照线上服务逐项验证。
 * - 没有醒目留言（SC）一类的功能，superChats 未实现；礼物、点赞、进房提示不转发。
 * - 未开播的直播间没有弹幕通道：显示提示，每分钟查一次是否开播，开播后自动重连。
 *   直播中途下播 / 封禁（ScStatusChanged）时提示一条、退出房间并自己关闭连接（不触发 App 重连），同样等开播。
 */

const AC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const AC_WS = "wss://klink-newproduct-ws3.kwaizt.com/"
const AC_FORM = "application/x-www-form-urlencoded"
const AC_MAGIC = [0xab, 0xcd, 0x00, 0x01]
const AC_SDK = "kwai-acfun-live-link"
const AC_LINK_VERSION = "2.13.8"
const AC_KPN = "ACFUN_APP"

// getLiveTypeList 不可用时的分类表（2026-10）
const AC_TYPES = [
  [1, "游戏直播", [[101, "主机单机"], [102, "网游"], [103, "手游"]]],
  [4, "虚拟偶像", [[401, "聊天"], [402, "游戏"], [403, "歌回"]]],
  [3, "娱乐", [[301, "休闲"], [302, "歌舞"], [303, "聊天"]]],
  [2, "其他", [[201, "资讯"], [202, "学习"], [203, "其它"]]],
]

function acNoQuery(url) {
  return typeof url === "string" ? url.replace(/\?.*$/, "") : ""
}

function acCount(v) {
  if (typeof v === "number") return v
  const s = String(v ?? "").trim()
  const n = parseFloat(s)
  if (!isFinite(n)) return 0
  return Math.round(s.includes("万") ? n * 10000 : s.includes("亿") ? n * 1e8 : n)
}

function acRandomHex(len) {
  let s = ""
  for (let i = 0; i < len; i++) s += "0123456789ABCDEF"[Math.floor(Math.random() * 16)]
  return s
}

function acRandomBytes(n) {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256)
  return out
}

function acU32(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
}

function acReadU32(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}

// protobuf 读取：Proto.decode 结果里取第一个值
function pbFirst(m, f) {
  const v = m && m[f]
  return v && v.length ? v[0] : undefined
}
function pbStr(m, f) {
  const v = pbFirst(m, f)
  return v instanceof Uint8Array ? Proto.str(v) : ""
}
function pbNum(m, f) {
  const v = pbFirst(m, f)
  return typeof v === "bigint" ? Proto.num(v) : 0
}
function pbMsg(m, f) {
  const v = pbFirst(m, f)
  return v instanceof Uint8Array ? Proto.decode(v) : null
}
function pbAll(m, f) {
  return (m && m[f]) || []
}

function acAesEncrypt(key, plain) {
  const iv = acRandomBytes(16)
  const enc = CryptoJS.AES.encrypt(Bytes.toWordArray(plain), key, {
    iv: Bytes.toWordArray(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  })
  return Bytes.concat(iv, Bytes.fromWordArray(enc.ciphertext))
}

function acAesDecrypt(key, data) {
  const params = CryptoJS.lib.CipherParams.create({ ciphertext: Bytes.toWordArray(data.slice(16)) })
  const dec = CryptoJS.AES.decrypt(params, key, {
    iv: Bytes.toWordArray(data.slice(0, 16)),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  })
  return Bytes.fromWordArray(dec)
}

class AcFunLive extends LiveSource {
  key = "acfun"
  name = "AcFun 直播"
  version = "1.0.0"
  url = "https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/acfun.live.js"
  apiVersion = 1
  icon = "https://cdn.aixifan.com/ico/favicon.ico"
  description = "AcFun 直播（游客）：推荐、分类、搜索、FLV 播放、长连接弹幕"
  domains = ["acfun.cn", "*.acfun.cn", "api.kuaishouzt.com", "*.kwaizt.com"]
  links = [
    "live\\.acfun\\.cn/live/(\\d+)",
    "m\\.acfun\\.cn/live/detail/(\\d+)",
    "acfun\\.cn/u/(\\d+)",
  ]

  danmaku = {
    start: (room, session) => this._danmakuStart(room, session),
    stop: (session) => this._danmakuStop(session),
  }

  // ---------------- HTTP ----------------

  // 设备号 _did：网页版由 live.acfun.cn 种下（Domain=acfun.cn）。以 Cookie 罐里的为准，
  // 没有时自己生成同样格式的，罐里还没有时显式带上（服务器会原样种回罐里）。
  async _did() {
    if (this._didValue) return this._didValue
    let did = null
    try {
      const m = /(?:^|;\s*)_did=([^;\s]+)/.exec((await Http.getCookies("https://live.acfun.cn/")) || "")
      if (m) {
        did = m[1]
        this._didInJar = true
      }
    } catch (e) {}
    if (!did) {
      try {
        did = await Storage.get("did")
      } catch (e) {}
    }
    if (typeof did !== "string" || !/^web_\w{6,64}$/.test(did)) did = "web_" + acRandomHex(16)
    this._didValue = did
    try {
      await Storage.set("did", did)
    } catch (e) {}
    return did
  }

  async _json(url, opts = {}) {
    const did = await this._did()
    const acfun = /^https?:\/\/([^/?#]+\.)?acfun\.cn(?::\d+)?(?:[/?#]|$)/i.test(url)
    const r = await Http.request({
      url,
      method: opts.method || "GET",
      body: opts.body,
      headers: {
        "user-agent": AC_UA,
        referer: opts.referer || "https://live.acfun.cn/",
        ...(acfun && !this._didInJar ? { cookie: `_did=${did}` } : {}),
        ...(opts.body != null ? { "content-type": AC_FORM } : {}),
        ...(opts.headers || {}),
      },
      responseType: "text",
    })
    const setCookie = String((r.headers && r.headers["set-cookie"]) || "")
    const m = /(?:^|[\n,]\s*)_did=([^;\s]+)/.exec(setCookie)
    if (acfun && m) {
      this._didInJar = true
      if (m[1] !== this._didValue) {
        // 服务器换了设备号：之后都用新的（游客令牌和它绑定，重新登录）
        this._didValue = m[1]
        this._vis = null
        try {
          await Storage.set("did", m[1])
        } catch (e) {}
      }
    }
    let body = null
    try {
      body = JSON.parse(r.body)
    } catch (e) {}
    if (r.status < 200 || r.status >= 300 || body == null) {
      const err = new Error(`AcFun 接口请求失败（HTTP ${r.status}）`)
      err.status = r.status
      throw err
    }
    return body
  }

  // 游客令牌：缓存 6 小时；播放和弹幕同时要时只登录一次
  async _visitor(force = false) {
    if (!force && this._vis && Date.now() - this._vis.at < 6 * 3600 * 1000) return this._vis
    if (!this._visLogin) {
      this._visLogin = this._login().finally(() => {
        this._visLogin = null
      })
    }
    return this._visLogin
  }

  async _login() {
    const did = await this._did()
    const b = await this._json("https://id.app.acfun.cn/rest/app/visitor/login", {
      method: "POST",
      body: "sid=acfun.api.visitor",
    })
    const st = b["acfun.api.visitor_st"]
    if (b.result !== 0 || !st || !b.acSecurity || !b.userId) {
      throw new Error("AcFun 游客登录失败：" + (b.error_msg || b.result))
    }
    this._vis = { did: this._didValue || did, userId: b.userId, st, security: b.acSecurity, at: Date.now() }
    return this._vis
  }

  // 返回 { data, vis }；未开播时抛出带 notLive 的错误
  async _startPlay(uid) {
    let lastError = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const vis = await this._visitor(attempt > 0)
      const url =
        "https://api.kuaishouzt.com/rest/zt/live/web/startPlay?subBiz=mainApp&kpn=ACFUN_APP&kpf=PC_WEB" +
        `&userId=${vis.userId}&did=${encodeURIComponent(vis.did)}&acfun.api.visitor_st=${encodeURIComponent(vis.st)}`
      let b
      try {
        b = await this._json(url, {
          method: "POST",
          body: `authorId=${encodeURIComponent(uid)}&pullStreamType=FLV`,
          referer: `https://live.acfun.cn/live/${uid}`,
        })
      } catch (e) {
        // 游客令牌过期时是 HTTP 401：重新登录再试一次
        if (attempt === 0 && (e.status === 401 || e.status === 403)) continue
        throw e
      }
      if (b.result === 1 && b.data && b.data.liveId) return { data: b.data, vis }
      lastError = b
      if (attempt === 0) {
        // 未开播时 startPlay 返回 129004「直播已关播」；其他错误先确认是不是没开播，免得白白重新登录
        let live = b.result !== 129004
        if (live) {
          try {
            live = await this.liveStatus(uid)
          } catch (e) {}
        }
        if (!live) {
          const err = new Error("主播未开播")
          err.notLive = true
          throw err
        }
      }
    }
    throw new Error(`获取播放信息失败：${lastError?.error_msg || lastError?.result}`)
  }

  async _channel(params) {
    let q = `count=${params.count}&pcursor=${encodeURIComponent(params.pcursor ?? 0)}`
    if (params.filters) q += "&filters=" + encodeURIComponent(JSON.stringify(params.filters))
    const b = await this._json(`https://live.acfun.cn/api/channel/list?${q}`)
    const c = b.channelListData || b
    if (c.result !== 0) throw new Error("获取直播列表失败：" + (c.error_msg || c.result))
    return { list: c.liveList || [], pcursor: c.pcursor, filters: b.channelFilters }
  }

  _toRoom(l) {
    const covers = l.coverUrls || []
    return {
      roomId: String(l.authorId),
      title: l.title || "",
      cover: acNoQuery(covers[0] || ""),
      userName: l.user?.name || "",
      online: acCount(l.onlineCount ?? l.formatOnlineCount),
    }
  }

  async _roomPage(filters, page) {
    const { list, pcursor } = await this._channel({ count: 60, pcursor: Math.max(0, page - 1), filters })
    return { hasMore: pcursor != null && pcursor !== "no_more" && list.length > 0, rooms: list.map((l) => this._toRoom(l)) }
  }

  // ---------------- 列表 ----------------

  async recommend(page) {
    return this._roomPage(null, page)
  }

  async categories() {
    const [types, ch] = await Promise.all([
      this._json("https://member.acfun.cn/common/api/getLiveTypeList", {
        method: "POST",
        body: "",
        referer: "https://member.acfun.cn/",
      }).catch(() => null),
      this._channel({ count: 1, pcursor: 0 }).catch(() => null),
    ])
    const groups = new Map()
    if (types && types.result === 0 && Array.isArray(types.typeList) && types.typeList.length) {
      for (const t of types.typeList) {
        if (!groups.has(t.categoryId)) groups.set(t.categoryId, { name: t.categoryName, children: [] })
        groups.get(t.categoryId).children.push([t.id, t.name])
      }
    } else {
      for (const [id, name, children] of AC_TYPES) groups.set(id, { name, children })
    }
    const covers = new Map()
    const order = []
    for (const f of ch?.filters?.liveChannelDisplayFilters?.[0]?.displayFilters || []) {
      if (f.filterType === 1 && f.filterId) {
        covers.set(f.filterId, f.cover || "")
        order.push(f.filterId)
      }
    }
    const ids = [...order.filter((id) => groups.has(id)), ...[...groups.keys()].filter((id) => !order.includes(id))]
    return ids.map((id) => {
      const g = groups.get(id)
      const pic = covers.get(id) || ""
      return {
        id: String(id),
        name: g.name,
        children: [
          { id: `c${id}`, name: `全部${g.name}`, pic },
          ...g.children.map(([cid, cname]) => ({ id: String(cid), name: cname, pic })),
        ],
      }
    })
  }

  async categoryRooms(category, page) {
    const id = String(category.id)
    const filters = id.startsWith("c")
      ? [{ filterType: 1, filterId: Number(id.slice(1)) }]
      : [{ filterType: 2, filterId: Number(id) }]
    return this._roomPage(filters, page)
  }

  async search(keyword, page) {
    if (page > 1) return { hasMore: false, rooms: [] }
    const kw = String(keyword || "").trim().toLowerCase()
    if (!kw) return { hasMore: false, rooms: [] }
    const { list } = await this._channel({ count: 1000, pcursor: 0 })
    const rooms = list
      .filter((l) =>
        [l.title, l.user?.name, l.type?.name, l.type?.categoryName, String(l.authorId)].some((s) =>
          String(s || "").toLowerCase().includes(kw),
        ),
      )
      .map((l) => this._toRoom(l))
    return { hasMore: false, rooms }
  }

  async searchAnchors(keyword, page) {
    const kw = String(keyword || "").trim()
    if (!kw) return { hasMore: false, anchors: [] }
    const b = await this._json(
      `https://api-new.app.acfun.cn/rest/app/search/user?keyword=${encodeURIComponent(kw)}&pCursor=${Math.max(0, page - 1)}`,
      { referer: "https://www.acfun.cn/" },
    )
    if (b.result !== 0) throw new Error("搜索主播失败：" + (b.error_msg || b.result))
    const anchors = (b.userList || []).map((u) => ({
      roomId: String(u.userId ?? u.id),
      userName: u.userName || "",
      avatar: acNoQuery(u.userImg || ""),
      live: !!u.liveId,
    }))
    const hasMore = b.pCursor !== "no_more" && anchors.length > 0 && (b.pageNum ? page < b.pageNum : true)
    return { hasMore, anchors }
  }

  // ---------------- 房间 ----------------

  _uid(roomId) {
    const uid = String(roomId ?? "").trim()
    if (!/^\d+$/.test(uid)) throw new Error("房间号应为主播 uid（数字）")
    return uid
  }

  async _liveInfo(uid) {
    const b = await this._json(`https://live.acfun.cn/api/live/info?authorId=${uid}`, {
      referer: `https://live.acfun.cn/live/${uid}`,
    })
    if (b.result !== 0) throw new Error("获取直播间信息失败：" + (b.error_msg || b.result))
    const user = b.user || {}
    if (!user.name && (!user.href || user.href === "0")) throw new Error("直播间不存在")
    return b
  }

  async room(roomId) {
    const uid = this._uid(roomId)
    const b = await this._liveInfo(uid)
    const user = b.user || {}
    const live = !!b.liveId
    return {
      roomId: uid,
      title: b.title || `${user.name || uid} 的直播间`,
      cover: acNoQuery((b.coverUrls || [])[0] || ""),
      userName: user.name || "",
      userAvatar: acNoQuery(user.headUrl || ""),
      online: live ? acCount(b.onlineCount ?? b.formatOnlineCount) : 0,
      live,
      introduction: user.signature || "",
      notice: "",
      url: `https://live.acfun.cn/live/${uid}`,
      data: { liveId: b.liveId || "" },
      danmakuData: { uid, liveId: b.liveId || "" },
    }
  }

  async liveStatus(roomId) {
    const uid = this._uid(roomId)
    const b = await this._liveInfo(uid)
    return !!b.liveId
  }

  // ---------------- 播放 ----------------

  async qualities(room) {
    const uid = this._uid(room.roomId)
    const { data } = await this._startPlay(uid)
    let res = {}
    try {
      res = JSON.parse(data.videoPlayRes || "{}")
    } catch (e) {}
    const byType = new Map()
    for (const manifest of res.liveAdaptiveManifest || []) {
      for (const rep of manifest.adaptationSet?.representation || []) {
        if (!rep.url) continue
        const key = rep.qualityType || rep.name || String(rep.bitrate)
        if (!byType.has(key)) {
          byType.set(key, { name: rep.name || key, bitrate: rep.bitrate || 0, hidden: !!rep.hidden, urls: [], hls: [] })
        }
        const q = byType.get(key)
        const list = /\.m3u8(\?|$)/.test(rep.url) ? q.hls : q.urls
        if (!list.includes(rep.url)) list.push(rep.url)
      }
    }
    let list = [...byType.values()].filter((q) => q.urls.length || q.hls.length)
    if (list.some((q) => !q.hidden)) list = list.filter((q) => !q.hidden)
    if (!list.length) throw new Error("没有可用的播放地址")
    list.sort((a, b) => b.bitrate - a.bitrate)
    return list.map((q) => ({ name: q.name, data: { urls: q.urls.length ? q.urls : q.hls, hls: q.hls, bitrate: q.bitrate } }))
  }

  async playUrls(room, quality) {
    const urls = quality?.data?.urls || []
    if (!urls.length) throw new Error("没有可用的播放地址")
    return { urls, headers: { "user-agent": AC_UA, referer: "https://live.acfun.cn/" } }
  }

  async avPlayerUrls(room, quality) {
    const hls = quality?.data?.hls || []
    if (!hls.length) return null
    return { urls: hls, headers: { "user-agent": AC_UA, referer: "https://live.acfun.cn/" } }
  }

  // ---------------- 弹幕 ----------------

  async _danmakuStart(room, session) {
    const uid = this._uid(room?.roomId ?? room?.danmakuData?.uid)
    let play
    try {
      play = await this._startPlay(uid)
    } catch (e) {
      if (!e.notLive) throw e
      this._waitForLive(uid, session, "主播未开播，开播后自动连接弹幕")
      return
    }
    const { data, vis } = play
    const tickets = (data.availableTickets || []).filter((t) => typeof t === "string" && t)
    if (!tickets.length) throw new Error("弹幕服务器没有给出可用的 ticket")
    const s = session.data
    Object.assign(s, {
      uid,
      userId: vis.userId,
      st: vis.st,
      securityKey: CryptoJS.enc.Base64.parse(vis.security),
      sessKey: null,
      liveId: data.liveId,
      attach: data.enterRoomAttach || "",
      tickets,
      ticketIndex: 0,
      ticketRetries: 0,
      seqId: 1,
      headerSeqId: 1,
      hbSeq: 0,
      appId: 0,
      instanceId: 0,
      heartbeat: false,
      entered: false,
      ended: false,
      online: -1,
    })
    const ws = await session.websocket(AC_WS)
    s.ws = ws
    ws.onMessage = (d) => this._onFrame(session, d)
    ws.onClose = () => {
      s.ws = null
    }
    ws.send(this._encode(s, "Basic.Register", this._registerRequest(s), { register: true }))
    s.seqId++
  }

  async _danmakuStop(session) {
    const s = session.data
    s.waiting = false
    const wasEnded = s.ended
    s.ended = true
    if (s.ws && s.sessKey && !wasEnded) {
      try {
        s.ws.send(this._csCmd(s, "ZtLiveCsUserExit", null))
        s.seqId++
        s.ws.send(this._encode(s, "Basic.Unregister", null))
      } catch (e) {}
    }
  }

  _waitForLive(uid, session, text) {
    const s = session.data
    s.waiting = true
    session.emit([{ type: "system", text }])
    session.setInterval(async () => {
      if (!s.waiting) return
      let live = false
      try {
        live = await this.liveStatus(uid)
      } catch (e) {}
      if (live && s.waiting) {
        s.waiting = false
        session.fail("主播已开播，正在连接弹幕")
      }
    }, 60000)
  }

  _registerRequest(s) {
    const app = new Proto.Writer().string(4, AC_SDK).string(5, AC_LINK_VERSION)
    const device = new Proto.Writer().varint(1, 9 /* H5_WINDOWS */).string(3, "h5")
    const zt = new Proto.Writer().string(1, AC_KPN).string(2, "PC_WEB").varint(4, s.userId)
    return new Proto.Writer()
      .message(1, app)
      .message(2, device)
      .varint(4, 1 /* kPresenceOnline */)
      .varint(5, 1 /* kAppInForeground */)
      .message(11, zt)
      .finish()
  }

  _keepAlive(s) {
    const body = new Proto.Writer().varint(1, 1).varint(2, 1).finish()
    return this._encode(s, "Basic.KeepAlive", body)
  }

  _csCmd(s, type, payload) {
    const w = new Proto.Writer().string(1, type)
    if (payload) w.bytes(2, payload)
    w.string(3, s.tickets[s.ticketIndex % s.tickets.length]).string(4, s.liveId)
    return this._encode(s, "Global.ZtLiveInteractive.CsCmd", w.finish())
  }

  _enterRoom(s) {
    const w = new Proto.Writer()
    if (s.attach) w.string(4, s.attach)
    w.string(5, AC_SDK)
    const frame = this._csCmd(s, "ZtLiveCsEnterRoom", w.finish())
    s.seqId++
    return frame
  }

  _heartbeat(s) {
    const w = new Proto.Writer().varint(1, Date.now())
    if (s.hbSeq) w.varint(2, s.hbSeq)
    const frame = this._csCmd(s, "ZtLiveCsHeartbeat", w.finish())
    s.hbSeq++
    s.seqId++
    return frame
  }

  // 帧：magic + 头长度 + 负载长度 + PacketHeader + 加密的 UpstreamPayload
  _encode(s, command, payloadData, opts = {}) {
    const up = new Proto.Writer().string(1, command).varint(2, s.seqId).varint(3, 1)
    if (payloadData && payloadData.length) up.bytes(4, payloadData)
    up.string(9, "mainApp")
    const body = up.finish()

    const h = new Proto.Writer()
    if (s.appId) h.varint(1, s.appId)
    h.varint(2, s.userId)
    if (s.instanceId) h.varint(3, s.instanceId)
    h.varint(7, body.length)
    h.varint(8, opts.register ? 1 : 2)
    if (opts.register) h.message(9, new Proto.Writer().varint(1, 1).bytes(2, Bytes.fromUtf8(s.st)))
    h.varint(10, opts.headerSeqId ?? s.seqId)
    h.string(12, AC_KPN)
    const header = h.finish()

    const enc = acAesEncrypt(opts.register ? s.securityKey : s.sessKey, body)
    return Bytes.concat(new Uint8Array(AC_MAGIC), acU32(header.length), acU32(enc.length), header, enc)
  }

  _decode(s, b) {
    if (b.length < 12 || b[0] !== 0xab || b[1] !== 0xcd || b[2] !== 0x00 || b[3] !== 0x01) return null
    const hl = acReadU32(b, 4)
    const pl = acReadU32(b, 8)
    if (12 + hl + pl > b.length) return null
    const header = Proto.decode(b.slice(12, 12 + hl))
    let payload = b.slice(12 + hl, 12 + hl + pl)
    const appId = pbNum(header, 1)
    if (!s.appId && appId) s.appId = appId
    const seq = pbFirst(header, 10)
    if (seq !== undefined) s.headerSeqId = seq
    const mode = pbNum(header, 8)
    if (mode === 1) payload = acAesDecrypt(s.securityKey, payload)
    else if (mode === 2) {
      if (!s.sessKey) return null
      payload = acAesDecrypt(s.sessKey, payload)
    }
    return { down: Proto.decode(payload), size: 12 + hl + pl }
  }

  async _onFrame(session, data) {
    if (typeof data === "string") return
    const s = session.data
    let rest = data
    while (rest.length >= 12) {
      let r
      try {
        r = this._decode(s, rest)
      } catch (e) {
        log("解析弹幕数据失败", String(e && e.message))
        return
      }
      if (!r) return
      try {
        await this._handle(session, r.down)
      } catch (e) {
        log("处理弹幕数据失败", String(e && e.message))
      }
      rest = rest.slice(r.size)
    }
  }

  async _handle(session, down) {
    const s = session.data
    const command = pbStr(down, 1)
    const errorCode = pbNum(down, 3)
    const payload = pbFirst(down, 4)
    switch (command) {
      case "Basic.Register": {
        if (errorCode) {
          this._vis = null
          session.fail(`弹幕服务器注册失败（${errorCode} ${pbStr(down, 5)}）`)
          return
        }
        const res = Proto.decode(payload || new Uint8Array(0))
        const key = pbFirst(res, 2)
        if (!(key instanceof Uint8Array)) {
          session.fail("弹幕服务器没有返回会话密钥")
          return
        }
        s.sessKey = Bytes.toWordArray(key)
        s.instanceId = pbFirst(res, 3) ?? 0
        if (!s.ws) return
        s.ws.send(this._keepAlive(s))
        s.seqId++
        s.ws.send(this._enterRoom(s))
        return
      }
      case "Global.ZtLiveInteractive.CsCmd": {
        const ack = Proto.decode(payload || new Uint8Array(0))
        const type = pbStr(ack, 1)
        const code = pbNum(ack, 2)
        if (type === "ZtLiveCsEnterRoomAck") {
          if (code) {
            // ticket 不能用时换下一个
            if (++s.ticketRetries < s.tickets.length * 2 && s.ws) {
              s.ticketIndex++
              s.ws.send(this._enterRoom(s))
            } else {
              session.fail(`进入直播间失败（${code} ${pbStr(ack, 3)}）`)
            }
            return
          }
          s.entered = true
          s.ticketRetries = 0
          if (!s.heartbeat) {
            s.heartbeat = true
            const enter = pbMsg(ack, 4)
            const interval = (enter && pbNum(enter, 1)) || 10000
            session.setInterval(() => {
              if (!s.ws || s.ended) return
              s.ws.send(this._heartbeat(s))
              if (s.hbSeq % 5 === 4) {
                s.ws.send(this._keepAlive(s))
                s.seqId++
              }
            }, Math.max(3000, interval))
          }
          session.ready()
        } else if (code && type !== "ZtLiveCsHeartbeatAck") {
          log("CsCmd 错误", type, code, pbStr(ack, 3))
        }
        return
      }
      case "Push.ZtLiveInteractive.Message": {
        if (s.ws) s.ws.send(this._encode(s, "Push.ZtLiveInteractive.Message", null, { headerSeqId: s.headerSeqId }))
        if (payload) await this._handleMessage(session, Proto.decode(payload))
        return
      }
      case "Basic.Unregister":
        if (!s.ended) session.fail("弹幕服务器断开了连接")
        return
      case "Basic.KeepAlive":
      case "Basic.Ping":
      case "Push.SyncSession":
      case "Push.DataUpdate":
        return
      default:
        if (errorCode) {
          log("弹幕服务器错误", command, errorCode, pbStr(down, 5))
          if (errorCode === 10018) session.fail("弹幕服务器要求重新登录")
        }
    }
  }

  async _handleMessage(session, msg) {
    const s = session.data
    const type = pbStr(msg, 1)
    let payload = pbFirst(msg, 3) || new Uint8Array(0)
    if (pbNum(msg, 2) === 2 /* GZIP */) payload = await Zip.gunzip(payload)
    const body = Proto.decode(payload)
    switch (type) {
      case "ZtLiveScActionSignal": {
        const chats = []
        for (const item of pbAll(body, 1)) {
          const it = Proto.decode(item)
          if (pbStr(it, 1) !== "CommonActionSignalComment") continue
          for (const p of pbAll(it, 2)) {
            const c = this._comment(Proto.decode(p))
            if (c) chats.push(c)
          }
        }
        if (chats.length) {
          chats.sort((a, b) => a.time - b.time)
          session.emit(chats.map((c) => c.message))
        }
        return
      }
      case "ZtLiveScStateSignal": {
        const out = []
        for (const item of pbAll(body, 1)) {
          const it = Proto.decode(item)
          const sig = pbStr(it, 1)
          const p = pbFirst(it, 2) || new Uint8Array(0)
          if (sig === "CommonStateSignalDisplayInfo") {
            const online = acCount(pbStr(Proto.decode(p), 1))
            if (online !== s.online) {
              s.online = online
              out.push({ type: "online", online })
            }
          } else if (sig === "CommonStateSignalRecentComment") {
            const recent = this._recentKeys(s.uid)
            const chats = []
            for (const cp of pbAll(Proto.decode(p), 1)) {
              const c = this._comment(Proto.decode(cp))
              if (c && !recent.has(c.key)) {
                recent.add(c.key)
                chats.push(c)
              }
            }
            while (recent.size > 200) recent.delete(recent.values().next().value)
            chats.sort((a, b) => a.time - b.time)
            for (const c of chats) out.push(c.message)
          }
        }
        if (out.length) session.emit(out)
        return
      }
      case "ZtLiveScNotifySignal": {
        for (const item of pbAll(body, 1)) {
          const it = Proto.decode(item)
          const sig = pbStr(it, 1)
          const p = Proto.decode(pbFirst(it, 2) || new Uint8Array(0))
          if (sig === "CommonNotifySignalKickedOut") {
            session.emit([{ type: "system", text: "已被移出直播间" + (pbStr(p, 1) ? "：" + pbStr(p, 1) : "") }])
          } else if (sig === "CommonNotifySignalViolationAlert") {
            session.emit([{ type: "system", text: "直播间违规提醒：" + pbStr(p, 1) }])
          }
        }
        return
      }
      case "ZtLiveScStatusChanged": {
        const st = pbNum(body, 1)
        if (st === 1 /* LIVE_CLOSED */ || st === 4 /* LIVE_BANNED */) {
          if (s.ended) return
          s.ended = true
          const reason = pbStr(pbMsg(body, 3), 1)
          if (s.ws) {
            const ws = s.ws
            try {
              ws.send(this._csCmd(s, "ZtLiveCsUserExit", null))
              s.seqId++
              ws.send(this._encode(s, "Basic.Unregister", null))
            } catch (e) {}
            // 脚本自己关闭不算意外断开，App 不会重连；会话留着等开播
            s.ws = null
            session.setTimeout(() => {
              try {
                if (typeof ws.close === "function") ws.close(1000, "live closed")
              } catch (e) {}
            }, 1000)
          }
          this._waitForLive(s.uid, session, st === 1 ? "直播已结束" : "直播间已被封禁" + (reason ? "：" + reason : ""))
        } else if (st === 2 /* NEW_LIVE_OPENED */) {
          session.fail("主播重新开播，正在重新连接弹幕")
        }
        return
      }
      case "ZtLiveScTicketInvalid": {
        if (!s.ws) return
        s.ticketIndex++
        s.ws.send(this._enterRoom(s))
        return
      }
    }
  }

  _recentKeys(uid) {
    if (!this._recent) this._recent = new Map()
    if (!this._recent.has(uid)) this._recent.set(uid, new Set())
    return this._recent.get(uid)
  }

  // CommonActionSignalComment：content(1) sendTimeMs(2) userInfo(3)
  _comment(c) {
    const text = pbStr(c, 1)
    if (!text) return null
    const user = pbMsg(c, 3)
    const name = pbStr(user, 2)
    const avatar = pbMsg(user, 3)
    const face = acNoQuery(pbStr(avatar, 2))
    const time = pbNum(c, 2)
    const message = { type: "chat", user: name || "AcFun 用户", text }
    if (face) message.face = face
    return { time, key: `${pbNum(user, 1)}:${time}:${text}`, message }
  }
}
