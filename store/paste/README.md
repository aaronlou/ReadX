# 发布 0.1.4 操作单

**我无法代你操作开发者后台**（那需要你的 Google 账号登录）。这份单子把
「点哪里、粘什么、传哪个文件」全部写死，照着做即可。

上传前我已经把能验的全验过了 —— **33 项预检全过**（包结构、权限、
中英文案、截图尺寸格式、描述同步、仓库状态）。

---

## 要上传/粘贴的文件

| 用途 | 文件 |
| --- | --- |
| **新版本包** | `.output/readx-0.1.4-chrome.zip` |
| Description（英文） | [`description.en.txt`](description.en.txt) |
| Description（中文） | [`description.zh.txt`](description.zh.txt) |
| 截图（英文，3 张） | `../screenshots/en/01-intro.png` → `02-reading` → `03-settings` |
| 截图（中文，3 张） | `../screenshots/zh/01-intro.png` → `02-reading` → `03-settings` |

> `.output` 是隐藏目录。Finder 里按 **`Cmd + Shift + .`** 才看得到。

---

## 一、上传新版本包

1. 打开 <https://chrome.google.com/webstore/devconsole> → 点开 ReadX
   （ID：`ecdjljbkaajlidofofjlopbcaigheeni`）
2. 进 **Package** 标签页
3. 点 **Upload new package**，选 `.output/readx-0.1.4-chrome.zip`
4. 等它解析完，确认页面上显示的版本是 **0.1.4**

> 如果报「版本号必须大于线上版本」，说明你选错文件了 ——
> 检查一下是不是 `.output` 里还有别的 zip。正常情况下只有这一个。

---

## 二、更新描述（中英各一份）

进 **Store listing** 标签页。

### 英文

1. 语言选择器选 **English**
2. **Description** 输入框 → **全选清空** → 粘贴 `description.en.txt`
3. **Save draft**

### 中文

1. 语言选择器切到 **中文（简体）**
2. 同样操作，粘贴 `description.zh.txt`
3. **Save draft**

> **要全选清空，不要追加。** 新版描述新增了「怎么开始用」「可以关掉控制条」
> 「跳过短帖」三处，覆盖比追加不容易出错。

---

## 三、换截图

同一页的 **Graphic assets** 区域。**顺序很重要** —— 第一张是搜索结果封面。

英文 listing 用 `../screenshots/en/`，中文 listing 用 `../screenshots/zh/`，
都按 `01-intro` → `02-reading` → `03-settings` 的顺序。

> 六张都是 1280×800 RGB 无 alpha，已逐个核对（商店明确拒绝带 alpha 的 PNG）。
>
> 这一版截图的变化：控制条右侧有 ✕（关掉），设置行末尾有
> `Skip short posts [Off]`（跳过短帖）。

---

## 四、提交

确认三样都对：**包版本 0.1.3**、**中英描述都是新的**、**中英截图都换了**。

然后点页面底部的 **Submit for review**。

---

## 五、审核期间 / 通过之后

**审核期间**：线上仍是旧版本，用户不受影响。看得到的是旧描述和旧截图 ——
这是正常的，描述和截图会和新包一起生效。

**通过之后**：商店会把版本更新到 0.1.4。老用户会在 Chrome 里收到更新提示
（通常几小时内）。

**建议通过后验一次**：从商店重新安装一遍，确认：
- 控制条正常出现
- 点 ✕ 能关掉，刷新不回来
- 「跳过短帖」能设成 40 并真的跳过短帖

---

## 附：这次发布包含了什么

对比 0.1.2：

| | 变化 |
| --- | --- |
| 🆕 | **本地语音服务** —— 接自己在本机跑的 OpenAI 兼容 TTS，不按字数计费、音频不出本机 |
| 🐛 | **余额用完不再被误报成「请求太频繁」** —— OpenAI 用同一个 429 表示两种相反的情况，现在会读 body 里的 code 区分 |
| 🐛 | 设置页的隐私提示原来写死「文本会离开你的设备」，对本地服务是事实错误，已按服务商区分 |
| 🐛 | 本地服务的错误解析兼容 FastAPI 的 `detail` 形状 —— 之前会把「音色不存在」这条最有用的报错吞掉 |
| 📝 | 商店描述补了本地服务这一条 |

---

## 不用改的东西

- **名称 / 简短说明** —— 来自包里的 `_locales`，跟着浏览器语言自动切换，
  上传新包后自动更新，不用手动填
- **Category / Language** —— 上次已填，这次不动
- **Privacy 标签页** —— 这次没有涉及权限或数据行为的变化，不用重填
