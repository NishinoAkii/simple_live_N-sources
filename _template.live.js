/**
 * SimpleLive 直播源模板（.live.js）
 *
 * 一个文件 = 一个直播平台。复制这个文件，改名为 <key>.live.js，把下面“示例直播”的
 * 接口换成目标平台的接口即可。完整说明见 live_sources/README.md 和 doc/live_source_api.md。
 *
 * 运行环境：QuickJS（ES2023，支持 async/await、BigInt、DataView、TextEncoder）。
 * 没有 DOM、fetch、Node 模块，用这些全局对象：
 *   Http、Bytes、Proto、Zip、Hash、CryptoJS、Storage、Settings、log / console、
 *   setTimeout / setInterval、App、randomId、uuid、atob / btoa
 *
 * 本地检查（在 simple_live_core 目录里）：
 *   dart run bin/live_source_check.dart ../live_sources/<key>.live.js --room <房间号> --play --danmaku 20
 */

// ---------------------------------------------------------------------------
// 顶层：只放常量和辅助函数。
// App 安装、加载、检查脚本时会在临时引擎里执行一遍顶层代码（那时发出的请求会被丢弃），
// 所以不要在顶层发请求、开定时器。
// ---------------------------------------------------------------------------

const API = "https://api.example.com";
const WEB = "https://live.example.com";

// 不写 User-Agent 时，Http 默认用桌面版 Chrome 的 UA
const HEADERS = {
  "Referer": WEB + "/",
  "Origin": WEB,
};

/** 把 “1.2万” 这样的人气转成数字 */
function parseOnline(v) {
  if (typeof v === "number") return v;
  const s = String(v || "0");
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return s.includes("万") ? Math.round(n * 10000) : Math.round(n);
}

/** 平台接口的统一返回：{ code: 0, data: … }，出错时抛出中文说明（会显示给用户） */
async function getJson(path, query) {
  const res = await Http.get(API + path, { query, headers: HEADERS, responseType: "json" });
  if (res.status !== 200) throw new Error("示例直播接口出错（HTTP " + res.status + "）");
  if (!res.body || res.body.code !== 0) throw new Error(res.body && res.body.message ? res.body.message : "示例直播接口返回异常");
  return res.body.data;
}

/** 平台的房间对象 → App 的 Room：{ roomId, title, cover, userName, online } */
function toRoom(item) {
  return {
    roomId: String(item.room_id),
    title: item.title || "",
    cover: item.cover || "",
    userName: item.nickname || "",
    online: parseOnline(item.online),
  };
}

class ExampleLive extends LiveSource {
  // ======================== 基本信息 ========================

  // 必填。只能用小写字母、数字、下划线，全局唯一；App 里的平台 id 为 "js:example_live"。
  // 发布后不要再改：改了 key 就是另一个源，用户的关注、历史记录会对不上。
  key = "example_live";

  // 必填。显示在 App 里的平台名称
  name = "示例直播";

  // 必填。语义化版本（主.次.修订）。每次发布都要调高，App 靠它判断有没有更新
  version = "1.0.0";

  // 用到的脚本接口版本。现在是 1；比 App 支持的版本高时 App 不加载这个源
  apiVersion = 1;

  // 可选。更新地址：App 从这里下载新版本（不在任何订阅里时也会按它检查更新）
  url = "https://example.com/live_sources/example_live.live.js";

  // 可选。平台图标：http(s) 地址或 data: URI
  icon = "https://live.example.com/favicon.ico";

  // 可选。一句话说明，显示在设置页
  description = "模板：演示所有字段和功能，复制后改成目标平台";

  // Http 和 WebSocket 只能访问这些域名（App 侧强制检查，包括重定向后的地址）：
  //   "example.com"   只匹配 example.com 本身
  //   "*.example.com" 匹配所有子域名（live.example.com、a.b.example.com），不含 example.com 本身
  // 播放地址（playUrls 返回的 CDN 地址）由播放器直接打开，不需要写在这里。
  domains = ["example.com", "*.example.com"];

