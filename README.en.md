[简体中文](README.md) | English

# simple_liveN live sources and translations

Live source subscriptions and interface translations for [simple_liveN](https://github.com/NishinoAkii/simple_liveN). Each platform is one `.live.js` script and each language is one translation file, and updates to either reach the app without reinstalling it. Changes are listed in [`CHANGELOG.md`](CHANGELOG.md) (in Chinese).

## Live sources

Once you add the subscription, the app installs the sources listed below and checks them for updates.

<!-- sources:start -->
Subscription URL (in the app: Me → Live source subscriptions → Add subscription):

`https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/index.json`

| Platform | Version | Description | Download |
|---|---|---|---|
| AcFun 直播 | 1.0.0 | AcFun 直播（游客）：推荐、分类、搜索、FLV 播放、长连接弹幕 | [acfun.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/acfun.live.js) |
| 快手直播 | 1.0.0 | 推荐、分类、搜索、播放（含 4K）；弹幕暂不可用（快手要求网页签名） | [kuaishou.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/kuaishou.live.js) |
| Steam 直播 | 1.2.0 | Steam 社区和商店页的游戏直播：推荐、分类、搜索、HLS 播放、聊天弹幕（游客） | [steam.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/steam.live.js) |
| 88直播 | 1.3.0 | 体育赛事：联赛分类、比赛列表、多线路切换（含国内线路）；网址失效时自动换镜像 | [zhibo88.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/zhibo88.live.js) |
<!-- sources:end -->

## Translations

The app includes Simplified Chinese, Traditional Chinese and English. Translations for other languages are in [`translations/`](translations); after you enter the translation list URL below, you can pick one in the app. When a translation changes, tap "Download again" next to it.

<!-- translations:start -->
Translation list URL (in the app: Me → Appearance settings → Language → Download from URL, then pick a language):

`https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/translations.json`

| Language | Code | Translated strings | Download |
|---|---|---|---|
| Español | `es` | 1741 | [es.json](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/es.json) |
| 日本語 | `ja` | 1741 | [ja.json](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/ja.json) |
<!-- translations:end -->

The Japanese and Spanish translations are first versions and have not yet been reviewed by native speakers, so corrections are welcome. To add a language, export every string with "Language → Export translation template" in the app, translate the file and submit it to `translations/`. The file format is described in [`doc/translation.md`](https://github.com/NishinoAkii/simple_liveN/blob/main/doc/translation.md) (in Chinese).

## Writing a live source

[`GUIDE.en.md`](GUIDE.en.md) covers the steps, how to find a platform's data, testing and publishing. [`sample.js`](sample.js) is a commented example and [`_template.live.js`](_template.live.js) is the full template; both are commented in Chinese.

New live sources, translations and fixes can be submitted as issues or pull requests.

## License

This repository is released under GPL-3.0, see [`LICENSE`](LICENSE).
