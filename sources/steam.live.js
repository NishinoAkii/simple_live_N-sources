/*
 * Steam 直播（steamcommunity.com/broadcast）—— SimpleLive 直播源脚本，接口见 doc/live_source_api.md（v1）
 *
 * 房间号 = 主播的 SteamID64（17 位，7656119…；https://steamcommunity.com/broadcast/watch/<id>）。
 * 也接受个人资料的自定义网址（/id/<名字>）、好友代码（8～10 位数字）和游戏的 AppID（1～7 位：打开这个
 * 游戏当前最热的直播，商店页“正在直播：观看开发者进行游戏”的那个优先）；详情里的 roomId 都换成 SteamID64。
 * 看直播、读聊天只用游客身份。
 *
 * 接口（2026-10 从美国出口实测，游客都能用）：
 * - 推荐：社区首页“实况直播”标签页的翻页接口 steamcommunity.com/apps/allcontenthome/
 *   ?browsefilter=trend&appHubSubSection=13&forceanon=1&p=<页>&broadcastsoffset=<(页-1)*10>，
 *   返回 HTML 卡片（每页固定 10 个，按观众数排序，能翻很多页）：主播 SteamID64、名字、头像、
 *   游戏名、观众数、实时缩略图。没有直播标题（Steam 的直播标题大多是空的），列表里用游戏名。
 *   App 的一页取两页 Steam 列表（20 个）。
 * - 分类：只有一组“正在热播”= 推荐前 3 页里出现的游戏（按观众数合计排序，图标用最热直播的缩略图）。
 *   列表卡片里只有游戏名没有 AppID：点进去时用 store.steampowered.com/api/storesearch/ 按名字找 AppID
 *   （结果存进 Storage）。游戏的直播 = 推荐列表里这个游戏的直播 + 社区游戏中心“直播”标签页
 *   steamcommunity.com/app/<appid>/homecontent/?appHubSubSection=13&browsefilter=trend&numperpage=24
 *   &p=&broadcastsoffset=（每页 24 个；找不到 AppID 时只有推荐列表里的）。
 *   没有做固定的“热门游戏”分类：CS2、Dota 2 这些游戏中心里几乎全是 0～2 个观众的 Steam 客户端直播
 *   （抽查 CS2 前 10 个：4 个客户端直播、6 个已经下播），按需开播又有下面的音频列表问题，基本看不了。
 * - 搜索直播间：推荐前 3 页里主播名 / 游戏名包含关键词的 + 商店搜索 api/storesearch 找到的第一个
 *   游戏的直播（翻页走游戏中心）。
 * - 搜索主播：社区用户搜索 steamcommunity.com/search/SearchCommunityAjax?filter=users
 *   （每页 20 个，需要 sessionid Cookie 和同值参数；Cookie 由社区页面下发，脚本先请求一次
 *   miniprofile 拿到），每个结果再用 getbroadcastinfo 查是否在播（最多同时 5 个）。
 *   包括没开播的人。联想（suggest）= 推荐列表里名字匹配的在播主播 + 用户搜索的前几个（不查是否在播）。
 * - 直达（resolve）：SteamID64、好友代码、AppID、自定义网址名（/id/<名字>/?xml=1 换成 SteamID64）、
 *   以及各种链接（直播页、个人资料、商店 / 社区游戏页、steam://broadcast/watch/）。
 * - 房间：steamcommunity.com/broadcast/getbroadcastinfo/?steamid=（success 1 = 在播；42 = 没有直播），
 *   给出游戏名、标题、观众数、缩略图（地址里带 broadcastid）；名字和头像来自
 *   steamcommunity.com/miniprofile/<accountid>/json（失败时用 /profiles/<id>/?xml=1）。
 * - 播放：steamcommunity.com/broadcast/getbroadcastmpd/?steamid=&broadcastid=0&viewertoken=&watchlocation=5
 *   → success=ready 时给出 DASH（url）和 HLS（hls_url，fMP4 分段、音频单独一路，最高 1080p60），
 *   CDN 为 cacheN-<机房>.steamcontent.com，地址不带签名，播放不需要请求头。viewertoken 第一次由
 *   服务器分配，存进 Storage 一直沿用（网页也是这样）。
 *   · 只用 HLS：App 的 libmpv 播 DASH 时 ffmpeg 的 dash 解复用器会抢在直播前面请求还没生成的分段
 *     （一直 404），约 30 秒后卡死；播 HLS 主列表没有问题（mpv 默认选最高码率）。
 *     主列表里的各档视频不带音频（音频是单独的 EXT-X-MEDIA），单独给某一档会没有声音，
 *     所以只有一个清晰度“原画”（名称里写上最高档的分辨率）。
 *   · 按需开播：观众少的玩家直播平时不上传，有人请求时主播的 Steam 客户端才开始推流，这期间返回
 *     waiting / waiting_for_start（retry 毫秒后再问），一般 20～40 秒后变成 ready。qualities() 和
 *     playUrls() 各最多等 16 秒，还没好就提示稍后重试。
 *   · iOS 系统画中画（AVPlayer）直接用同一个 HLS 主列表。
 *   · Steam 客户端直播（getbroadcastinfo 的 is_rtmp=0，玩家在 Steam 里点“直播”的那种）放不了多久：
 *     Steam 的 HLS 音频列表把每段（约 3 秒）写成 #EXTINF:143.36 左右（像是把 48 kHz 的采样数除了 1000），
 *     ffmpeg 以为一段音频有 143 秒，140 多秒不刷新音频列表，十几秒后音频断粮，整个播放卡住；
 *     DASH 又是上面那个问题。网页版桌面端用 DASH（Valve 自己的播放器），所以网页上看不出来。
 *     OBS 等推流的 RTMP 直播（is_rtmp=1，推荐列表里几乎都是）音频时长正确，播放正常。
 *     所以客户端直播的 playUrls 多返回 hlsFix: "durations"：新版 App（App.features 含 "hlsFix"）经本机
 *     中转把过长的 #EXTINF 改成 TARGETDURATION；旧版 App 忽略这个字段、直接播原地址，只在直播间公告里提示。
 * - 弹幕：getchatinfo?steamid=&broadcastid= 给出 chat_id 和 view_url_template
 *   （steambroadcastchat.akamaized.net/chat/<chat_id>/messages/{0}?chat_origin=…）。网页每 ~0.7 秒按
 *   next_request 游标取一小段；这里改为每 4 秒取一次 {0}=0（最近 50 条），按 steamid + instance_id +
 *   内容去重后发出（请求比网页少得多）。去重记录按聊天室保存在引擎里，重连（90 秒内）后沿用，不重复发。
 *   连上后第一次取到的是进直播间之前的聊天：新版 App（App.features 含 "history"）发最近 20 条，
 *   带 history: true，只进聊天区、不飞过视频；旧版 App 没有这个功能，这些就不发了（不然会一起飞过视频），
 *   聊天区从新消息开始（和 App 自带的平台一样）。多行刷屏、带 3 个以上链接的消息不发；
 *   主播自己的消息用 Steam 蓝色。没有醒目留言、礼物。
 *   观众数每 60 秒用 getbroadcastinfo 更新（网页的 update_interval 也是 60 秒）。
 *   另外每 30 秒 POST /broadcast/heartbeat/（steamid、broadcastid、viewertoken，网页游客观看时也发），
 *   让按需开播的主播继续推流；离开直播间（弹幕会话结束）就不再发。
 * - 表情：消息里的 ːnameː（U+02D0）是 Steam 表情，文字里写成 :name:，同时在消息的 emotes 里给出图片
 *   community.fastly.steamstatic.com/economy/emoticonlarge/<name>（54×54；小图 economy/emoticon/<name> 18×18）。
 *   贴纸（Steam 聊天的 [sticker type="名字"][/sticker] 或 /sticker 名字）给出 sticker：
 *   economy/sticker/<名字>（150×150 APNG 动图，可能有 1 MB）和静态图 economy/stickerstatic/<名字>。
 *   网页的直播聊天只渲染表情，不渲染贴纸，实测也没见过贴纸消息，贴纸只是以防万一。
 *   新版 App（App.features 含 "emotes"）显示为图片；旧版 App 忽略这两个字段，只显示文字 :name:。
 *   （都是普通 PNG，静态图能直接解码。）
 *
 * 登录（按网页代码实现，没有用真实帐号测试过；App.features 含 "login" 的 App 才有，旧版 App 不读 login）：
 * - 登录：Steam 网页登录后 steamcommunity.com 上有 steamLoginSecure（<SteamID64>||<JWT>，HttpOnly）
 *   和 sessionid 两个 Cookie。App 在网页里打开下面 login.url 登录（或手动粘贴 Cookie），把 login.cookieUrl
 *   下的全部 Cookie 写进本源的 Cookie 罐，脚本的请求就都带上登录态；退出登录时 App 删掉这些 Cookie。
 *   account() 读出当前帐号。
 *   JWT 大约一天过期；网页靠 login.steampowered.com 上的 steamRefresh_steam 刷新，脚本没有实现刷新，
 *   过期后需要重新登录（进直播间时聊天区会提示）。
 */

