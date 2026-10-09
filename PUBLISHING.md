# 发布到 Chrome Web Store 的检查清单

> 这份清单来自一次按商店实际审核要求做的代码审计。**当时未通过**的项已经在 2026-10 的
> `chore(release)` 提交里修掉了，下面标注了每项的状态。

---

## 一、代码层（已全部完成）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| Manifest V3 | ✅ | |
| **零远程代码** | ✅ | 实测 `eval` / `new Function` / 动态 `import` / `XHR` / `WebSocket` / `sendBeacon` 全为 0 |
| `fetch` 调用点 | ✅ | 仅 3 处，全部指向扩展自身的资源（React preload、WXT 注入 CSS） |
| 权限最小化 | ✅ | 只要 `storage`；host 限定 `x.com` / `twitter.com`，无 `<all_urls>` |
| 无 MAIN world 注入 | ✅ | 诊断用的 MAIN world 脚本已删除，生产包只有一个内容脚本 |
| 空闲不耗电 | ✅ | 高亮框的 rAF 循环改为**只在有当前帖子时**运行（原先常驻 60fps） |
| 首次使用引导 | ✅ | 页面右下角一次性提示卡，点 ▶ 或「知道了」后永久关闭 |
| 可访问性 | ✅ | 图标按钮都带 `aria-label` |
| 无 `console.log` 残留 | ✅ | 只保留失败路径的 `console.warn`（便于用户反馈问题时排查） |
| 测试 | ✅ | 82 个单元测试 + `tsc --noEmit` |

### 有意保留的降级行为

- **Chrome < 138** → 没有内置翻译，自动降级为只朗读原文（有提示，不静默失败）
- **语言包未下载** → 挂起并显示下载按钮 + 进度条（Chrome 要求下载必须由用户手势触发）
- **硬件不达标** → 同上降级
- **找不到帖子** → 面板显示可读的原因，而不是静默什么都不做

---

## 二、真实 x.com 验证

**已确认可用**：生产版（`.output/chrome-mv3`）装进日常 Chrome、在真实 x.com 上能正常朗读与滚动。

