# 规格：用 adb 在手机上创建 MacroDroid 上报宏

## 背景

用户要求「只要前台应用改变就上传前台改变的应用」，并且明确表示要我用 USB 调试（adb）+ 图形化操作，直接在手机上创建宏，而不是导入 `.macro` 文件。

目标设备：一台 Android 13 手机（分辨率 1080×2340）。
adb 路径：`<Android SDK>\platform-tools\adb.exe`。

## 目标结果

手机上一个名为 `LiveTracker` 的 MacroDroid 宏，满足：

- 触发器：`应用程序打开/关闭` → `应用程序打开` → 选择应用程序 = `所有应用程序`
- 动作：`网络互动 → HTTP 请求`
  - 方法：`POST`
  - URL：`https://api.example.com/api/report?token=<设备令牌>`
  - 内容类型：`application/json`
  - 正文：`{"app_id":"<前台应用包名>","app_label":"<前台应用名称>"}`（用 MacroDroid 魔变文本取值）
- 宏处于启用状态，且重启后仍生效（MacroDroid 需后台运行 + 自启动权限）

后端已支持明文 JSON 上报（`decryptEnvelope` 对 `enc !== 1` 的请求原样返回），因此手机侧不需要加密，HTTPS 即可。

## 已完成步骤（无需重复）

1. 新建宏，名称 `LiveTracker`
2. 触发器：所有应用程序 / 应用程序打开
3. 动作 `网络互动 → HTTP 请求`，方法已改为 `POST`
4. URL 已填入（含设备令牌 `my-phone`）
5. 内容类型已选择 `application/json`
6. 已开启 MacroDroid 无障碍服务（已通过 `settings get secure enabled_accessibility_services` 验证包含 `com.arlosoft.macrodroid/...MacroDroidAccessibilityServiceJellyBean`）
7. MiUI 风险提示已确认

## 剩余步骤（执行计划）

1. 回到 MacroDroid 宏编辑器 → HTTP 请求动作 → `内容正文` 标签页
2. 在正文文本框输入 `{"app_id":"` + 魔变文本「前台应用包名」+ `","app_label":"` + 魔变文本「前台应用名称」+ `"}`
   - 魔变文本通过字段右侧 `...` 按钮插入，可保证占位符语法正确
   - 若插入后得到的是普通文本占位符（如 `{fg_package}`），直接手动补全其余 JSON 字符
3. 点右上角 ✔ 保存动作，返回宏编辑器，再保存宏
4. 授权后台运行：应用信息 → 省电策略 = 无限制；自启动开关打开
5. 验证：切换到另一个应用（`am start` 打开系统设置或浏览器），等待数秒后查询后端
   - `curl https://api.example.com/api/current`（或直接在电脑上访问面板），确认 `my-phone` 的 `app_id` 变成刚切换的应用，`online: true`
6. 若上报失败：查看 MacroDroid 宏执行日志（宏详情页的历史记录），按错误处理
7. 可选：把 `frontend/src/views/GuideView.vue` 里手机接入说明同步为这套实际配置（宏名、URL 形式）

## 约束与已验证事实

- 后端 `/api/report` 接受 `token` 查询参数作为鉴权（`authenticate()` 中 `url.searchParams.get('token')`）
- `my-phone` 令牌：`<设备令牌>`（在管理面板「设备管理」里复制）
- 后端域名：`api.example.com`（HTTPS）
- MacroDroid 魔变文本候选项包含：应用程序名称、应用程序包、前台应用名称、前台应用包名
- 全程只操作手机 UI，不修改后端代码

## 验证标准

- 面板上「我的手机」显示 `online: true` 且 `app_id` 随前台应用切换而变化
- MacroDroid 宏 `LiveTracker` 已启用且在设备重启后仍可工作（后台运行 + 自启动已配置）
