# simple_liveN 直播源

[simple_liveN](https://github.com/NishinoAkii/simple_liveN) 的直播源订阅。一个平台对应一个 `.live.js` 脚本。在 App 的“我的 → 直播源订阅”里添加下面的订阅地址，就能一键安装和检查更新；脚本更新了，App 不用重装。

<!-- sources:start -->
订阅地址（在 App 的“我的 → 直播源订阅 → 添加订阅”里填）：

`https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/index.json`

| 平台 | 版本 | 说明 | 下载 |
|---|---|---|---|
| AcFun 直播 | 1.0.0 | AcFun 直播（游客）：推荐、分类、搜索、FLV 播放、长连接弹幕 | [acfun.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/acfun.live.js) |
| 快手直播 | 1.0.0 | 推荐、分类、搜索、播放（含 4K）；弹幕暂不可用（快手要求网页签名） | [kuaishou.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/kuaishou.live.js) |
| Steam 直播 | 1.2.0 | Steam 社区和商店页的游戏直播：推荐、分类、搜索、HLS 播放、聊天弹幕（游客） | [steam.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/steam.live.js) |
| 88直播 | 1.3.0 | 体育赛事：联赛分类、比赛列表、多线路切换（含国内线路）；网址失效时自动换镜像 | [zhibo88.live.js](https://gist.githubusercontent.com/NishinoAkii/7ef617aacd2b81be3a337db6ae33cdaa/raw/zhibo88.live.js) |
<!-- sources:end -->

## 写一个新的直播源

1. 复制 `_template.live.js`，改名为 `<平台>.live.js`，照着里面的注释填。接口说明在 simple_liveN 仓库的 `doc/live_source_api.md`。
2. 在 simple_liveN 仓库的 `simple_live_core` 目录里用检查工具试一遍：

   ```
   dart run bin/live_source_check.dart <脚本路径> --room <房间号> --danmaku 60 --play
   ```

3. 每次修改都把脚本里的 `version` 加一，App 靠版本号判断有没有更新。

想加新的平台或者修改现有的脚本，欢迎提 Issue 或 Pull Request。

更新记录见 `CHANGELOG.md`。
