# Chrome Web Store listing copy / 商店文案

Copy-paste ready. Each field maps to a specific input in the Web Store developer
dashboard. Keep both languages in sync — the dashboard has one tab per locale.

可以直接复制粘贴。每个字段对应开发者后台的一个输入框；后台按语言分页，
两种语言要同步维护。

---

## 1. Name / 名称

| Locale | Value |
| --- | --- |
| English | `ReadX — Listen to X` |
| 中文 | `ReadX — 用耳朵刷 X` |

> Source of truth: `public/_locales/{en,zh_CN}/messages.json` → `extName`.
> The dashboard shows the manifest name automatically; you do not retype it.

---

## 2. Short description / 简短说明

Chrome hard-limits this to **132 characters**. Source:
`public/_locales/{en,zh_CN}/messages.json` → `extDescription`.

| Locale | Value | Length |
| --- | --- | --- |
| English | `Turn your X timeline into audio: auto-scrolls to the next post and reads it aloud in the right language, with optional translation.` | 131 |
| 中文 | `把 X 时间线变成音频：自动滚到下一条帖子并按语言朗读，可选设备端翻译。` | 33 |

---

## 3. Detailed description — English

```
Turn your X timeline into something you can listen to.

ReadX scrolls to a post, works out what language it's in, and reads it aloud.
When it finishes one post it moves to the next, so you can listen with your eyes
off the screen.

It's a Chrome extension for desktop — there's no iOS or Android version.

GETTING STARTED

1. Click "Add to Chrome", then open x.com or twitter.com.
2. A small control bar appears in the bottom-right corner of the page.
3. Press ▶ to start listening. ReadX scrolls to the post you're on, reads it, and
   moves to the next one on its own.

Keyboard shortcuts: Alt+Shift+P to play or pause, Alt+Shift+N for the next post.

Nothing is ever read unless you press play. If you scroll away, ReadX stops and
picks up from wherever you are.

WHAT IT DOES

• Reads posts aloud in the post's own language
• Scrolls to the next post automatically, so the reading never stops
• Stops the moment you scroll yourself — it never fights you for the page
• Skips promoted posts and posts with no text
• Skips the author's name if you'd rather get straight to the content
• Keyboard shortcuts: Alt+Shift+P to play or pause, Alt+Shift+N for the next post

READ POSTS IN YOUR LANGUAGE

Pick a reading language and ReadX translates foreign posts before reading them,
using Chrome's built-in on-device translation. That means:

• It's free — no API key, no account, no subscription
• It works offline once the language pack is downloaded (a one-time ~15 seconds)
• Your posts are translated on your own machine, not on a server

If translation isn't available on your device, ReadX tells you why and reads the
original instead. It never silently does nothing.

BETTER VOICES (OPTIONAL)

The system voice is free and works offline, but it sounds robotic. If you want a
more natural voice, ReadX supports pluggable cloud voice providers — bring your
own API key:

• OpenRouter — one key, many models
• OpenAI — a single key, no setup beyond that

Bringing your own key means no middleman: you pay the provider directly at their
rates, and your key is stored only on your own device.

PRIVACY

ReadX has no servers of its own. No analytics, no tracking, no account.

• Translation runs entirely on your device
• A fresh install does not touch a single third-party domain
• Cloud voices are off by default and request their domain permission only when
  you enable them — and only then is post text sent to the provider you chose
• Your API keys are stored locally and are never synced anywhere

REQUIREMENTS AND LIMITS

• Works on x.com and twitter.com
• Automatic translation needs Chrome 138+ on desktop
• ReadX reads posts by looking at the page, so if X redesigns its layout the
  extension may need an update. There are no promises it will survive every
  redesign.
• ReadX is not affiliated with, endorsed by, or sponsored by X Corp.

ReadX is open source: https://github.com/aaronlou/ReadX
```

---

## 4. Detailed description — 中文

