# 任务清单：MacroDroid 上报宏

- [ ] T1 回到宏编辑器，打开 `HTTP 请求` 动作的 `内容正文` 标签页
- [ ] T2 填写 JSON 正文（`app_id` 用魔变文本「前台应用包名」，`app_label` 用「前台应用名称」）
- [ ] T3 保存动作并保存宏，确认宏处于启用状态
- [ ] T4 配置 MacroDroid 后台运行权限：省电策略「无限制」、自启动打开
- [ ] T5 实测：切换前台应用后，确认后端 `/api/current` 中 `my-phone` 的 `app_id` 变化且 `online: true`
- [ ] T6 失败时读取 MacroDroid 宏执行日志并修正配置
- [ ] T7（可选）同步 `frontend/src/views/GuideView.vue` 手机接入文案

验收：面板「我的手机」实时跟随前台应用变化，重启手机后仍然有效。
