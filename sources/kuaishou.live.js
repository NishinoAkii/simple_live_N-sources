/*
 * 快手直播（live.kuaishou.com）—— SimpleLive 直播源脚本，接口见 doc/live_source_api.md（v1）
 *
 * 房间号 = 主播的 principalId（快手号，https://live.kuaishou.com/u/<id>）；也接受 3x… 形式的
 * 用户 id（网页会换成快手号，详情里的 roomId 以快手号为准）。只用游客身份，不登录。
 *
 * 接口（2026-10 从日本 / 台湾 / 新加坡 / 香港出口实测，均未见地区限制）：
 * - 推荐：/live_api/hot/list?type=HOT&filterType=0&page=&pageSize=24（游客可用，一页约 50 个）。
 * - 分类：/live_api/category/data?type=<2..8>&page=&size=（大类 2 PC端游 / 3 主机 / 4 手游 /
 *   5 棋牌 / 6 娱乐 / 7 综合 / 8 文化，一页 50 个小类）；结果在 Storage 里缓存一天。
 *   游戏小类的直播间：/live_api/gameboard/list?gameId=&page=&pageSize=20&filterType=0；
 *   娱乐 / 综合 / 文化（小类 id 为 100000x）：/live_api/non-gameboard/list，按 cursor 翻页。
 * - 搜索主播：/live_api/search/author（游客可用，但结果很少，很多关键词返回空列表；空时退回
 *   /live_api/search/overview 的 authors）。搜索直播间：/live_api/search/liveStream 对游客返回
 *   result=10「服务器繁忙」，退回综合搜索 overview：其中的 liveStreams（游客也是空的）+ 正在直播
 *   的主播 + 第一个同名分类（如“和平精英”）下的热门直播间（翻页沿用分类的翻页）。
 * - 房间：网页 /u/<id> 的 window.__INITIAL_STATE__.liveroom.playList[0]（服务端渲染，游客可用）。
 *   里面有 FLV（playUrls.h264 / hevc 的 adaptationSet.representation，高清 / 超清 / 蓝光 4M /
 *   蓝光 8M / 4K，CDN 每次不同：tx / hw / ws-origin.pull.yximgs.com，带 txSecret / hwSecret 等，约 24 小时
 *   有效）和一条 HLS（hlsPlayUrl，只有“高清”一档，带 auth_key / wsSecret；改清晰度或改扩展名都会
 *   403）。播放不需要请求头（给了 referer，CDN 不检查）。网页里没有直播标题和单个直播间
 *   的在线人数：标题优先用列表 / 搜索里见过的，人数同理（gameInfo.watchingCount 是整个分类的）。
 *   未开播：isLiving=false、status.forbiddenState=671；快手号不存在：errorType.type=22。
 * - 弹幕：wss（websocketinfo 给的地址）+ protobuf SocketMessage（payloadType 200 进房
 *   CSWebEnterRoom{token, liveStreamId, pageId}，1 心跳，300 进房确认带心跳间隔，310
 *   SCWebFeedPush：commentFeeds 弹幕、displayWatchingCount 人数、systemNoticeFeeds 系统提示，
 *   103 错误，601 = 直播结束）；compressionType 2 为 gzip，3 为 AES-128-CBC（网页内置密钥）。
 *   token 只能从 /live_api/liveroom/websocketinfo?liveStreamId= 拿；网页请求它时带 __NS_hxfalcon
 *   签名（混淆的 JS 虚拟机，会读调用栈）和 kww 指纹头（kwfv1 / kwpsec）。游客直接请求返回 result=2
 *   （OPERATE_TOO_FAST「请求过快」，换出口、带 did 和 Referer 都一样；/live_api/liveroom/livedetail
 *   也是），所以匿名用户没有弹幕：脚本在聊天区给出提示（不调用 ready / fail，App 不会退避重连），
 *   3 分钟内不再请求。脚本不伪造签名和指纹、不上报假日志“注册”设备、不解验证码。
 *   如果本源的 Cookie 里有网页登录态（以后 App 若提供“源 Cookie”设置，用户自己填），网页本身
 *   会把 token 放进 __INITIAL_STATE__.liveroom，或者 websocketinfo 返回 result=1，此时弹幕
 *   自动可用。协议按网页 app.js 内置的 proto 定义实现；解包（明文 / gzip / AES）用合成数据在
 *   QuickJS 运行时里验证过，但拿不到 token，没有连上过真实弹幕服务器。
 * - 链接：live.kuaishou.com/u/<id>、/profile/<id>，(livev|v).m.chenzhongtech.com/fw/live/<id>，
 *   m.gifshow.com/fw/live/<id>；v.kuaishou.com/<短码> 整段作为房间号传进 room()，由脚本跟随
 *   302 换成快手号（App 收藏 / 历史请以 room() 返回的 roomId 为准；手头没有真实短链，只验证了
 *   无效短码的报错）。
 * - 风控：所有接口返回 data.result 时，1 成功，2 请求过快，10 服务器繁忙，400002 需要验证码，
 *   67606 地区不支持，60200 需要登录；这些都会变成中文错误提示，不会重试轰炸（只在网络错误时
 *   隔 1 秒重试一次：代理换出口时偶尔会 TLS 重置）。`did` Cookie 由快手首次响应下发，脚本把它
 *   存进 Storage，Cookie 丢失时写回；没有下发就按网页格式（web_ + 32 位十六进制）生成并固定。
 * - 没有醒目留言；礼物、点赞、分享不转发；在线人数只在弹幕可用时实时更新。
 */

