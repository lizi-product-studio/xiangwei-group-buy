# 点位负责人域名复用

- task_id / run_id：`TASK-20260907-PICKUP-DOMAIN-CONFIG`；attempt：1。
- 路由：`范围明确的迭代`；本批状态：`READY_FOR_REVIEW`，仅本地配置草稿，尚未提交、推送或部署。
- 唯一写入范围：`infra/nginx.host-api.conf` 与本记录。前端品牌实施由另一负责人持有，需其 READY 后统一审核发布。

## 已确认决定与边界

- `confirmed`：主线程确认复用现有 admin 应用与同源 API，将 `saas.liziqi.icu` 作为点位负责人入口；不新增域名角色安全门禁。
- `confirmed`：域名不是权限边界，后端 RBAC 与点位数据范围继续承担授权。其他合法后台角色也可在此入口登录，不能将入口名称表述为仅该角色可访问。
- `evidence-inferred`：`apps/admin-web/src/navigation.ts` 的 `isPointWorkbenchUser`、`getDefaultAdminPage` 将具有 `PICKUP_MANAGER` 且没有全局角色的用户默认带到 `point-workbench`；全局角色按现有优先级落页。
- `evidence-inferred`：`apps/admin-web/src/api.ts` 使用按 origin 隔离的 localStorage 保存 Bearer，并通过相对路径调用 API。admin 与 saas 需分别登录，不迁移或共享浏览器 token。
- `evidence-inferred`：生产 CORS 关闭，同源代理无需开放跨域；鉴权读取 Authorization，不新增登录 cookie。保留 Host、HTTPS 与真实客户端 IP 转发，沿用 API 全局 IP 限流及 IP/用户名登录限流，不新增独立额度。
- `not-applicable`：本批不修改账号、密码、数据库、API 镜像、支付、AMAP 或微信配置，不上传微信，不执行登录或真实渠道动作。

## 前置只读证据

以下是前一只读任务 `TASK-20260907-PICKUP-DOMAIN-READONLY` 在 2026-09-07 的观测，不代替部署前重新核验。

- `confirmed`：目标服务器为 `192.144.136.205`；有效 conf.d 配置只有 `/etc/nginx/conf.d/housekeeping.conf`，`nginx -T` 成功。其 SHA256 为 `88e0c60229747c40ca3696f4502926e5c8d8e0bdbe5264ee4ba135ad9b659266`，与修改前仓库配置一致。
- `confirmed`：saas HTTP 80 返回 301 到 HTTPS，443 返回退役 410；独立 saas block 没有 root/proxy。80/443/8443 由 Nginx 监听，运行容器仅拼团 API/MySQL/Redis，API 仅绑定 127.0.0.1:3100。
- `confirmed`：静态链接 `/var/www/hometown-admin-current` 当时指向 `/var/www/hometown-admin-29254e2`。当前同一静态目录将服务多个域名，后续静态切换会同时影响这些入口。
- `confirmed`：证书 `/etc/letsencrypt/live/housekeeping-platform/fullchain.pem` SAN 覆盖主域名、admin 与 saas，到期为 2026-11-04 02:07:08 UTC；无需为本变更更换证书。
- `confirmed`：服务器与权威 DNS `audience.dnspod.net` 返回 saas A=192.144.136.205，无 CNAME 答案。本机返回 198.18.0.248；`evidence-inferred`：受 Clash fake-IP 干扰，不能当作真实公网地址。

## 精确配置差异

1. 将 saas 加入现有主 HTTPS server_name。
2. 删除独立 saas HTTPS 410 block。

HTTP 重定向、默认未知 host 与 8443 的 410、旧 admin/platform/uploads/public-media 路径阻断、静态 root、资源匹配、/api 和 /health 代理及所有代理头保持原值。不创建另一套 API，也不开放任意 SPA 路径。

## 后续部署、验收与停止条件

本节是后续发布计划，不代表已执行；生产写入须由主线程确认独立 QA 与发布窗口后开展。

1. 待前端 READY，与已验收前端版本统一冻结范围、提交、非 force 同步并校验 tree。部署前重新核对现有链接、Nginx SHA、证书、API/env/AMAP/trial、资源和业务/账号数据指纹；漂移先上报。
2. 新鲜备份当前静态、链接、Nginx 原文件及清单到受限本机与服务器，权限 0600，校验归档可读及双端 SHA；保留旧静态与精确回滚目标。
3. 若发布前端静态，使用版本化目录、逐文件 SHA 核对与原子链接切换；将经审核的完整配置替换现有效文件，避免并存重复 saas vhost。运行 `nginx -t`；失败立即恢复原文件，禁止 reload 坏配置。通过后仅 reload Nginx，不重建 API、不修改 env 或数据。
4. 核 saas HTTP 301、HTTPS 首页和全部资源 200/SHA、同源 readiness 与 reconciliation body 正常、未授权后台接口 401；核原 admin/主域可用，未知 host/8443 和旧阻断路径仍 410。核 API 身份/env/AMAP/端口/资源、账号及资金事实无非预期变化，OOM/restart/错误日志正常。
5. 角色落页与分域登录需单列行为验收；静态及未授权 HTTP 结果不能冒充真实账号登录验收。未获本轮账号使用授权时保持 NOT_RUN，不创建演示账号。
6. 遇配置冲突、备份失败、版本不一致、健康失败或非预期数据变化停止；不通过放宽 CORS/权限、重建 API 或恢复 DB 解决。

## 回滚

恢复本轮备份的 Nginx 原文件，执行 `nginx -t` 成功后 reload；若配置测试仍失败则保留原运行 worker 并报告，不加载坏配置。若同批静态也切换，核当前链接仍属于本轮后原子回指本轮备份目标；saas 恢复原 410 占位。保留业务资金事实，绝不恢复数据库。前置备份不可用时禁止开始发布。

## 本地验证与未验证范围

- 针对性静态核验：精确两处配置变换之外文本不变；四个 server block、HTTP/HTTPS 域名组、代理与默认/旧路径保护保留。
- `git diff --check`：本批完成时记录执行结果交主线程；真实 `nginx -t`/reload、DNS 修改、生产切换、登录与微信渠道均 NOT_RUN。
