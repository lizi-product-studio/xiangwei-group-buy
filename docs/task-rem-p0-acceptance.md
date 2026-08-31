# TASK-REM-P0 独立验收与重放

本文件记录发布阻断 P0 的最小可验证契约，供开发、代码审核和独立 QA 使用；它不替代 [产品需求](PRD.md) 或 [架构说明](architecture.md)。

## 退款义务与恢复

1. 触发未成团取消或人工取消一个已付款订单。确认同一事务将订单置为 `REFUNDING`、写入唯一退款义务；事务提交后的进程中断后由退款调和扫描恢复，且不得丢失该义务。
2. 重启后运行退款调和。它只消费既有义务，并以不可变的 `providerRefundNo` 提交。再次运行调和，确认退款记录、账本和支付机构提交次数各为一。
3. 用可控支付提供方依次模拟：提交前异常、提供方已受理但响应丢失、查询未找到、查询超时、可重试失败、迟到成功回调。每次提交或查询均消耗同一笔持久化恢复预算（当前上限为 5 次）；第 5 次调用后，除 `SUCCEEDED` 外的任何结果都必须立即进入 `MANUAL_HOLD`，后续调和零次调用支付机构。每次等待租约/退避条件满足后调和，验证：相同退款单号、不会重复退款、成功只一次落账。
4. 对全额退款和按订单行部分退款分别重放第 2、3 步。断言部分退款不会把全额订单支付状态提前写为已退款。
5. 造出一笔历史 `REFUNDING` 已付款订单但无退款义务的受控夹具，执行不变量/补偿任务。应只补建一笔；已有义务的订单不增加记录。
6. 让一次 `queryRefund` 在途时先送达成功退款回调，再返回旧的 `PROCESSING` 查询结果。全额与部分退款都必须保持 `SUCCEEDED`；退款恢复写入使用持久化版本 CAS，任何旧查询、租约回收或错误处理均不得使终态倒退。
7. 在一批至少两笔待处理退款中让第一笔提交失败。调和返回失败汇总并记录可恢复状态，但第二笔仍继续收敛；服务启动不得因为单笔可恢复支付故障失败。

建议的自动化入口（实现完成后应包含故障注入覆盖）：

```bash
pnpm --filter @hometown/api test -- payment-concurrency
pnpm --filter @hometown/api test -- community-lifecycle
pnpm --filter @hometown/api test -- mysql-redis.integration
```

## 到货角色和网页工作台

1. 准备一个已在途配送批次、一个已授权点位负责人、一个未授权点位负责人、`OPERATOR` 和 `SUPER_ADMIN`。
2. 以已授权 `PICKUP_MANAGER` 登录网页“我的点位工作台”，确认只显示其点位的批次；逐商品提交正常数量，再重放同一请求，确认返回同一到货事实并且正常订单可领取。
3. 另建批次，提交短少或破损数量。确认生成差异事实/草案，受影响数量在运营确认前不可领取；以 `OPERATOR` 在其工作台确认草案后，验证分配结果可领取或进入退款路径。
4. 以未授权 `PICKUP_MANAGER` 调用或操作另一个点位，必须收到拒绝；以 `OPERATOR` 操作到货提交，必须收到拒绝且网页无该动作。
5. 以 `SUPER_ADMIN` 紧急代办：空 `emergencyReason` 必须失败；填写原因后成功，并在审计日志中检查执行人、代办标记、原因和时间。以普通 `PICKUP_MANAGER` 携带该字段必须失败。
6. 在浏览器中覆盖 loading、空列表、错误提示、禁用提交和未授权状态；权限由接口再次校验，不能只验证菜单隐藏。

建议的自动化入口：

```bash
pnpm --filter @hometown/api test -- allocation-determinism
pnpm --filter @hometown/api test -- community-lifecycle
pnpm test:e2e
```

## 发布前命令与环境判定

```bash
pnpm check
pnpm test:e2e
```

真实 MySQL/Redis 重放须提供 `INTEGRATION_DATABASE_URL` 与 `INTEGRATION_REDIS_URL`；CI 使用 MySQL 8.4、Redis 7.4，并设置 `REQUIRE_INTEGRATION_TESTS=true`。该开关现在为 fail-closed：缺任一 URL 时测试明确失败；本地未设置该开关时相关集成用例标记为 **BLOCKED（环境缺失）**，不得以跳过结果视为通过。
