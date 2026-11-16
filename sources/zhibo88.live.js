/**
 * 88直播（88zhibo / 88看球）
 *
 * 网站结构（2026-11-08）：
 *   首页 /                      全部比赛，按日期分组；每行有时间、联赛、主客队、状态（直播中 / 暂无 / 已结束）
 *   联赛 /match/<分类>/live      左边栏的联赛（NBA、英超……），格式同首页
 *   比赛 /live/<比赛>/play       比赛信息；线路由 /live/<比赛>/source 给出
 *   线路 /live/<比赛>/source     {"data": "6 个字符 + Base64(JSON) + 2 个字符"}，
 *                                JSON 为 { links: [{ name, url, shareLock }], … }，
 *                                url 多为 https://play.88player.top/m3u8.html?url=<m3u8>（播放页直接用 hls.js 播这个地址）
 *
 * 播放时的请求头和浏览器一样（见 browserHeaders）：88player 页面声明 no-referrer，所以不带 Referer。
 * 1.1.0 之前带了 Referer、用的是播放器默认 UA，浏览器能播而 App 一直重连。
 *
 * 国内线路（play.sportsteam368.com）：选中时读网页里的 encodedStr，按网页播放器的 XXTEA 格式解出 {ts, url}，
 * 不执行网页脚本；被 Cloudflare 拦截、过期、格式变了时分别报错。App 出错后会马上重连、换线，
 * 每次都重新请求这个网页容易被限流（403），所以解出的地址和失败结果都只记 1 分钟。
 *
 * 比赛结束后网站还会挂着“直播中”好一阵（线路已经 404），App 就一直重连：按开赛时间推算，
 * 超过这个项目一场比赛的正常时长就当已结束。体育电视台（客队写“电视直播”）一直算在播。
 * “稳定线路”“推荐线路：飞球直播”只是跳到飞球直播首页，没有这场比赛的地址，不显示。
 *
 * 网址经常换：先用上次能用的网址，打不开就按下面的镜像依次试，都不行再读地址发布页找新网址。
 * 发布页上出现的全新域名不在 domains 里时用不了（脚本只能访问声明过的域名），要更新这个直播源。
 */

/** 同一个后台的镜像网址（比赛编号、接口都一样） */
const MIRRORS = [
  "www.88zhibo.me", "www.88zhibo.tv",
  "www.88kanqiu.tw", "www.88kanqiu.la", "www.88kanqiu.one", "www.88kanqiu.love", "www.88kanqiu.ooo",
  "www.88kanqiu.pw", "www.88kanqiu.in", "www.88kanqiu.cv", "www.88kanqiu.bar", "www.88kanqiu.cx", "www.88kanqiu.us",
  "www.popozhibo.tv", "www.popozhibo.me", "www.popozhibo.xyz", "www.popozhibo.com", "www.popozhibo.vip",
];

/** 地址发布页：列着当前能用的网址 */
const PUBLISH_PAGES = ["https://www.88kq.me/", "https://www.88kq.org/", "https://www.88kq.cc/", "https://www.88kq.net/"];

/** 发布页里属于这个站的网址 */
const MIRROR_PATTERN = /https?:\/\/(www\.(?:88zhibo|88kanqiu|popozhibo)\.[a-z]{2,12})\b/gi;

// 脚本引擎里没有 URL 类，用这几个简单的函数
function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function originOf(url) {
  const m = String(url || "").match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1] : "";
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

/** 和浏览器的 URLSearchParams.get 一样：按 & 分开，+ 当空格 */
function queryParam(url, name) {
  const query = String(url || "").split("#")[0].split("?").slice(1).join("?");
  for (const part of query.split("&")) {
    const i = part.indexOf("=");
    const key = safeDecode((i < 0 ? part : part.slice(0, i)).replace(/\+/g, " "));
    if (key === name) return i < 0 ? "" : safeDecode(part.slice(i + 1).replace(/\+/g, " "));
  }
  return null;
}

const DOMAINS = [
  ...new Set([
    ...MIRRORS.map((h) => "*." + h.replace(/^www\./, "")),
    ...PUBLISH_PAGES.map((u) => "*." + hostOf(u).replace(/^www\./, "")),
    "play.sportsteam368.com",
  ]),
];