  // 粘贴链接识别：正则字符串（注意 JS 字符串里反斜杠要写两次），第 1 组为房间号
  links = [
    "live\\.example\\.com/(\\d+)",
    "m\\.example\\.com/room/(\\d+)",
  ];

  // 可选（App.features 含 "login"，旧版 App 忽略）：网页登录。App 打开 url 让用户登录，出现 cookieNames 里的
  // Cookie 后把 cookieUrl 下的全部 Cookie 写进本源的 Cookie 罐（也可以手动粘贴）；退出登录时删掉这些 Cookie。
  login = {
    url: "https://live.example.com/login",
    cookieUrl: "https://live.example.com/",
    cookieNames: ["auth_token"],
    tip: "登录后可以看更高的画质",
  };

  // 可选（App.features 含 "settings"）：设置项，显示在 App 的直播源详情里，用户改了只存在本机。
  // 脚本用 Settings.get(key) 同步读取（没改过时为 default）。type：switch、text、number（可写 min / max）、
  // select（options：[{ value, label }] 或值的数组）
  settings = [
    { key: "preferHls", type: "switch", label: "优先 HLS", description: "关掉时优先 FLV", default: false },
    { key: "line", type: "select", label: "默认线路", options: [{ value: "main", label: "主线路" }, { value: "backup", label: "备用线路" }], default: "main" },
  ];

  // 可选（App.features 含 "overrides"）：修 App 内置的平台，而不是加一个新平台（doc/live_source_api.md §9）。
  // 写了 overrides 时这个源不显示成平台，只替换内置平台里下面实现了的函数（recommend、categories、
  // categoryRooms、search、searchAnchors、suggest、resolve、room、liveStatus、qualities、playUrls、
  // avPlayerUrls、superChats、danmaku.start），没实现的照常用内置代码，出错时（默认）也改用内置代码。
  // - 只能从有签名的订阅安装；安装、更新时 App 告诉用户替换了什么，要用户确认
  // - 内置的直播间只给公开字段（room.builtIn 为 true），没有 data、danmakuData
  // - 不能写 login、account()；替换 qualities 时也要替换 playUrls；links 不用写
  // - useAccount = true：App 在发往白名单主机（如 api.live.bilibili.com）的 https 请求上代为加登录信息，脚本读不到
  //
  //   overrides = "bilibili";   // bilibili、douyu、huya、douyin、twitch、kick、youtube
  //   useAccount = true;        // 可选

  // ======================== 列表 ========================
  // 以下方法全部可选：没写的功能 App 不显示（没有 recommend 就没有首页推荐…）。
  // 所有方法都可以是 async；抛出的 Error 的 message 会作为错误提示显示给用户。

  /** 首页推荐。page 从 1 开始 */
  async recommend(page) {
    const data = await getJson("/rooms/recommend", { page, size: 30 });
    return { hasMore: data.has_more === true, rooms: data.list.map(toRoom) };
  }

  /**
   * 分类：[{ id, name, children: [{ id, name, pic }] }]
   * 要和 categoryRooms 一起实现，App 才显示分类页。
   */
  async categories() {
    const data = await getJson("/categories");
    return data.map((group) => ({
      id: String(group.id),
      name: group.name,
      children: group.children.map((c) => ({ id: String(c.id), name: c.name, pic: c.icon })),
    }));
  }

  /** 分类下的房间。category 为 { id, name, parentId, pic } */
  async categoryRooms(category, page) {
    const data = await getJson("/rooms/category", { parent: category.parentId, id: category.id, page });
    return { hasMore: data.has_more === true, rooms: data.list.map(toRoom) };
  }

  /** 搜索直播间（一般只有在播的） */
  async search(keyword, page) {
    const data = await getJson("/search/rooms", { keyword, page });
    return { hasMore: data.has_more === true, rooms: data.list.map(toRoom) };
  }

