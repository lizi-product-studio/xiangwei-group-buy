# TASK-REM-P1D 消费者微信登录与“我的”页验收契约

本任务只覆盖消费者微信小程序的统一登录入口、登录意图回跳和“我的”页信息架构，不改变单一社区团购的订单、支付、履约或后台业务规则，也不包含消费者账号密码、会员、积分、优惠券、供应商、仓储或多商户能力。

## 冻结范围与文件所有权

- 前端实现者唯一写入范围：`apps/miniprogram/src/**`（页面、工具、测试和小程序配置）。
- 主线程写入范围：本验收文档、跨包测试编排和最终集成；不得修改实现者负责的源码文件，除非先重新明确边界。
- 既有后台/API/P0/P1-A/P1-B/P1-C 改动、用户未跟踪审计目录和真实环境配置均不在本任务内。
- Figma 原型尚未交付前，只实现可验证的信息层级、状态和交互契约；“我的”页以绿色固定自提点为主视觉，细节视觉以批准原型为准。

## 消费者可见范围

游客可以浏览团购、商品、购物车和自提点。以下入口在未登录或会话失效时统一进入独立微信快捷登录页，并记录来源与回跳地址：订单、结算/支付、取货码、消息、售后提交。

登录成功后回到原页面，但结算和售后等写操作只恢复页面，不自动重放原提交；用户必须再次确认。取消登录、返回或失败重试都不得丢失可恢复的来源信息，也不得制造订单或重复写入。

## 登录状态机与意图

登录页状态至少包括：

```text
IDLE -> CONSENT_REQUIRED -> AUTHENTICATING -> AUTHENTICATED
                         \-> CANCELLED
AUTHENTICATING -> FAILED (可重试) -> AUTHENTICATING
AUTHENTICATED -> EXPIRED -> CONSENT_REQUIRED
AUTHENTICATED -> LOGGED_OUT -> IDLE
```

- 只允许微信 `wx.login` code 换取会话；不新增消费者密码或手机号采集。
- 协议未勾选时在控件附近行内提示，不发起微信登录请求。
- token/会话过期时清理本地身份并回到登录页；401 重试最多恢复一次，不能循环。
- 登录来源记录 `{source, returnUrl, intentId}`，成功消费一次后清除；未知或过期意图安全回到“我的”页。
- 登录取消返回时仅写入一次性 `cancel-return suppression`，并绑定同一 `intentId + source + returnUrl`。来源或回跳地址不匹配时不得消费；匹配的受保护页首次 `onShow` 消费后停留游客态、清空敏感数据并提供“微信快捷登录”主动入口，不能再次自动打开登录页。显式入口在 intent 仍有效且来源、回跳和写动作相同的情况下复用原 `intentId`。
- auth intent 的有效期固定为 30 分钟（与支付 15 分钟独立）：`createdAt` 缺失、非法、未来或年龄 `>= 30 分钟` 时读/消费即清除 intent 与 suppression，不回放旧路由参数，也不触发支付、售后或开通意向写操作；安全回到“我的”并给出简短提示。29:59 仍有效，30:00 失效。
- `source` 与 `writeAction` 只接受本文件约定的枚举白名单：结算使用 `submit-order`，售后使用 `submit-after-sale`，开通意向使用 `submit-service-area-interest`；未知、空字符串、缺失必要字段、空存储值或非法 JSON 均按无效 intent 清除存储和 suppression。登录页取消时若无有效 intent，不得返回旧受保护页，必须清理并切到“我的”游客态。
- 退出登录原子清除 token、用户摘要、来源意图和敏感页面缓存；退出后的页面不显示上一身份数据。

## 身份边界与回跳路由注册表