const KS_ORIGIN = "https://live.kuaishou.com"
const KS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
const KS_UA_MOBILE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const KS_ID = /^[A-Za-z0-9_\-]{2,64}$/
const KS_SHORT = /^(?:https?:\/\/)?v\.kuaishou\.com\/([A-Za-z0-9]+)/

// 分类大类（/live_api/category/config，2026-10）；6/7/8 的小类走 non-gameboard
const KS_TYPES = [
  ["2", "PC端游"], ["3", "主机游戏"], ["4", "手游直播"], ["5", "棋牌直播"],
  ["6", "娱乐天地"], ["7", "综合直播"], ["8", "科技文化"],
]
const KS_NON_GAME = ["6", "7", "8"]

const KS_RESULT = {
  2: "请求过快，快手暂时拒绝了游客请求，请稍后再试",
  10: "快手服务器繁忙，请稍后再试",
  15: "请求过于频繁，请稍后再试",
  16: "请求被快手拒绝，请稍后再试",
  22: "找不到这个快手号的直播间",
  109: "需要登录快手账号",
  60200: "需要登录快手账号",
  67601: "这是私密直播间",
  67606: "该直播当前地区暂不支持观看",
  400002: "快手要求完成验证码，请稍后再试（或先在浏览器里打开一次 live.kuaishou.com）",
  671: "主播当前未开播",
  999: "找不到这个主播",
}

// 弹幕包 compressionType=3 的 AES-128-CBC 密钥（网页 app.js 内置）
const KS_AES_KEY = "PPbzKKL7NB15leYy"
const KS_AES_IV = "JRODKJiolJ9xqso0"
const KS_WS_COOLDOWN = 3 * 60 * 1000

function ksCount(v) {
  if (typeof v === "number") return Math.round(v)
  const s = String(v ?? "").trim().toLowerCase()
  const n = parseFloat(s.replace(/,/g, ""))
  if (!isFinite(n)) return 0
  if (s.includes("亿")) return Math.round(n * 1e8)
  if (s.includes("万") || s.includes("w")) return Math.round(n * 10000)
  if (s.includes("k")) return Math.round(n * 1000)
  return Math.round(n)
}

function ksStr(v) {
  return v === undefined || v === null ? "" : String(v).trim()
}

function ksCookieValue(cookies, name) {
  if (!cookies) return ""
  if (typeof cookies === "object") return ksStr(cookies[name])
  for (const part of String(cookies).split(";")) {
    const i = part.indexOf("=")
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ""
}

function ksResultError(result, msg) {
  const known = KS_RESULT[result]
  return new Error(known ? `快手：${known}` : `快手接口返回错误 ${result}${msg ? "：" + msg : ""}`)
}

// 把 __INITIAL_STATE__ 里的 JS 字面量（含 undefined）转成 JSON
function ksParseState(html) {
  const start = html.indexOf("window.__INITIAL_STATE__=")
  if (start < 0) return null
  let end = html.indexOf(";(function(){var s;", start)
  if (end < 0) end = html.indexOf("</script>", start)
  if (end < 0) return null
  const text = html.slice(start + "window.__INITIAL_STATE__=".length, end)
    .replace(/([:\[,])undefined(?=[,\}\]])/g, "$1null")
  try {
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}

// playUrls 有两种形状：房间页 {h264:{adaptationSet}, hevc:{…}}，列表 [{adaptationSet}]
function ksRepresentations(playUrls) {
  const pick = (x) => (x && x.adaptationSet && Array.isArray(x.adaptationSet.representation)) ? x.adaptationSet.representation : []
  if (Array.isArray(playUrls)) return { h264: pick(playUrls[0]), hevc: [] }
  if (playUrls && typeof playUrls === "object") return { h264: pick(playUrls.h264), hevc: pick(playUrls.hevc) }
  return { h264: [], hevc: [] }
}

function ksPageId() {
  const cs = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"
  let s = ""
  for (let i = 0; i < 16; i++) s += cs[Math.floor(Math.random() * cs.length)]
  return s + "_" + Date.now()
}

function ksColor(v) {
  const s = ksStr(v).replace(/^#/, "")
  if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16)
  if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(2), 16)
  return undefined
}

