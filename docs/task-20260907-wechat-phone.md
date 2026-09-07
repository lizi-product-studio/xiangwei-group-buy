# 首次微信登录绑定手机号

- task_id: `TASK-20260907-WECHAT-PHONE`；本轮为认证与个人信息变更，执行完整检查与独立审核。
- confirmed：用户要求补上首次登录授权并绑定手机号，已绑定用户后续直接登录。
- confirmed：保留微信 openId/userId 作为身份和订单归属，不根据手机号合并账号，不修改现有订单或员工登录。
- evidence-inferred：用户存储为 MySQL 聚合 JSON，可追加可选验证手机号字段；不修改基线 SQL，不需要 SQL 迁移，旧对象按未绑定处理。

## 冻结接口与交互

1. 复用 `POST /api/v1/auth/wechat/login`，请求保留 `code`、`privacyAccepted`、`privacyVersion`，追加可选 `phoneCode`。两类 code 不混用。
2. 未绑定且没有 phoneCode，返回 `{ phoneRequired: true }`，不创建普通会话、不写隐私同意或新用户。
3. 小程序展示真实 getPhoneNumber 授权按钮。用户授权后重新获取 wx.login 身份 code，连同 phoneCode 提交；拒绝则停留未登录状态，可重试或返回浏览。
4. 后端只接受微信服务端兑换手机号，必须传入身份兑换所得 openId，使用微信接口的 openid/code 绑定关系校验；不接受客户端指定 openId。校验中国大陆号码（countryCode=86）、应用归属和时效；事务内重新核对用户、保存验证信息与新版隐私同意，再签发普通会话。成功响应 `{ phoneRequired: false, accessToken, expiresAt, userId }`。
5. 已绑定用户直接签发会话，不再次兑换或覆盖手机号。网络响应丢失可重新进行身份登录。手机号不设身份唯一约束。
6. 旧消费者会话需通过手机号验证资格及当前隐私版本校验，未满足时重新进入登录补绑；员工身份认证不变。前端升级隐私版本并防止迟到响应恢复已退出会话。
7. 新隐私版本 `2026-09-07-phone-v1`。说明用户主动授权手机号用于账号绑定、订单联系、取货及售后，不宣称未获取手机号；不扩展营销用途。拒绝可返回浏览。

## 所有权与验证

- 后端负责人 payment_repair：apps/api、packages/api-contracts、必要相关配置样例；不得写小程序文件。
- 小程序负责人 login_ui：小程序登录/API状态/隐私说明及相关测试；不得改 project.config.json 用户配置。
- root：本记录、接口裁决、官方资料核对、集成与交付协调。
- auth_review：只读设计与独立验收。
- 发布运维：仅收到已验收发布包后按当前授权准备备份、同步隐私版本、发布并核对；不购买资源包、不修改微信密钥、不上传或发布小程序。
- 必须覆盖：首次/已绑定/拒绝/过期/失败/错误应用/重放/并发/旧会话/登录响应迟到/内部账号不受影响；pnpm check、全量 E2E、可用数据库集成检查与独立审核。
- 本地模拟不代替用户实际微信手机号授权；平台能力和额度由真实平台状态决定，不伪造手机号或自动降级放行。

## 官方资料与外部边界

- 微信手机号组件：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html
- 服务端兑换：https://developers.weixin.qq.com/miniprogram/dev/server/API/user-info/phone-number/api_getphonenumber.html
- 稳定访问令牌：https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getstableaccesstoken.html
- 已读取官方页面：手机号 code 五分钟一次性，与 wx.login code 不同；稳定 token 与旧 token 接口隔离，普通模式 force_refresh=false 不主动作废其他 token。新 provider 采用稳定 token，避免改动订阅消息链路。
- 当前服务端官方文档明确提供可选 openid：填入后校验 openid 与 code 绑定关系，不匹配时报错。本实现必须传入，替代早期只凭两个 code 同请求关联的设计假设。
- 新手机号字段只追加。回滚代码不回滚业务库；旧代码允许未绑定登录，安全语义会回退，发布前需记录该限制，不能声称等价安全回滚。
- 状态：实施中。尚未发布 API 或完成真实手机号授权验收。

## 本地验收（2026-09-07）

- 后端与小程序实施完成；后端15文件定向39项、contracts专项及小程序127项通过。独立审核后端30项、小程序32项与错身份/同号码不合并探针通过，无 OPEN P0/P1。
- 完整产品 typecheck、build 与412项测试通过；MySQL/Redis 8项因本机无测试服务而跳过，未使用生产库执行测试。历史JSON读取及新字段往返有本地测试，但不等同真实MySQL并发验证。
- 原始 `pnpm check` 在 lint 阶段失败：21项均来自未跟踪的 `prototypes/ui-redesign-20260907/app.js`、`verify.cjs`。保留原型、原日志与仓库规则，仅本轮 eslint 命令参数排除 prototypes/** 后，全产品 lint 通过，再执行原有全 typecheck/test/build；不宣称原始命令通过。
- 全量E2E首轮13/14，唯一失败为意向登记测试仍提交旧隐私版本；仅更新其版本数据，原201及业务断言保留。重跑14/14通过。
- 证据：`/tmp/wechat-phone-full-check.log`、`/tmp/wechat-phone-product-lint.log`、`/tmp/wechat-phone-full-typecheck.log`、`/tmp/wechat-phone-full-test.log`、`/tmp/wechat-phone-full-build.log`、`/tmp/wechat-phone-full-e2e.log`、`/tmp/wechat-phone-full-e2e-final.log`。
- 微信平台页面自动化访问被工具URL规则阻止，已停止该页面操作。已向用户询问能力与额度，尚未收到结果；不代购、不伪造手机号。真实微信点击授权及成功绑定仍 NOT_RUN；这属于后续外部验收，不能由本地mock替代。
- 发布包只更新API与隐私版本，原admin静态/Nginx无需变更。小程序实际本地src已更新，未上传微信。发布后须核服务版本，并由用户完成真实首次授权、保持登录和第二次免重复授权验证。
