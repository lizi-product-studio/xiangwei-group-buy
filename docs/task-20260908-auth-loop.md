# 新用户消息页登录跳转修复

- run_id / task_id：TASK-20260908-AUTH-LOOP；attempt 1；GOVERNED 客户端认证导航修复。
- confirmed：用户反馈新用户在消息页与登录页之间反复跳转；本人账号不复现。截图显示消息页未登录入口和未勾选协议的登录页。
- evidence-inferred：修复前 messages.onShow/load 每次发现未登录都会自动 navigateTo 登录；返回、重新显示或重复加载会重新推入。openLogin 与自动入口没有在途/当前页去重，快速两次调用创建两次导航。新增实际页面回归先运行，2项失败、首绑两阶段1项通过，证据 before.log。
- 边界：当前 login.onShow 没有自动返回；未勾协议、PHONE_REQUIRED、手机号拒绝不会自行完成登录。没有证据将用户所有设备表现归因于 API、抖音入口或首绑服务，修复的是已复现的客户端自动重入/重复导航路径。
- 修改：messages 未登录时仅显示原有登录按钮，主动 openLogin/授权提醒入口仍可进入；共享 navigateToCustomerLogin 增加当前登录页与在途去重，complete 或同步异常释放带唯一标识的锁，失败后允许重试。保留合法 returnUrl/intent、协议、两阶段授权、会话边界及业务写入规则。
- 回归：新用户消息入口、未勾协议零登录请求、取消返回并重复 onShow 不重跳、双击只一次、失败重试、当前登录页阻止再入、手机号拒绝不返回、两次身份code/手机号成功只返回一次。平台与外部网络为替身，实际页面/api/navigation 模块参与。
- 首轮 mini 全量132/134，2失败为旧 checkout/profile 精确参数断言缺少新增 complete 回调；仅补 expect.any(Function)，保留 URL 与业务断言。最终 mini134/134 PASS、mini typecheck、目标lint、diffcheck PASS。独立 QA attempt1 限定客户端导航修复 PASS：冻结一致，独立定向27/27及mini134/134通过。
- 全仓B候选与其尚未完成的门禁不纳入本修复验收，不改API或B文件。本轮未运行真实设备/微信渠道验证；服务端无修复依据，不部署服务器。Git同步后需重新上传/发布小程序，才能影响使用旧包的新用户。
- 本机脱敏证据：/Users/lizi/Backups/TASK-20260908-AUTH-LOOP/，含修复前失败、定向与mini全量日志及冻结清单。