- `customerAuth` 维护进程内单调 `session epoch`：登录成功建立/切换身份、显式退出和 401 `clearSession` 都递增。异步页面读取在写入 data、error、loading 或模块缓存前必须确认 epoch 未变。
- 每个受保护页面（订单、订单详情、消息、售后、结算、取货码、我的）使用独立的 `PageLoadCoordinator`；一次加载捕获 `{epoch, generation}`，并在 `onHide`/`onUnload` 使其失效。旧请求的 success/catch/finally 均静默丢弃，不能覆盖新身份、新一代加载或页面离开后的状态。订单缓存同时记录 epoch/generation，不能跨身份复用。
- 回跳地址采用与 `app.json` 同步的中央注册表，而非任意 `/pages` 字符串：`profile → /pages/profile/index`、`orders → /pages/orders/index`、`order-detail → /pages/order-detail/index?id`、`checkout → /pages/checkout/index?campaignId`、`pickup-code → /pages/pickup-code/index?orderId`、`messages → /pages/messages/index`、`after-sale → /pages/after-sale/index?orderId`、`service-area-interest → /pages/interest/index`。登录页自身、未注册页面、source/route 不匹配、缺必需参数、重复/非法编码均在保存或消费前拒绝，清除 intent/suppression 并安全切换到“我的”。
- 结算、售后和开通意向的 `writeAction` 仅用于恢复页面，不自动重新提交；回跳后必须由用户再次点击。系统不把登录页 query 当作权限依据。

## “我的”页与角色导航

“我的”页是消费者身份与固定自提点入口：已登录显示微信身份、当前区域/固定自提点、订单摘要、消息、售后和开通意向；未登录显示微信快捷登录卡和协议入口。固定自提点信息使用绿色主视觉，游客仍可先选择自提点。

订单、取货码、消息、售后提交等受保护动作在菜单和按钮层面可预见地进入登录页；API 仍做最终鉴权。loading、失败重试、空状态、取消返回、会话过期和退出均有可恢复反馈。

## 正式构建约束

- `release`/正式构建必须使用 HTTPS `wechat` 部署配置和真实微信登录；不能出现“体验登录”、demo header 或 demo customer session。
- 仅 `develop`/本地 HTTP demo 部署启用“开发体验登录”次级入口，能力由 `resolveDeployment` 产出的 `demoLoginEnabled` 与 `apiBaseUrl`/`authMode` 共同判定；不读取页面 query 或可篡改存储作为开关。`trial`、`release`、`wechat` 或 HTTPS 配置下入口不渲染，运行时调用也必须 fail-closed。
- 开发体验登录沿用协议勾选、auth intent/回跳和会话清理规则，不新增消费者账号密码、固定凭据或 token；结算、售后等写动作登录后仍需用户再次主动确认，不自动重放。
- 真实微信 AppID/AppSecret、隐私版本、JSAPI 支付与开发者工具验收依赖外部预发布环境，本地 mock 不能替代上线批准。

## 验收门禁

1. 小程序 typecheck、单测和 lint（若包内提供）通过；新增状态机/意图至少有单测。
2. 浏览器/小程序可复验：游客浏览不触发登录；受保护入口记录来源并进入登录页；同意后成功回跳；取消、失败重试、过期、退出和写操作不自动重放。
3. “我的”页在 375/768/1440 宽度下可读可操作，无页面级横向溢出；固定自提点信息和空/错误/加载状态明确。
4. release 配置静态检查拒绝 demo 登录路径；真实微信登录、支付和订阅消息仍标记为外部预发布依赖。
5. 根门禁继续执行 `pnpm check`、`pnpm test:e2e` 和 `git diff --check`；MySQL/Redis 缺少 URL 时按既有 fail-closed 契约报告 BLOCKED。
6. 异步边界定向测试覆盖：A 请求等待期间 logout 后迟到 success/error/finally 不写入；A 身份切换到 B 后仅 B 响应可见；同身份旧 generation、页面 hide/unload、缓存写入均不覆盖最新状态；29:59 有效、30:00/未来/非法时间失效；非法 source/route/参数不回跳旧页面。
