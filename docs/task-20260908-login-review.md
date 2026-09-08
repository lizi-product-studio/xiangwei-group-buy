# 登录页审核文案修正

- run_id / task_id：TASK-20260908-LOGIN-REVIEW；attempt 1；QUICK_PATCH。
- confirmed：用户提供审核拒绝原因并要求尽快修复。范围为登录前置页面去除易混淆官方身份的图标与文案，不改真实登录和手机号授权协议。
- 登录页移除两个 wechat-white 图标引用；初始与手机号授权按钮改为“手机号快捷登录”，去除微信身份宣传和登录错误回退中的微信字样。
- 售后、订单、消息、订单详情、取货码的未登录入口同步使用“手机号快捷登录”。保留重新登录、处理中反馈、协议同意、wx.login 与 getPhoneNumber 流程。
- index.json 标题原为“登录”，无需修改。project.config.json 的 miniprogramRoot 为 src/；编译检查为 noEmit，无额外生成产物需要更新。
- 验证：登录页面13项及手机号登录接口6项，共19/19 PASS；mini typecheck、git diff --check PASS。仅局部图标/文案修正，root范围核对，不启动B容量候选的完整验收。
- 本轮仅Git同步，不部署服务器、不上传小程序、不操作微信审核渠道。用户需使用更新代码上传并重新提交审核；不能以本地检查保证审核通过。
- B候选交接状态仍以 docs/handoff-20260908-readiness.md 为准，本轮不修改B。
