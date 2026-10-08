# ReadX

> 用耳朵刷 X。自动滚动定位到 X (Twitter) 的下一条帖子，识别它的语言，用对应语言的音色朗读出来。

**[English](#english)** · 中文

---

## 它解决什么问题

刷 X 的时候你其实只想"知道大家在说什么"，但眼睛和手都被绑住了。ReadX 把时间线变成一条可以听的流：

- **自动滚动定位** —— 不用手滚，它自己把下一条帖子对准阅读位置
- **按语种朗读** —— 英文用英文音色，中文用中文音色，日文用日文音色，全自动
- **不打断你** —— 你一旦自己滚动，它立刻让位，跟着你的位置继续读

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

### 4. 不用登录 X 也能调试（推荐先跑这个）

另开一个终端：

```bash
npm run mock      # → http://localhost:5174
```

打开这个页面，你会看到一条**复刻了 X 真实 DOM 结构**的模拟时间线（含中/英/日/俄/阿/韩/西/法帖子、emoji、引用帖、纯图片帖、推广帖）。
点右下角控制条的 ▶ 就能听到效果。

这条路径很重要：x.com 需要登录、难自动化，而 `playground/` 里的 DOM 结构和单元测试共用同一份"唯一真相"（`playground/fixtures/x-dom.js`），所以本地验证是有意义的。

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

## 命令行

```bash
npm run dev        # 开发模式（热更新）
npm run build      # 构建
npm run zip        # 打包
npm run test       # 单元测试（30 个）
npm run compile    # 类型检查
npm run mock       # 启动本地 mock 时间线
```

---

## 架构

```
src/
├── entrypoints/
│   ├── background.ts          # 快捷键、右键指令、语种识别兜底
│   ├── content/
│   │   ├── index.tsx          # 内容脚本入口：装配 + 生命周期
│   │   └── Overlay.tsx        # 悬浮控制条 + 高亮框（Shadow DOM 隔离）
│   └── popup/                 # 完整控制面板
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
npm run test     # 30 unit tests
npm run build    # → .output/chrome-mv3
```

**Language detection is a three-layer strategy:** X's own `lang` attribute on the post text → Unicode script detection (kana before Han, or Japanese gets misread as Chinese) → `chrome.i18n.detectLanguage` (CLD2) for Latin-script languages only.

**Why it doesn't fight your scrollbar:** it listens only to real input events (`wheel` / `touchmove` / arrow keys), never to `scroll` — programmatic scrolling fires that too. The moment you scroll, it yields and re-anchors to wherever you are.

`playground/fixtures/x-dom.js` is the single source of truth for X's DOM shape, shared by the offline playground page and the unit tests.