// 不用 instanceof：运行环境给的 Uint8Array 不一定来自脚本自己的全局对象
function ksIsBytes(v) {
  return v !== null && typeof v === "object" && ArrayBuffer.isView(v)
}

function ksField(msg, no) {
  const v = msg[no]
  return v && v.length ? v[0] : undefined
}

function ksText(msg, no) {
  const v = ksField(msg, no)
  return ksIsBytes(v) ? Proto.str(v) : ""
}

function ksSocketMessage(payloadType, payload) {
  const w = new Proto.Writer()
  w.varint(1, payloadType)
  w.bytes(3, payload)
  return w.finish()
}

class KuaishouLive extends LiveSource {
  key = "kuaishou"
  name = "快手直播"
  version = "1.0.0"
  url = "https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/kuaishou.live.js"
  description = "推荐、分类、搜索、播放（含 4K）；弹幕暂不可用（快手要求网页签名）"
  apiVersion = 1
  icon = "https://static.yximgs.com/udata/pkg/WEB-LIVE/kwai_icon.8f6787d8.ico"
  // *.gifshow.com / *.kuaishou.com：websocketinfo 给出的弹幕服务器（livejs-ws-group*.gifshow.com）
  domains = ["live.kuaishou.com", "v.kuaishou.com", "*.kuaishou.com", "*.gifshow.com"]
  links = [
    "live\\.kuaishou\\.com/u/([A-Za-z0-9_\\-]+)",
    "live\\.kuaishou\\.com/profile/([A-Za-z0-9_\\-]+)",
    "chenzhongtech\\.com/fw/live/([A-Za-z0-9_\\-]+)",
    "gifshow\\.com/fw/live/([A-Za-z0-9_\\-]+)",
    "(v\\.kuaishou\\.com/[A-Za-z0-9]+)",
  ]

  // 列表里见过的标题 / 人数（房间页没有），按快手号记
  _seen = {}
  _didChecked = false
  _cursors = {}
  _hotSeen = null

  // ---------------- 通用请求 ----------------

  // 设备号 did：优先用快手下发的（网页首次响应的 Set-Cookie），存进 Storage；Cookie 丢了就写回；
  // 第一次响应后仍没有，就按网页的格式（web_ + 32 位十六进制）生成一个并固定下来
  async _ensureDid(afterResponse) {
    if (this._didChecked) return
    try {
      const did = ksCookieValue(await Http.getCookies(KS_ORIGIN + "/"), "did")
      const saved = ksStr(await Storage.get("did"))
      if (did) {
        if (did !== saved) await Storage.set("did", did)
        this._didChecked = true
      } else if (saved) {
        await Http.setCookies(KS_ORIGIN + "/", `did=${saved}`)
        this._didChecked = true
      } else if (afterResponse) {
        let hex = ""
        for (let i = 0; i < 32; i++) hex += "0123456789abcdef"[Math.floor(Math.random() * 16)]
        await Http.setCookies(KS_ORIGIN + "/", `did=web_${hex}`)
        await Storage.set("did", `web_${hex}`)
        this._didChecked = true
      }
    } catch (e) {
      this._didChecked = true
      log("did 处理失败", String(e && e.message || e))
    }
  }

  async _request(opts) {
    await this._ensureDid(false)
    // 单次调用限时 20 秒：每次请求 8 秒，失败重试一次
    if (!opts.timeout) opts = Object.assign({ timeout: 8000 }, opts)
    let res
    try {
      res = await Http.request(opts)
    } catch (e) {
      // 代理换出口时偶尔会断一次连接，隔一秒重试一次
      await new Promise((r) => setTimeout(r, 1000))
      try {
        res = await Http.request(opts)
      } catch (e2) {
        throw new Error("连接快手失败：" + (e2 && e2.message ? e2.message : e2))
      }
    }
    if (!this._didChecked && String(opts.url).startsWith(KS_ORIGIN)) await this._ensureDid(true)
    return res
  }

  _headers(referer, json) {
    const h = {
      "user-agent": KS_UA,
      "accept-language": "zh-CN,zh;q=0.9",
      "referer": referer || KS_ORIGIN + "/",
    }
    h.accept = json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    return h
  }

