# 商店页面更新操作单

**我无法代你操作开发者后台**（那需要你的 Google 账号登录）。所以这份单子把
「点哪里、粘什么、传哪个文件」全部写死，你照着做即可，不需要做任何判断。

所有可复制的内容都在这几个文件里，直接 `Cmd + A` → `Cmd + C`：

| 要填的字段 | 从这里复制 |
| --- | --- |
| Description（英文） | [`description.en.txt`](description.en.txt) |
| Description（中文） | [`description.zh.txt`](description.zh.txt) |

---

## 一、打开后台

<https://chrome.google.com/webstore/devconsole> → 点开 ReadX 这个条目
（ID 是 `ecdjljbkaajlidofofjlopbcaigheeni`）。

进 **Store listing** 标签页。

---

## 二、更新描述（中英各一份）

### 英文

1. 页面上的语言选择器选 **English**
2. 找到 **Description** 输入框（在 Product details 里）
3. **全选清空**，然后粘贴 `description.en.txt` 的全部内容
4. 点 **Save draft**

### 中文

1. 语言选择器切到 **中文（简体）**
2. 同样的 **Description** 输入框 → 全选清空 → 粘贴 `description.zh.txt`
3. 点 **Save draft**

> **为什么要全选清空**：这两份描述相对上一版新增了「怎么开始用」和
> 「可以关掉控制条」两段，直接追加会比覆盖更容易出错。

---

## 三、换截图（中英各三张）

在同一个 Store listing 页面的 **Graphic assets** 区域。

**顺序很重要** —— 第一张是搜索结果里的封面。

### 英文（语言选 English 时）

| 顺序 | 传这个文件 |
| --- | --- |
| 1 | `../screenshots/en/01-intro.png` |
| 2 | `../screenshots/en/02-reading.png` |
| 3 | `../screenshots/en/03-settings.png` |

### 中文（语言切到中文后）

| 顺序 | 传这个文件 |
| --- | --- |
| 1 | `../screenshots/zh/01-intro.png` |
| 2 | `../screenshots/zh/02-reading.png` |
| 3 | `../screenshots/zh/03-settings.png` |

> 六张都是 **1280×800、RGB、无 alpha 通道**，符合商店要求（商店明确拒绝带
> alpha 的 PNG）。这一点已经逐个核对过。
>
> 这一版截图的主要变化：控制条右侧多了 **✕** 按钮 —— 就是新增的「关掉」出口。

---

## 四、保存并提交

1. 确认中英两份的 Description 和截图都填好了
2. 点页面底部的 **Submit for review**

> 只改 Store listing **不需要重新上传 zip**，走的是独立的审核流程，通常比
> 首次审核快很多。
>
> 如果你同时要发 `0.1.1` 的功能包，**建议先单独提交这次的 listing 更新**，
> 两件事分开走，哪一步被卡住都好定位。

---

## 五、这一步之后还没做的

| 事项 | 说明 |
| --- | --- |
| **发 0.1.1 功能包** | 控制条的修复必须发新包，已有的用户才会拿到。改 `package.json` 的 `version` → `npm run zip` → Package 标签页上传 |
| **宣传图** | 如果上次没传，`../promo-440x280.png` 和 `../marquee-1400x560.png` 也可以一并补上（可选） |

---

## 附：不用改的东西

- **名称和简短说明** —— 来自包里的 `_ext_name` / `_ext_description`，
  跟着浏览器语言自动切换，商店自己会读，不用手动填
- **Category / Language** —— 上次已填，这次不用动
- **Privacy 标签页** —— 这次没有涉及权限或数据行为的变化，不用重新填
  （等你发 0.1.1 时也不需要重填）