  /**
   * 搜索主播：anchors 为 [{ roomId, userName, avatar, live }]。
   * 尽量包括没开播的主播（live: false）：App 默认的“综合”搜索靠它找到没开播的人。
   * 可选字段：followers（粉丝数）、lastTitle（上次直播的标题）、
   *   lastLiveTime（上次开播时间：秒或毫秒时间戳，或 ISO 时间文字）、isRecord（正在轮播）。
   */
  async searchAnchors(keyword, page) {
    const data = await getJson("/search/users", { keyword, page });
    return {
      hasMore: data.has_more === true,
      anchors: data.list.map((u) => ({
        roomId: String(u.room_id),
        userName: u.nickname,
        avatar: u.avatar,
        live: u.live_status === 1,
        followers: u.fans,
        lastLiveTime: u.last_live_time,
      })),
    };
  }

  /**
   * 搜索联想（可选）：只给直播相关的主播、直播间卡片，不要视频、话题之类的联想词。
   * 返回 [{ text, roomId, userName?, avatar?, live?, isRecord?, subtitle? }]：
   * 有 roomId 的卡片点了直接进直播间；没有 roomId 的项 App 不显示；live 不写表示不知道是否在播。
   * 平台没有直播专用的联想接口时，可以用一次轻量的主播搜索代替（前 5 个就够）。
   * 输入时 App 防抖后调用，超时 3 秒；超时、出错都不提示。
   */
  async suggest(keyword) {
    const data = await getJson("/search/suggest", { keyword });
    return data.list
      .filter((s) => s.room_id)
      .map((s) => ({ text: s.nickname, roomId: String(s.room_id), avatar: s.avatar, live: s.live_status === 1 }));
  }

  /**
   * 把不是链接的输入解析成房间号（可选）：数字 ID、用户号、@名称等。
   * 搜索时 App 先用它试“直达”，能打开就在结果最上面放一张卡片（不自动跳转）。
   * 返回房间号字符串（或 { roomId }），认不出返回 null。
   * 没有这个方法时 App 不试直达（不会拿任意关键词调用 room()）。
   */
  async resolve(input) {
    if (/^\d{3,12}$/.test(input)) return input;
    return null;
  }

  // ======================== 直播间 ========================

  /**
   * 直播间详情（RoomDetail）。
   *   live：是否在播；url：网页地址；
   *   data / danmakuData：任意 JSON，原样传回 qualities / playUrls / danmaku.start。
   * 整个返回对象会原样传回后面的方法，可以放额外字段。
   */
  async room(roomId) {
    const d = await getJson("/room/info", { room_id: roomId });
    return {
      roomId: String(d.room_id),
      title: d.title,
      cover: d.cover,
      userName: d.nickname,
      userAvatar: d.avatar,
      online: parseOnline(d.online),
      live: d.live_status === 1,
      introduction: d.intro || "",
      notice: d.notice || "",
      url: WEB + "/" + d.room_id,
      // 播放需要的信息：这里假设接口直接给了各清晰度的流地址
      data: { streams: d.streams || [] },
      // 弹幕需要的信息
      danmakuData: { roomId: String(d.room_id), token: d.danmaku_token, mode: d.danmaku_ws ? "ws" : "poll", ws: d.danmaku_ws },
    };
  }

  /** 是否在播（关注列表刷新用）。不写时 App 调用 room() 读 live */
  async liveStatus(roomId) {
    const d = await getJson("/room/status", { room_id: roomId });
    return d.live_status === 1;
  }

  /**
   * 清晰度：[{ name, data, sort? }]，data 为任意 JSON，原样传回 playUrls。
   * 第一个是默认清晰度。这里直接从 room.data 里取，不发请求。
   */
  async qualities(room) {
    const streams = (room.data && room.data.streams) || [];
    return streams.map((s, i) => ({ name: s.name, data: { url: s.url, index: i } }));
  }

