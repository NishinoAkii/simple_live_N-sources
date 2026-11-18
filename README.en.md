[简体中文](README.md) | English

# simple_live_N live sources and translations

Live source subscriptions and interface translations for [simple_live_N](https://github.com/NishinoAkii/simple_live_N). Each platform is one `.live.js` script and each language is one translation file, and updates to either reach the app without reinstalling it. Changes are listed in [`CHANGELOG.md`](CHANGELOG.md) (in Chinese).

## Live sources

Once you add the subscription, the app installs the sources listed below and checks them for updates.

<!-- sources:start -->
Subscription URL (in the app: Me → Live source subscriptions → Add subscription):

`https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/index.json`

| Platform | Version | Description | Download |
|---|---|---|---|
| AcFun Live | 1.0.0 | Recommendations, categories, search, FLV playback and danmaku, without logging in. | [acfun.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/acfun.live.js) |
| Kuaishou Live | 1.0.0 | Recommendations, categories, search and playback up to 4K. Danmaku is not available yet because Kuaishou requires a signature from its web page. | [kuaishou.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/kuaishou.live.js) |
| Steam Broadcasts | 1.2.0 | Game broadcasts from Steam Community and store pages, with recommendations, categories, search, HLS playback and chat, without logging in. | [steam.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/steam.live.js) |
| 88zhibo | 1.3.0 | Sports, with league categories, match lists and several stream lines, some of them in mainland China. When the site address stops working, it switches to a mirror. | [zhibo88.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/zhibo88.live.js) |
<!-- sources:end -->

## Translations

The app includes Simplified Chinese, Traditional Chinese and English. Translations for other languages are in [`translations/`](translations); after you enter the translation list URL below, you can pick one in the app. When a translation changes, tap "Download again" next to it.

<!-- translations:start -->
Translation list URL (in the app: Me → Appearance settings → Language → Download from URL, then pick a language):

`https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/translations.json`

| Language | Code | Translated strings | Download |
|---|---|---|---|
| Español | `es` | 1868 | [es.json](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/es.json) |
| 日本語 | `ja` | 1868 | [ja.json](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/ja.json) |
<!-- translations:end -->

The Japanese and Spanish translations are first versions and have not yet been reviewed by native speakers, so corrections are welcome. To add a language, export every string with "Language → Export translation template" in the app, translate the file and submit it to `translations/`. The file format is described in [`doc/translation.md`](https://github.com/NishinoAkii/simple_live_N/blob/main/doc/translation.md) (in Chinese).

## Writing a live source

[`GUIDE.en.md`](GUIDE.en.md) covers the steps, how to find a platform's data, testing and publishing. [`sample.js`](sample.js) is a commented example and [`_template.live.js`](_template.live.js) is the full template; both are commented in Chinese.

New live sources, translations and fixes can be submitted as issues or pull requests.

## License

This repository is released under GPL-3.0, see [`LICENSE`](LICENSE).
