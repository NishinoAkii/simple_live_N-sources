/*
 * simple_liveN 直播源示例
 *
 * 本文件以虚构平台 example.com 为例，说明直播源脚本的结构、各函数的用途和返回格式，
 * 以及这些数据在平台网页中的查找方法。所有说明均写在注释中。
 *
 * 使用方法：
 *   1. 复制本文件，命名为 <key>.live.js（例如 my_live.live.js）。
 *   2. 将地址、参数和字段换成目标平台的实际内容。
 *   3. 用检查工具测试（见 GUIDE.md“测试”），再在 App 中安装。
 *
 * 相关文件：
 *   - GUIDE.md：编写步骤、数据查找、测试与发布。
 *   - _template.live.js：全部字段和可选功能的完整模板。
 *   - simple_liveN 仓库 doc/live_source_api.md：接口约定。
 *
 * 运行环境：QuickJS，支持 ES2023 与 async/await；没有 DOM、fetch 和 Node 模块。
 * 每次函数调用须在 20 秒内返回；同步代码连续运行超过 10 秒会被中断。
 * 顶层代码在安装和启动时会执行一次，只用于读取字段，因此顶层只定义常量和函数，不发请求。
 *
 * 可用的全局对象（详见接口约定 §2）：
 *   Http.get(url, opts) / Http.post(url, body, opts)
 *       发送请求，返回 { status, headers, body, url }。opts 常用项：query（查询参数对象）、
 *       headers、responseType（"text" / "json" / "bytes"）、timeout（毫秒）。
 *       非 2xx 响应不抛出错误，需自行检查 status。只能访问 domains 中的域名。
 *       每个源有独立的 Cookie，响应中的 Set-Cookie 自动保存，后续请求自动携带。
 *   Http.getCookies(url) / Http.setCookies(url, "a=1; b=2")   读写本源的 Cookie。
 *   Storage.get(key) / Storage.set(key, value) / Storage.remove(key)   持久保存 JSON 数据。
 *   Settings.get(key)       读取用户在 App 中修改的设置项（需声明 settings）。
 *   Bytes                   UTF-8、Base64、Hex 与字节数组之间的转换。
 *   Proto                   protobuf 编码与解码。
 *   Zip                     gzip、zlib、brotli 的压缩与解压。
 *   Hash                    MD5、SHA、HMAC（App.features 包含 "hash" 时可用）。
 *   CryptoJS                CryptoJS 4（不含 GCM）。
 *   log(...) / console.log  写入 App 日志。
 *   setTimeout、setInterval、TextEncoder、TextDecoder、atob、btoa 等常用浏览器接口。
 *   App.version、App.platform、App.features（App 支持的可选功能列表，旧版 App 没有此字段）。
 *
 * 错误处理：抛出 new Error("中文说明")，message 会作为提示显示给用户。
 */

// ---------------------------------------------------------------------------
// 常量与工具函数
// ---------------------------------------------------------------------------

const API = "https://api.example.com"
const WEB = "https://www.example.com"

// 多数平台的接口要求 Referer；未设置 User-Agent 时默认使用桌面版 Chrome 的 UA。
const HEADERS = { Referer: WEB + "/" }

/**
 * 请求 JSON 接口。
 * 本示例平台以 code 为 0 表示成功；其他平台请按其实际约定判断。
 */
async function getJson(path, query) {
  const res = await Http.get(API + path, { query, headers: HEADERS, responseType: "json" })
  if (res.status !== 200 || !res.body || res.body.code !== 0) {
    throw new Error("示例直播请求失败（" + res.status + "）")
  }
  return res.body.data
}

/**
 * 将平台的直播间数据转换为 App 的 Room 格式：
 *   roomId    房间号（字符串）
 *   title     直播标题
 *   cover     封面地址
 *   userName  主播名
 *   online    在线人数或热度（数字）
 */
function toRoom(item) {
  return {
    roomId: String(item.room_id),
    title: item.title || "",
    cover: item.cover || "",
    userName: item.nickname || "",
    online: Number(item.online) || 0,
  }
}

// ---------------------------------------------------------------------------
// 直播源
// 一个文件中只能有一个继承 LiveSource 的类。
// ---------------------------------------------------------------------------

class SampleLive extends LiveSource {
  // 必填。只能包含小写字母、数字和下划线，全局唯一。
  // 发布后不可更改：更改后视为另一个源，用户的关注和观看记录将无法对应。
  key = "sample"

  // 必填。App 中显示的平台名称。
  name = "示例直播"

  // 必填。格式为 1.2.3。每次发布须调高，App 据此判断是否有更新。
  version = "1.0.0"

