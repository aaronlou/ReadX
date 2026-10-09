# ReadX Privacy Policy / 隐私政策

**Last updated / 最后更新：2026-10-09**

ReadX is a browser extension that reads your X (Twitter) timeline aloud.
ReadX 是一个把 X(Twitter)时间线朗读出来的浏览器扩展。

Contact / 联系方式：<https://github.com/aaronlou/ReadX/issues>

---

## English

### The short version

ReadX has no servers of its own. It does not collect analytics, does not track you,
and does not have an account system. **The only time any post text leaves your
device is when you deliberately turn on a cloud voice**, in which case the text
being read aloud is sent to the provider you chose so it can be turned into audio.

### What ReadX does NOT do

- No analytics, telemetry, crash reporting, or usage statistics
- No advertising, and no advertising identifiers
- No account, no sign-in, no email collection
- No selling or sharing of data with anyone
- No remote code — everything that runs is in the package you installed

### What is stored on your device

| What | Where | Synced? |
| --- | --- | --- |
| Preferences (speed, volume, voice, reading language, toggles) | `chrome.storage.sync` | **Yes** — Chrome syncs these across your signed-in devices via Google |
| Cloud voice API keys | `chrome.storage.local` | **No** — never leaves this device, except as an `Authorization` header to the provider you selected |
| Cached audio clips | Memory only | Never written to disk; cleared when the tab closes |

ReadX has no way to read these back out; they exist only so the extension
remembers your choices.

### What leaves your device, and only when you ask for it

**Reading aloud with the system voice (default).** ReadX hands the text to your
browser's built-in speech synthesis. Depending on which voice is installed,
your browser or operating system may process that text locally or on the
vendor's servers. ReadX itself does not transmit it. See your browser's and
operating system's own privacy policies.

**Translating (optional).** If you pick a reading language, foreign posts are
translated using Chrome's built-in on-device Translator API. The text is
processed **locally on your machine** and is not sent to ReadX or to any third
party.

**Reading aloud with a cloud voice (optional, off by default).** If — and only
if — you go to Settings, enable a cloud voice provider, and grant that
provider's domain permission, the text of each post being read is sent to that
provider to be synthesized into audio:

| Provider | Domain | Their privacy policy |
| --- | --- | --- |
| OpenRouter | `openrouter.ai` | <https://openrouter.ai/privacy> |
| OpenAI | `api.openai.com` | <https://openai.com/policies/privacy-policy> |
| Doubao (ByteDance / Volcengine) | `openspeech.bytedance.com` | <https://www.volcengine.com/docs/6256/64902> |

Your API key for that provider is sent in the request header for authentication.
Nothing else about you is sent. To stop this entirely, switch back to the
system voice — then nothing leaves your machine.

### Permissions and why they exist

| Permission | Why |
| --- | --- |
| `storage` | Remember your preferences and (locally) your API keys |
| `x.com`, `twitter.com` | Show the reading bar on X and read the post text you asked to hear |
| Optional provider domains | Requested **only** when you enable that cloud voice provider. A fresh install touches no third-party domain. |

### Children's privacy

ReadX is not directed at children and collects no personal information from anyone.

### Changes

Any change to this policy will be published in this file in the
[ReadX repository](https://github.com/aaronlou/ReadX), with the date above updated.

---

## 中文

### 一句话版本

ReadX **没有自己的服务器**。它不收集统计、不追踪你、也没有账号体系。
**唯一会让帖子文本离开你设备的时刻，是你主动开启云语音** —— 那时被朗读的
文本会发给你选择的服务商，用来合成音频。

### ReadX 不会做的事

- 不做统计、不上报遥测、不收集崩溃日志或使用数据
- 没有广告，也不使用广告标识符
- 没有账号、不需要登录、不收集邮箱
- 不向任何人出售或共享数据
- 没有远程代码 —— 运行的一切都在你安装的这个包里

### 存在你本机的东西

| 内容 | 位置 | 是否同步 |
| --- | --- | --- |
| 偏好设置（语速、音量、音色、朗读语言、开关） | `chrome.storage.sync` | **会** —— Chrome 会通过 Google 在你登录的设备间同步 |
| 云语音的 API Key | `chrome.storage.local` | **不会** —— 除了作为 `Authorization` 请求头发给你选定的服务商，绝不离开本机 |
| 缓存的音频 | 仅内存 | 不落盘；关闭标签页即清空 |

ReadX 没有能力把这些读出去，它们存在的唯一目的是记住你的选择。

### 什么会离开你的设备，且仅在你主动要求时

**用系统语音朗读（默认）。** ReadX 把文本交给浏览器内置的语音合成。
取决于你装了哪个语音包，浏览器或操作系统可能在本地处理，也可能在厂商的
服务器上处理。ReadX 自身不传输这些文本，具体请见浏览器与操作系统的隐私政策。

**翻译（可选）。** 如果你指定了朗读语言，其他语言的帖子会用 Chrome 内置的
**设备端**翻译模型处理 —— **完全在你本机完成**，不会发给 ReadX 或任何第三方。

**用云语音朗读（可选，默认关闭）。** 只有当你主动去设置页启用某家云语音
服务商、并授予该域名权限之后，被朗读的帖子文本才会发给该服务商合成音频：

| 服务商 | 域名 |
| --- | --- |
| OpenRouter | `openrouter.ai` |
| OpenAI | `api.openai.com` |
| 豆包（字节跳动 / 火山引擎） | `openspeech.bytedance.com` |

请求头里会带上你为该服务商填的 API Key 用于鉴权，除此之外不发送任何与你有关的信息。
想完全停止，切回「系统语音」即可 —— 那样什么都不会离开你的机器。

### 权限用途

| 权限 | 为什么需要 |
| --- | --- |
| `storage` | 记住你的偏好设置，以及（只存在本机的）API Key |
| `x.com`、`twitter.com` | 在 X 上显示朗读控制条，并读取你要求朗读的帖子正文 |
| 可选的服务商域名 | **只在你启用某家云语音时**才申请。全新安装不碰任何第三方域名 |

### 未成年人

ReadX 不面向未成年人，也不向任何人收集个人信息。

### 变更

本政策的任何改动都会发布在 [ReadX 仓库](https://github.com/aaronlou/ReadX)
的这个文件里，并更新上方的日期。