  async _api(path, query, referer) {
    const res = await this._request({
      url: KS_ORIGIN + path,
      query,
      headers: this._headers(referer, true),
      responseType: "text",
    })
    if (res.status === 403 || res.status === 429) throw new Error(`快手拒绝了请求（HTTP ${res.status}），请稍后再试`)
    if (res.status < 200 || res.status >= 300) throw new Error(`快手接口出错（HTTP ${res.status}）`)
    let json
    try {
      json = JSON.parse(res.body)
    } catch (e) {
      throw new Error("快手返回了无法解析的内容（可能触发了验证），请稍后再试")
    }
    const data = json && typeof json === "object" ? (json.data ?? json) : null
    if (!data || typeof data !== "object") throw new Error("快手返回了空数据")
    if (data.result !== undefined && data.result !== 1) {
      const err = ksResultError(data.result, data.error_msg)
      err.ksResult = data.result
      throw err
    }
    return data
  }

  _remember(item) {
    const id = ksStr(item?.author?.id)
    if (!id) return
    this._seen[id] = {
      title: ksStr(item.caption),
      online: ksCount(item.watchingCount),
      cover: ksStr(item.poster),
      at: Date.now(),
    }
  }

  _roomItem(item) {
    if (!item || typeof item !== "object") return null
    const author = item.author || {}
    const roomId = ksStr(author.id)
    if (!roomId) return null
    this._remember(item)
    return {
      roomId,
      title: ksStr(item.caption) || ksStr(item.gameInfo?.name) || `${ksStr(author.name)}的直播间`,
      cover: ksStr(item.poster) || ksStr(author.avatar),
      userName: ksStr(author.name),
      online: ksCount(item.watchingCount),
    }
  }

  _roomList(list, seen) {
    const rooms = []
    for (const item of Array.isArray(list) ? list : []) {
      const r = this._roomItem(item)
      if (!r) continue
      if (seen) {
        if (seen.has(r.roomId)) continue
        seen.add(r.roomId)
      }
      rooms.push(r)
    }
    return rooms
  }

  // ---------------- 列表 ----------------

  async recommend(page) {
    page = Math.max(1, Number(page) || 1)
    if (page === 1) {
      this._hotSeen = new Set()
      this._cursors.hot = { 1: "" }
    }
    const seen = this._hotSeen || (this._hotSeen = new Set())
    const cursor = (this._cursors.hot && this._cursors.hot[page]) || ""
    const data = await this._api("/live_api/hot/list", { type: "HOT", filterType: 0, page, pageSize: 24, cursor })
    if (!this._cursors.hot) this._cursors.hot = {}
    this._cursors.hot[page + 1] = ksStr(data.cursor)
    const rooms = this._roomList(data.list, seen)
    // 翻页偶尔会重复上一页的内容，去重后一个不剩就当作没有更多
    return { hasMore: !!data.hasMore && rooms.length > 0, rooms }
  }

  async categories() {
    try {
      const cached = await Storage.get("categories")
      if (cached && cached.at > Date.now() - 24 * 3600 * 1000 && Array.isArray(cached.list) && cached.list.length) return cached.list
    } catch (e) { }
    const fetchType = async ([id, name]) => {
      const children = []
      const ids = new Set()
      for (let page = 1; page <= 3; page++) {
        let data
        try {
          data = await this._api("/live_api/category/data", { type: id, page, size: 50 })
        } catch (e) {
          if (page === 1) log(`分类 ${name} 获取失败`, String(e.message || e))
          break
        }
        for (const c of data.list || []) {
          const cid = ksStr(c.id)
          if (!cid || ids.has(cid)) continue
          ids.add(cid)
          children.push({ id: cid, name: ksStr(c.name), pic: ksStr(c.iconUrl) || ksStr(c.poster) })
        }
        if (!data.hasMore || !(data.list || []).length) break
      }
      return { id, name, children }
    }
    // 两批并发，避免一下子打出太多请求
    const list = []
    for (const batch of [KS_TYPES.slice(0, 4), KS_TYPES.slice(4)]) {
      list.push(...await Promise.all(batch.map(fetchType)))
    }
    const ok = list.filter((x) => x.children.length)
    if (!ok.length) throw new Error("快手分类获取失败，请稍后再试")
    if (ok.length === list.length) {
      try { await Storage.set("categories", { at: Date.now(), list }) } catch (e) { }
    }
    return list
  }

