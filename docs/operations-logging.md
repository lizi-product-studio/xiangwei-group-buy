# 乡味集日志与快速定位

## 先记录什么

报错时记录发生时间（中国时间）、操作页面、操作名称及“排查编号”。涉及订单时可附订单号；不要转发取货码、密码、微信授权 code、token 或完整手机号。无服务端响应的网络故障可能没有请求编号，不能据此判断请求是否已写入；先查询最新状态，不直接重复支付或核销。

## 已有入口

| 类型 | 入口 | 能查到什么 |
|---|---|---|
| 业务操作审计 | 超级管理员后台 → 系统 → 操作日志 | 操作人、时间、动作、资源、变更前后及请求编号；接口仅允许超级管理员 |
| API 请求/异常 | 服务器 `docker logs hometown-food-api-1` | 请求编号（`reqId`）、耗时、响应状态和未捕获异常 |
| 入口访问 | `/var/log/nginx/access.log` | 请求时间、域名、方法、路径、状态、耗时及后端请求编号 |
| 网关异常 | `/var/log/nginx/error.log` | 上游连接失败、静态文件或网关层故障 |
| 退款/通知业务失败 | 相应后台处理队列及任务详情 | 失败对象、处理状态、原因；对照订单/退款/通知标识继续排查 |

操作日志不是全部运行日志：没有成功形成审计记录的失败，要用请求编号查 API 日志。普通点位负责人不应获得全站系统日志权限。

## 常用命令（服务器上执行）

```sh
# 最近半小时，先限制输出量。
docker logs --since 30m --tail 500 hometown-food-api-1 2>&1

# 把示例替换为页面提供的编号，按精确文本定位。
docker logs --since 2h hometown-food-api-1 2>&1 | grep -F -- 'REQUEST_ID'
grep -F -- 'REQUEST_ID' /var/log/nginx/access.log

# 后端无日志而页面502/504时核对网关及容器。
tail -n 100 /var/log/nginx/error.log
docker inspect --format '{{.State.Health.Status}}' hometown-food-api-1
```

排查顺序：页面编号 → API `reqId` → 对应订单/退款/通知/审计记录；若 API 未收到请求，则按发生时间查网关。服务健康仅说明依赖可用，不代表某笔交易已成功。

## 留存与隐私

- 2026-09-21 实测生产 Docker API 日志采用 `json-file`，每份最大 10 MB、最多 3 份（按容量而非天数）。Nginx 每日轮转、最多 10 份、压缩旧日志。
- 2026-09-21 已部署 Nginx 配置 `infra/nginx.host-api.conf` 的 access log 仅记录 `$uri`，不记录 query、body、cookie、authorization、referrer。请求编号取后端 `X-Request-Id`；Nginx 自行产生的响应可能无后端编号。
- 新后台取货码查询应使用 POST body；旧版本产生的历史日志可能包含 query，不能宣传历史数据已经脱敏。Nginx error log 是标准诊断格式，可能包含原始请求行，读取和导出时同样需要控制访问并脱敏。
- 日志只供获授权维护人员排障，不应通过公网静态目录暴露。向外分享日志前再次检查；不要直接导出生产请求 body 或环境变量。
- 上线后已实测 API/Nginx 编号联查与 query 脱敏，实际版本与测试编号回查证据记录在 `task-20260921-release-verification.md`。

## 回退与留证

发布前保留当前 API 镜像、后台静态目录、Nginx 配置及受限运行配置；失败时按本次发布记录恢复代码/配置。不得用旧数据库快照覆盖上线后新订单。日志达到容量上限前及时摘录必要失败证据至受限目录，不为释放空间清空财务与业务审计。
