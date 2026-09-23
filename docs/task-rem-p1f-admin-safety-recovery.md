# TASK-REM-P1F：后台人员安全、测试数据修复与小程序错误恢复

状态：IMPLEMENTATION（等待独立代码审核）
路由：existing-iteration + software + 重大任务
唯一集成负责人：Engineering Lead（当前任务）
独立审查：代码审核任务 `01a031d5-1997-79d3-8f22-74251d344691`

## 权威输入与约束

- 业务与上线基线：`README.md`、`docs/PRD.md`、`docs/architecture.md`、`docs/go-live-checklist.md`。
- 现有认证契约：`docs/task-rem-p1a-acceptance.md`、`docs/task-rem-p1d-mini-auth.md`、`docs/checklists/admin-password-migration.md`。
- 只保留单一社区团购；不引入旧模式、消费者密码体系、供应商/仓储/多商户逻辑。
- 不输出、写入、提交或部署任何密码、Token、AppSecret、数据库连接串或其他密钥。
- 本轮不处理支付、订单、配送业务规则；小程序只新增公共错误恢复，不改变认证、intent、session epoch、page/action fence 或写操作不自动重放契约。

## 当前事实

- 代码基线为 `f851781`；工作树另有用户未提交的本地流程文件改动。
- 服务器身份以当前 `AGENTS.md` 第 3.1 节为准；本历史任务不再提供服务器地址判定。此前的字符修复需核实目标与备份后按独立授权执行。
- 后台目前把“系统设置”作为导航/标题的一部分，顶栏有裸“修改密码/退出”动作；需在不改变权限的前提下统一为“人员与权限”和账号菜单。
- 小程序公共请求层与多个页面仍会显示底层 `request:fail`/HTTP 技术文案，部分页面把失败渲染为空或没有重试。

## 文件所有权

实现阶段每个共享文件只允许一个写入者；集成负责人负责冲突裁决和最终测试。

1. **后台 API/认证写入者**
   - 负责：`apps/api/src/modules/auth/**`、相关 `apps/api/src/routes/**`、认证/员工测试。
   - 目标：自停用/自发临时密码双重拒绝；临时密码一次显示且日志不落明文；bootstrap 输入校验；员工身份/角色/版本重校验。
2. **后台 Web 写入者**
   - 负责：`apps/admin-web/src/App.tsx`、`apps/admin-web/src/api.ts`、`apps/admin-web/src/navigation.ts`、相关测试与样式。
   - 目标：人员与权限导航、账号菜单、当前账号标记、员工重置确认/一次性凭据复制、可恢复错误态。
3. **小程序公共错误恢复写入者**
   - 负责：`apps/miniprogram/src/utils/api.ts`、受影响页面 `src/pages/**` 及对应测试；不得修改认证契约或业务 API。
   - 目标：错误映射、重试/loading/empty/error/success 状态、特殊页面缺失的重试和恢复。
4. **服务器数据修复（本任务未执行）**
   - 针对 `admin` staff 的字符修复需先核实目标、备份和授权，再由运维以显式 `utf8mb4` 连接执行并验证回滚；不保存或输出凭据。

## 必须完成

- 后台人员与权限导航、账号菜单和当前账号识别。
- 当前账号不能停用自己或发放自己的临时密码；唯一超管不能自锁；服务端在事务写入时再次校验。
- 他人重置命名为“发放新临时密码”，原因、影响、二次确认、一次性展示/复制、下次强制改密和旧会话失效完整闭环。
- bootstrap displayName 拒绝纯问号、控制字符和明显乱码。
- 小程序网络不可达、超时、4xx/5xx、401、业务冲突统一为安全中文；开发环境可提示本地服务启动命令，正式环境不泄露技术细节。
- 首页、自提点选择、团期详情、结算、订单列表/详情、消息、我的、取货码、售后、开通意向逐一覆盖 loading/error/empty/success/retry，禁止失败伪装空数据。
- 保留 P1D 的 intent TTL、取消 suppression、身份 epoch、PageLoad/PageAction coordinator、401/logout 清理及写操作不自动重放。

## 明确不做

- 不新增消费者账号密码、短信、注册、找回密码或账号合并。
- 不改变后台角色集合、支付/订单/配送状态机、生产配置或公网开发环境指向。
- 不修改其他测试人员、手机号、角色、点位、订单、商品或演示种子。
- 不部署生产、不操作真实微信/支付、不提交用户脏文件。

## Given / When / Then 验收

### 后台账号安全

- Given 当前登录员工，When 尝试停用自己或给自己发临时密码，Then API 与 UI 均拒绝，数据、会话和审计不产生成功写入。
- Given 超级管理员为其他员工发放临时密码，When 完成原因确认，Then 只返回一次临时密码；旧密码/会话失效；目标下次登录必须改密；日志和审计不含明文。
- Given bootstrap 输入为纯问号、控制字符或乱码，When 执行校验，Then fail-closed 且不写入员工记录。

### 小程序错误恢复

- Given 受影响页面请求失败，When 页面渲染，Then 只显示业务中文错误与重试，不出现 `request:fail`、原始 URL、HTTP 技术状态或 SDK 文案。
- Given 首次请求失败、第二次成功，When 用户点击重试，Then 真实发起新请求，显示 loading，成功后清除旧错误并展示数据。
- Given 401 或切换身份，When 旧请求迟到，Then 不写入新身份页面、缓存、表单或错误状态。

### 服务器数据（当前阻断）

- Given 用户重新授权且运维确认目标环境非生产或已批准变更，When 执行修复，Then 仅该记录 displayName 变为“系统管理员”，角色/手机号/授权/凭据不变；页面和 API 不再显示问号；备份可用于回滚。当前不具备该授权，故不计本地任务通过。

## 门禁与证据

- `pnpm check`
- `pnpm test:e2e`
- 后台 auth/staff/API 定向测试、小程序 utils/pages 定向测试
- `git diff --check`
- 高置信度敏感信息扫描（不得包含密码/Token/连接串）
- 独立代码审核任务只读复核后才可标记 ready。

真实 MySQL/Redis/微信仍按现有门禁和上线清单单列；缺少凭据或 URL 时不得把 skip 记为 PASS。