  async categoryRooms(category, page) {
    page = Math.max(1, Number(page) || 1)
    const id = ksStr(category && category.id)
    if (!id) throw new Error("分类无效")
    const parent = ksStr(category.parentId)
    const nonGame = KS_NON_GAME.includes(parent) || id.length >= 7
    if (!nonGame) {
      const data = await this._api("/live_api/gameboard/list", { filterType: 0, pageSize: 20, gameId: id, page })
      const rooms = this._roomList(data.list)
      return { hasMore: !!data.hasMore && rooms.length > 0, rooms }
    }
    const key = "ng:" + id
    if (page === 1) this._cursors[key] = { 1: "", seen: new Set() }
    const state = this._cursors[key] || (this._cursors[key] = { seen: new Set() })
    if (page > 1 && state[page] === undefined) return { hasMore: false, rooms: [] }
    const data = await this._api("/live_api/non-gameboard/list", {
      filterType: 0, pageSize: 20, gameId: id, keyword: "", cursor: state[page] || "",
    })
    state[page + 1] = ksStr(data.cursor)
    const rooms = this._roomList(data.list, state.seen)
    return { hasMore: !!data.hasMore && !!state[page + 1] && rooms.length > 0, rooms }
  }

  // ---------------- 搜索 ----------------

  async _overview(keyword) {
    const referer = `${KS_ORIGIN}/search/${encodeURIComponent(keyword)}`
    const data = await this._api("/live_api/search/overview", { keyword, ussid: "" }, referer)
    const sections = Array.isArray(data.list) ? data.list : []
    return (type) => {
      const s = sections.find((x) => x && x.type === type)
      return s && Array.isArray(s.list) ? s.list : []
    }
  }

  async search(keyword, page) {
    keyword = ksStr(keyword)
    page = Math.max(1, Number(page) || 1)
    if (!keyword) return { hasMore: false, rooms: [] }
    const referer = `${KS_ORIGIN}/search/${encodeURIComponent(keyword)}`
    const state = page === 1 ? (this._search = { keyword, category: null, seen: new Set() }) : this._search
    if (page > 1 && (!state || state.keyword !== keyword)) return { hasMore: false, rooms: [] }
    if (page > 1 && state.category) {
      const r = await this.categoryRooms(state.category, page)
      return { hasMore: r.hasMore, rooms: r.rooms.filter((x) => !state.seen.has(x.roomId) && state.seen.add(x.roomId)) }
    }
    try {
      const data = await this._api("/live_api/search/liveStream", { keyword, page, ussid: "" }, referer)
      const rooms = this._roomList(data.list, state.seen)
      if (rooms.length || page > 1) return { hasMore: rooms.length > 0 && data.hasMore !== false, rooms }
    } catch (e) {
      if (page > 1) return { hasMore: false, rooms: [] }
      log("直播间搜索不可用，改用综合搜索", String(e.message || e))
    }
    // 退路（游客常见）：综合搜索里的直播间 + 正在直播的主播 + 同名分类下的热门直播间
    const section = await this._overview(keyword)
    const rooms = this._roomList(section("liveStreams"), state.seen)
    for (const a of section("authors")) {
      const id = ksStr(a && a.id)
      if (!id || !a.living || state.seen.has(id)) continue
      state.seen.add(id)
      rooms.push({ roomId: id, title: `${ksStr(a.name)}的直播间`, cover: ksStr(a.avatar), userName: ksStr(a.name), online: 0 })
    }
    const cat = section("categories").find((c) => c && ksStr(c.categoryId))
    let hasMore = false
    if (cat) {
      const abbr = ksStr(cat.categoryAbbr)
      state.category = {
        id: ksStr(cat.categoryId),
        name: ksStr(cat.title),
        parentId: ["YL", "ZH", "KJ"].includes(abbr) ? "7" : "4",
      }
      try {
        const r = await this.categoryRooms(state.category, 1)
        for (const x of r.rooms) {
          if (state.seen.has(x.roomId)) continue
          state.seen.add(x.roomId)
          rooms.push(x)
        }
        hasMore = r.hasMore
      } catch (e) {
        log("分类直播间获取失败", String(e.message || e))
      }
    }
    return { hasMore, rooms }
  }

  async searchAnchors(keyword, page) {
    keyword = ksStr(keyword)
    page = Math.max(1, Number(page) || 1)
    if (!keyword) return { hasMore: false, anchors: [] }
    const referer = `${KS_ORIGIN}/search/${encodeURIComponent(keyword)}`
    const toAnchor = (a) => ({
      roomId: ksStr(a && a.id),
      userName: ksStr(a && a.name),
      avatar: ksStr(a && a.avatar),
      live: !!(a && a.living),
    })
    const data = await this._api("/live_api/search/author", {
      key: keyword, keyword, page, count: 15, ussid: "", lssid: "",
    }, referer)
    const list = Array.isArray(data.list) ? data.list : []
    let anchors = list.map(toAnchor).filter((a) => a.roomId)
    if (!anchors.length && page === 1) {
      try {
        anchors = (await this._overview(keyword))("authors").map(toAnchor).filter((a) => a.roomId)
      } catch (e) { }
    }
    return { hasMore: list.length >= 15, anchors }
  }

