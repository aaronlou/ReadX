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
When it finishes one post it moves to the next, so you can put your phone or
laptop down and just listen.

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
去下一条，你可以把手机或电脑放下，只用耳朵刷。

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

## 6. Privacy practices tab / 隐私表单

Answers to the Web Store "Privacy practices" questionnaire. **These must be
truthful — a wrong answer here is grounds for removal.**

| Question | Answer |
| --- | --- |
| Single purpose description | See `PUBLISHING.md` → 单一用途说明 |
| Does it collect or use user data? | **Yes** — one category: "Website content" |
| Website content | Read from x.com/twitter.com to read aloud and translate. Transmitted to a third party **only** when the user enables a cloud voice provider. |
| Data sold to third parties? | **No** |
| Data used for purposes unrelated to the single purpose? | **No** |
| Data used to determine creditworthiness / for lending? | **No** |
| Privacy policy URL | See §7 below |

### Why "Website content" must be declared

ReadX reads post text. Even though it stays on the device by default, the
extension *does* transmit it when the user turns on a cloud voice — so declaring
"none" would be false. Declaring it accurately is the safe and honest answer.

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
