简体中文 | [English](GUIDE.en.md)

# 直播源编写指南

直播源是一个 JavaScript 脚本（`<key>.live.js`），一个平台对应一个文件。App 通过订阅或脚本地址安装直播源；平台接口变化后，更新脚本即可，无需重新编译 App。

## 参考文件

| 文件 | 内容 |
|---|---|
| [`sample.js`](sample.js) | 带注释的示例：各函数的用途、返回格式、数据来源和可用的全局对象。建议从这里开始。 |
| [`_template.live.js`](_template.live.js) | 完整模板，包含全部字段和可选功能。 |
| [`sources/`](sources) | 已发布的直播源，可作为实际参考。 |
| [`doc/live_source_api.md`](https://github.com/NishinoAkii/simple_liveN/blob/main/doc/live_source_api.md) | 接口约定，位于 simple_liveN 仓库。 |

## 编写步骤

1. 复制 `sample.js`，命名为 `<key>.live.js`。`key` 只能包含小写字母、数字和下划线，发布后不可更改。
2. 在 `domains` 中列出脚本访问的全部域名，包括播放地址所在的 CDN。
3. 实现 `room()`、`qualities()`、`playUrls()`。完成这三项即可观看直播。
4. 按需实现推荐、分类、搜索、弹幕等函数。未实现的功能不会在 App 中显示。
5. 用检查工具测试，再在 App 中安装试用。

## 查找平台数据

在 Chrome 或 Edge 中打开平台网页，按 F12 打开开发者工具，切换到“网络”面板，勾选“保留日志”和“停用缓存”后刷新页面。

| 数据 | 查找方法 |
|---|---|
| 推荐、分类、搜索 | 筛选 Fetch/XHR，翻页或搜索后，查看新出现的、返回直播间列表的请求。 |
| 直播间详情 | 在“网络”面板中搜索直播间标题。数据在 HTML 中时，通常位于 `window.__INITIAL_STATE__` 或 `__NEXT_DATA__`。 |
| 播放地址 | 筛选 `m3u8` 或 `flv`，找到视频请求后，向前查找返回该地址的接口。注意有效期参数和播放所需的请求头。 |
| 弹幕 | 筛选 WS，查看 WebSocket 消息。没有 WebSocket 的平台会定时请求聊天接口，在 Fetch/XHR 中可见。 |
| 请求头与签名 | 在请求上右键选择“复制为 cURL”，逐项删除以确认必需项。签名参数可在“源代码”中全局搜索参数名，找到生成方法。 |

平台的手机网页（通常以 `m.` 开头）接口往往更简单，可将开发者工具切换到手机模式后查找。

只使用游客可见的公开数据，不得绕过平台的付费、会员或权限限制。

## 测试

检查工具位于 simple_liveN 仓库，需要 Dart（或 Flutter 自带的 `dart`）。在 `simple_live_core` 目录中运行：

```sh
dart pub get
dart run bin/live_source_check.dart <脚本路径> --room <房间号> --play --danmaku 20
```

其他选项：`--search <关键词>`、`--suggest <关键词>`、`--resolve <输入>`。工具依次检查各函数并显示错误，运行环境与 App 一致。

## 发布

1. 将脚本放在可通过 https 访问的位置。
2. 编写订阅文件 `index.json`，格式见 `sample.js` 末尾或接口约定 §4。
3. 每次发布时，同时调高脚本和 `index.json` 中的 `version`。
4. 在 App 的“我的 → 直播源订阅”中添加 `index.json` 的地址。

新版本增加了 `domains` 中的域名或 `login` 等权限时，用户更新前需要确认。

## 常见问题

| 提示 | 处理方法 |
|---|---|
| `不允许访问 xxx：没有写在直播源的 domains 里` | 将该域名加入 `domains`，重定向后的域名也要加入。 |
| `没有找到继承 LiveSource 的类` | 使用 `class Xxx extends LiveSource { … }`，一个文件只能有一个。 |
| `xxx() 超时（20 秒没有返回）` | 检查是否遗漏 `await`，或接口响应过慢。 |
| `返回的内容不是 JSON` | 平台返回了 HTML，通常是缺少请求头或被风控。先用 `responseType: "text"` 查看内容。 |
| HTTP 403 / 412 | 补充 `User-Agent`、`Referer`、`Cookie`，或确认接口是否需要签名。 |
| 数字显示为很长的字符串 | 返回了 BigInt，用 `Proto.num()` 或 `Number()` 转换。 |
| 修改脚本后 App 中没有变化 | 调高 `version`，或从文件重新安装。 |

欢迎提交新的直播源或修改，可提 Issue 或 Pull Request。