  /**
   * 播放地址：{ urls: [主线路, 备用线路…], headers: { 播放器请求头 } }。
   * App 用 mpv 播放，FLV、HLS 都可以。
   */
  async playUrls(room, quality) {
    // 可选（App.features 含 "hlsFix"）：平台的 HLS 列表有错时加 hlsFix，App 经本机中转修正，
    // 如 hlsFix: "durations" 把过长的 #EXTINF 改成 TARGETDURATION；hlsFix: ["rewrite"] 用下面的
    // hls.rewrite 自己改（见 doc/live_source_api.md §7）
    // 设置项：旧版 App 没有 Settings，先判断
    const preferHls = typeof Settings !== "undefined" && Settings.get("preferHls");
    const url = String(quality.data.url || "");
    return { urls: [preferHls ? url.replace(".flv", ".m3u8") : url], headers: { referer: WEB + "/" } };
  }

  // 可选（App.features 含 "hlsRewrite"）：playUrls 返回的 hlsFix 含 "rewrite" 时，App 的本机中转每次取到
  // 播放列表（主列表和媒体列表）都调用它。必须同步、只处理文字（不能发请求、读写存储），约 200 毫秒内返回；
  // 返回 null 表示不改。结果里的地址只能是 http(s)，域名在 domains 里或和原列表同一主机，否则 App 用原列表。
  hls = {
    rewrite(text, info) {
      // info：{ url, kind: "master" | "media", index, variant（主列表里引用这个列表的那一行） }
      if (info.kind !== "media") return null;
      // 例：去掉广告分段（地址里有 /ad/ 的）和它前面的 #EXTINF
      const out = [];
      for (const line of text.split("\n")) {
        if (!line.startsWith("#") && line.includes("/ad/")) {
          if (out.length && out[out.length - 1].startsWith("#EXTINF")) out.pop();
          continue;
        }
        out.push(line);
      }
      return out.join("\n");
    },
  };

  /**
   * iOS 系统画中画（AVPlayer）用的地址。AVPlayer 只能播 HLS（m3u8）和 MP4，不能播 FLV：
   * 平台平时给 FLV 时，在这里另取同一直播间的 HLS 地址。没有可用地址时返回 null，
   * App 改用 mpv 画中画。不写这个方法等同于一直返回 null。
   */
  async avPlayerUrls(room, quality) {
    const url = String(quality.data.url || "");
    if (!url.includes(".flv")) return { urls: [url], headers: { referer: WEB + "/" } };
    return { urls: [url.replace(".flv", ".m3u8")], headers: { referer: WEB + "/" } };
  }

  /**
   * 当前的醒目留言（进入直播间时显示）：
   * [{ user, text, face?, price, priceText?, startTime: 毫秒, endTime: 毫秒,
   *    backgroundColor?: "#RRGGBB", backgroundBottomColor?: "#RRGGBB", id? }]
   */
  async superChats(roomId) {
    const list = await getJson("/room/superchat", { room_id: roomId });
    return list.map((s) => ({
      id: String(s.id),
      user: s.nickname,
      face: s.avatar,
      text: s.message,
      price: s.price,          // 人民币金额（整数）
      priceText: s.price_text, // 带币种的金额（可选），如 "$5.00"
      startTime: s.start_time * 1000,
      endTime: s.end_time * 1000,
      backgroundColor: "#EDF5FF",
      backgroundBottomColor: "#2A60B2",
    }));
  }

  /** 可选（App.features 含 "login"）：当前帐号，App 在账号管理里显示名字；没有时只按 Cookie 判断 */
  async account() {
    const cookies = await Http.getCookies(WEB + "/");
    if (!cookies.includes("auth_token=")) return { loggedIn: false };
    const me = await getJson("/user/me");
    return { loggedIn: true, userName: me.nickname, avatar: me.avatar, uid: String(me.uid) };
  }

