# 运营后台可操作性整改证据（2026-09-02）

## 本地门禁

- `pnpm --filter @hometown/admin-web typecheck`：通过。
- `pnpm --filter @hometown/admin-web test`：通过，11 个文件 / 62 项；包含畸形角色数组 fail-closed 回归。
- `pnpm --filter @hometown/api typecheck`：通过。
- `pnpm --filter @hometown/api test`：通过，79 项；包含未完成订单阻止停用自提点回归。真实 MySQL/Redis 集成 7 项因未提供连接 URL 按 fail-closed 跳过，未计入通过。
- `pnpm --filter @hometown/miniprogram test`：通过，21 个文件 / 88 项；无字段 JSON POST、结算两类失败路径与原订单继续支付回归通过。
- `pnpm check`：通过（lint、全工作区类型、测试、生产构建）。
- `pnpm test:e2e`：通过，Playwright 11/11；社区主线用例另以 `--repeat-each=3` 重复通过（3/3），含配送错误态/空态、分类驱动商品创建、到货数量守恒、治理与权限回归。
- `git diff --check`：通过。

## 代码证据

- `apps/admin-web/src/api.ts` 与 `logistics-ui.ts` 将网络失败、401/403/404/409/5xx、校验详情和已知业务冲突转为中文可恢复提示；网络请求失败保留表单草稿。
- `apps/admin-web/src/App.tsx` 的根级 reload 使用 identity epoch 与 reload generation；按资源 `allSettled` 提交，单个财务/售后读取失败不会覆盖已成功读取的账本或退款事实；页面提供 loading/error/重试与空态引导。
- 分类主数据在 `packages/api-contracts/src/index.ts`、`apps/api/src/modules/core/types.ts`、`apps/api/src/modules/core/store.ts`、`apps/api/src/app.ts` 贯通，支持新增、改名、排序、启停；被商品引用时删除返回 409；商品表单只展示启用分类。
- 区域开通改为行政目录 Select，不再手填 regionCode；区域暂停/恢复先二次确认并展示对进行中团期、未完成订单的影响。
- 商品表单显示“销售规格（包装单位）”“默认团期可售量”，团期、到货表单保留时间顺序、数量守恒和差异说明校验。
- 配送点位到货的“确认差异分配”使用提交锁、loading/disabled 和 finally 释放；社区浏览器用例将响应延迟 700ms 后双击，严格断言只发送 1 次 POST，失败路径仍可重试。
- 生产 bearer 认证的角色数组通过白名单逐项校验；空数组、非字符串、未知或混合角色清理会话并回登录，demo/local 无角色预览仍保留受控超管入口。
- 自提点停用在同一事务内检查未完成订单，409 详情返回 `unfinishedOrderCount`，不会留下已停用但仍有履约义务的点位。
- 小程序请求层为支付启动、模拟支付、取消等所有无字段 JSON POST 发送 `{}`。结算页区分“订单创建失败”和“订单已创建但支付未完成”：前者不跳转，后者保留购物车与结算草稿并可进入原订单；订单详情继续支付只操作原订单，不调用创建订单接口。

## 独立 QA 结论

- 最终结论：`PASS`（本地代码验收），P0=0、P1=0、P2=0。
- 配送差异在 700ms 慢响应下双击只产生 1 次 POST；生产 bearer 畸形角色数组 fail-closed。
- 支付恢复覆盖创建失败、创建成功后支付失败、原订单继续支付、幂等键复用、身份 epoch 与重复点击防护。
- 允许按本任务冻结范围提交当前分支；该结论不代表生产发布通过。

## 外部限制

真实 MySQL/Redis 需要 `INTEGRATION_DATABASE_URL` 与 `INTEGRATION_REDIS_URL`；当前机器未配置，7 项集成测试保持外部阻断，不能宣称真实基础设施已验证。真实微信登录、支付、订阅与生产发布也未执行。