  // 可选。脚本自身的下载地址，用于检查更新。
  // url = "https://example.com/sample.live.js"

  // 可选。平台图标和一句话说明。
  icon = "https://www.example.com/favicon.ico"
  description = "示例：推荐、分类、搜索、播放、弹幕"

  // 必填。脚本可访问的全部域名，包括接口、WebSocket 和播放地址所在的 CDN。
  // "*.example.com" 不包含 example.com 本身，需要时两项都要写。未列出的域名一律拒绝访问。
  domains = ["api.example.com", "www.example.com", "*.example-cdn.com"]

  // 可选。识别用户粘贴的直播间链接：正则表达式字符串，第 1 个捕获组为房间号。
  links = ["example\\.com/live/(\\d+)"]

  // -------------------------------------------------------------------------
  // 列表类函数（均为可选；未实现的功能不会在 App 中显示）
  // 返回格式：{ hasMore: 是否还有下一页, rooms: [Room, ...] }，page 从 1 开始。
  // -------------------------------------------------------------------------

  /**
   * 首页推荐。
   * 数据来源：打开平台首页，在开发者工具“网络”面板中筛选 Fetch/XHR，
   * 向下滚动页面，查找返回直播间列表的请求，并记录其分页参数。
   */
  async recommend(page) {
    const data = await getJson("/live/recommend", { page, size: 20 })
    return { hasMore: data.list.length >= 20, rooms: data.list.map(toRoom) }
  }

  /**
   * 分类列表。须与 categoryRooms 同时实现，App 才会显示分类。
   * 返回：[{ id, name, children: [{ id, name, pic }] }]，children 为子分类。
   * 数据来源：打开平台的分类页面时加载的分类数据。
   */
  async categories() {
    const data = await getJson("/live/areas")
    return data.map((group) => ({
      id: String(group.id),
      name: group.name,
      children: group.areas.map((area) => ({ id: String(area.id), name: area.name, pic: area.icon || "" })),
    }))
  }

  /**
   * 分类下的直播间。category 为 { id, name, parentId, pic }。
   * 数据来源：进入某个分类并翻页时的请求。
   */
  async categoryRooms(category, page) {
    const data = await getJson("/live/area_rooms", { area: category.id, page })
    return { hasMore: data.has_more === true, rooms: data.list.map(toRoom) }
  }

  /**
   * 搜索直播间。
   * 数据来源：在平台网页的搜索框中搜索一次，查看新出现的请求。
   * 另有 searchAnchors(keyword, page)（搜索主播，应包括未开播的主播）、
   * suggest(keyword)（输入联想）和 resolve(input)（将用户号等换成房间号），
   * 格式见接口约定 §1。
   */
  async search(keyword, page) {
    const data = await getJson("/search/live", { keyword, page })
    return { hasMore: data.has_more === true, rooms: data.list.map(toRoom) }
  }

  // -------------------------------------------------------------------------
  // 直播间与播放（这三个函数实现后即可观看直播）
  // -------------------------------------------------------------------------

  /**
   * 直播间详情。
   * 返回字段：
   *   roomId、title、cover、userName、userAvatar、online   同 Room，另加主播头像
   *   live          是否正在直播
   *   url           直播间网页地址
   *   introduction  简介（可选）
   *   data          任意数据，原样传给 qualities 和 playUrls
   *   danmakuData   任意数据，原样传给 danmaku.start
   * 返回的整个对象会作为 room 参数传给后续函数，后续步骤所需的数据应放在这里，避免重复请求。
   *
   * 数据来源：打开直播间页面。详情可能来自单独的接口，也可能写在页面 HTML 中
   * （通常在 window.__INITIAL_STATE__ 或 __NEXT_DATA__ 等变量里，可用正则取出后 JSON.parse）。
   * 在“网络”面板中搜索直播间标题，即可找到数据所在的请求。
   */
  async room(roomId) {
    const d = await getJson("/live/room", { room_id: roomId })
    return {
      roomId: String(d.room_id),
      title: d.title,
      cover: d.cover,
      userName: d.nickname,
      userAvatar: d.avatar,
      online: Number(d.online) || 0,
      live: d.status === 1,
      url: WEB + "/live/" + d.room_id,
      data: d.streams || [],
      danmakuData: { roomId: String(d.room_id) },
    }
  }

  /**
   * 清晰度列表，第一项为默认清晰度。
   * 返回：[{ name: "原画", data: 任意数据 }]，data 原样传给 playUrls。
   * 数据来源：通常在直播间详情中，或与播放地址在同一个接口里。
   */
  async qualities(room) {
    return room.data.map((stream) => ({ name: stream.name, data: stream.url }))
  }

