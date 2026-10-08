# ReadX

> 用耳朵刷 X。自动滚动定位到 X (Twitter) 的下一条帖子，识别它的语言，用对应语言的音色朗读出来。

**[English](#english)** · 中文

---

## 它解决什么问题

刷 X 的时候你其实只想"知道大家在说什么"，但眼睛和手都被绑住了。ReadX 把时间线变成一条可以听的流：

- **自动滚动定位** —— 不用手滚，它自己把下一条帖子对准阅读位置
- **按语种朗读** —— 英文用英文音色，中文用中文音色，日文用日文音色，全自动
- **翻译成你想听的语言** —— 指定「朗读语言」后，外语帖子会先翻译再朗读；
  **帖子本来就是该语言时直接读原文**，不做无谓的翻译
- **不打断你** —— 你一旦自己滚动，它立刻让位，跟着你的位置继续读

### 翻译用的是什么

Chrome 138+ 内置的**设备端** Translator API：免费、离线、**模型下载之后内容完全不出本机**。
代价是可用性受硬件门槛限制（官方要求 16GB 内存 / 22GB 空闲磁盘 / 4 核），
用不了时**自动降级读原文并说明原因**，绝不会静默什么都不读。

`TranslationProvider` 是接口化的，后续接 LLM（自备 Key，社媒文本的译文质量更好）不影响上层。

---

## 快速开始

### 1. 环境要求

- Node.js ≥ 20（开发时用的是 25.9）
- Chrome / Edge 等 Chromium 内核浏览器

### 2. 安装依赖

```bash
npm install
```

> **本机注意**：这台机器的 `~/.npm/_cacache` 里有 root 权限的残留文件，直接跑 `npm install` 会报 `EPERM`。
> 仓库里的 `.npmrc` 已经把缓存重定向到项目内的 `./.npm-cache`，所以**不需要 sudo**，
> 直接 `npm install` 就行。如果仍然报错，用
> `npm_config_cache="$PWD/.npm-cache" npm install` 显式指定。
>
> 想一劳永逸修掉可以执行 `sudo chown -R 501:20 ~/.npm`。

### 3. 启动开发模式

```bash
npm run dev
```

WXT 会自动打开一个装了本插件的 Chrome，**内容脚本支持热更新**——改完代码在 x.com 页面上直接生效，不用手动刷新。

> **两个容易踩的坑（都已处理，但值得知道）：**
>
> - **`web-ext` 是 devDependencies 里的必需项。** WXT 靠它拉起浏览器；这个 import 失败时
>   WXT 会**静默退化成「请手动加载」**，不报任何错。如果你看到 `Load ".output/chrome-mv3-dev" as an unpacked extension manually`，
>   就是这个原因。手动加载也可以：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `.output/chrome-mv3-dev`。
> - **dev 用的 Chrome profile 是持久化的**（`.chrome-profile/`，已 gitignore）。
>   Chrome 内置 AI 的语言包存在 profile 里，web-ext 默认用临时 profile ——
>   那样每次 `npm run dev` 都要重新下载一遍翻译模型（实测 12 秒）。
>   顺带一提，这也意味着**手动加载到你自己常用的 Chrome 里，能直接复用它已下载的语言包**。

### 4. 不用登录 X 也能调试（推荐先跑这个）

另开一个终端：

```bash
npm run mock
```

它会打印两个地址：

| 地址 | 用途 |
| --- | --- |
| http://localhost:5174 | **模拟时间线** —— 复刻了 X 真实 DOM 结构，含中/英/日/俄/阿/韩/西/法帖子、emoji、引用帖、纯图片帖、推广帖。点右下角控制条的 ▶ 就能听到效果 |
| http://localhost:5174/probe.html | **设备端翻译能力检测** —— 见下文「翻译能力检测」 |

按 `Ctrl+C` 停止。如果提示端口被占用，它会**自动改用下一个可用端口**并打印实际地址；
想腾出原端口：`kill $(lsof -nP -iTCP:5174 -sTCP:LISTEN -t)`。

这条调试路径很重要：x.com 需要登录、难自动化，而 `playground/` 里的 DOM 结构和单元测试共用同一份"唯一真相"（`playground/fixtures/x-dom.js`），所以本地验证是有意义的。

### 5. 在真实的 x.com 上使用

开发模式下插件已经装好了，直接打开 https://x.com/home ，点右下角控制条上的 ▶。

### 6. 构建正式版本

```bash
npm run build     # 产物在 .output/chrome-mv3
npm run zip       # 打包成可上传的 zip
```

手动加载：Chrome → `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `.output/chrome-mv3`。

---

## 怎么用

| 操作 | 方式 |
| --- | --- |
| 开始 / 暂停 | 右下角控制条 ▶，或 `Alt+Shift+P`，或点插件图标用 popup |
| 下一条 | `Alt+Shift+N` |
| 上一条 | `Alt+Shift+B` |
| 停止 | 控制条 ⏹ |
| 调语速 / 音量 / 音色 | popup |
| 跟随你的滚动 | 直接用手滚 —— 它会让位，并从你停下的位置继续读 |

---

## 翻译能力检测（下一阶段的前置调研）

规划中的「指定朗读语言 → 自动翻译」打算用 **Chrome 138+ 内置的 `Translator` API**：设备端、免费、离线、内容不出本机。
但它有两个必须提前摸清的未知数，所以仓库里有两套互补的检测工具。

### 工具一：`playground/probe.html`（普通网页上下文）

```bash
npm run mock
```

打开 <http://localhost:5174/probe.html>。

回答的问题：**这台机器到底能不能跑设备端翻译。**
它会显示 Chrome 版本、API 是否存在、`availability` 状态，并且可以**真的下载语言包并翻译一句话**（下载必须在按钮点击里触发，这正是 `Translator.create()` 的硬性要求）。

#### 实测结论（Chrome 153 / 154，macOS）

| 项目 | 结果 |
| --- | --- |
| `typeof Translator` | `function` |
| `Translator.availability(en→zh)` | `downloadable` → 下载后 `available` |
| 首次下载 en→zh 语言包 | **12.2 秒**，136 次 `downloadprogress` 事件（约 11 次/秒，进度条很顺） |
| 翻译质量 | 可用（"获得创业想法的最好方法是不要考虑创业的想法。它是寻找问题，最好是你自己遇到的问题。"） |

**三种 JS 上下文的可见性**（扩展「能力检测」页实测）：

| 上下文 | `Translator` | 结论 |
| --- | --- | --- |
| 扩展页面（选项页） | `function` | 也能在设置页预下载语言包 |
| **内容脚本 isolated world** | **`function`** | ✅ **翻译直接写在 content script 里，不需要 MAIN world 桥接** |
| 页面 MAIN world | `function` | 作为退路存在（`main-world-probe.content.ts`） |

⚠️ 同一份数据里 **`LanguageDetector.availability() = unavailable`** —— 这个 API 要么模型已就绪要么直接不可用，
**没有 `downloadable` 中间态**（另一台 profile 上它曾显示 `available`）。
所以它不能作为可靠的「第 4 层语种识别」，三层识别方案保持不变。

👉 **产品含义：首次使用必须给用户一个可见的下载进度，否则会有十几秒的"点了没反应"。**
这个下载是**一次性**的，之后 `availability` 直接是 `available`。
另外 `downloadprogress` 的 `e.loaded` 是 0~1 的**比例**（不是字节数），`total` 恒为 1。

#### 如果卡在「下载中」

排查页会带超时和日志，能区分「一次进度事件都没收到」（下载没启动）和「收到了但走不动」（被拦）。另外：

- `chrome://on-device-translation-internals` —— 列出所有语言包，**支持手动下载**，并显示下载失败的原因。
  翻译需要源语言和目标语言**两个包都装**（如 en 和 zh）。**如果这个页面打不开或为空，说明本机根本不支持内置翻译。**
- `chrome://flags/#translation-api` —— 「Experimental translation API」需设为 Enabled（若已无此项，说明特性已转正）
- `chrome://components` —— 找 Translation / Optimization Guide 相关条目，检查更新；版本停在 `0.0.0.0` 就是组件没下发

页面上的「对比测试：语言检测模型」按钮可以区分故障范围：语言检测模型小得多，
**它能下载而翻译不能 → 问题只在翻译语言包；两个都下不来 → 内置 AI 整体没启用。**

### 工具二：扩展的「能力检测」页（三种 JS 上下文）

点插件图标 → 「能力检测」，或 `chrome://extensions` → ReadX → 扩展选项。

回答的问题：**API 在内容脚本的 isolated world 里到底可不可见。**
这决定翻译功能放在哪一层 —— 内置 AI API 挂在 `window` 上，而内容脚本跑在另一个 JS realm，两者并不共享。它会同时报告：

| 上下文 | 意义 |
| --- | --- |
| 扩展页面（选项页） | 能否在设置页里预下载语言包 |
| **内容脚本 isolated world** | **我们的代码真正运行的地方，最关键** |
| 页面 MAIN world | 万一 isolated world 不可用，这是退路 |

结论怎么用：

- **isolated world 可用** → 翻译直接写在 content script 里，架构最简单
- **只有 MAIN world 可用** → 把翻译放进 `main-world-probe.content.ts` 那一层，用 DOM 事件桥回内容脚本（代价：拿不到 `chrome.*`）
- **两边都不可用** → 本机不支持，走云翻译或降级读原文

`chrome://on-device-internals` 可以看到 Chrome 自己关于模型下载和硬件判定的详情。

---

## 命令行

```bash
npm run dev        # 开发模式（热更新）
npm run build      # 构建
npm run zip        # 打包
npm run test       # 单元测试（77 个）
npm run compile    # 类型检查
npm run mock       # 启动本地 mock 时间线
```

---

## 架构

```
src/
├── entrypoints/
│   ├── background.ts          # 快捷键、语种识别兜底、跨标签页诊断广播
│   ├── content/
│   │   ├── index.tsx          # 内容脚本入口：装配 + 生命周期
│   │   └── Overlay.tsx        # 悬浮控制条 + 高亮框（Shadow DOM 隔离）
│   ├── main-world-probe.content.ts  # ⭐ 跑在页面 MAIN world，探测内置 AI 可见性
│   ├── options/               # 完整设置 + 能力检测页
│   └── popup/                 # 快捷控制面板
├── diagnostics/               # Chrome 内置 AI 能力探测（翻译方案的前置调研）
│   ├── probe.ts               # 探测 Translator / LanguageDetector 在当前 realm 的可见性
│   ├── pageProbe.ts           # isolated world + MAIN world 双 realm 探测
│   └── events.ts              # 跨 world 的 DOM 事件名
├── translate/                 # 翻译层
│   ├── provider.ts            # 引擎接口（为了以后接 LLM / 云 MT）
│   ├── chromeTranslator.ts    # Chrome 设备端翻译实现
│   └── languages.ts           # ⭐ BCP-47 ↔ Translator API 语言代码的归一化
├── x/                         # X 站点的适配层
│   ├── selectors.ts           # ⭐ 所有选择器的「降级链」，X 改版只改这里
│   ├── extract.ts             # 抽正文（含 emoji / 引用帖）、作者、status id
│   └── timeline.ts            # 帖子发现、几何定位、滚动、虚拟列表适配
├── lang/
│   ├── detect.ts              # 三层语种识别
│   └── cld.ts                 # chrome.i18n.detectLanguage 的兼容封装
├── tts/
│   ├── provider.ts            # 朗读引擎接口（为了以后换云 TTS）
│   └── webSpeech.ts           # Web Speech API 实现
├── core/
│   ├── reader.ts              # ⭐ 朗读主控：定位 → 提取 → 识别 → 切句 → 朗读 → 推进
│   └── text.ts                # 按语言切句 + 长句二次切分
├── matches.ts                 # 内容脚本注入范围（dev 环境含 localhost）
├── settings.ts                # chrome.storage.sync 设置
└── types.ts                   # 跨模块共享类型
```

控制流：

```
点「开始」
   ↓
锚线上找帖子 ──→ 滚动过去（自己算偏移，绕开 X 的 sticky header）
   ↓                    ↘ 并行预取后续帖子的文本
抽取正文 → 三层语种识别 → 按语言切句 → 逐句朗读（逐词进度回传）
   ↓
读完 → 自动滚到下一帖 → 循环
   ↓
用户手动滚动 → 立刻让位，改为跟随锚线继续
```

---

## 几个关键的技术决策

### 1. 语种识别用三层，缺一不可

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 1 | X 自己标在正文节点上的 `lang` 属性 | 最准，且免费 |
| 2 | 字符集判定（假名 / 谚文 / 汉字 / 西里尔 / 阿拉伯…） | 非拉丁语系几乎 100% 准 |
| 3 | `chrome.i18n.detectLanguage`（CLD2） | 只用来细分拉丁字母语言 |

顺序有讲究：**假名必须排在汉字之前**，否则所有日文都会被认成中文（含汉字的日文是已知局限，靠第 1 层兜住）。
第 3 层对短文本（< ~30 字符）经常返回 `isReliable: false`，所以只在百分比够高时才采信。
这个 API 在内容脚本里不一定可用，失败会自动转发给 background 再试一次。

### 2. X 是虚拟列表，不能一次性抓全部帖子

滚动时远端节点会被卸载。所以是"边走边抓"：滚一屏 → 用 `MutationObserver` 等新节点 → 再抽文本。
另外用**预取队列**提前缓存后面几条的文本，朗读不会卡顿。

### 3. 不能跟用户抢滚动条

只监听 `wheel` / `touchmove` / 方向键这类**真实输入事件**（不监听 `scroll`，因为程序化滚动也会触发）。
一旦用户动手，后续推进就从"DOM 里的下一条"切换成"从当前锚线重新定位"。

### 4. 长句必须切分

Chrome 的 `speechSynthesis` 在朗读很长的 utterance 时会莫名中断（历史上约 15 秒）。
所以：`Intl.Segmenter` 按语言切句 → 超过 160 字符再在标点/空格处二次切分 → 另加一个 9 秒的 keep-alive `pause/resume` 兜底。

### 5. 高亮不能改 X 的 DOM

X 是 React 管理的，往里插节点随时会被重渲染冲掉。
所以改用**自己 Shadow DOM 里的浮层**，每帧 rAF 跟随当前帖子的 `getBoundingClientRect()`——零 DOM 污染。

### 6. 两个容易踩的 WXT / 浏览器坑

- WXT 的 overlay 宿主**默认不设 z-index**，面板会被 X 顶栏盖住 → 必须显式 `zIndex: 2147483647`
- overlay 宿主 `pointer-events` 默认可点，且 `pointer-events: none` 会被子元素继承 →
  宿主设为 `none`，只有控制条本身设 `auto`，否则整个 x.com 会点不动

### 7. 无音色时不能永久卡死

系统缺少对应语种的语音包时，`speak()` 的 `onend` / `onerror` 可能永远不触发。
`webSpeech.ts` 里有一个按文本长度估算的超时看门狗，超时后跳过这一句继续。

---

## 权限说明（为什么只要这些）

```json
{
  "permissions": ["storage"],
  "host_permissions": ["*://x.com/*", "*://twitter.com/*"]
}
```

- 只要 `storage`：用来存语速、音量、音色偏好
- 不申请 `<all_urls>`，不申请 `tabs`，不申请 `tts`（Web Speech API 不需要权限）
- 朗读全部在本地浏览器完成，**不联网、不上传任何内容**

---

## 已知局限

- **音色取决于操作系统**。macOS 自带的语言比较全；Windows 需要在系统设置里装对应的语音包，否则某些语种只能用默认音色（插件会在 popup 里提示）。
- **整句都是汉字的日文会被判成中文**（第 1 层的 `lang` 属性通常能兜住）。
- **X 会改版**。改版后如果失效，只需要更新 `src/x/selectors.ts` 里的降级链。
- **只朗读文字**。图片、视频内容不处理（P1 范围外）。
- **"Show more" 折叠的长帖只读可见部分**，不会自动展开。

---

## 下一步（P2+）

- [x] **机器可用性已验证**：设备端翻译可用，且内容脚本的 isolated world 里 `Translator` 可见
- [x] `translationProvider` 接口 + `readingLang` 设置 + 语言包下载进度 UI
- [ ] **翻译预取**：现在是"读完一条才翻下一条"，翻译延迟会直接体现在听感上。
      应当在朗读第 N 条时就把第 N+1 条翻好（复用 `advance()` 的时机）
- [ ] 翻译结果缓存：按内容 hash 去重，转推和重复帖不必重翻
- [ ] `LlmTranslateProvider`：自备 Key，社媒文本（俚语 / 反讽 / 梗）的译文质量明显更好
- [ ] 预取队列显式化（当前是逐条推进，靠 X 自身加载速度）
- [ ] 逐词高亮（`onboundary` 已在回传，需要渲染到浮层上）
- [ ] 跳过规则细化：转推 / 回复 / 指定关键词 / 指定用户
- [ ] 云 TTS 引擎（Azure / OpenAI / ElevenLabs）——`TtsProvider` 接口已经留好
- [ ] 时间线以外的场景：帖子详情页、列表、书签、搜索页
- [ ] 上架 Chrome Web Store（需要隐私说明：不采集数据、不加载远程代码）

---

## English

**ReadX** is a Chrome extension (Manifest V3) that turns your X (Twitter) timeline into an audio stream.

It **auto-scrolls to the next post**, **detects the post's language**, and **reads it aloud with a matching voice** — English in English, Japanese in Japanese, no configuration.

Built with **WXT + TypeScript + React + Tailwind CSS v4**, using the browser's built-in **Web Speech API** (free, offline, zero extra permissions).

```bash
npm install
npm run mock     # offline playground at http://localhost:5174 — no X login needed
npm run dev      # dev build with HMR, then open https://x.com/home
npm run test     # 77 unit tests
npm run build    # → .output/chrome-mv3
```

**Language detection is a three-layer strategy:** X's own `lang` attribute on the post text → Unicode script detection (kana before Han, or Japanese gets misread as Chinese) → `chrome.i18n.detectLanguage` (CLD2) for Latin-script languages only.

**Why it doesn't fight your scrollbar:** it listens only to real input events (`wheel` / `touchmove` / arrow keys), never to `scroll` — programmatic scrolling fires that too. The moment you scroll, it yields and re-anchors to wherever you are.

`playground/fixtures/x-dom.js` is the single source of truth for X's DOM shape, shared by the offline playground page and the unit tests.