const ST_COMMUNITY = "https://steamcommunity.com"
const ST_STORE = "https://store.steampowered.com"
const ST_CDN = "https://community.fastly.steamstatic.com/"
const ST_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
const ST_LANG = "schinese"
const ST_HEADERS = { "User-Agent": ST_UA, "Referer": ST_COMMUNITY + "/" }
const ST_PLAY_HEADERS = { "user-agent": ST_UA, "referer": ST_COMMUNITY + "/" }
const ST_BASE = 76561197960265728n
const ST_SID = /^7656119\d{10}$/
const ST_VANITY = /^[A-Za-z0-9_-]{2,32}$/
const ST_EMOTICON = /ː([^ː\s]{1,64})ː/g

// Steam 客户端直播（is_rtmp=0）的提示：HLS 音频列表时长有误，见文件开头“播放”
const ST_CLIENT_NOTICE = "这是 Steam 客户端直播：Steam 给出的音频播放列表时长有误，这个版本的 App 播放十几秒后可能卡住（更新 App 后会自动修正）；观众少时还要等主播的客户端开始推流（20～40 秒）"
const ST_ONDEMAND_NOTICE = "这是 Steam 客户端直播：观众少时要等主播的客户端开始推流（20～40 秒）"

// getbroadcastmpd 的 success 值 → 提示
const ST_WAITING = ["waiting", "waiting_for_start", "waiting_for_reconnect"]
const ST_MPD_ERRORS = {
  unavailable: "主播当前未开播",
  end: "直播已经结束",
  noservers: "Steam 直播服务器负载过高，暂时无法观看，请稍后再试",
  system_not_supported: "Steam 直播暂不支持主播的系统",
  user_restricted: "主播的帐户目前被限制直播",
  client_out_of_date: "主播的 Steam 客户端需要更新才能直播",
  poor_upload_quality: "主播与 Steam 的连接不稳定，暂时看不了",
  missing_subscription: "观看这个直播需要拥有对应的游戏或订阅（游客不能看）",
  request_failed: "载入直播失败，请稍后再试",
  too_many_broadcasts: "Steam 直播服务器繁忙，请稍后再试",
  denied: "主播只允许好友或受邀请的人观看",
}

// 聊天：进直播间时补发的之前的聊天条数（只进聊天区）；多久之内重新连上同一个聊天室算重连（不重复发）
const ST_BACKLOG = 20
const ST_REJOIN_MS = 90 * 1000

/** App 是否支持接口 v1 之后加的功能（"emotes"、"login"、"hlsFix"、"history"）；旧版 App 没有 App.features */
function stFeature(name) {
  try {
    return typeof App !== "undefined" && Array.isArray(App.features) && App.features.includes(name)
  } catch (e) {
    return false
  }
}

// ---- 进程内缓存（引擎空闲 3 分钟后关闭，缓存随之清空） ----
const stCache = new Map()        // key → { at, value, promise }
const stViewers = new Map()      // steamid → { broadcastid, viewertoken, hls, mpd, at }
const stChatSeen = new Map()     // 聊天室 → { seen, order, at }：已经发过的聊天（重连后沿用）
let stRecommendSeen = new Set()  // 推荐翻页去重

function stStr(v) {
  return v === undefined || v === null ? "" : String(v).trim()
}

function stSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** HTML 实体 → 文字 */
function stHtml(s) {
  return stStr(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim()
}

/** “12,461 viewers” / “938 名观众” → 数字 */
function stCount(text) {
  const m = stStr(text).replace(/[,，.\s]/g, "").match(/\d+/)
  return m ? parseInt(m[0], 10) : 0
}

function stAccountToSid(acc) {
  return (BigInt(acc) + ST_BASE).toString()
}

function stSidToAccount(sid) {
  return (BigInt(sid) - ST_BASE).toString()
}

/** 游戏名比较用：去掉 ™®© 和空白，小写 */
function stNameKey(s) {
  return stStr(s).replace(/[™®©\s]/g, "").toLowerCase()
}

/** 带缓存的调用：ttl 毫秒内返回上次的结果，同一个 key 并发时只请求一次 */
async function stMemo(key, ttl, fn) {
  const hit = stCache.get(key)
  const now = Date.now()
  if (hit && hit.value !== undefined && now - hit.at < ttl) return hit.value
  if (hit && hit.promise) return hit.promise
  const promise = (async () => {
    try {
      const value = await fn()
      stCache.set(key, { at: Date.now(), value })
      if (stCache.size > 200) stCache.delete(stCache.keys().next().value)
      return value
    } catch (e) {
      stCache.delete(key)
      throw e
    }
  })()
  stCache.set(key, { at: now, promise })
  return promise
}

/** 最多 limit 个同时进行的 map */
async function stMapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function stRequest(url, opts) {
  opts = opts || {}
  let res
  try {
    res = await Http.request({
      url,
      method: opts.method || "GET",
      query: opts.query,
      body: opts.body,
      contentType: opts.contentType,
      headers: Object.assign({}, ST_HEADERS, opts.headers || {}),
      timeout: opts.timeout || 12000,
    })
  } catch (e) {
    throw new Error("连接 Steam 失败：" + (e && e.message ? e.message : e))
  }
  if (res.status === 429) throw new Error("Steam 认为请求太频繁了，请稍后再试")
  if (res.status < 200 || res.status >= 300) {
    const err = new Error("Steam 接口出错（HTTP " + res.status + "）")
    err.status = res.status
    throw err
  }
  return res
}

async function stText(url, opts) {
  return String((await stRequest(url, opts)).body || "")
}

async function stJson(url, opts) {
  const text = await stText(url, opts)
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error("Steam 返回的内容不是 JSON（可能被限制访问了）")
  }
}

// ---------------------------------------------------------------------------
// 列表卡片（社区首页 / 游戏中心的“实况直播”）
// ---------------------------------------------------------------------------

