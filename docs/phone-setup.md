# 手机端配置说明（MacroDroid）

本文是「视监面板」手机端的完整配置步骤。照着做，面板上就能实时看到手机当前应用、电量、充电状态，并且**息屏期间不计入使用时长**。

> 手机端不需要安装额外 App，只用 [MacroDroid](https://www.macrodroid.com/) 免费版（免费版最多 5 个宏，这里只需要 3 个）。

---

## 一、准备工作

1. 在面板「管理面板 → 设备管理」里找到手机设备（例如 `my-phone`），复制它的**设备令牌**。
2. 确认后端地址可访问，例如 `https://api.example.com`。
3. 手机安装 MacroDroid，并授予基础权限（见第五节）。

最终会建 3 个宏：

| 宏 | 作用 | 触发器 |
|---|---|---|
| `LiveTracker` | 上报当前应用、电量、充电状态 | 应用启动/切换 + 每 1 分钟定时器 |
| `ScreenOff` | 告诉面板手机息屏了 | 屏幕关闭 |
| `ScreenOn` | 告诉面板手机亮屏了 | 屏幕开启 |

先建 `LiveTracker`，再建两个屏幕宏。**第一次上报必须先有应用信息**，否则服务端没有可沿用的应用。

---

## 二、宏 A：`LiveTracker`（应用 + 电量 + 充电）

### 1. 新建宏

MacroDroid → 新建宏 → 名称填 `LiveTracker`。

### 2. 触发器 1：应用启动/切换

- 触发器 → 应用程序 → **应用启动/切换**（Application Launched / App Changed）
- 选择应用 → **所有应用程序**（或只勾选你常用的应用）

### 3. 触发器 2：定时器

- 触发器 → 日期/时间 → **定时器**
- 间隔设为 **1 分钟**，重复

定时器是为了避免长时间停留在同一个应用时面板不刷新。

### 4. 动作：HTTP 请求

- 动作 → 网络互动 → **HTTP 请求**（HTTP Request）
- 方法：`POST`
- URL：`https://api.example.com/api/report`（换成你自己的域名）
- 内容类型：`application/json`
- 请求头（Headers）添加一行：
  - 名称：`Authorization`
  - 值：`Bearer <手机令牌>`

> 如果 MacroDroid 版本找不到自定义请求头，可以把令牌放到 URL 上：
> `https://api.example.com/api/report?token=<手机令牌>`，效果一样。

### 5. 内容正文（请求体）

在「内容正文 / Body」里填：

```json
{
  "app_id": "{app_package}",
  "app_label": "{app_name}",
  "battery_percent": {battery},
  "battery_charging": {power},
  "window_title": "{window_title}"
}
```

这些占位符是 MacroDroid 的**魔变文本**，不要手打。做法：把光标放到要插入的位置，点输入框右侧的「…」按钮，从列表里插入：

| 字段 | 从列表选择 |
|---|---|
| `app_id` | 前台应用包名 |
| `app_label` | 前台应用名称 |
| `battery_percent` | 电池电量 |
| `battery_charging` | 充电状态（Power on/off） |
| `window_title` | 窗口标题（没有就整行删掉） |

不同 MacroDroid 版本占位符名字可能不同，以「…」列表插入的结果为准。没有的字段整行删掉即可，其余照常工作。

### 6. 保存并启用

点右上角 ✔ 保存动作，再保存宏，确认宏处于**启用**状态。

> **不要在 `LiveTracker` 里写 `screen_on`**。它的定时器每分钟都会执行，如果写死 `screen_on: true`，会把息屏状态每分钟改回亮屏，导致息屏计时失效。屏幕状态交给下面两个独立宏。

---

## 三、宏 B：`ScreenOff`（息屏）

1. 新建宏，名称 `ScreenOff`。
2. 触发器 → **屏幕开/关**（Screen On/Off），选项选 **屏幕关闭**。
3. 动作 → 网络互动 → **HTTP 请求**：
   - 方法：`POST`
   - URL：`https://api.example.com/api/report`
   - 内容类型：`application/json`
   - 请求头：`Authorization: Bearer <手机令牌>`（或令牌放 URL）
   - 内容正文：

```json
{"screen_on": false}
```

4. 保存并启用。

---

## 四、宏 C：`ScreenOn`（亮屏）

和 `ScreenOff` 一样，只改两处：

- 触发器选 **屏幕开启**
- 内容正文：

```json
{"screen_on": true}
```

保存并启用。

这两个宏的请求体**不需要** `app_id`：服务端会自动沿用这台手机上一次的应用和电量。第一次使用前请确保 `LiveTracker` 已经成功上报过。

---

## 五、手机权限设置（很关键）

MacroDroid 被系统杀掉后，宏就不会执行。请逐项确认：

### 通用

- MacroDroid 需要 **使用情况访问权限**（Usage Access），应用启动/切换触发器依赖它：设置 → 应用 → 特殊权限 → 使用情况访问 → 允许 MacroDroid。
- 允许通知（前台服务常驻通知可以降低被杀概率）。

### 小米 / MIUI / HyperOS

- 设置 → 应用设置 → 应用管理 → MacroDroid：
  - 省电策略 → **无限制**
  - 自启动 → **允许**
  - 后台弹出界面 → **允许**
- 最近任务列表里把 MacroDroid **锁定**（下拉加锁），避免一键清理时被杀。

### 其他品牌

- 华为/荣耀：应用启动管理 → 手动管理，允许自启动、关联启动、后台活动。
- OPPO/一加/realme：允许自启动、允许后台运行，省电策略不优化。
- vivo：后台高耗电允许，自启动允许。
- 三星：电池 → 不受限制；关闭「休眠应用」。

---

## 六、验证是否配置成功

### 1. 面板查看

- 打开面板首页，手机设备卡片应显示当前应用、电量百分比；充电时显示「⚡ 充电中」。
- 在手机上切换应用，约 1 分钟内面板应更新。
- 手机息屏后：
  - 顶部主卡片显示「息屏中」；
  - 今日时间线上出现灰色「息屏」段；
  - 今日总时长不再增长（息屏时段不计时）。
- 手机亮屏后，主卡片恢复显示「正在 xxx」。

### 2. 用 curl 测接口

在电脑上执行（换成你的域名和令牌）：

```bash
curl -X POST "https://api.example.com/api/report" \
  -H "Authorization: Bearer <手机令牌>" \
  -H "Content-Type: application/json" \
  -d '{"app_id":"com.android.settings","app_label":"设置","battery_percent":66,"battery_charging":true}'
```

再查当前状态：

```bash
curl "https://api.example.com/api/current"
```

能看到对应设备 `online: true`、`app_name`、`extra.battery_percent` 即表示后端正常。

### 3. 查看 MacroDroid 执行日志

MacroDroid → 宏详情 → 历史记录。如果宏触发但请求失败，会显示 HTTP 错误码或网络错误。

---

## 七、字段说明

`POST /api/report` 支持以下字段（除 `app_id` 外都可选）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `app_id` | string | 应用包名；只上报屏幕状态时可省略（服务端沿用上一次） |
| `app_label` | string | 应用显示名；缺省时服务端按内置映射/包名显示 |
| `battery_percent` | number | 电量 0–100 |
| `battery_charging` | boolean | 是否在充电；`{power}` 的 on/off 会自动解析 |
| `screen_on` | boolean | 屏幕是否亮着；`false` 表示息屏，该时段不计入时长 |
| `window_title` | string | 窗口标题（聊天/银行等私密应用会被服务端过滤） |
| `timestamp` | ISO 时间 | 可选；不传则用服务端当前时间 |

---

## 八、常见问题

**面板不显示电量 / 充电状态**

- `LiveTracker` 的请求体里没有 `battery_percent` / `battery_charging`，或占位符是手打的、没有被替换。
- 用「…」重新插入「电池电量」「充电状态（Power on/off）」，保存宏后等一次定时器触发。
- 个别机型/版本没有充电状态魔变文本，删掉该行即可，电量仍会显示。

**息屏后总时长还在涨**

- `ScreenOff` 宏没有启用，或 URL / 令牌写错（MacroDroid 历史记录里看请求结果）。
- `LiveTracker` 的请求体里写了 `screen_on`，定时器把状态改回亮屏了。删掉这一行。
- 手机把 MacroDroid 杀了，屏幕关闭触发器没有执行。按第五节检查后台权限。

**亮屏后一直显示「息屏中」**

- `ScreenOn` 宏没有启用或没有触发成功。
- 检查它的 URL / 令牌是否和 `ScreenOff` 一致。
- 如果刚配置好，先在手机上亮屏一次，或切换一次应用。

**应用名显示成包名**

- `app_label` 没有填或魔变文本无效。重新插入「前台应用名称」。

**接口返回 401**

- 令牌错误或设备被删除/重置。回管理面板重新复制令牌。

**接口请求失败 / 超时**

- 域名必须是 HTTPS（MacroDroid 走明文 JSON，公网必须用 HTTPS）。
- 手机网络是否正常；服务器后端是否在运行。
- 请求体必须是合法 JSON（引号、逗号、大括号）。

**时间线有空白段**

- 手机长时间没有上报（被杀、断网、定时器未启用）。服务端对超长空档只按 1 分钟估算，不会虚增时长。

---

## 九、隐私说明

- 上报内容是明文 JSON，**公网部署必须使用 HTTPS**。
- 聊天、邮件、银行等私密应用的 `window_title` 会被服务端自动过滤，不会写入数据库。
- 截图、指令下发等功能需要额外配置，和本文的手机上报宏互不影响。
