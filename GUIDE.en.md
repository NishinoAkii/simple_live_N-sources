[简体中文](GUIDE.md) | English

# Writing a live source

A live source is a JavaScript script (`<key>.live.js`), one file per platform. The app installs live sources from a subscription or from a script URL. When a platform changes its API, updating the script is enough; the app does not need to be rebuilt.

## Reference files

| File | Contents |
|---|---|
| [`sample.js`](sample.js) | A commented example: what each function does, the return formats, where the data comes from and which globals are available. Start here. |
| [`_template.live.js`](_template.live.js) | The full template with every field and optional feature. |
| [`sources/`](sources) | The published live sources, useful as working examples. |
| [`doc/live_source_api.md`](https://github.com/NishinoAkii/simple_live_N/blob/main/doc/live_source_api.md) | The interface specification, in the simple_live_N repository. |

The comments in these files and the specification are in Chinese.

## Steps

1. Copy `sample.js` and name it `<key>.live.js`. The `key` may contain only lowercase letters, digits and underscores, and cannot change after publishing.
2. List every domain the script accesses in `domains`, including the CDN that serves the stream.
3. Implement `room()`, `qualities()` and `playUrls()`. These three are enough to watch a stream.
4. Implement recommendations, categories, search, danmaku and other functions as needed. Features that are not implemented do not appear in the app.
5. Test with the check tool, then install the script in the app and try it.

## Finding a platform's data

Open the platform's website in Chrome or Edge and press F12 to open the developer tools. In the Network panel, select "Preserve log" and "Disable cache", then reload the page.

| Data | How to find it |
|---|---|
| Recommendations, categories, search | Filter by Fetch/XHR, then page through the list or search, and look for the new request that returns a list of rooms. |
| Room details | Search the Network panel for the room title. When the data is in the HTML, it is usually in `window.__INITIAL_STATE__` or `__NEXT_DATA__`. |
| Stream URL | Filter by `m3u8` or `flv`, find the video request, then look back for the API that returned that URL. Note any expiry parameters and the headers needed for playback. |
| Danmaku | Filter by WS and read the WebSocket messages. Platforms without WebSocket poll a chat API, which shows up under Fetch/XHR. |
| Headers and signatures | Right-click the request and choose "Copy as cURL", then remove items one at a time to find the required ones. For a signature parameter, search all sources in the Sources panel for the parameter name to find the code that generates it. |

A platform's mobile site (often starting with `m.`) usually has simpler APIs. Switch the developer tools to device mode to look for them.

Use only public data visible to guests. Do not bypass a platform's paywalls, memberships or access restrictions.

## Testing

The check tool is in the simple_live_N repository and needs Dart (the `dart` that comes with Flutter also works). Run it in the `simple_live_core` directory:

```sh
dart pub get
dart run bin/live_source_check.dart <script path> --room <room ID> --play --danmaku 20
```

Other options: `--search <keyword>`, `--suggest <keyword>`, `--resolve <input>`. The tool checks each function in turn and shows any errors, in the same environment as the app. Its output is in Chinese.

## Publishing

1. Put the script somewhere reachable over https.
2. Write the subscription file `index.json`; the format is at the end of `sample.js` and in §4 of the specification.
3. Each time you publish, raise `version` in both the script and `index.json`.
4. In the app, add the URL of `index.json` under "Me → Live source subscriptions".

When a new version adds domains to `domains` or asks for permissions such as `login`, users must confirm before it updates.

## Common problems

Some of these messages come from the script engine and appear only in Chinese; the Chinese text is given in parentheses.

| Message | What to do |
|---|---|
| `Access to xxx not allowed: not listed in the live source's domains` | Add the domain to `domains`, including any domain a redirect leads to. |
| `No class extending LiveSource found` | Use `class Xxx extends LiveSource { … }`, with only one such class per file. |
| `xxx timed out (no response in 20 s)` | Check for a missing `await`, or the API may be responding too slowly. |
| Response is not JSON (`返回的内容不是 JSON`) | The platform returned HTML, usually because a header is missing or the request was blocked. Use `responseType: "text"` to see what came back. |
| HTTP 403 / 412 | Add `User-Agent`, `Referer` or `Cookie`, or check whether the API needs a signature. |
| A number shows as a long string | It is a BigInt; convert it with `Proto.num()` or `Number()`. |
| Changes to the script do not show in the app | Raise `version`, or reinstall the script from the file. |

New live sources and fixes are welcome through issues or pull requests.
