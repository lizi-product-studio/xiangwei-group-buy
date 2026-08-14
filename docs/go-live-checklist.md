# 生产发布与回滚清单

## 发布前阻断门槛

- 公司主体已完成小程序注册、备案、认证和类目资质申请。
- 微信支付平台收付通已开通；所有商户完成二级商户进件，后台录入正确的 `sub_mchid`。
- API 与运营后台使用已备案 HTTPS 域名，微信后台已配置 request 合法域名和支付回调域名。
- 上传前已安全注入体验版/正式版 HTTPS 域名及三条订阅模板 ID；服务端 `.env.production` 的模板 ID 和字段映射已与微信后台逐项核对。不要把真实地址或模板 ID 提交到源码。
- 服务端 `PRIVACY_NOTICE_VERSION` 与小程序法律页的版本号一致；变更协议文案时先升级版本，再发布小程序与 API。
- 生产密钥只存放于云密钥服务或容器 secret，不写入镜像、环境样例、日志或代码库。
- MySQL 开启自动备份、跨可用区副本和删除保护；Redis 开启 AOF 与持久化备份。
- 告警至少覆盖：5xx、支付回调失败、退款/分账失败、团期截单积压、数据库连接、磁盘和备份失败。
- 在预发布环境完成 `pnpm check`、数据库迁移、真实微信 0.01 元支付/退款/分账、小程序审核包回归。

## 首次部署

1. 将 `infra/deploy.env.example` 复制为仓库根目录 `.env.production`，通过安全渠道填写真实值。
2. 把支付私钥和微信支付公钥放入仅部署账号可读的 `infra/secrets`；禁止提交到 Git。
3. 确认 `PUBLIC_DOMAIN` 的 DNS 已指向该主机、80/443 端口可用；生产编排会由 Caddy 自动申请并续期 TLS 证书，HTTP 只用于跳转到 HTTPS。
4. 在安全上传工作区将 `apps/miniprogram/src/config/deployment.local.example.ts` 复制为 `deployment.local.ts`，填入已备案 HTTPS 域名和审核通过的订阅模板 ID；该文件必须保持 gitignored。
5. 执行 `docker compose --env-file .env.production -f infra/compose.production.yaml build`。
6. 执行 `docker compose --env-file .env.production -f infra/compose.production.yaml up -d`。迁移容器成功退出后 API 才会启动。
7. 用 `docker compose --env-file .env.production -f infra/compose.production.yaml run --rm -e BOOTSTRAP_ADMIN_USERNAME=ops.admin -e BOOTSTRAP_ADMIN_PASSWORD='<临时强密码>' api node dist/scripts/bootstrap-admin.js` 创建首个超级管理员，随后删除终端历史中的临时密码。
8. 验证 `/health/live`、`/health/ready`、管理员登录、小程序登录和一笔完整支付—核销—分账链路。

## 日常发布

- 发布前创建数据库快照并记录当前镜像摘要。
- 先在预发布执行迁移；数据库迁移仅允许向前兼容，至少跨一个版本保持旧代码可读。
- 涉及退款提交租约或领取令牌的版本，先停止上一版本的退款调度实例，完成迁移后再启动新实例；不得让旧版和新版退款工作者混跑。新版本会用持久化领取令牌围栏旧工作者的迟到写回。
- 滚动替换 API，健康检查通过后再更新运营后台静态资源。
- 观察 30 分钟核心指标后结束发布窗口。

## 回滚

- 应用异常且迁移向前兼容：立即切回上一镜像摘要，不回滚数据库。
- 数据损坏：停止写入，保留现场日志，使用最近全量备份加 binlog 做时间点恢复到新实例，核对订单与账本后切换。
- 支付异常：关闭入口推广和新团期开售，不删除回调；修复后通过支付查询、退款查询和分账查询自动补偿。

## 每日与每月演练

- 每日检查备份任务、失败退款、失败分账、关团任务和账本平衡。
- 每月从备份恢复到隔离环境并核对订单数、支付金额、退款金额与账本借贷平衡。
- 每月轮换后台离职账号、复核角色权限和二级商户状态。