/** 网页播放器的地址：参数 url 就是播放地址 */
const PLAYER_PARAM = "url";
const PLAYER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * 播放请求头，和浏览器里网页播放器（hls.js）发的一样：Chrome 的 UA 和客户端提示、跨域请求的 Origin，没有 Referer。
 * 有的 CDN 按 User-Agent、Referer、Sec-CH-UA-Mobile、Accept 区分（rtmpcdn 的 Vary），和浏览器不一样时可能被拒或跳到别处。
 */
function browserHeaders(origin) {
  const headers = {
    "user-agent": PLAYER_USER_AGENT,
    "accept": "*/*",
    "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };
  if (origin) headers.origin = origin;
  return headers;
}

/** 开赛后超过这么久，网站还写“直播中”也当已结束（小时） */
const MAX_LIVE_HOURS = { football: 3, basketball: 3.5, other: 5 };

/** 国内线路：解出的地址、失败结果都记这么久 */
const DOMESTIC_TTL = 60 * 1000;
const domesticCache = new Map();

/** 网址检查结果缓存这么久，避免每次都试 */
const BASE_TTL = 10 * 60 * 1000;
/** 列表页缓存，切换分类、搜索时少请求几次 */
const PAGE_TTL = 30 * 1000;

let currentBase = null;
let currentBaseAt = 0;
const pageCache = new Map();

function domainAllowed(host) {
  host = host.toLowerCase();
  return DOMAINS.some((d) => (d.startsWith("*.") ? host === d.slice(2) || host.endsWith(d.slice(1)) : host === d));
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function text(html) {
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** 能打开、而且是这个站的首页 */
async function homeOf(host) {
  try {
    const res = await Http.get("https://" + host + "/", { timeout: 8000 });
    if (res.status !== 200 || !/category-nav|group-game-item/.test(res.body || "")) return null;
    return { host: hostOf(res.url) || host, html: res.body };
  } catch (e) {
    log("打不开 " + host + "：" + (e && e.message ? e.message : e));
    return null;
  }
}

async function useBase(found) {
  currentBase = found.host;
  currentBaseAt = Date.now();
  pageCache.set("/", { at: Date.now(), html: found.html });
  await Storage.set("base", found.host);
  return found.host;
}

/** 找一个能用的网址：上次的 → 内置镜像 → 地址发布页 */
async function base(skip) {
  if (currentBase && currentBase !== skip && Date.now() - currentBaseAt < BASE_TTL) return currentBase;
  const saved = await Storage.get("base");
  const tried = new Set(skip ? [skip] : []);
  for (const host of [saved, ...MIRRORS]) {
    if (!host || tried.has(host)) continue;
    tried.add(host);
    const found = await homeOf(host);
    if (found) return useBase(found);
  }
  for (const page of PUBLISH_PAGES) {
    let html;
    try {
      const res = await Http.get(page, { timeout: 8000 });
      if (res.status !== 200) continue;
      html = res.body || "";
    } catch (e) {
      continue;
    }
    for (const m of html.matchAll(MIRROR_PATTERN)) {
      const host = m[1].toLowerCase();
      if (tried.has(host)) continue;
      tried.add(host);
      if (!domainAllowed(host)) {
        log("地址发布页上有新网址 " + host + "，不在这个直播源的域名列表里，更新直播源后才能用");
        continue;
      }
      const found = await homeOf(host);
      if (found) return useBase(found);
    }
  }
  throw new Error("88直播的网址都打不开：可能又换了网址，请检查网络或更新这个直播源");
}

/** 取站内页面；当前网址出错时换一个网址再试一次 */
async function fetchPage(path, opts = {}) {
  const cached = !opts.noCache && pageCache.get(path);
  if (cached && Date.now() - cached.at < PAGE_TTL) return cached.html;
  let host = await base();
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await Http.get("https://" + host + path, {
        timeout: 12000,
        headers: Object.assign({ Referer: "https://" + host + "/" }, opts.headers || {}),
      });
    } catch (e) {
      res = null;
    }
    if (res && res.status === 200) {
      if (!opts.noCache) pageCache.set(path, { at: Date.now(), html: res.body });
      return res.body;
    }
    if (res && res.status === 404) throw new Error(opts.notFound || "88直播上找不到这个页面");
    currentBase = null;
    host = await base(host);
  }
  throw new Error("88直播暂时打不开，请稍后再试");
}

// ---------------- 列表 ----------------

/** 联赛名 → 图标，用作比赛卡片的封面 */
let leagueIcons = null;
/** 联赛名 → 项目（侧边栏的分组：篮球、足球、其他） */
let leagueSports = null;

function absolute(url, host) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  return "https://" + host + (url.startsWith("/") ? "" : "/") + url;
}