开发期间所有测试都跑在 `playground/mock-timeline.html` 上 —— 它是照
[第三方整理的 X DOM 参考](https://github.com/nirholas/XActions/blob/main/docs/dom-selectors.md) 复刻的。
所以单测验证的是「实现符合我们对 X DOM 的**认知**」，**不是**「符合 X 的**真实** DOM」。
真机跑通这一步不能省。

以下细节仍建议逐项过一遍（都是 mock 无法覆盖的）：

- [ ] 读到的是**正确的正文** —— 不是作者名、不是界面文案、不是引用内容
- [ ] 自动滚动**滚到位**，不被顶部栏挡住
- [ ] 推广帖被跳过
- [ ] emoji 被读出来（不是跳过或乱码）
- [ ] 引用帖的正文和引用内容**不会读串**
- [ ] 「朗读语言」设为中文时，英文帖会被翻译
- [ ] 自己手动滚一下，它会让位并跟着你的位置继续
- [ ] 未登录状态下打开 x.com 不崩溃
- [ ] 帖子详情页、列表页各试一次
- [ ] Chrome < 138 的机器上降级为只朗读

一旦某项失败，要改的地方基本都在 `src/x/selectors.ts`（所有选择器的降级链都集中在那一个文件）。

---

## 三、商店素材

- [x] **图标** —— 已用 `scripts/make-icons.py` 生成（翡翠色圆角方块 + 三根白色声波条）。
      16/32/48/96/128 全套在 `public/icon/`。
      重新生成：`python3 scripts/make-icons.py build`；
      看方案对比：`python3 scripts/make-icons.py variants`；
      看真实工具栏效果（明/暗底）：`python3 scripts/make-icons.py toolbar`。
      设计约束是**必须先在 16×16 下能认出来** —— 那是 Chrome 工具栏的实际尺寸，
      所以脚本在 8 倍超采样下绘制再降采样，并且对比图里用超采样放大来暴露小尺寸的真实效果。
- [x] **宣传图** —— `scripts/make-store-art.py` 生成，产物在 `store/`：
      `promo-440x280.png`（商店必填）、`marquee-1400x560.png`（顶部大图，可选）。
      和图标共用同一套 emerald 常量 —— 商店里图标和宣传图并排显示，色差会很显眼。
- [x] **文案** —— [`store/listing.md`](store/listing.md)：中英双语的长短描述、
      分类选择、隐私表单答案、以及截图清单，全部可直接复制粘贴。
- [x] **截图** —— `npm run shoot` 自动生成，1280×800，中英两套：
      `store/screenshots/{en,zh}/{01-intro,02-reading,03-settings}.png`。
      商店支持**按语言分别上传截图**，所以英文 listing 用 `en/`，中文用 `zh/`。
      第一张是搜索结果的封面，所以脚本先截引导卡、再截"正在朗读"那张。

      > 这些是在**本地 mock 时间线**上截的（`playground/mock-timeline.html`）。
      > 换成真实 x.com 的截图会更有说服力，但需要登录后手动截。
      > 脚本里已经把 mock 页面的调试横幅隐藏了，所以看起来就是普通时间线。

---

## 三点五、隐私政策

- [x] [`PRIVACY.md`](PRIVACY.md) —— 中英双语，涵盖：不收集什么、本机存了什么、
      什么情况下数据会离开设备、权限用途、未成年人、变更通知。

**商店要求的是一个可公开访问的 URL，不是上传文件。** 仓库是 public，所以：

| 方案 | URL | 取舍 |
| --- | --- | --- |
| **A. GitHub blob（现在就能用）** | `https://github.com/aaronlou/ReadX/blob/main/PRIVACY.md` | 零配置。渲染时带 GitHub 的外壳，开源扩展这样填很常见 |
| B. GitHub Pages（更干净） | `https://aaronlou.github.io/ReadX/PRIVACY.html` | 需要开一次 Pages，并把 Markdown 转成 HTML |

建议**先用 A 提交**，别让这一步卡住审核；如果审核方要求一个"真正的网页"再切 B。

有几条**必须如实写、不能图省事**的：

1. 偏好设置走的是 `chrome.storage.sync` —— **Chrome 会通过 Google 在你登录的设备间同步**。
   说"什么都不上传"是错的。
2. **系统语音也可能走网络** —— 取决于用户装的是本地语音还是网络语音，
   浏览器/操作系统可能在厂商服务器上处理。ReadX 自己不传，但政策里讲清楚才诚实。
3. 云语音开启后，帖子文本会发给所选服务商 —— 这是"网站内容"这一类数据，
   隐私表单里**必须勾选**，不能填"不收集"。

---

## 三点八、⚠️ 发布前必须**真的把扩展装进 Chrome 一次**

这不是形式主义。这一轮里有两个 bug **会让扩展完全无法装载**，而它们同时
通过了：构建成功、`tsc` 干净、178 个单元测试全绿。

| bug | 表现 | 为什么测试发现不了 |
| --- | --- | --- |
| i18n 的 key 含点号（`popup.engine`） | `Name of a key ... is invalid` | 测试直接读 `messages.json`，绕过了 Chrome 的校验 |
| 用了裸 `$1$` 占位符 | `Variable $1$ used but not defined` | 同上；而且构建期完全不校验 `_locales` |

两者都只在 Chrome 解析 `_locales` 时才报错。**所以「能构建 + 测试通过」
不等于「能装进浏览器」**，扩展类项目必须真的装载一次。

自动化方式（`scripts/shoot.mjs` 里的做法，已跑通）：

```bash
npx wxt build -m screenshot      # 输出到 .output/chrome-mv3-screenshot，不污染正式包
```

然后跑冒烟测试和截图 —— 两个都会真的把扩展装进 headless Chrome：

```bash
npm run smoke                    # 端到端：中英各一遍，36 项断言
npm run shoot                    # 中英两套截图
```

`npm run smoke` 覆盖的正是上面那张表里"测试发现不了"的部分：内容脚本注入、
点播放后状态推进、高亮框出现、句子在变、设置页和 popup 能渲染、
全程无控制台报错、界面上没有残留的 `{0}` 记号或裸露的 i18n key。
**中英各跑一遍** —— 上一轮那个"中文标点变乱码"的 bug 就只在中文下出现。

**注意 `--load-extension` 这个命令行参数在 Chrome 137+ 已被静默忽略**
—— 不报错、不警告，只是扩展根本没加载。必须用 CDP 的
`Extensions.loadUnpacked`（需要 `--enable-unsafe-extension-debugging`）。

---

## 四、商店表单要如实填写的内容

### 隐私声明（Privacy practices）

必须如实申报，**这是审核最容易卡住的地方**。
注意 ReadX 有两种朗读引擎，隐私表现**不同**：

| 问题 | 填什么 |
| --- | --- |
| 是否收集用户数据？ | **是** —— 仅「网站内容」这一类（帖子正文） |
| 是否读取网页内容？ | **是** —— 读取 x.com 帖子正文用于朗读与翻译 |
| 内容会不会离开设备？ | **取决于用户选择**（见下） |
| 是否出售数据？ | **否** |
| 是否用于与单一用途无关的目的？ | **否** |
| 是否使用远程代码？ | **否** |
| 是否包含广告 / 分析 SDK？ | **否** |

> ⚠️ 「是否收集用户数据」这一栏**不能填"否"**。默认情况下文本确实不出本机，
> 但用户开启云语音后扩展**确实会**把帖子文本发出去 —— 填"否"就是不实申报。
> 如实勾选「网站内容」并把条件写清楚，才是安全且诚实的答案。

**两种引擎的差异（务必在商店描述里写清楚）**：

| | 系统语音（默认） | 云语音（用户主动启用） |
| --- | --- | --- |
| 朗读文本 | 完全本地 | **发送到所选服务商**（火山引擎 / OpenAI） |
| 翻译 | 完全本地（Chrome 设备端模型） | 完全本地 |
| 需要联网 | 否 | 是 |
| 需要的权限 | 无额外权限 | 用户点击授权的服务商域名 |

**当前支持的服务商**（定义在 `src/tts/providers/`，注册表在 `index.ts`）：

| 服务商 | 域名 | 凭据 |
| --- | --- | --- |
| 豆包（火山引擎） | `openspeech.bytedance.com` | API Key，或 App ID + Access Key |
| OpenAI | `api.openai.com` | API Key |

> 默认安装**不碰任何第三方域名**。只有用户去选项页主动点某家服务商
> 并同意授权后，文本才会发出去。授权走的是 `optional_host_permissions`
> （由注册表自动推导），安装时的权限提示里不会出现这些域名。

### 单一用途说明（Single purpose）

> ReadX 把 X 的时间线变成可听的流：自动滚动定位到帖子、按语言朗读，
> 并在用户指定朗读语言时先做翻译。

### 权限用途说明（Permission justification）

| 权限 | 原因 |
| --- | --- |
| `storage` | 保存语速、音量、音色、朗读语言等偏好 |
| `host_permissions: x.com / twitter.com` | 注入控制条、读取帖子正文。**不申请其它任何域名** |
| `optional_host_permissions` | **可选**。仅在用户主动启用某家云语音服务商时申请，用于把待朗读文本送去合成 |

### 商标措辞

名称和描述里要明确 **与 X Corp 无关联**。已在扩展的选项页脚注里写明，
商店描述里也要加一句：

> ReadX is not affiliated with, endorsed by, or sponsored by X Corp.

---

## 五、兼容性说明（写进商店长描述）

- 需要 Chrome **138+（桌面版）** 才能使用设备端翻译
- 更低版本、或硬件不达标的机器上，**朗读功能正常，只是不会自动翻译**
- 翻译使用 Chrome 内置的**设备端**模型：免费、离线、内容不出本机
- 首次选择某个语言时需要下载一次语言包（约十几秒）
- **朗读音色**默认用系统语音（零配置、离线）；想要更自然的音色可以启用云语音
  （豆包 / OpenAI），需要自备对应服务商的凭据，且**会把待朗读文本发送到该服务商**

---

## 六、打包与提交

### 6.1 打包

```bash
npm run compile   # 类型检查
npm run test      # 178 个单元测试
npm run smoke     # 端到端冒烟（中英各一遍 + 正式包装载验证）
npm run build     # 生产构建 → .output/chrome-mv3
npm run zip       # 压缩包 → .output/readx-<version>-chrome.zip
```

> `.output` 是隐藏目录。在 Finder 里按 **`Cmd + Shift + .`** 才看得到。

### 6.2 一次性准备：开发者账号

1. 打开 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole)
2. 用 Google 账号登录，支付**一次性 5 美元**注册费
3. 填写发布者信息：显示名称 + **一个已验证的联系邮箱**
   （Google 要求邮箱验证通过后才能发布）

