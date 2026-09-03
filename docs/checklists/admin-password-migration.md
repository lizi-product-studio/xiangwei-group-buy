# 管理员密码生命周期迁移运行手册（脱敏）

本手册只描述执行顺序，不包含任何真实密码、Token、AppSecret 或数据库连接串。

## 执行顺序

1. 在受控运维环境备份 `community_product_state` 和 `schema_migrations`。
2. 使用仅存在于进程环境的 `DATABASE_URL` 执行 `pnpm --filter @hometown/api db:migrate`。迁移运行器在数据库迁移锁内显式开启事务，`0003_admin_password_lifecycle.sql` 不再自行嵌套事务。它把历史输入 `PENDING_ACTIVATION` 转换为 `PASSWORD_SETUP_REQUIRED`，仅停用这些员工对应的旧凭据并撤销其会话，保留员工、角色和点位绑定；该字符串只允许出现在迁移 backfill 输入，不是运行时公共状态。
3. 使用交互式隐藏输入或受控环境变量运行 `pnpm --filter @hometown/api admin:bootstrap`，创建或轮换一个 `ACTIVE` 且 `mustChangePassword=false` 的受管 `SUPER_ADMIN`。命令输出只包含账号和完成状态，不输出密码。
4. 请求 `/health/ready`，确认 `adminBootstrap: "ok"` 后再开放生产流量。

## 回滚与补偿

- 迁移失败时，运行器先明确回滚业务事务，再在一个新事务中持久化 `schema_migrations.state=FAILED` 和截断后的错误摘要；失败记录自身无法写入时会同时报告两项错误，不会静默吞掉。
- 已成功迁移但需要恢复时，使用迁移前的受控备份恢复 `community_product_state`，再恢复对应 `schema_migrations` 记录；不得通过运行时把 `PENDING_ACTIVATION` 伪装成新状态。
- 如果旧会话已撤销，不能恢复旧 Token；应由受管超级管理员重新重置临时密码。临时密码仅在重置响应中显示一次。

## 失败关闭条件

- 未配置数据库、无法取得迁移锁、没有可用受管 `SUPER_ADMIN`、生产 Redis/HTTPS/微信配置不完整时，服务不得进入 ready。
- 本地开发和测试不得使用真实生产凭据；真实 MySQL/Redis 连接缺失时，集成门禁应报告 BLOCKED，而不是伪造通过。