function realImage(url) {
  return url && !/\/static\/img\/default\.png/.test(url) ? url : "";
}

function parseCategories(html, host) {
  const nav = (html.match(/<ul class="category-nav[\s\S]*?<\/ul>/) || [""])[0];
  const groups = [];
  let group = null;
  for (const li of nav.split(/<li\b/).slice(1)) {
    if (/category-nav-header/.test(li)) {
      group = { id: "g" + groups.length, name: text(li.replace(/^[^>]*>/, "")), children: [] };
      groups.push(group);
      continue;
    }
    const m = li.match(/href=['"]\/match\/(\d+)\/live['"][\s\S]*?alt="([^"]*)"[\s\S]*?data-src="([^"]*)"/);
    if (!m || !group) continue;
    group.children.push({ id: m[1], name: decodeEntities(m[2]).trim(), pic: absolute(m[3], host) });
  }
  return groups.filter((g) => g.children.length);
}

function leagueIcon(league) {
  if (!leagueIcons) return "";
  for (const [name, pic] of leagueIcons) if (league.startsWith(name)) return pic;
  return "";
}

function rememberLeagues(groups) {
  leagueIcons = [];
  leagueSports = [];
  for (const group of groups) {
    const sport = /篮/.test(group.name) ? "basketball" : /足/.test(group.name) ? "football" : "other";
    for (const c of group.children) {
      leagueIcons.push([c.name, c.pic]);
      leagueSports.push([c.name, sport]);
    }
  }
  leagueIcons.sort((a, b) => b[0].length - a[0].length);
  leagueSports.sort((a, b) => b[0].length - a[0].length);
}

/** 联赛属于哪个项目：先看侧边栏的分组，不在里面的按名字猜 */
function sportOf(league) {
  league = String(league || "");
  for (const [name, sport] of leagueSports || []) if (name && league.startsWith(name) && !/综合/.test(name)) return sport;
  if (/网球|棒球|NFL|橄榄|超级碗|羽毛|乒乓|排球|斯诺克|台球|拳|UFC|赛车|F1|电竞|高尔夫|田径|冰球/i.test(league)) return "other";
  if (/篮|NBA|CBA|WNBA|WCBA|FIBA|NBL/i.test(league)) return "basketball";
  if (/足|超|甲|乙|联赛|杯|K联|J联|日职|韩职|欧冠|欧联|欧会|亚冠/.test(league)) return "football";
  return "other";
}

/** 网站的时间都是北京时间。date 为 YYYY-MM-DD 或 MM-DD（没有年份时取离现在最近的那一年），time 为 HH:mm */
function startTime(date, time) {
  const t = String(time || "").match(/(\d{1,2}):(\d{2})/);
  const d = String(date || "").match(/(?:(\d{4})-)?(\d{1,2})-(\d{1,2})/);
  if (!t || !d) return 0;
  const at = (year) => Date.UTC(year, Number(d[2]) - 1, Number(d[3]), Number(t[1]) - 8, Number(t[2]));
  if (d[1]) return at(Number(d[1]));
  const now = Date.now();
  const year = new Date(now + 8 * 3600 * 1000).getUTCFullYear();
  return [year - 1, year, year + 1].map(at).sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
}

/** 网站写“直播中”，但开赛已经超过这个项目一场比赛的时长 */
function staleLive(league, start) {
  return start > 0 && Date.now() - start > MAX_LIVE_HOURS[sportOf(league)] * 3600 * 1000;
}

function isTvChannel(home, away) {
  return /电视直播/.test(away || "") || /电视直播/.test(home || "");
}

/** 列表页 → 比赛：{ id, date, time, league, home, away, homeLogo, awayLogo, status } */
function parseGames(html, host) {
  const games = [];
  let date = "";
  for (const li of html.split(/<li class="list-group-item/).slice(1)) {
    if (/^\s*live-list-group-time/.test(li)) {
      date = (li.match(/(\d{4}-\d{2}-\d{2})/) || ["", ""])[1];
      continue;
    }
    if (!/group-game-item/.test(li)) continue;
    const id = (li.match(/data-id="(\d+)"/) || li.match(/\/live\/(\d+)\/play/) || [])[1];
    if (!id) continue;
    const teams = [...li.matchAll(/class="team-name"\s+title="([^"]*)"/g)].map((m) => decodeEntities(m[1]).trim());
    const logos = [...li.matchAll(/data-src="([^"]*)"/g)].map((m) => realImage(absolute(m[1].trim(), host)));
    const btn = (li.match(/pay-btn[^>]*>([\s\S]*?)<\/div>/) || ["", ""])[1];
    const game = {
      id,
      date,
      time: text((li.match(/category-game-time">([\s\S]*?)<\/div>/) || ["", ""])[1]),
      league: text((li.match(/class="game-type">([\s\S]*?)<\/span>/) || ["", ""])[1]),
      home: teams[0] || "",
      away: teams[1] || "",
      homeLogo: logos[0] || "",
      awayLogo: logos[1] || "",
      status: text(btn),
    };
    game.tv = isTvChannel(game.home, game.away);
    if (game.tv) game.status = "直播中";
    else if (game.status.includes("直播中") && staleLive(game.league, startTime(game.date, game.time))) game.status = "已结束";
    games.push(game);
  }
  return games;
}

function statusRank(status) {
  if (status.includes("直播中")) return 0;
  if (status.includes("已结束")) return 2;
  return 1;
}

function toRoom(g) {
  if (g.tv) {
    return { roomId: g.id, title: g.home || g.league, cover: g.homeLogo || leagueIcon(g.league), userName: "电视直播", online: 0 };
  }
  const when = (g.date ? g.date.slice(5) + " " : "") + g.time;
  const state = statusRank(g.status) === 0 ? "直播中" : statusRank(g.status) === 2 ? "已结束" : "未开始";
  return {
    roomId: g.id,
    title: g.home && g.away ? g.home + " vs " + g.away : g.home || g.away || g.league,
    cover: leagueIcon(g.league) || g.homeLogo || g.awayLogo,
    userName: [g.league, when, state].filter(Boolean).join(" · "),
    online: 0,
  };
}

/** 在播的在前，没开始的按时间，已结束的不显示 */
function toRooms(games) {
  return games
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => statusRank(g.status) < 2)
    .sort((a, b) => statusRank(a.g.status) - statusRank(b.g.status) || a.i - b.i)
    .map(({ g }) => toRoom(g));
}

async function listPage(path) {
  const html = await fetchPage(path);
  const host = currentBase || (await base());
  if (!leagueIcons) {
    const home = path === "/" ? html : await fetchPage("/");
    rememberLeagues(parseCategories(home, host));
  }
  return parseGames(html, host);
}

// ---------------- 线路 ----------------

/** /source 的 data："6 个字符 + Base64(JSON) + 2 个字符" */
function decodeSource(data) {
  const s = String(data || "");
  if (s.length < 10) throw new Error("88直播的线路数据格式变了，请更新这个直播源");
  return JSON.parse(Bytes.toUtf8(Bytes.fromBase64(s.slice(6, -2))));
}

/** 区分直链和需要在选中时解析的国内播放器；只跳到其他网站首页的返回 null。 */
function playableLine(link) {
  if (!link || typeof link !== "object") return null;
  const page = String(link.url || "").trim();
  if (!/^https?:\/\//i.test(page)) return null;
  if (isDomesticPlayer(page)) return { playerUrl: page };
  const inner = queryParam(page, PLAYER_PARAM);
  if (inner === null) {
    // 直接给的播放地址
    return /\.(m3u8|flv)(\?|#|$)/i.test(page) ? { url: page, origin: "" } : null;
  }
  if (!/^https?:\/\//i.test(inner)) return null;
  // 网页播放器在 page 所在的网站上，跨域取列表时浏览器带的是它的 Origin
  return { url: inner, origin: originOf(page) };
}

function isHls(url) {
  return /\.m3u8(\?|#|$)/i.test(String(url || ""));
}

function isDomesticPlayer(url) {
  return /^https?:\/\/play\.sportsteam368\.com\/play\/[a-z0-9_-]+\/(?:\?|$)/i.test(String(url || ""));
}

/** 公开播放器 paps.html / index.min.js 的 XXTEA 格式；key 是网页内置常量。 */
function decodeDomesticPayload(encoded, now = Date.now()) {
  const invalid = () => new Error("国内线路的播放数据格式已变化，请更新直播源");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 65536 || encoded.length % 4) throw invalid();
  const bytes = Bytes.fromBase64(encoded);
  if (bytes.length < 8 || bytes.length % 4) throw invalid();
  const words = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < bytes.length; i++) words[i >>> 2] |= bytes[i] << ((i & 3) * 8);
  const keyBytes = Bytes.fromUtf8("ABCDEFGHIJKLMNOPQRSTUVWX");
  const key = new Uint32Array(4);
  for (let i = 0; i < 16; i++) key[i >>> 2] |= keyBytes[i] << ((i & 3) * 8);
  const delta = 0x9e3779b9;
  let sum = (Math.floor(6 + 52 / words.length) * delta) >>> 0;
  let y = words[0];
  while (sum !== 0) {
    const e = (sum >>> 2) & 3;
    for (let p = words.length - 1; p >= 0; p--) {
      const z = words[p === 0 ? words.length - 1 : p - 1];
      const mx = ((z >>> 5 ^ y << 2) + (y >>> 3 ^ z << 4)) ^ ((sum ^ y) + (key[(p & 3) ^ e] ^ z));
      y = words[p] = (words[p] - mx) >>> 0;
    }
    sum = (sum - delta) >>> 0;
  }
  const length = words[words.length - 1];
  const capacity = (words.length - 1) * 4;
  if (length < capacity - 3 || length > capacity) throw invalid();
  const plain = new Uint8Array(length);
  for (let i = 0; i < length; i++) plain[i] = (words[i >>> 2] >>> ((i & 3) * 8)) & 255;
  let data;
  try {
    data = JSON.parse(Bytes.toUtf8(plain));
  } catch (e) {
    throw invalid();
  }
  if (!data || typeof data.url !== "string" || !/^https?:\/\/[^/?#\s@]+(?:[/?#]|$)/i.test(data.url) || /[\s\x00-\x1f\x7f]/.test(data.url)) throw invalid();
  if (!Number.isFinite(data.ts) || data.ts <= 0) throw invalid();
  if (now / 1000 - data.ts > 300) throw new Error("国内线路的播放地址已过期，请重新选择线路");
  // 网页播放器声明 no-referrer；不把比赛页的 Referer 带到媒体 CDN。
  return { url: data.url, referer: "" };
}

function parseDomesticPlayer(html) {
  const encoded = String(html || "").match(/\b(?:var|let|const)\s+encodedStr\s*=\s*(["'])([A-Za-z0-9+/=]+)\1/);
  if (!encoded) throw new Error("国内线路没有返回播放数据，可能暂未开播或网页格式已变化");
  const line = decodeDomesticPayload(encoded[2]);
  // 真正播放的是 playerUrlBase64 指向的另一个网站上的播放器，跨域请求带它的 Origin
  const base = String(html).match(/playerUrlBase64\s*:\s*["']([A-Za-z0-9+/=]+)["']/);
  if (base) {
    try {
      line.origin = originOf(Bytes.toUtf8(Bytes.fromBase64(base[1])));
    } catch (e) {
      // 没有也能播
    }
  }
  return line;
}

async function resolveLine(room, quality) {
  const line = quality && quality.data;
  if (!line) throw new Error("这条线路没有播放地址");
  if (!line.playerUrl) {
    if (!line.url) throw new Error("这条线路没有播放地址");
    return line;
  }
  if (!isDomesticPlayer(line.playerUrl)) throw new Error("不支持这个国内线路播放器地址");
  const now = Date.now();
  for (const [key, entry] of domesticCache) if (now - entry.at > DOMESTIC_TTL) domesticCache.delete(key);
  const cached = domesticCache.get(line.playerUrl);
  if (cached) {
    if (cached.error) throw new Error(cached.error);
    return Object.assign({}, cached.line);
  }
  try {
    const resolved = await fetchDomestic(line.playerUrl, room, quality.name || "国内线路");
    domesticCache.set(line.playerUrl, { at: now, line: resolved });
    return Object.assign({}, resolved);
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    domesticCache.set(line.playerUrl, { at: now, error: message });
    throw new Error(message);
  }
}

async function fetchDomestic(playerUrl, room, name) {
  let res;
  try {
    res = await Http.get(playerUrl, {
      timeout: 10000,
      headers: { Referer: room.url || "https://www.88zhibo.me/", "User-Agent": PLAYER_USER_AGENT, "Cache-Control": "no-cache" },
    });
  } catch (e) {
    throw new Error(name + "请求失败或超时，请稍后重试或切换其他线路");
  }
  const html = String(res.body || "");
  if (/cf-chl-|cf-error-details|Just a moment|Attention Required.*Cloudflare/i.test(html)) {
    throw new Error(name + "被 Cloudflare 拦截，暂时无法解析，请切换其他线路");
  }
  if (res.status !== 200) throw new Error(name + "请求失败（HTTP " + res.status + "），请切换其他线路");
  return parseDomesticPlayer(html);
}

function playbackResult(line) {
  const headers = browserHeaders(line.origin);
  // 1.1.0 及更早的线路数据里有 referer（App 里还没刷新的线路）
  if (line.referer) headers.referer = line.referer;
  return { urls: [line.url], headers };
}

class Zhibo88Live extends LiveSource {
  key = "zhibo88";
  name = "88直播";
  version = "1.3.0";
  url = "https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/zhibo88.live.js"
  apiVersion = 1;
  icon = "https://www.88zhibo.me/storage/images/6842643ea6465438fefc3e8c8ff84ee5.ico";
  description = "体育赛事：联赛分类、比赛列表、多线路切换（含国内线路）；网址失效时自动换镜像";
  domains = DOMAINS;
  links = ["(?:88zhibo|88kanqiu|popozhibo)\\.[a-z]{2,12}/live/(\\d+)"];

  async recommend(page) {
    if (page > 1) return { hasMore: false, rooms: [] };
    return { hasMore: false, rooms: toRooms(await listPage("/")) };
  }

  async categories() {
    const html = await fetchPage("/");
    const host = currentBase || (await base());
    const groups = parseCategories(html, host);
    if (!groups.length) throw new Error("88直播的页面格式变了，读不到分类，请更新这个直播源");
    return groups;
  }

  async categoryRooms(category, page) {
    if (page > 1) return { hasMore: false, rooms: [] };
    return { hasMore: false, rooms: toRooms(await listPage("/match/" + category.id + "/live")) };
  }

  async search(keyword, page) {
    if (page > 1) return { hasMore: false, rooms: [] };
    const words = String(keyword || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return { hasMore: false, rooms: [] };
    const games = (await listPage("/")).filter((g) => {
      const all = (g.league + " " + g.home + " " + g.away).toLowerCase();
      return words.every((w) => all.includes(w));
    });
    return { hasMore: false, rooms: toRooms(games) };
  }

  async resolve(input) {
    const s = String(input || "").trim();
    if (/^\d{4,9}$/.test(s)) return s;
    const m = s.match(/\/live\/(\d+)/);
    return m ? m[1] : null;
  }

  async room(roomId) {
    const id = String(roomId).replace(/\D/g, "");
    if (!id) throw new Error("比赛编号不对");
    const html = await fetchPage("/live/" + id + "/play", { notFound: "这场比赛在88直播上找不到了" });
    const host = currentBase || (await base());
    const info = (html.match(/<div class="game-info-container">([\s\S]*?)<div class="game-videos-btn-container">/) || ["", html])[1];
    const teams = [...info.matchAll(/class="team-name"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => text(m[1]));
    const logos = [...info.matchAll(/<img[^>]*\bsrc="([^"]*)"[^>]*team-logo/g)].map((m) => realImage(absolute(m[1].trim(), host)));
    const league = text((info.match(/class="game-name">([\s\S]*?)<\/p>/) || ["", ""])[1]);
    const time = text((info.match(/class="game-time">([\s\S]*?)<\/p>/) || ["", ""])[1]);
    let status = text((info.match(/class="game-status[^"]*">([\s\S]*?)<\/p>/) || ["", ""])[1]);
    if (!teams.length && !league) throw new Error("88直播的页面格式变了，读不到比赛信息，请更新这个直播源");
    if (!leagueSports) {
      try {
        rememberLeagues(parseCategories(await fetchPage("/"), host));
      } catch (e) {
        // 读不到分类时按联赛名猜项目
      }
    }
    const tv = isTvChannel(teams[0], teams[1]);
    const when = time.split(/\s+/);
    if (tv) status = "直播中";
    else if (status.includes("直播中") && staleLive(league, startTime(when[0], when[1] || when[0]))) status = "已结束";
    const title = tv ? teams[0] || league : teams.length >= 2 ? teams[0] + " vs " + teams[1] : teams[0] || league;
    return {
      roomId: id,
      title,
      cover: logos[0] || logos[1] || "",
      userName: league || "88直播",
      userAvatar: logos[0] || "",
      online: 0,
      live: status.includes("直播中"),
      introduction: tv ? "电视直播" : [league, time, status].filter(Boolean).join(" · "),
      notice: "",
      url: "https://" + host + "/live/" + id + "/play",
      showTime: time,
    };
  }

  async liveStatus(roomId) {
    return (await this.room(roomId)).live;
  }

  /** 每条线路是一个“清晰度”，名字和网站上一样 */
  async qualities(room) {
    const id = room.roomId;
    const path = "/live/" + id + "/source";
    const host = currentBase || (await base());
    const body = await fetchPage(path, {
      noCache: true,
      headers: { Referer: "https://" + host + "/live/" + id + "/play", "X-Requested-With": "XMLHttpRequest" },
    });
    let data;
    try {
      data = decodeSource(JSON.parse(body).data);
    } catch (e) {
      log("线路数据解不开：" + (e && e.message ? e.message : e));
      throw new Error("88直播的线路数据格式变了，请更新这个直播源");
    }
    const links = Array.isArray(data.links) ? data.links : [];
    const seen = new Map();
    const direct = [];
    const domestic = [];
    for (const link of links) {
      const line = playableLine(link);
      if (!line) continue;
      let name = String(link.name || "线路").trim() || "线路";
      const n = (seen.get(name) || 0) + 1;
      seen.set(name, n);
      if (n > 1) name += "（" + n + "）";
      (line.playerUrl ? domestic : direct).push({ name, data: line });
    }
    // App 默认放第一条：直连线路排前面，国内线路要多请求一次、还可能被拦，放后面
    const result = [...direct, ...domestic];
    if (!result.length) {
      if (!links.length) throw new Error(room.live ? "这场比赛暂时没有线路，稍后再试" : "比赛还没开始，开赛前后才有线路");
      throw new Error("这场比赛的线路仅跳转其他网站或使用尚未支持的播放器，请打开比赛网页查看");
    }
    return result;
  }

  async playUrls(room, quality) {
    const line = await resolveLine(room, quality);
    return playbackResult(line);
  }

  async avPlayerUrls(room, quality) {
    const line = await resolveLine(room, quality);
    if (!isHls(line.url)) return null;
    return playbackResult(line);
  }
}