function stParseCards(html) {
  const rooms = []
  const parts = String(html || "").split(/class="Broadcast_Card/).slice(1)
  for (const part of parts) {
    const sid = (part.match(/broadcast\/watch\/(\d{17})/) || [])[1]
    if (!sid) continue
    const cover = stHtml((part.match(/apphub_CardContentPreviewImage"\s+src="([^"]+)"/) || [])[1])
    const online = stCount((part.match(/apphub_CardContentViewers[^>]*>([^<]*)</) || [])[1])
    let app = stHtml((part.match(/apphub_CardContentTitle[^>]*>([^<]*)</) || [])[1])
    if (!app) {
      app = stHtml((part.match(/apphub_CardContentType">([^<]*)</) || [])[1]).replace(/[:：]\s*(Broadcast|实况直播)\s*$/i, "")
    }
    const name = stHtml((part.match(/apphub_CardContentAuthorName[^>]*>\s*<a[^>]*>([^<]*)</) || [])[1])
    const avatar = stHtml((part.match(/appHubIconHolder[^"]*"><img src="([^"]+)"/) || [])[1])
    rooms.push({ roomId: sid, title: app || "Steam 直播", cover, userName: name || sid, online, appName: app, avatar })
  }
  return rooms
}

function stToRoom(c) {
  return { roomId: c.roomId, title: c.title, cover: c.cover, userName: c.userName, online: c.online }
}

/** 社区首页的热门直播，p 从 1 开始，每页 10 个 */
function stTrendingPage(p) {
  return stMemo("trend:" + p, 90 * 1000, async () => {
    const html = await stText(ST_COMMUNITY + "/apps/allcontenthome/", {
      query: { l: ST_LANG, browsefilter: "trend", appHubSubSection: 13, forceanon: 1, p, broadcastsoffset: (p - 1) * 10 },
    })
    return stParseCards(html)
  })
}

/** 推荐前 n 页（缓存 90 秒），出错的页跳过 */
async function stTrending(n) {
  const pages = await Promise.all(Array.from({ length: n }, (_, i) => stTrendingPage(i + 1).catch(() => [])))
  const seen = new Set()
  const out = []
  for (const c of pages.flat()) {
    if (seen.has(c.roomId)) continue
    seen.add(c.roomId)
    out.push(c)
  }
  return out
}

/** 游戏中心的直播，p 从 1 开始，每页 24 个 */
function stAppPage(appid, p) {
  return stMemo("app:" + appid + ":" + p, 90 * 1000, async () => {
    const html = await stText(ST_COMMUNITY + "/app/" + appid + "/homecontent/", {
      query: {
        l: ST_LANG, browsefilter: "trend", appHubSubSection: 13, forceanon: 1,
        p, broadcastsoffset: (p - 1) * 24, numperpage: 24,
      },
    })
    return stParseCards(html)
  })
}

/** 按关键词筛推荐列表（主播名、游戏名） */
async function stTrendingMatch(keyword, pages) {
  const kw = stNameKey(keyword)
  if (!kw) return []
  const list = await stTrending(pages)
  return list.filter((c) => stNameKey(c.userName).includes(kw) || stNameKey(c.appName).includes(kw))
}

// ---------------------------------------------------------------------------
// 游戏（AppID）
// ---------------------------------------------------------------------------

/** 商店搜索：[{ id, name, pic }] */
function stStoreSearch(term) {
  return stMemo("store:" + term, 10 * 60 * 1000, async () => {
    const d = await stJson(ST_STORE + "/api/storesearch/", { query: { term, l: ST_LANG, cc: "US" } })
    return (d.items || []).filter((i) => i.type === "app" || !i.type)
      .map((i) => ({ id: String(i.id), name: stStr(i.name), pic: stStr(i.tiny_image) }))
  })
}

/** 游戏名 → AppID（完全同名才算；结果存 Storage） */
async function stAppIdByName(name) {
  const key = stNameKey(name)
  if (!key) return null
  let map = null
  try { map = await Storage.get("appIds") } catch (e) {}
  if (!map || typeof map !== "object") map = {}
  if (map[key]) return map[key]
  let id = null
  try {
    const items = await stStoreSearch(name)
    const hit = items.find((i) => stNameKey(i.name) === key)
    if (hit) id = hit.id
  } catch (e) {}
  if (!id && /^[\x20-\x7e]+$/.test(name)) {
    try {
      const list = await stJson(ST_COMMUNITY + "/actions/SearchApps/" + encodeURIComponent(name))
      const hit = (list || []).find((a) => stNameKey(a.name) === key)
      if (hit) id = String(hit.appid)
    } catch (e) {}
  }
  if (id) {
    const keys = Object.keys(map)
    if (keys.length > 300) delete map[keys[0]]
    map[key] = id
    try { await Storage.set("appIds", map) } catch (e) {}
  }
  return id
}

/** 一个游戏当前最热的直播主播（商店页的开发者直播优先），没有时 null */
async function stTopBroadcasterOfApp(appid) {
  try {
    const d = await stJson(ST_STORE + "/broadcast/ajaxgetstreamersforpage", { query: { appid, cc: "US", l: ST_LANG } })
    const b = (d.filtered || []).find((x) => ST_SID.test(stStr(x.broadcaststeamid)))
    if (b) return stStr(b.broadcaststeamid)
  } catch (e) {}
  const cards = await stAppPage(appid, 1).catch(() => [])
  return cards.length ? cards[0].roomId : null
}

// ---------------------------------------------------------------------------
// 用户、直播信息
// ---------------------------------------------------------------------------

/** 自定义网址名 → SteamID64，找不到时 null */
function stVanityToSid(name) {
  return stMemo("vanity:" + name.toLowerCase(), 30 * 60 * 1000, async () => {
    const xml = await stText(ST_COMMUNITY + "/id/" + encodeURIComponent(name) + "/", { query: { xml: 1 } })
    const m = xml.match(/<steamID64>(\d{17})<\/steamID64>/)
    return m ? m[1] : null
  })
}

/**
 * 输入（房间号、链接、名字）→ 目标：{ sid } 或 { appid } 或 { vanity }，认不出时 null。
 * 链接里的 AppID、好友代码、自定义网址都在这里分出来。
 */
function stParseTarget(input) {
  let s = stStr(input)
  if (!s) return null
  let m
  if ((m = s.match(/broadcast\/watch\/(\d{17})/)) || (m = s.match(/\/profiles\/(\d{17})/))) return { sid: m[1] }
  if ((m = s.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})/))) return { vanity: m[1] }
  if ((m = s.match(/(?:store\.steampowered\.com|steamcommunity\.com)\/app\/(\d{1,8})/))) return { appid: m[1] }
  if (/^https?:\/\//i.test(s) || s.includes("/")) return null
  s = s.replace(/^@/, "")
  if (ST_SID.test(s)) return { sid: s }
  if (/^\d{1,7}$/.test(s)) return { appid: String(parseInt(s, 10)) }
  if (/^\d{8,10}$/.test(s)) return { sid: stAccountToSid(s) }
  if (ST_VANITY.test(s)) return { vanity: s }
  return null
}

/** 目标 → SteamID64；游戏没有直播、名字不存在时 null */
async function stResolveSid(target) {
  if (!target) return null
  if (target.sid) return target.sid
  if (target.appid) return stTopBroadcasterOfApp(target.appid)
  if (target.vanity) return stVanityToSid(target.vanity)
  return null
}

/** 名字、头像（缓存 10 分钟） */
function stProfile(sid) {
  return stMemo("profile:" + sid, 10 * 60 * 1000, async () => {
    try {
      const d = await stJson(ST_COMMUNITY + "/miniprofile/" + stSidToAccount(sid) + "/json")
      if (d && d.persona_name) return { name: stStr(d.persona_name), avatar: stStr(d.avatar_url) }
    } catch (e) {}
    const xml = await stText(ST_COMMUNITY + "/profiles/" + sid + "/", { query: { xml: 1 } })
    const name = (xml.match(/<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/) || [])[1]
    const avatar = (xml.match(/<avatarFull><!\[CDATA\[([\s\S]*?)\]\]><\/avatarFull>/) || [])[1]
    if (!name && /<error>/.test(xml)) throw new Error("找不到这个 Steam 用户")
    return { name: stStr(name), avatar: stStr(avatar) }
  })
}

/** getbroadcastinfo：{ live, appid, appTitle, title, viewers, thumbnail, broadcastid } */
async function stBroadcastInfo(sid, timeout) {
  const d = await stJson(ST_COMMUNITY + "/broadcast/getbroadcastinfo/", { query: { steamid: sid, l: ST_LANG }, timeout })
  const live = d.success === 1 && d.is_online !== false
  const thumbnail = stStr(d.thumbnail_url)
  return {
    live,
    appid: stStr(d.appid),
    appTitle: stStr(d.app_title),
    title: stStr(d.title),
    viewers: Number(d.viewer_count) || 0,
    thumbnail,
    broadcastid: (thumbnail.match(/\/broadcast\/\d{17}\/(\d+)\//) || [])[1] || "",
    rerun: d.is_replay === 1,
    rtmp: d.is_rtmp === 1,
  }
}

function stCookieValue(cookies, name) {
  const m = String(cookies || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"))
  return m ? m[1] : ""
}

/** sessionid Cookie（社区搜索要用）；没有时请求一次 miniprofile 让服务器下发 */
async function stSessionId() {
  const read = async () => {
    const v = stCookieValue(await Http.getCookies(ST_COMMUNITY + "/"), "sessionid")
    return /^[0-9a-f]+$/.test(v) ? v : ""
  }
  let id = await read()
  if (id) return id
  await stRequest(ST_COMMUNITY + "/miniprofile/22202/json").catch(() => null)
  id = await read()
  if (!id) throw new Error("没有拿到 Steam 社区的会话 Cookie，搜索主播暂时不可用")
  return id
}

/** 登录 Cookie 里的 SteamID64（steamLoginSecure = <SteamID64>||<JWT>），没登录时为空 */
async function stLoginSid() {
  const v = stCookieValue(await Http.getCookies(ST_COMMUNITY + "/"), "steamLoginSecure")
  const m = decodeURIComponent(v || "").match(/^(\d{17})\|\|./)
  return m ? m[1] : ""
}

/** 社区用户搜索结果的 HTML → [{ sid, name, avatar }] */
function stParseUserRows(html) {
  const users = []
  for (const row of String(html || "").split(/class="search_row"/).slice(1)) {
    const acc = (row.match(/data-miniprofile="(\d+)"/) || [])[1]
    const sid = (row.match(/\/profiles\/(\d{17})/) || [])[1] || (acc ? stAccountToSid(acc) : "")
    if (!sid) continue
    const name = stHtml((row.match(/class="searchPersonaName"[^>]*>([^<]*)</) || [])[1])
    const avatar = stHtml((row.match(/<img src="([^"]+)"/) || [])[1]).replace(/_medium\.jpg$/, "_full.jpg")
    users.push({ sid, name: name || sid, avatar })
  }
  return users
}

/** 社区用户搜索：{ total, users: [{ sid, name, avatar }] } */
function stUserSearch(keyword, page) {
  return stMemo("users:" + keyword + ":" + page, 2 * 60 * 1000, async () => {
    const sessionid = await stSessionId()
    const opts = {
      query: { text: keyword, filter: "users", sessionid, steamid_user: "false", page },
      headers: { "X-Requested-With": "XMLHttpRequest", "Referer": ST_COMMUNITY + "/search/users/" },
    }
    let d
    try {
      d = await stJson(ST_COMMUNITY + "/search/SearchCommunityAjax", opts)
    } catch (e) {
      if (e.status !== 401) throw e
      // 会话 Cookie 过期：重新拿一次
      await Http.setCookies(ST_COMMUNITY + "/", "sessionid=")
      opts.query.sessionid = await stSessionId()
      d = await stJson(ST_COMMUNITY + "/search/SearchCommunityAjax", opts)
    }
    if (d.success !== 1) throw new Error("Steam 用户搜索失败")
    return { total: Number(d.search_result_count) || 0, users: stParseUserRows(d.html) }
  })
}

// ---------------------------------------------------------------------------
// 播放
// ---------------------------------------------------------------------------

async function stViewerToken() {
  try {
    const t = await Storage.get("viewerToken")
    return t ? String(t) : "0"
  } catch (e) {
    return "0"
  }
}

/**
 * getbroadcastmpd，按需开播时最多等 waitMs 毫秒。
 * 返回 { ready: true, hls, mpd, broadcastid } 或 { ready: false, status }（还在等主播开播）。
 */
async function stManifest(sid, waitMs) {
  const cached = stViewers.get(sid)
  if (cached && cached.hls && Date.now() - cached.at < 30 * 1000) return Object.assign({ ready: true }, cached)
  const deadline = Date.now() + waitMs
  for (;;) {
    const viewertoken = await stViewerToken()
    const d = await stJson(ST_COMMUNITY + "/broadcast/getbroadcastmpd/", {
      query: { steamid: sid, broadcastid: 0, viewertoken, watchlocation: 5 },
    })
    const status = stStr(d.success)
    if (d.viewertoken && String(d.viewertoken) !== viewertoken) {
      try { await Storage.set("viewerToken", String(d.viewertoken)) } catch (e) {}
    }
    if (status === "ready") {
      if (!d.hls_url) {
        throw new Error(d.is_webrtc ? "这个直播只能用 WebRTC 观看，暂不支持" : "Steam 没有给出 HLS 播放地址")
      }
      const v = {
        broadcastid: stStr(d.broadcastid),
        viewertoken: stStr(d.viewertoken) || viewertoken,
        hls: stStr(d.hls_url),
        mpd: stStr(d.url),
        heartbeat: Number(d.heartbeat_interval) || 30,
        at: Date.now(),
      }
      stViewers.set(sid, v)
      return Object.assign({ ready: true }, v)
    }
    if (!ST_WAITING.includes(status)) {
      throw new Error(ST_MPD_ERRORS[status] || ("这个直播现在不能观看（" + (status || "未知状态") + "）"))
    }
    const left = deadline - Date.now()
    if (left < 1500) return { ready: false, status }
    await stSleep(Math.min(Math.max(Number(d.retry) || 5000, 2000), 5000, left - 500))
  }
}

/** HLS 主列表文字 → 最高一档的名称（“1080p60”），认不出时为空 */
function stVariantLabel(text) {
  let best = null
  for (const line of String(text || "").split("\n")) {
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue
    const bw = Number((line.match(/BANDWIDTH=(\d+)/) || [])[1]) || 0
    const h = Number((line.match(/RESOLUTION=\d+x(\d+)/) || [])[1]) || 0
    const fps = Number((line.match(/FRAME-RATE=([\d.]+)/) || [])[1]) || 0
    if (!best || bw > best.bw) best = { bw, h, fps }
  }
  if (!best || !best.h) return ""
  return best.h + "p" + (best.fps > 31 ? Math.round(best.fps) : "")
}

async function stTopVariantLabel(hls) {
  try {
    return stVariantLabel(await stText(hls, { timeout: 6000 }))
  } catch (e) {
    return ""
  }
}

// ---------------------------------------------------------------------------
// 聊天消息、表情
// ---------------------------------------------------------------------------

function stEmoticon(name) {
  return { text: ":" + name + ":", url: ST_CDN + "economy/emoticonlarge/" + encodeURIComponent(name), width: 54, height: 54 }
}

function stSticker(name, text) {
  const n = encodeURIComponent(name)
  return {
    text,
    url: ST_CDN + "economy/sticker/" + n,
    staticUrl: ST_CDN + "economy/stickerstatic/" + n,
    width: 150,
    height: 150,
  }
}

/**
 * 一条聊天 → 弹幕消息；刷屏消息返回 null。
 * 表情 ːnameː → 文字 :name: + emotes；贴纸 → sticker（接口 v1 的 App 还不显示图片，只显示文字）
 */
function stChatMessage(m, broadcasterSid) {
  const raw = stStr(m && m.msg)
  if (!raw) return null
  const user = stStr(m.persona_name) || "Steam 用户"
  const color = broadcasterSid && stStr(m.steamid) === broadcasterSid ? 0x66c0f4 : 0xffffff
  const sticker = raw.match(/^\[sticker\s+type="([^"\]]{1,80})"[^\]]*\]\s*\[\/sticker\]$/i) || raw.match(/^\/sticker\s+(\S[^\n]{0,79})$/i)
  if (sticker) {
    const name = sticker[1].trim()
    const text = "[贴纸] " + name
    return { type: "chat", user, text, color, sticker: stSticker(name, text) }
  }
  const links = (raw.match(/https?:\/\//gi) || []).length
  const lines = raw.split("\n").filter((l) => l.trim()).length
  if (links >= 3 || lines >= 6) return null
  const names = []
  let text = raw.replace(ST_EMOTICON, (_, name) => {
    if (!names.includes(name)) names.push(name)
    return ":" + name + ":"
  })
  text = text.replace(/\s+/g, " ").trim()
  if (text.length > 120) text = text.slice(0, 120) + "…"
  if (!text) return null
  const msg = { type: "chat", user, text, color }
  const emotes = names.map(stEmoticon).filter((e) => text.includes(e.text))
  if (emotes.length) msg.emotes = emotes
  return msg
}

/**
 * 一个聊天室的去重记录（进程内，重连时沿用）。超过 ST_REJOIN_MS 没有拉取过的当作重新进直播间，重新开始。
 * 90 秒内离开又回到同一个直播间时，补发的只有离开之后的聊天。
 */
function stChatStore(chatKey) {
  const now = Date.now()
  let store = stChatSeen.get(chatKey)
  if (!store || now - store.at > ST_REJOIN_MS) {
    store = { seen: new Set(), order: [], at: now }
    stChatSeen.delete(chatKey)
    stChatSeen.set(chatKey, store)
    while (stChatSeen.size > 8) stChatSeen.delete(stChatSeen.keys().next().value)
  }
  return store
}

/**
 * 一次拉取的聊天（最近 50 条）→ 要发出的消息：按 steamid + instance_id + 内容去掉发过的。
 * first = 这个会话的第一次拉取，没发过的都是连上之前的聊天：history 为 true（App.features 含 "history"）时
 * 发最近 ST_BACKLOG 条并标上 history: true（只进聊天区）；旧版 App 不发（不然会一起飞过视频）。
 */
function stSelectChat(store, list, first, broadcasterSid, history) {
  const fresh = []
  for (const m of list) {
    const key = stStr(m.steamid) + "|" + stStr(m.instance_id) + "|" + stStr(m.msg)
    if (store.seen.has(key)) continue
    store.seen.add(key)
    store.order.push(key)
    fresh.push(m)
  }
  while (store.order.length > 400) store.seen.delete(store.order.shift())
  store.at = Date.now()
  if (first && !history) return []
  const out = []
  for (const m of first ? fresh.slice(-ST_BACKLOG) : fresh) {
    const msg = stChatMessage(m, broadcasterSid)
    if (!msg) continue
    if (first) msg.history = true
    out.push(msg)
  }
  return out
}

async function stPollChat(session, first) {
  const s = session.data
  const d = await stJson(s.chatUrl.replace("{0}", "0"), { timeout: 10000 })
  const list = Array.isArray(d.messages) ? d.messages : []
  const out = stSelectChat(s.store, list, first, s.sid, stFeature("history"))
  if (out.length) session.emit(out)
}

class SteamLive extends LiveSource {
  key = "steam"
  name = "Steam 直播"
  version = "1.2.0"
  url = "https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/steam.live.js"
  apiVersion = 1
  icon = "https://store.steampowered.com/favicon.ico"
  description = "Steam 社区和商店页的游戏直播：推荐、分类、搜索、HLS 播放、聊天弹幕（游客）"
  domains = [
    "steamcommunity.com",
    "store.steampowered.com",
    "steambroadcastchat.akamaized.net",
    "*.steamcontent.com",
  ]
  links = [
    "steamcommunity\\.com/broadcast/watch/(\\d{17})",
    "steam://broadcast/watch/(\\d{17})",
    "steamcommunity\\.com/profiles/(\\d{17})",
    "steamcommunity\\.com/id/([A-Za-z0-9_-]{2,32})",
    "store\\.steampowered\\.com/app/(\\d{1,8})",
    "steamcommunity\\.com/app/(\\d{1,8})",
  ]

  // 网页登录（App.features 含 "login" 的 App 读它；旧版 App 忽略）：打开 url 登录，出现 cookieNames 后
  // 把 cookieUrl 下的全部 Cookie 写进本源的 Cookie 罐。没有用真实帐号测试过。
  login = {
    url: "https://steamcommunity.com/login/home/?goto=",
    cookieUrl: "https://steamcommunity.com/",
    cookieNames: ["steamLoginSecure"],
    tip: "用自己的 Steam 帐号观看（登录 Cookie 只保存在本机）",
  }

  // ======================== 列表 ========================

  /** 推荐：社区首页的热门直播，App 一页 = Steam 两页（20 个） */
  async recommend(page) {
    if (page <= 1) stRecommendSeen = new Set()
    const pages = await Promise.all([stTrendingPage(page * 2 - 1), stTrendingPage(page * 2)])
    const rooms = []
    for (const c of pages.flat()) {
      if (stRecommendSeen.has(c.roomId)) continue
      stRecommendSeen.add(c.roomId)
      rooms.push(stToRoom(c))
    }
    return { hasMore: pages[1].length >= 10, rooms }
  }

  async categories() {
    const list = await stTrending(3).catch(() => [])
    const apps = new Map()
    for (const c of list) {
      if (!c.appName) continue
      const a = apps.get(c.appName) || { name: c.appName, viewers: 0, pic: c.cover }
      a.viewers += c.online
      apps.set(c.appName, a)
    }
    const hot = [...apps.values()].sort((a, b) => b.viewers - a.viewers).slice(0, 30)
    if (!hot.length) return []
    return [{ id: "hot", name: "正在热播", children: hot.map((a) => ({ id: "name:" + a.name, name: a.name, pic: a.pic })) }]
  }

  /** 一个游戏的直播：推荐列表里这个游戏的直播排在前面，后面是游戏中心的列表 */
  async categoryRooms(category, page) {
    const id = stStr(category.id)
    const name = id.startsWith("name:") ? id.slice(5) : stStr(category.name)
    const appid = /^\d+$/.test(id) ? id : await stAppIdByName(name)
    const key = stNameKey(name)
    const trending = page <= 1 ? (await stTrending(5).catch(() => [])).filter((c) => stNameKey(c.appName) === key) : []
    // 找不到 AppID：只有推荐列表里的（一页）
    const cards = appid ? await stAppPage(appid, page) : []
    const seen = new Set()
    const rooms = []
    for (const c of trending.concat(cards)) {
      if (seen.has(c.roomId)) continue
      seen.add(c.roomId)
      rooms.push(stToRoom(c))
    }
    return { hasMore: cards.length >= 24, rooms }
  }

  /** 搜索直播间：推荐列表里名字匹配的 + 商店搜到的第一个游戏的直播 */
  async search(keyword, page) {
    const kw = stStr(keyword)
    if (!kw) return { hasMore: false, rooms: [] }
    const appid = await stMemo("searchApp:" + kw, 10 * 60 * 1000, async () => {
      let items = await stStoreSearch(kw).catch(() => [])
      if (!items.length && /^[\x20-\x7e]+$/.test(kw)) {
        const list = await stJson(ST_COMMUNITY + "/actions/SearchApps/" + encodeURIComponent(kw)).catch(() => [])
        items = (list || []).map((a) => ({ id: String(a.appid), name: stStr(a.name) }))
      }
      return items.length ? items[0].id : ""
    })
    const [matches, cards] = await Promise.all([
      page <= 1 ? stTrendingMatch(kw, 3) : Promise.resolve([]),
      appid ? stAppPage(appid, page) : Promise.resolve([]),
    ])
    const seen = new Set()
    const rooms = []
    for (const c of matches.concat(cards)) {
      if (seen.has(c.roomId)) continue
      seen.add(c.roomId)
      rooms.push(stToRoom(c))
    }
    return { hasMore: cards.length >= 24, rooms }
  }

  /** 搜索主播：社区用户搜索（含没开播的人），逐个查是否在播 */
  async searchAnchors(keyword, page) {
    const kw = stStr(keyword)
    if (!kw) return { hasMore: false, anchors: [] }
    const [result, trending] = await Promise.all([
      stUserSearch(kw, page),
      stTrending(3).catch(() => []),
    ])
    const live = new Map(trending.map((c) => [c.roomId, c]))
    const anchors = await stMapLimit(result.users, 5, async (u) => {
      const card = live.get(u.sid)
      if (card) return { roomId: u.sid, userName: u.name, avatar: u.avatar, live: true, lastTitle: card.appName }
      let info = null
      try { info = await stBroadcastInfo(u.sid, 6000) } catch (e) {}
      return {
        roomId: u.sid,
        userName: u.name,
        avatar: u.avatar,
        live: !!(info && info.live),
        lastTitle: info && info.live ? (info.title || info.appTitle) : undefined,
      }
    })
    anchors.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0))
    return { hasMore: page * 20 < result.total, anchors }
  }

  /** 联想：推荐列表里名字匹配的在播主播 + 用户搜索的前几个（不查是否在播） */
  async suggest(keyword) {
    const kw = stStr(keyword)
    if (kw.length < 2) return []
    const [matches, users] = await Promise.all([
      stTrendingMatch(kw, 3).catch(() => []),
      stUserSearch(kw, 1).then((r) => r.users).catch(() => []),
    ])
    const out = []
    const seen = new Set()
    for (const c of matches) {
      if (seen.has(c.roomId) || out.length >= 5) continue
      seen.add(c.roomId)
      out.push({ text: c.userName, roomId: c.roomId, userName: c.userName, avatar: c.avatar, live: true, subtitle: c.appName })
    }
    for (const u of users) {
      if (seen.has(u.sid) || out.length >= 8) continue
      seen.add(u.sid)
      out.push({ text: u.name, roomId: u.sid, userName: u.name, avatar: u.avatar })
    }
    return out
  }

  /** 直达：SteamID64、好友代码、AppID、自定义网址名、链接 → SteamID64 */
  async resolve(input) {
    const target = stParseTarget(input)
    if (!target) return null
    try {
      return await stResolveSid(target)
    } catch (e) {
      return null
    }
  }

  // ======================== 直播间 ========================

  async room(roomId) {
    const target = stParseTarget(roomId)
    if (!target) throw new Error("不是有效的 Steam 直播间（应为 SteamID64）")
    const sid = await stResolveSid(target)
    if (!sid) {
      throw new Error(target.appid ? "这个游戏现在没有人在直播" : "找不到这个 Steam 用户")
    }
    const [info, profile] = await Promise.all([stBroadcastInfo(sid), stProfile(sid).catch(() => null)])
    const name = (profile && profile.name) || sid
    const avatar = (profile && profile.avatar) || ""
    return {
      roomId: sid,
      title: info.live ? (info.title || info.appTitle || name + " 的 Steam 直播") : name + " 的 Steam 直播",
      cover: info.live && info.thumbnail ? info.thumbnail : avatar,
      userName: name,
      userAvatar: avatar,
      online: info.live ? info.viewers : 0,
      live: info.live,
      isRecord: info.live && info.rerun,
      introduction: info.live && info.appTitle ? "正在玩：" + info.appTitle : "",
      notice: info.live
        ? [
          info.title && info.appTitle ? info.title : "",
          info.rtmp ? "" : (stFeature("hlsFix") ? ST_ONDEMAND_NOTICE : ST_CLIENT_NOTICE),
        ].filter(Boolean).join("\n")
        : "",
      url: ST_COMMUNITY + "/broadcast/watch/" + sid,
      data: { steamid: sid, appid: info.appid, rtmp: info.rtmp },
      danmakuData: { steamid: sid, broadcastid: info.broadcastid, live: info.live },
    }
  }

  async liveStatus(roomId) {
    const target = stParseTarget(roomId)
    const sid = target && target.sid ? target.sid : await stResolveSid(target)
    if (!sid) return false
    return (await stBroadcastInfo(sid)).live
  }

  /** 只有一个清晰度（HLS 主列表，mpv 选最高档）；按需开播时最多等 16 秒 */
  async qualities(room) {
    if (!room.live) return []
    const m = await stManifest(room.roomId, 16000)
    if (!m.ready) return [{ name: "原画", data: { pending: true } }]
    const label = await stTopVariantLabel(m.hls)
    return [{ name: label ? "原画 " + label : "原画", data: { broadcastid: m.broadcastid } }]
  }

  /**
   * Steam 客户端直播（is_rtmp=0）的音频列表时长有误：加上 hlsFix: "durations"，新版 App 经本机中转修正
   * （App.features 含 "hlsFix"）；旧版 App 不认识这个字段，照常直接播原地址。
   */
  async playUrls(room, quality) {
    const m = await stManifest(room.roomId, 16000)
    if (!m.ready) {
      throw new Error("主播的 Steam 正在开始推流（观众少的直播要有人观看才开始上传，一般 20～40 秒），请稍后重试")
    }
    const rtmp = !(room.data && room.data.rtmp === false)
    return rtmp
      ? { urls: [m.hls], headers: ST_PLAY_HEADERS }
      : { urls: [m.hls], headers: ST_PLAY_HEADERS, hlsFix: "durations" }
  }

  /** iOS 系统画中画：同一个 HLS 主列表（fMP4 分段，AVPlayer 能播） */
  async avPlayerUrls(room, quality) {
    const m = await stManifest(room.roomId, 8000)
    if (!m.ready) return null
    return { urls: [m.hls], headers: ST_PLAY_HEADERS }
  }

  // ======================== 帐号（App.features 含 "login" 的 App 调用） ========================

  /**
   * 当前登录的帐号：{ loggedIn, uid?, userName?, avatar? }（只读本地 Cookie 和公开资料）。
   * 退出登录由 App 清掉 login.cookieUrl 的 Cookie。
   */
  async account() {
    const sid = await stLoginSid()
    if (!sid) return { loggedIn: false }
    const p = await stProfile(sid).catch(() => null)
    return { loggedIn: true, uid: sid, userName: (p && p.name) || sid, avatar: (p && p.avatar) || "" }
  }

  // ======================== 自检（检查工具、单元测试用，不发请求） ========================

  parseForTest(kind, input) {
    switch (kind) {
      case "cards": return stParseCards(input)
      case "users": return stParseUserRows(input)
      case "chat": return (input.messages || []).map((m) => stChatMessage(m, input.broadcaster || ""))
      // 一次拉取：{ chat, messages, first, history? }，同一个 chat 连续调用 = 同一个聊天室的连续拉取（含重连）；
      // history 不写时按 App.features
      case "poll": return stSelectChat(stChatStore("test:" + input.chat), input.messages || [], !!input.first,
        input.broadcaster || "", input.history === undefined ? stFeature("history") : !!input.history)
      case "target": return stParseTarget(input)
      case "label": return stVariantLabel(input)
    }
    return null
  }

  // ======================== 弹幕 ========================
  danmaku = {
    async start(room, session) {
      const s = session.data
      const dm = room.danmakuData || {}
      s.sid = stStr(dm.steamid || room.roomId)
      let bid = stStr(dm.broadcastid)
      if (!dm.live || !bid) {
        const info = await stBroadcastInfo(s.sid)
        if (!info.live) {
          session.emit([{ type: "system", text: "主播当前未开播" }])
          return
        }
        bid = info.broadcastid
      }
      const viewer = stViewers.get(s.sid)
      if (!bid && viewer) bid = viewer.broadcastid
      if (!bid) throw new Error("没有拿到直播编号，稍后重新连接聊天")
      // 登录后这个接口还返回自己的 steamid 和名字
      const chat = await stJson(ST_COMMUNITY + "/broadcast/getchatinfo/", { query: { steamid: s.sid, broadcastid: bid } })
      if (chat.success !== 1 || !chat.view_url_template) throw new Error("连接 Steam 直播聊天失败（" + chat.success + "）")
      s.chatUrl = stStr(chat.view_url_template)
      s.chatId = stStr(chat.chat_id)
      s.me = chat.steamid ? { steamid: stStr(chat.steamid), name: stStr(chat.persona_name) } : null
      // 去重记录按聊天室保存，重连后沿用：已经发过的不再发
      s.store = stChatStore(s.chatId || s.chatUrl)
      s.errors = 0
      s.ended = false

      await stPollChat(session, true)
      session.ready()

      // 登录状态只在有登录 Cookie 时提示（接口 v1 没有帐号页，用聊天区的系统消息显示）
      const loginSid = await stLoginSid().catch(() => "")
      if (loginSid) {
        if (s.me) {
          session.emit([{ type: "system", text: "已登录 Steam：" + (s.me.name || s.me.steamid) }])
        } else {
          session.emit([{ type: "system", text: "Steam 登录已过期，请重新登录" }])
        }
      }

      s.chatTimer = session.setInterval(async () => {
        try {
          await stPollChat(session, false)
          s.errors = 0
        } catch (e) {
          s.errors++
          log("拉取聊天失败", e.message)
          if (s.errors >= 5) session.fail("Steam 直播聊天连接中断")
        }
      }, 4000)

      // 观众数（网页 60 秒更新一次）；下播后停止拉聊天
      session.setInterval(async () => {
        try {
          const info = await stBroadcastInfo(s.sid)
          if (info.live) {
            session.emit([{ type: "online", online: info.viewers }])
          } else if (!s.ended) {
            s.ended = true
            session.clearInterval(s.chatTimer)
            session.emit([{ type: "system", text: "直播已结束" }])
          }
        } catch (e) {}
      }, 60000)

      // 观看心跳：按需开播的主播靠它继续推流（viewertoken 来自 qualities / playUrls）
      session.setInterval(async () => {
        const v = stViewers.get(s.sid)
        if (!v || !v.broadcastid || s.ended) return
        try {
          await stRequest(ST_COMMUNITY + "/broadcast/heartbeat/", {
            method: "POST",
            body: { steamid: s.sid, broadcastid: v.broadcastid, viewertoken: v.viewertoken },
            contentType: "form",
            headers: { "Referer": ST_COMMUNITY + "/broadcast/watch/" + s.sid },
          })
        } catch (e) {
          log("观看心跳失败", e.message)
        }
      }, 30000)

      const info = await stBroadcastInfo(s.sid).catch(() => null)
      if (info && info.live) session.emit([{ type: "online", online: info.viewers }])
    },
  }
}
