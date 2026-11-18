简体中文 | [English](README.en.md)

# simple_live_N 直播源与翻译

[simple_live_N](https://github.com/NishinoAkii/simple_live_N) 的直播源订阅和界面翻译。一个平台对应一个 `.live.js` 脚本，一种语言对应一个翻译文件，两者更新后都无需重装 App。更新记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 直播源

添加订阅后，App 会安装下表中的直播源，并检查它们的更新。

<!-- sources:start -->
订阅地址（在 App 的“我的 → 直播源订阅 → 添加订阅”中填写）：

`https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/index.json`

| 平台 | 版本 | 说明 | 下载 |
|---|---|---|---|
| AcFun 直播 | 1.0.0 | AcFun 直播（游客）：推荐、分类、搜索、FLV 播放、长连接弹幕 | [acfun.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/acfun.live.js) |
| 快手直播 | 1.0.0 | 推荐、分类、搜索、播放（含 4K）；弹幕暂不可用（快手要求网页签名） | [kuaishou.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/kuaishou.live.js) |
| Steam 直播 | 1.2.0 | Steam 社区和商店页的游戏直播：推荐、分类、搜索、HLS 播放、聊天弹幕（游客） | [steam.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/steam.live.js) |
| 88直播 | 1.3.0 | 体育赛事：联赛分类、比赛列表、多线路切换（含国内线路）；网址失效时自动换镜像 | [zhibo88.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/zhibo88.live.js) |
<!-- sources:end -->

## 翻译

App 内置简体中文、繁体中文和英文。其他语言的翻译文件放在 [`translations/`](translations) 中，填写下方的翻译清单地址后即可在 App 中选择。翻译更新后，在该语言旁点“重新下载”。

<!-- translations:start -->
翻译清单地址（在 App 的“我的 → 外观设置 → 语言 → 从网址下载”中填写，再选择语言）：

`https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/translations.json`

| 语言 | 代码 | 已翻译的句子 | 下载 |
|---|---|---|---|
| Español | `es` | 1738 | [es.json](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/es.json) |
| 日本語 | `ja` | 1738 | [ja.json](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/ja.json) |
<!-- translations:end -->

日语和西班牙语翻译是第一版，尚未经过母语者校对，欢迎指正。新增语言时，在 App 的“语言 → 导出翻译模板”中导出全部句子，翻译后提交到 `translations/`。文件格式见 [`doc/translation.md`](https://github.com/NishinoAkii/simple_live_N/blob/main/doc/translation.md)。

## 编写直播源

编写步骤、查找平台数据的方法、测试和发布见 [`GUIDE.md`](GUIDE.md)。[`sample.js`](sample.js) 是带注释的示例，[`_template.live.js`](_template.live.js) 是完整模板。

新的直播源、翻译和修改可通过 Issue 或 Pull Request 提交。

## 许可

本仓库依照 GPL-3.0 发布，见 [`LICENSE`](LICENSE)。