> 费用和界面以官方页面为准 —— [官方发布文档](https://developer.chrome.com/docs/webstore/publish)

### 6.3 新建条目

1. 后台 → **Add new item** → 把 `.output/readx-0.1.0-chrome.zip` **整个拖进去**
2. 上传后会自动解析 manifest。上传的 zip 里 `manifest.json` 必须**在根目录**
   （WXT 打出来的包满足这一点，不要自己重新压缩一层目录）

### 6.4 Store listing 标签页

文案都在 [`store/listing.md`](store/listing.md)，逐项复制即可。要填：

| 字段 | 填什么 |
| --- | --- |
| **Description** | `store/listing.md` §3（英文）和 §4（中文）。纯文本，不支持 Markdown |
| **Category** | **Accessibility** —— 见 `listing.md` §5 的理由 |
| **Language** | English（主）+ Chinese (Simplified) |
| **Store icon** | 上传后自动取包里的 `icon/128.png` |
| **Screenshots** | `store/screenshots/en/01-intro.png` → `02-reading` → `03-settings`，**按这个顺序**（第一张是搜索结果的封面） |
| **Small promo tile** | `store/promo-440x280.png` |
| **Marquee promo tile** | `store/marquee-1400x560.png` |

> 商店支持**按语言分别上传**。英文 listing 用 `store/screenshots/en/`，
> 中文 listing 用 `store/screenshots/zh/`。
>
> 截图和宣传图的格式已核对过：**1280×800 / 440×280 / 1400×560，RGB 无 alpha
> 通道** —— 商店明确要求 JPEG 或 24 位 PNG 且不能带 alpha，带 alpha 会被拒。

### 6.5 Privacy 标签页

逐项答案在 [`store/listing.md`](store/listing.md) §6，这里只强调**最容易填错的两处**：

1. **「是否收集用户数据」不能填"否"。** 默认情况下帖文确实不出本机，
   但用户开启云语音后扩展**确实会**把帖子文本发给所选服务商。
   必须勾选 **Website content** 这一类，否则就是不实申报。
2. **Privacy policy URL 必须填。** 用
   `https://github.com/aaronlou/ReadX/blob/main/PRIVACY.md`
   （仓库是 public，审核方能打开）。想更正式可以开 GitHub Pages 换成渲染后的页面。

另外要贴三个 justification：**单一用途说明**、**权限用途说明**
（都在 `PUBLISHING.md` 第四节）以及 **Are you using remote code? → No**。

### 6.6 Distribution 与提交

1. **Distribution** → 先选 **Unlisted** 还是 **Public**：
   - 想自己先走一遍商店安装流程验证，选 Unlisted，拿到链接装一次确认无误
   - 确认没问题后改回 **Public**
2. **Submit for review**

### 6.7 审核预期

- 首次审核通常几天，**新开发者账号会更久**
- ReadX 申请的权限很少（只要 `storage` + x.com 域名），
  可选域名还是用户主动授权的，审核风险不高
- 被拒时看拒信里的具体条款 —— 最常见的是**隐私申报与实际行为不符**，
  对照 6.5 那两处再核一遍

### 6.8 通过之后

- 商店会分配一个**永久 extension ID**（和本地加载的临时 ID 不同）
- 之后更新：改 `package.json` 的 `version` → `npm run zip` → 后台
  该条目 → **Package** → 上传新 zip → Submit for review
- **版本号必须递增**，否则会被拒

---

## 七、当前审计结论

**代码是干净的**：零远程代码、权限最小、没有 MAIN world 注入、空闲不耗电、82 个测试。

**真实 x.com 上已跑通**，图标已就位。

**离可提交还差**：

1. 商店截图与宣传图
2. 商店表单（隐私声明、单一用途说明、权限用途）
3. 上面第二节里那几项细节验证
