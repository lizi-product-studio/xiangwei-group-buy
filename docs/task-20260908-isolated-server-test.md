# 备用服务器隔离测试

- task_id: TASK-20260908-ISOLATED-SERVER-TEST
- status: IN_PROGRESS
- confirmed: 用户指定 180.76.100.156（内网 192.168.16.2）仅用于测试，先在测试环境验收，再安排正式发布。本次明确替代旧文档对此地址的连接限制，不变更正式目标 192.144.136.205，不自动部署。
- confirmed: 2026-09-08 用户明确允许清理备用服务器现有服务。执行仅移除四个精确旧服务容器，未清理旧代码、数据库卷或备份。
- 全流程合成数据、模拟支付、通知替身；不使用真实渠道凭据或生产数据。

## 资源与旧服务处理

服务器 instance-u64whg6i，Ubuntu 24.04.4，2 核，3403 MiB 内存，无 Swap，根盘约 24 GiB 可用。清理前可用内存 2345 MiB。

旧服务为 hometown-food-staging-admin-1、hometown-food-staging-api-1、hometown-food-staging-mysql-1、hometown-food-staging-redis-1。API Compose 路径指向 /opt/hometown-food/releases/7245aec-20260903-1507/infra；旧 current 指向 c62e6e3-20260903-080037。

四容器配置已保存到服务器受限文件 /opt/readiness-test-20260908/evidence/retired-containers.inspect.json（0600，含敏感配置，不上传 Git）。优雅停止后移除容器，保留镜像、源码、备份及 hometown-food-staging_mysql_data / hometown-food-staging_redis_data 卷，可用于恢复旧服务。清理后无运行容器，可用内存 2823 MiB。

## 冻结测试目标与职责

- 新工作目录：/opt/readiness-test-20260908；不复用 /opt/hometown-food 数据或配置。
- 独立 internal 网络：readiness-20260908；测试执行容器无公网出口，不连接生产网络，不发布数据库端口。
- 容量 MySQL：readiness-mysql:3306/readiness_capacity_20260908，非 root 用户 readiness_runner。
- 容量 Redis：readiness-redis:6379/5。
- 显式 profile：server-isolated-20260908。容量读写前验证精确端点及数据库内只读身份标记。旧 localhost profile 保留。
- 集成测试使用另一专用数据库；E2E 当前配置为内存服务，须与真实 MySQL/Redis 集成结果分别报告。
- root 负责目标、服务器唯一执行及记录；test_harness 负责容量脚本和分配后的通知修复；isolation_setup 负责 infra/readiness-test 新文件；independent_review 只读独立审核。

## 当前发现

- P2 OPEN：上一轮通知改动只计入超时未结束调用；并行 drainPending 在超时前仍可达到 10 个发送。独立复核以 delayed provider 实测 maximum=10，不能宣称单实例全局上限已为 5。交研发修复后重新验收。
- 隔离基础镜像准备中。测试环境尚未验收，未开始容量压测；正式服务器未操作。
