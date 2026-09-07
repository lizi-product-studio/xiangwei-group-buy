# TASK-20260907-HOUSEKEEPING-DISK-CLEANUP

## 任务契约

- route: `GOVERNED_DELIVERY`
- confirmed: 2026-09-07 用户在获知服务器空间主要由 Docker 构建残留和系统日志占用后，回复“可以”，授权保留当前生产镜像与上一版 API 回滚镜像、精确清理无引用构建残留并将系统日志限制在 300–500MB。
- target: `housekeeping-server / 192.144.136.205`
- objective: 在不影响拼团生产服务、数据和必要回滚能力的前提下，回收已确认无引用的 Docker 构建残留与过量日志空间。
- non_goals: 不删除数据卷、业务数据、证书、运行中容器、当前 API 镜像 `hometown-api:6507b32`、上一版回滚镜像 `hometown-api:db1cf1c`、MySQL 8.4 镜像、Redis 7.4 镜像或 Node 基础镜像；不使用 `docker system prune -a`；不修改业务代码或应用配置。

## 删除前基线

- 2026-09-07 15:50 CST: `/dev/vda1` 总量 42,881,495,040 字节，已用 20,353,896,448 字节，可用 22,527,598,592 字节，约 48%。
- Docker: 3 个运行容器、1 个已停止集成 Redis 容器；Docker 卷合计约 271.8MB，容器可写层约 12.29kB。
- Docker 镜像逻辑统计 10.47GB，其中 7.405GB 标记为 reclaimable；镜像记录 70 个，其中 65 个为 dangling。
- Build Cache: 109 项，逻辑统计 5.076GB，当前标记可回收 333.1MB。Docker 镜像与构建缓存共享层，不得直接相加。
- `/var/lib/containerd`: content 约 1.1GB，overlayfs 约 8.8GB；`/var/log` 约 1.5GB，其中 journald 约 1.2GB。

## 角色与所有权

- 主 Orchestrator: 本文档唯一写入者，冻结范围、收集原始结论并最终汇总；不执行服务器删除。
- Project Assessor: 只读评估精确删除边界、风险、顺序与验收门禁。
- Engineering Lead: 服务器本批唯一写入者；保存删除清单和删前基线，执行精确清理、日志限额、自验和回滚设计。
- 独立 QA: 只读核对删除前后 ID 集合、保留项、磁盘差值、容器健康、公网冒烟和日志配置，给出 `PASS` / `PASS_WITH_RISKS` / `BLOCKED`。

## 实施与验收门禁

1. 删除前冻结所有镜像 ID、dangling ID、容器引用镜像 ID、数据卷、日志占用和 `df` 基线。
2. 仅对冻结的 dangling ID 集合执行不带 `--force` 的精确删除；任一 ID 被容器引用、引用关系不清或删除命令要求强制时停止。
3. 保留 `f28ee164e2ac...` 当前 API、`414fbcf2b14e...` 上一版 API、MySQL、Redis 和 Node 带标签镜像；不删任何 Docker 卷。
4. 仅清理 Docker 当前明确标记为 reclaimable 且与保留镜像无保护冲突的构建缓存；无法生成精确清单时允许保留该 333.1MB，不扩大为全局清理。
5. journald 采用独立 drop-in 限额为 500MB，先保存原有有效配置和新文件不存在证据；配置验证后重启 journald，再将历史归档收缩至不高于 500MB。失败时移除新 drop-in 并恢复原有有效配置。
6. 删除后必须确认仅冻结的目标 ID 消失，所有保留镜像和 3 个运行容器存在且 healthy，Docker 卷数量/名称不变，OOM/restart 无异常，API ready、主站、后台和旧入口返回符合现行发布契约。
7. 以 `df` 前后差值报告物理释放；不将 Docker 各类逻辑 reclaimable 直接相加。

## 当前状态

- status: `COMPLETE`
- 编排器 doctor 报告旧 `docs/project-status.json` 使用当前工具不支持的 `RELEASE_EVIDENCE` 状态。本任务不改写该全局生命周期元数据，以项目根契约和本任务记录作为本次精确生产清理的控制与证据入口。
- Project Assessor 结论 `READY_FOR_ORCHESTRATOR_FREEZE`：生产删除必须使用唯一写入窗口，65 个 `<none>` 中间记录不能直接当作可删集合，Build Cache 无法精确锚定时必须全部保留。
- 首个临时 Engineering Lead 只读预检发现 Docker 真正定义的顶层 dangling 候选为 10 个，而非 65 个；未执行写入，因超过等待预算被中止并撤销所有权。恢复会话亦在只读预检阶段被中止，未写服务器。
- 后续动态检查发现常驻任务“发布运维·迁移维护”（`01a07966-652f-7d43-bb94-5b3952159290`）正处于域名发布与后验写入窗口。主 Orchestrator 已将本任务作为其串行后续工作发送；该任务已确认接收，并承诺当前写入与证据完全冻结前不开始磁盘清理。

## 执行结果与最终验收

- 域名发布后验冻结后，复用同一生产写入窗口串行执行；删除前 manifest SHA-256 为 `36f6be46df436bf091c3c849db6484b7bb0c057119a164ac50557f8a706cfd74`，raw 证据 SHA-256 为 `10e9663c9d4a376613641e432169dbc39df60a797f5c1dbd1f8ee8f261c173d7`，受限证据双端 `0600` 且哈希一致。
- 70 条镜像记录中仅 10 个完整 ID 同时满足顶层 dangling、无容器引用、无保护冲突；分 5 批逐条执行 `docker image rm --no-prune <fullID>`，全部退出 0，未使用 force 或任何 prune。删除后 70 → 60，只有冻结的 10 个完整 ID 消失。
- 镜像删除证据 `image-deletion-attempt2/SHA256.json` SHA-256 为 `b630f1ccad572eb6635c7b8f286ef14a5497e0b1e33695ea18247291eb2d608c`。Build Cache 因只能取得 12 位 ID 而全部保留，109 项未变。
- 新增唯一 journald drop-in `/etc/systemd/journald.conf.d/99-hometown-retention.conf`，内容仅为 `[Journal]` 与 `SystemMaxUse=500M`，SHA-256 为 `e5dc26483ddeb63f62e13e4ad7ea11ca7ea233b428419811831a574c21d16a84`。配置解析通过，restart 后 active，无 Unknown/Invalid；旧归档经 rotate 与 `journalctl --vacuum-size=500M` 收缩，无秘密 marker 可写入并读回，最终 journal 约 494.2MB。
- 独立 QA 原始结论：`PASS`，无待修阻断。物理可用空间从 22,472,110,080 增至 23,684,087,808 字节，实际释放 1,211,977,728 字节（约 1.13GiB / 1.21GB），系统盘使用率降至 45%。
- 5 个保护 tag、4 个容器、3 个卷均保留；停止的 integration Redis 仍保持停止；3 个生产容器 healthy、OOM=false、restart=0。API ready/reconciliation、主站、后台、未授权 401、旧入口 410、current 版本、Nginx、API 环境与账号/业务数据指纹均保持不变。
- 已 vacuum 的旧 journal 归档不可恢复；500MB 是持久上限目标，不保证活动日志在每一时刻都不会短暂超过。本任务未执行登录、业务、支付或微信真实链路验收。
- 连续三次有界等待未见该生产写入窗口释放。按项目单写入与编排技能的预算停止条件，本会话不新建并发执行者，不执行删除。下一责任人为“发布运维·迁移维护”，单一下一步是先完成当前域名发布后验，再按本契约从动态预检开始。