```
把 X 时间线变成可以「听」的东西。

ReadX 会滚动定位到一条帖子，判断它是什么语言，然后朗读出来。读完一条自动
去下一条，你可以让眼睛离开屏幕。

这是**桌面版 Chrome 扩展**，没有 iOS / Android 版本。

怎么开始用

1. 点「添加至 Chrome」，然后打开 x.com 或 twitter.com。
2. 页面右下角会出现一条控制条。
3. 按 ▶ 开始听。ReadX 会滚动定位到你正在看的帖子，读完自动去下一条。

快捷键：Alt+Shift+P 播放/暂停，Alt+Shift+N 下一条。

**你不按播放，它什么都不读。** 你自己滚动时它会停下，从你所在的位置接着读。

它做什么

• 按帖子本身的语言朗读
• 读完自动滚到下一条，连续听下去不会断
• 你自己一滚动它就停 —— 绝不跟你抢滚动条
• 跳过推广帖和没有文字的帖子
• 不想听作者名可以关掉，直接进正文
• 快捷键：Alt+Shift+P 播放/暂停，Alt+Shift+N 下一条

用你的语言听

指定一个朗读语言，ReadX 会先用 Chrome 内置的**设备端**翻译把外文帖子翻好再读：

• 免费 —— 不需要 API Key、不需要账号、不需要订阅
• 语言包下载后完全离线可用（一次性，约十几秒）
• 翻译在你本机完成，不经过任何服务器

如果你的设备不支持，ReadX 会说明原因并改读原文，**绝不会静默地什么都不做**。

更好的音色（可选）

系统语音免费且离线，但听起来偏机械。想要更自然的音色，ReadX 支持可插拔的
云语音服务商 —— 自备 API Key：

• OpenRouter —— 一个 Key 用多家的模型
• OpenAI —— 一个 Key，配置最简单

自备 Key 意味着没有中间商：你按服务商的原价直接付费，Key 只存在你自己的设备上。

隐私

ReadX 没有自己的服务器。没有统计、没有追踪、没有账号。

• 翻译完全在你的设备上完成
• 全新安装不碰任何第三方域名
• 云语音默认关闭，只在你主动启用时才申请对应域名权限；也只有那时，
  帖子文本才会发给你选择的服务商
• API Key 只存本机，不同步到任何地方

环境要求与已知局限

• 支持 x.com 和 twitter.com
• 自动翻译需要桌面版 Chrome 138 及以上
• ReadX 靠读取页面来工作，所以 X 改版后可能需要更新才能恢复。无法承诺
  它能挺过每一次改版。
• ReadX 与 X Corp 无关联，也未获得其认可或赞助。

ReadX 是开源的：https://github.com/aaronlou/ReadX
```

---

## 5. Category / 分类

| Field | Value |
| --- | --- |
| Category | **Accessibility** (best fit) — alternative: Productivity |
| Language | English (primary), Chinese (Simplified) |

> Category choice matters for discovery. Accessibility is where "read this to me"
> extensions live, and it's where the audience that needs this looks.

---

## 6. Privacy practices tab / 隐私表单（逐字段可粘贴）

Chrome 后台的 **Privacy** 标签页按字段分。下面每块直接复制。

> ⚠️ 先看清一个事实：ReadX 的 manifest 里
> `permissions: ["storage"]`、`host_permissions: ["x.com","twitter.com"]`、
> 三个云语音域名在 `optional_host_permissions` 里。**所以理由栏会出现
> storage + 两个站点域名 + 可选的三个域名。**

### 6.1 Single purpose description

```
ReadX makes the X (Twitter) timeline listenable. On x.com it scrolls to a post,
detects the post's language, and reads it aloud, then advances to the next post.
If the user picks a reading language, foreign posts are translated first using
Chrome's built-in on-device Translator API.

The only network function is optional cloud text-to-speech: if the user turns it
on and supplies their own API key, the text being read is sent to that provider
to be converted into audio. Scrolling, text extraction, language detection and
translation all happen locally on the user's device.
```

### 6.2 Permission justifications

**`storage`**

```
Saves the user's reading preferences (speed, volume, voice, reading language,
and feature toggles) via chrome.storage.sync, and — locally only — the API key
for any cloud voice provider the user chooses to enable, via
chrome.storage.local. Credentials are never synced. No browsing history and no
page content is stored.
```

**`x.com` / `twitter.com` host permission**

```
ReadX works only on x.com and twitter.com. It injects a small reading control
bar into the page, reads the text of the post the user asked to hear, and
scrolls the timeline to the next post. No other website is requested at install
time.
```