  /**
   * 播放地址。
   * 返回：{ urls: [地址, 备用地址...], headers: { 播放时的请求头 } }。
   * 数据来源：在“网络”面板中筛选 m3u8 或 flv（或切换到“媒体”），找到视频请求后，
   * 向前查找返回该地址的接口。地址含有效期参数（如 expires、token）时，应在此处重新请求，
   * 不要使用 room() 时取得的旧地址。播放所需的 Referer、User-Agent 写在 headers 中。
   * 另有 avPlayerUrls(room, quality)：返回 HLS 或 MP4 地址，供 iOS 系统小窗使用；平台只有 FLV 时返回 null。
   */
  async playUrls(room, quality) {
    return { urls: [quality.data], headers: { referer: WEB + "/" } }
  }

  // -------------------------------------------------------------------------
  // 弹幕（可选）
  // -------------------------------------------------------------------------

  /*
   * session 提供：
   *   session.websocket(url, { headers })   建立 WebSocket 连接，连接成功后返回；
   *                                          ws.onMessage = (data) => {}（二进制为 Uint8Array，文本为字符串）、
   *                                          ws.send(数据)、ws.close()
   *   session.emit(消息数组)                 将消息交给 App
   *   session.ready()                        通知 App 已连接
   *   session.fail("原因")                   报告断开；App 会等待后重新调用 start
   *   session.setInterval / setTimeout       会话结束时自动清除
   *   session.data                           会话内的临时数据
   *   session.source                         源对象（danmaku 中的 this 不是源对象）
   *
   * 消息格式：
   *   { type: "chat", user, userId?, text, color? }   普通弹幕；填写 userId 后，屏蔽、备注按 ID 识别
   *   { type: "superChat", user, text, price, startTime, endTime }   醒目留言（时间为毫秒）
   *   { type: "online", online }                       在线人数
   *   { type: "system", text }                         只在聊天区显示的提示
   *
   * 断线重连由 App 负责，脚本无需处理。
   *
   * 数据来源：在“网络”面板中筛选 WS，查看 WebSocket 连接的消息。重点记录连接后发送的第一条消息
   * （进入房间）和心跳的格式与间隔。二进制消息通常为 protobuf，可用 Proto.decode 逐层解析。
   * 没有 WebSocket 的平台会定时请求聊天接口，在 Fetch/XHR 中可以看到。本示例采用这种方式。
   */
  danmaku = {
    async start(room, session) {
      const roomId = room.danmakuData.roomId
      // 首次请求只记录最新一条消息的位置，不发送进入直播间之前的聊天。
      const first = await getJson("/live/chat", { room_id: roomId, after: 0 })
      session.data.after = first.list.length ? first.list[first.list.length - 1].id : 0
      session.ready()
      session.setInterval(async () => {
        try {
          const data = await getJson("/live/chat", { room_id: roomId, after: session.data.after })
          if (!data.list.length) return
          session.data.after = data.list[data.list.length - 1].id
          session.emit(data.list.map((m) => ({
            type: "chat",
            user: m.nickname,
            userId: String(m.uid),
            text: m.content,
          })))
        } catch (e) {
          log("拉取聊天失败", e.message)
        }
      }, 3000)
    },
  }

  // -------------------------------------------------------------------------
  // 其他可选内容（示例中未启用，用法见 _template.live.js 和接口约定 §7）
  // -------------------------------------------------------------------------
  //
  // 网页登录：登录后，本源的请求携带该站点的 Cookie。
  //   login = { url: WEB + "/login", cookieUrl: WEB + "/", cookieNames: ["token"], tip: "说明文字" }
  //   async account() { return { loggedIn: true, userName: "…" } }
  //
  // 设置项：显示在 App 的直播源详情页，脚本用 Settings.get(key) 读取。
  //   settings = [{ key: "hd", type: "switch", label: "默认高清", default: true }]
  //
  // 醒目留言列表：
  //   async superChats(roomId) { return [{ user, text, price, startTime, endTime }] }
  //
  // 是否在播（未实现时 App 调用 room() 判断）：
  //   async liveStatus(roomId) { return true }
}

/*
 * 发布时，将脚本放在可通过 https 访问的位置，并编写订阅文件 index.json：
 *
 * {
 *   "name": "我的直播源",
 *   "sources": [
 *     { "key": "sample", "name": "示例直播", "version": "1.0.0",
 *       "url": "sample.live.js", "description": "推荐、搜索、弹幕" }
 *   ]
 * }
 *
 * url 可以是相对 index.json 的路径或完整地址。每次发布须同时调高脚本和 index.json 中的 version。
 */
