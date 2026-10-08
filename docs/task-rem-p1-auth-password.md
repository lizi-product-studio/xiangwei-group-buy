# TASK-REM-P1｜后台账号密码认证（脱敏任务契约）

## 状态

- 路由：`existing-iteration` / `software` / `重大任务`
- 负责人：Engineering Lead（单一源码写入者）
- 审查：现有独立代码审核/QA 线程只读复核
- 真实服务器凭据：仅由产品线程在受控环境处理；本文件、代码、测试、日志和提交信息不得包含真实密码、Token 或密钥

## 目标与范围

后台员工统一使用“账号 + 密码”登录。SUPER_ADMIN 在员工管理中创建账号或重置临时密码；员工首次使用临时密码登录后，进入受限的强制改密步骤。个人改密、超管重置、退出、会话过期、停用、角色/点位变更、普通 API 频控和审计保持可追溯。2026-10-08 用户决定取消共享员工登录的输错冷却：运营后台与点位工作台连续输入错误密码后仍可立即重试，登录表单不显示倒计时或因此禁用；旧 Redis 登录错误计数不再参与认证。

本任务删除“首次激活”产品入口、请求方法和公共接口。迁移 `0003_admin_password_lifecycle.sql` 对历史输入 `PENDING_ACTIVATION` 做一次性、幂等的真实 backfill 为 `PASSWORD_SETUP_REQUIRED`，停用旧 activation credential 和旧会话但保留员工、角色、点位绑定；该字符串仅在历史迁移输入兼容边界内保留，运行时公共状态不再接受或展示它。异常时依赖迁移事务和备份回滚，不执行清库。运行时不再把旧状态伪装成新状态。

## 状态与错误契约

| 场景 | 机器码 | HTTP | 处理 |
| --- | --- | ---: | --- |
| 普通登录账号/密码错误 | `INVALID_CREDENTIALS` | 401 | 显示“账号或密码不正确”，可立即重试 |
| 账号停用或受管状态不可用 | `ACCOUNT_DISABLED` | 403 | 显示账号不可用及恢复路径 |
| 临时密码首次登录 | `CHANGE_PASSWORD` | 200 | 返回单用途短期 passwordChangeToken，不创建完整 bearer 会话 |
| 受保护请求会话失效 | `AUTH_REQUIRED` | 401 | 清理本地会话并回到登录 |
| 普通 API 频控 | `RATE_LIMITED` | 429 | 返回 Retry-After 并显示可恢复提示；员工登录不计入该限流 |

所有密码验证使用恒定时间比较；密码明文只存在于请求处理生命周期，不写审计、日志、响应或仓库。

## 权限与会话

- 生产 bearer 认证必须对应 `ACTIVE` 的 `InternalStaff`，credential 的角色与 `authorizationVersion` 必须一致；无员工的 legacy credential 一律拒绝登录、认证和敏感写。
- 角色、点位范围、状态、凭据重置/改密等授权变化在同一事务生成唯一新版本，同时更新员工、credential、角色/点位投影，撤销该员工旧会话并写审计。
- 仅修改显示名/手机号且规范化后无权限差异时，不递增版本、不撤销会话。
- 强制改密成功后才发放新的普通 bearer 会话；旧会话继续按版本校验失效。

## API 变化

- 删除 `/api/v1/auth/admin/activate` 及前端 `activateStaff`（发布后 404）。
- 新增 `POST /api/v1/auth/admin/complete-password-change`，body 仅含 `passwordChangeToken` 与 `newPassword`。
- 新增受保护的 `POST /api/v1/admin/me/change-password`；两条改密路径共用同一密码校验、版本撤销和审计逻辑。
- 超管重置使用 `POST /api/v1/admin/staff/:staffId/reset-password`，响应中的 `temporaryPassword` 只返回一次。
- 创建/重置响应中的临时密码只返回一次，随后不可查询；字段命名为 `temporaryPassword`，不得称为“一次性初始凭据”。

## 验收标准

1. 普通登录成功；错误密码 401 文案稳定；停用 403；临时密码正确时登录返回 200 + `nextAction=CHANGE_PASSWORD`，改密后可用新密码访问受保护接口。
2. 超管创建/重置临时密码只显示一次；重置后旧会话 401；挑战过期、并发消费和重复改密按明确状态拒绝且幂等。
3. 退出、401、角色/点位/状态变更清理会话；敏感写在事务内重新校验当前员工与版本。
4. legacy 无 `InternalStaff` 的凭据在 login/authenticate/敏感写均被拒绝；受管且 ACTIVE 的 bootstrap 正常工作。
5. 运营后台和点位工作台均验证连续输错后立即使用正确密码登录；普通 API 超限仍返回 429。临时密码强制改密、账号停用、角色权限与会话撤销校验保留。
6. API、管理端定向测试、Playwright、`pnpm check`、`pnpm test:e2e` 和 `git diff --check` 通过；真实 MySQL/Redis/线上凭据仍单独标记 BLOCKED。
