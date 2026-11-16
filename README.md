# simple_liveN 直播源

[simple_liveN](https://github.com/NishinoAkii/simple_liveN) 的直播源订阅。一个平台对应一个 `.live.js` 脚本。在 App 的“我的 → 直播源订阅”中添加下方的订阅地址，即可安装直播源并检查更新；脚本更新后无需重装 App。

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

## 编写直播源

编写步骤、查找平台数据的方法、测试和发布见 [`GUIDE.md`](GUIDE.md)。带注释的示例见 [`sample.js`](sample.js)，完整模板见 [`_template.live.js`](_template.live.js)。

欢迎通过 Issue 或 Pull Request 提交新的直播源或修改。

更新记录见 [`CHANGELOG.md`](CHANGELOG.md)。