**Optional host permissions (openrouter.ai / api.openai.com / openspeech.bytedance.com)**

```
Requested only when the user deliberately enables a cloud voice provider in
ReadX settings. At that moment the user chooses the provider and Chrome shows a
permission prompt for that provider's domain. The text of the post being read is
then sent to that provider to be synthesized into audio, together with the
user's own API key for that provider. A fresh install requests none of these
domains, and the system voice plus on-device translation need no network at all.
```

### 6.3 Are you using remote code?

**No, I am not using remote code.** — 全部代码都在包里，不从网络拉取或 eval。

### 6.4 Data usage — checkboxes / 数据使用勾选项

| 类别 | 勾不勾 | 为什么 |
| --- | --- | --- |
| **Website content** | ✅ **必勾** | 读取 x.com 帖子正文；用户开启云语音时会把这段文本发出去 |
| **Authentication information** | ✅ **建议勾** | 用户自备的 API Key 会作为 `Authorization` 请求头发给所选服务商 |
| 其余全部（PII / 健康 / 财务 / 位置 / 网络历史 / 用户活动 / 个人通信） | ❌ | 确实不涉及 |

> **为什么不填"什么都不收集"**：默认情况下帖文确实不出本机，但用户开启云语音后
> 扩展**确实会**把帖子文本发出去。填"否"就是不实申报 —— 这是审核被拒最常见的原因。
>
> **为什么连 Authentication information 也勾**：那个 API Key 是我们**传输到设备之外**的
> 凭据。Google 对"收集"的定义就是"传出设备"。多申报不违规，少申报才是问题 ——
> 配合 6.2 里的说明，审核方一看就明白。

### 6.5 Certifications — 三个勾选框

三个都勾（都确实成立）：

- 不出售或转让用户数据给第三方 ✅
- 不将用户数据用于与单一用途无关的目的 ✅
- 不将用户数据用于判定信用或放贷 ✅

### 6.6 Privacy policy URL

```
https://github.com/aaronlou/ReadX/blob/main/PRIVACY.md
```

仓库是 public，审核方能打开。想更正式可以开 GitHub Pages 换成渲染后的页面。

---

## 7. Privacy policy URL / 隐私政策地址

`PRIVACY.md` lives at the repo root. **The store requires a public URL**, not a
file upload. Two options:

| Option | URL | Trade-off |
| --- | --- | --- |
| **A. GitHub blob (works today)** | `https://github.com/aaronlou/ReadX/blob/main/PRIVACY.md` | Zero setup, repo is public. Renders with GitHub's chrome around it. |
| **B. GitHub Pages (cleaner)** | `https://aaronlou.github.io/ReadX/PRIVACY.html` | Needs Pages enabled once (Settings → Pages → Deploy from branch `main`), and the Markdown converted to HTML. |

Recommendation: **ship with A now** so submission isn't blocked, switch to B later
if the reviewer asks for a "real" page. Both are acceptable; A is common for
open-source extensions.

---

## 8. Graphic assets / 图片素材

| Asset | Size | Status |
| --- | --- | --- |
| Extension icon | 128×128 | ✅ `public/icon/128.png` |
| Screenshots (1–5) | 1280×800 | ⬜ **needs a real capture** — see shot list below |
| Small promo tile | 440×280 | ✅ `store/promo-440x280.png` |
| Marquee promo tile (optional) | 1400×560 | ⬜ optional |

### Screenshot shot list / 截图清单

The store requires 1280×800 (16:10). Capture these in order — the first one is
what people see in search results, so it must communicate the product instantly.

1. **The reading bar on a real timeline** — a post being read, showing author,
   progress ("Post 2 of 3") and the controls. This is the money shot.
2. **Settings → Voice** — the provider cards and the privacy notice, to show the
   cloud voice is opt-in.
3. **The intro card** — first-run guidance on a fresh install.
4. **Settings → compatibility check** — the diagnostics table (shows it's a
   serious tool, and it's genuinely useful for support).

To capture at exactly 1280×800: open DevTools → ⋮ → *Run command* →
"Capture screenshot" won't give exact size; instead set the device toolbar to a
1280×800 viewport, or capture at 2× and downscale.