  // ======================== 弹幕 ========================
  /**
   * start(room, session)：room 为 room() 返回的对象（room.danmakuData 里放弹幕需要的信息）。
   *
   * session 的方法：
   *   session.websocket(url, { headers, protocols })  连上才返回 ws，失败抛错
   *   session.emit([消息…])    把一批消息交给 App；消息格式：
   *       { type: "chat", user, text, color?: 0xRRGGBB, face?: 头像地址 }
   *       { type: "superChat", user, text, face?, price, priceText?, startTime, endTime, … }
   *       { type: "online", online: 数字 }
   *       { type: "system", text }               只显示在聊天区
   *   session.ready()           连接就绪（App 显示“弹幕服务器连接正常”）；不调用时第一条非 system 消息视为就绪（只发 system 提示时不算就绪）
   *   session.fail(原因)         报告断开，App 按 2、4、8…最长 30 秒退避，用新 session 重新调用 start
   *   session.setInterval / setTimeout / clearInterval / clearTimeout   会话结束时自动清除
   *   session.data               会话内的临时对象（序号、密钥…）
   *   session.source             源对象本身（这里的 this 是 danmaku 对象，不是源）
   *
   * ws 的成员：ws.onMessage = (data) => {}（二进制为 Uint8Array，文本为 string）、
   *   ws.onClose = (code, reason) => {}、ws.send(string 或 Uint8Array)、ws.close()。
   * WebSocket 意外断开时 App 同样会退避重连，不需要自己重连。
   */
  danmaku = {
    async start(room, session) {
      const info = room.danmakuData || {};
      if (info.mode === "poll") {
        return startPolling(room, session);
      }

      // ---- WebSocket 型 ----
      const ws = await session.websocket(info.ws, {
        headers: { Origin: WEB, "User-Agent": "Mozilla/5.0" },
      });

      // 登录包：这里假设平台用 protobuf：{ 1: roomId, 2: token, 3: 设备 id }
      const deviceId = (await Storage.get("deviceId")) || uuid();
      await Storage.set("deviceId", deviceId);
      const login = new Proto.Writer()
        .string(1, info.roomId)
        .string(2, info.token || "")
        .string(3, deviceId)
        .finish();
      ws.send(packFrame(1, login));

      ws.onMessage = async (data) => {
        if (typeof data === "string") return; // 这个平台只发二进制
        const frame = unpackFrame(data);
        let body = frame.body;
        if (frame.compressed) body = await Zip.gunzip(body); // 也有 Zip.inflate、inflateRaw、brotli
        const msg = Proto.decode(body);
        switch (frame.op) {
          case 2: // 登录成功
            session.ready();
            break;
          case 3: // 聊天：{ 1: 用户名, 2: 内容, 3: 颜色, 4: 表情名 }
            // emotes（可选，App.features 含 "emotes"）：文字里的表情显示为图片，旧版 App 只显示文字
            session.emit([{
              type: "chat", user: Proto.str(msg[1]), text: Proto.str(msg[2]), color: Proto.num(msg[3]) || 0xffffff,
              emotes: Proto.str(msg[4])
                ? [{ text: "[" + Proto.str(msg[4]) + "]", url: WEB + "/emote/" + Proto.str(msg[4]) + ".png", width: 28, height: 28 }]
                : undefined,
            }]);
            break;
          case 4: // 在线人数：{ 1: 人数 }（varint 解出来是 BigInt，Proto.num 转成数字）
            session.emit([{ type: "online", online: Proto.num(msg[1]) }]);
            break;
          case 5: // 醒目留言
            session.emit([{
              type: "superChat", user: Proto.str(msg[1]), text: Proto.str(msg[2]), price: Proto.num(msg[3]),
              startTime: Date.now(), endTime: Date.now() + Proto.num(msg[4]) * 1000,
            }]);
            break;
          case 9: // 服务器要求断开
            session.fail("弹幕服务器要求重新连接");
            break;
        }
      };

      ws.onClose = (code, reason) => log("弹幕连接关闭", code, reason);

      // 心跳：会话结束时自动清除
      session.setInterval(() => ws.send(packFrame(0, new Uint8Array(0))), 30000);
    },

    // 可选：会话结束时调用（App 停止弹幕，或断开后重连之前）；连接和定时器 App 会自己清理
    async stop(session) {},
  };