  // ---------------- 房间 ----------------

  async _resolveRoomId(roomId) {
    let id = ksStr(roomId)
    const short = id.match(KS_SHORT)
    if (short) {
      // 分享短链按手机网页跳转：…/fw/live/<用户 id>?…（/u/ 页面也认这种 3x… id）
      const res = await this._request({
        url: `https://v.kuaishou.com/${short[1]}`,
        headers: { "user-agent": KS_UA_MOBILE },
        followRedirects: false,
      })
      const h = res.headers || {}
      let loc = h.location ?? h.Location ?? ""
      if (Array.isArray(loc)) loc = loc[0]
      loc = ksStr(loc)
      const m = loc.match(/\/(?:u|profile|fw\/live)\/([A-Za-z0-9_\-]+)/)
      if (!m) {
        if (/\/fw\/photo\/|short-video|\/photo\//.test(loc)) throw new Error("这个快手分享链接是作品，不是直播间")
        throw new Error("快手短链接无效或已过期")
      }
      id = m[1]
    }
    id = id.replace(/^@/, "")
    if (!KS_ID.test(id)) throw new Error("快手号格式不对")
    return id
  }

  async _roomPage(roomId) {
    const id = await this._resolveRoomId(roomId)
    const res = await this._request({
      url: `${KS_ORIGIN}/u/${encodeURIComponent(id)}`,
      headers: this._headers(KS_ORIGIN + "/", false),
    })
    if (res.status === 404) throw new Error("找不到这个快手号的直播间")
    if (res.status < 200 || res.status >= 300) throw new Error(`快手直播间页面打开失败（HTTP ${res.status}）`)
    const html = String(res.body || "")
    const state = ksParseState(html)
    const room = state && state.liveroom
    const list = room && Array.isArray(room.playList) ? room.playList : []
    if (!list.length) {
      if (/__CAPTCHA_INFO__\s*=\s*\[\s*\{/.test(html) || /captcha/i.test(html.slice(0, 3000))) {
        throw new Error("快手要求完成验证码，请稍后再试（或先在浏览器里打开一次 live.kuaishou.com）")
      }
      throw new Error("快手直播间页面解析失败（网页结构可能变了）")
    }
    const entry = list.find((x) => x && x.isLiving) || list[0]
    return { id, state, room, entry }
  }

  async room(roomId) {
    const { id, room, entry } = await this._roomPage(roomId)
    if (entry.errorType) {
      const t = entry.errorType
      throw new Error(KS_RESULT[t.type] ? `快手：${KS_RESULT[t.type]}` : `快手：${ksStr(t.title) || "直播间无法访问"}`)
    }
    const author = entry.author || {}
    const stream = entry.liveStream || {}
    const game = entry.gameInfo || {}
    const principalId = ksStr(author.id) || id
    if (!ksStr(author.id) && !ksStr(author.name)) throw new Error("找不到这个快手号的直播间")
    const banned = author.bannedStatus || {}
    if (banned.banned || banned.isolate) throw new Error("快手：该主播账号已被封禁或不可见")
    const liveStreamId = ksStr(stream.id)
    const live = !!entry.isLiving && !!liveStreamId
    const seen = this._seen[principalId] || this._seen[id] || {}
    const reps = ksRepresentations(stream.playUrls)
    const name = ksStr(author.name)
    const title = (live && seen.title) || (live && ksStr(game.name) ? `${name} · ${ksStr(game.name)}` : `${name}的直播间`)
    return {
      roomId: principalId,
      title,
      cover: ksStr(stream.poster) || seen.cover || ksStr(author.avatar),
      userName: name,
      userAvatar: ksStr(author.avatar),
      online: live ? (seen.online || 0) : 0,
      live,
      introduction: ksStr(author.description),
      url: `${KS_ORIGIN}/u/${principalId}`,
      data: live ? {
        principalId,
        h264: reps.h264.map((r) => ({ name: ksStr(r.name), level: Number(r.level) || 0, bitrate: Number(r.bitrate) || 0, url: ksStr(r.url) })),
        hevc: reps.hevc.map((r) => ({ name: ksStr(r.name), level: Number(r.level) || 0, bitrate: Number(r.bitrate) || 0, url: ksStr(r.url) })),
        hls: ksStr(stream.hlsPlayUrl),
      } : null,
      danmakuData: live ? {
        principalId,
        liveStreamId,
        // 登录态下网页会直接给出 token / 地址；游客为空，到 danmaku.start 里再试接口
        token: ksStr(room && room.token),
        websocketUrls: (room && Array.isArray(room.websocketUrls) ? room.websocketUrls : []).map(ksStr).filter(Boolean),
      } : null,
    }
  }

  async liveStatus(roomId) {
    const { entry } = await this._roomPage(roomId)
    if (entry.errorType) {
      const t = entry.errorType.type
      if (t === 2 || t === 10 || t === 15 || t === 16 || t === 400002) throw ksResultError(t)
      return false
    }
    return !!entry.isLiving && !!ksStr(entry.liveStream && entry.liveStream.id)
  }

  // ---------------- 播放 ----------------

  async qualities(room) {
    const d = room && room.data
    if (!d) throw new Error("主播当前未开播")
    const byLevel = new Map()
    const add = (r, codec) => {
      if (!r.url) return
      const q = byLevel.get(r.level) || { level: r.level, name: r.name, h264: "", hevc: "" }
      if (!q.name) q.name = r.name
      q[codec] = q[codec] || r.url
      byLevel.set(r.level, q)
    }
    for (const r of d.h264 || []) add(r, "h264")
    for (const r of d.hevc || []) add(r, "hevc")
    const list = [...byLevel.values()].sort((a, b) => b.level - a.level)
    const out = list.map((q) => ({
      name: (q.name || "默认") + (q.h264 ? "" : " (H.265)"),
      // 同一清晰度：H.264 在前，H.265 作为第二条线路
      data: { urls: [q.h264, q.hevc].filter(Boolean) },
    }))
    if (!out.length && d.hls) out.push({ name: "高清", data: { urls: [d.hls] } })
    if (!out.length) throw new Error("快手没有给出播放地址（直播间可能是私密 / 受限的，或网页结构变了）")
    return out
  }

  async playUrls(room, quality) {
    const urls = (quality && quality.data && Array.isArray(quality.data.urls)) ? quality.data.urls.filter(Boolean) : []
    if (!urls.length) throw new Error("没有找到可用的播放地址")
    return { urls, headers: { referer: KS_ORIGIN + "/" } }
  }

  // iOS 系统画中画用 HLS：快手只给“高清”一档 m3u8，与所选清晰度无关
  async avPlayerUrls(room, quality) {
    const hls = room && room.data && room.data.hls
    if (!hls) return null
    return { urls: [hls], headers: { referer: KS_ORIGIN + "/" } }
  }

  // ---------------- 弹幕 ----------------

  danmaku = {
    start: async (room, session) => {
      const d = room && room.danmakuData
      if (!d || !d.liveStreamId) {
        session.emit([{ type: "system", text: "主播未开播，没有弹幕" }])
        return
      }
      let token = ksStr(d.token)
      let urls = Array.isArray(d.websocketUrls) ? d.websocketUrls.filter(Boolean) : []
      if (!token || !urls.length) {
        let denied = 0
        try { denied = Number(await Storage.get("wsDeniedUntil")) || 0 } catch (e) { }
        if (denied > Date.now()) {
          session.emit([{ type: "system", text: "快手弹幕暂不可用：游客拿不到弹幕凭证（需要网页签名或登录），稍后再试" }])
          return
        }
        try {
          const info = await this._api("/live_api/liveroom/websocketinfo", { liveStreamId: d.liveStreamId }, `${KS_ORIGIN}/u/${d.principalId}`)
          token = ksStr(info.token)
          urls = (Array.isArray(info.websocketUrls) ? info.websocketUrls : Array.isArray(info.webSocketAddresses) ? info.webSocketAddresses : []).map(ksStr).filter(Boolean)
        } catch (e) {
          if (e.ksResult !== undefined) {
            // 接口明确拒绝（游客一般是 result=2）：提示一次，几分钟内不再请求，也不让 App 反复重连
            log("websocketinfo 被拒绝", e.ksResult)
            try { await Storage.set("wsDeniedUntil", Date.now() + KS_WS_COOLDOWN) } catch (e2) { }
            session.emit([{ type: "system", text: "快手弹幕暂不可用：游客拿不到弹幕凭证（快手要求网页签名或登录）" }])
            return
          }
          throw new Error("快手弹幕凭证获取失败：" + (e.message || e))
        }
        if (!token || !urls.length) {
          session.emit([{ type: "system", text: "快手弹幕暂不可用：没有拿到弹幕服务器地址" }])
          return
        }
      }
      try { await Storage.remove("wsDeniedUntil") } catch (e) { }

      let ws = null
      let lastErr = null
      for (const url of urls.slice(0, 3)) {
        try {
          ws = await session.websocket(url, {
            headers: { "user-agent": KS_UA, "origin": KS_ORIGIN, "referer": `${KS_ORIGIN}/u/${d.principalId}` },
          })
          break
        } catch (e) {
          lastErr = e
        }
      }
      if (!ws) throw new Error("快手弹幕服务器连接失败：" + (lastErr && lastErr.message ? lastErr.message : lastErr))

      ws.onMessage = async (data) => {
        if (!ksIsBytes(data)) return
        await this._onSocket(data, session)
      }
      ws.onClose = (code, reason) => {
        log("快手弹幕连接断开", code, reason || "")
      }
      const enter = new Proto.Writer()
      enter.string(1, token)
      enter.string(2, d.liveStreamId)
      enter.varint(3, 0)
      enter.varint(4, 0)
      enter.string(7, ksPageId())
      ws.send(ksSocketMessage(200, enter.finish()))
      // 网页在进房确认后按 heartbeatIntervalMs（实际为 20 秒）发心跳，这里直接用 20 秒
      session.setInterval(() => {
        const w = new Proto.Writer()
        w.varint(1, Date.now())
        ws.send(ksSocketMessage(1, w.finish()))
      }, 20000)
    },
    stop: async (session) => { },
  }

  async _onSocket(data, session) {
    let msg
    try {
      msg = Proto.decode(data)
    } catch (e) {
      return
    }
    const type = Proto.num(ksField(msg, 1))
    const compression = Proto.num(ksField(msg, 2))
    let payload = ksField(msg, 3)
    if (!ksIsBytes(payload)) payload = new Uint8Array(0)
    try {
      if (compression === 2 && payload.length) payload = await Zip.gunzip(payload)
      else if (compression === 3 && payload.length) {
        const key = CryptoJS.enc.Utf8.parse(KS_AES_KEY)
        const iv = CryptoJS.enc.Utf8.parse(KS_AES_IV)
        const plain = CryptoJS.AES.decrypt({ ciphertext: Bytes.toWordArray(payload) }, key, {
          iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
        })
        payload = Bytes.fromWordArray(plain)
      }
    } catch (e) {
      log("快手弹幕包解压失败", String(e))
      return
    }
    let p
    try {
      p = Proto.decode(payload)
    } catch (e) {
      return
    }
    if (type === 300) {           // SC_ENTER_ROOM_ACK
      session.ready()
    } else if (type === 310) {    // SC_FEED_PUSH
      const out = []
      const watching = ksText(p, 1)
      if (watching) out.push({ type: "online", online: ksCount(watching) })
      for (const raw of p[5] || []) {         // commentFeeds
        const c = Proto.decode(raw)
        if (Proto.num(ksField(c, 7)) === 2) continue   // FEED_HIDDEN
        const text = ksText(c, 3)
        if (!text) continue
        const user = ksField(c, 2) ? Proto.decode(ksField(c, 2)) : {}
        const m = { type: "chat", user: ksText(user, 2), text }
        const color = ksColor(ksText(c, 6))
        if (color !== undefined && color !== 0xffffff) m.color = color
        const face = ksText(user, 3)
        if (face) m.face = face
        out.push(m)
      }
      for (const raw of p[7] || []) {         // comboCommentFeed（刷屏合并）
        const c = Proto.decode(raw)
        const text = ksText(c, 2)
        if (text) out.push({ type: "chat", user: "", text: Proto.num(ksField(c, 3)) > 1 ? `${text} ×${Proto.num(ksField(c, 3))}` : text })
      }
      for (const raw of p[11] || []) {        // systemNoticeFeeds
        const c = Proto.decode(raw)
        const text = ksText(c, 4)
        if (text) out.push({ type: "system", text })
      }
      if (out.length) session.emit(out)
    } else if (type === 340) {    // SC_LIVE_WATCHING_LIST
      const watching = ksText(p, 2)
      if (watching) session.emit([{ type: "online", online: ksCount(watching) }])
    } else if (type === 103) {    // SC_ERROR
      const code = Proto.num(ksField(p, 1))
      const text = ksText(p, 2)
      if (code === 601) {
        session.emit([{ type: "system", text: "直播已结束" }])
        session.fail("直播已结束")
      } else {
        session.fail(`快手弹幕服务器报错 ${code}${text ? "：" + text : ""}`)
      }
    }
  }
}