  // ======================== 自检（可删） ========================
  // 不发请求，演示 Bytes、Proto、CryptoJS 的用法；模板测试会调用它。
  selfTest() {
    // Proto 往返
    const bytes = new Proto.Writer().varint(1, 150).string(2, "直播").sint(3, -2).finish();
    const m = Proto.decode(bytes);
    if (Proto.num(m[1]) !== 150 || Proto.str(m[2]) !== "直播" || Proto.zigzag(m[3]) !== -2) return false;

    // MD5 / HMAC：签名参数常用（新版 App 另有异步的 Hash.md5 / sha256 / hmac，在 App 里算，更快：
    //   Bytes.toHex(await Hash.hmac("sha256", key, text))）
    const sign = CryptoJS.MD5("room=1&t=123" + "secret").toString();
    if (sign.length !== 32) return false;

    // AES-CBC：key / iv 用 Bytes 转成 WordArray
    const key = Bytes.toWordArray(Bytes.fromUtf8("0123456789abcdef"));
    const iv = Bytes.toWordArray(Bytes.fromUtf8("abcdef9876543210"));
    const enc = CryptoJS.AES.encrypt("弹幕密钥", key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
    const dec = CryptoJS.AES.decrypt(enc.toString(), key, { iv }).toString(CryptoJS.enc.Utf8);
    if (dec !== "弹幕密钥") return false;

    // 帧格式往返
    const f = unpackFrame(packFrame(3, Bytes.fromHex("0a00")));
    return f.op === 3 && Bytes.toHex(f.body) === "0a00" && parseOnline("1.5万") === 15000;
  }
}

// ---------------------------------------------------------------------------
// 弹幕帧（示例格式）：4 字节总长度 + 2 字节 op + 1 字节压缩标记 + body，大端序
// 用 DataView 读写二进制
// ---------------------------------------------------------------------------
function packFrame(op, body, compressed) {
  const out = new Uint8Array(7 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  view.setUint16(4, op);
  view.setUint8(6, compressed ? 1 : 0);
  out.set(body, 7);
  return out;
}

function unpackFrame(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { op: view.getUint16(4), compressed: view.getUint8(6) === 1, body: u8.subarray(7, view.getUint32(0)) };
}

// ---------------------------------------------------------------------------
// 轮询型弹幕：没有 WebSocket 的平台定时拉取新消息
// ---------------------------------------------------------------------------
function startPolling(room, session) {
  session.data.cursor = "";
  session.ready();
  session.setInterval(async () => {
    try {
      const first = !session.data.cursor;
      const data = await getJson("/room/messages", { room_id: room.roomId, cursor: session.data.cursor });
      session.data.cursor = data.cursor;
      // 第一次（没有游标）拿到的是进直播间之前的聊天：App.features 含 "history" 时标上 history: true，
      // 只进聊天区、不飞过视频；旧版 App 会把它们当成新弹幕一起飞过视频，就不发了
      const history = first && Array.isArray(App.features) && App.features.includes("history");
      if (first && !history) return;
      session.emit(data.list.map((m) => ({ type: "chat", user: m.nickname, text: m.content, history: history || undefined })));
    } catch (e) {
      // 偶尔失败不要紧，下次再拉；连续失败可以 session.fail(...) 让 App 退避重连
      log("拉取弹幕失败", e.message);
    }
  }, 3000);
}
