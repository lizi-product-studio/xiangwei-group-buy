---
title: "社区团购 — System Design"
status: APPROVED
version: 1.2.0
last_updated: "2026-08-31"
owner: architect
source_of_truth: project-document-set
---

# System design

## Context and components

| Component | Responsibility / owned contracts | Dependencies | Failure isolation |
|---|---|---|---|
| 微信小程序 | USER 登录、目录、订单、消息、售后、意向 | API、微信登录/支付/订阅 | release 配置缺失拒上传 |
| 运营后台 | 五内部角色页面与动作 | API | 角色默认页/请求隔离 |
| API | auth/catalog/campaign/order/payment/fulfillment/notification/ledger/audit | MySQL、Redis、微信 | 生产配置 fail-closed |
| MySQL 8.4 | 当前 InnoDB 单行聚合业务状态；退款/审计等同事务 | durable disk | 单行锁保证原子但限制吞吐 |
| Redis 7.4 | 团期 close job、lifecycle scheduling、周期调和租约 | Redis | 租约过期后其他实例可接管 |
| 微信 | 登录、JSAPI、支付退款回调、订阅消息 | 备案 HTTPS/商户凭据 | unknown/manual recovery |
| 地点解析（管理端） | 地址/POI 搜索、地图交互、GCJ-02 逆地理与行政目录路径相容核验 | 获批准的位置核验适配器、行政区目录；确定性测试夹具 | 适配器/地图不可用或不可映射时 fail-closed；不以公共 OSM 作为生产默认 |

## Security and permissions

- 微信消费者令牌和员工账号/会话分离；敏感路由后端执行角色、状态和点位范围校验。
- 员工权限变化撤销旧会话；列表/详情/动作保持相同数据范围。
- 手机号仅区域意向主动提供，后台默认脱敏；审计输出递归脱敏。
- 密钥、PEM、API v3 key、`deployment.local.ts` 和真实数据不得入库。
- 生产禁止 demo auth/mock payment，缺 HTTPS/取货码密钥/模板配置拒启动。

## Consistency, concurrency, side effects

- 事务边界：订单+库存+幂等；状态+退款义务；到货事实+草案；业务状态+outbox+审计。
- 支付/退款：事件和正文摘要去重；固定 provider number；持久化 claim token/lease；unknown 先查后重试。
- 核销：request id+payload hash；行数量条件更新；累计不超 fulfilled。
- 通知：事务内 outbox；调用提供方前消耗 at-most-once 提交预算；未知结果不自动重发。
- 账本：整数分，借贷平衡；领取确认收入，未领取退款冲合同负债，领取后品质退款冲收入。

## Current storage and capacity decision

- 当前基线 `community_product_state` 单行 JSON + `FOR UPDATE` 是首发正确性方案，不是横向扩展方案。
- Release guardrail：受控社区/团期规模；多个 API 副本虽能共享数据锁和调和租约，但不得据此宣称无限订单规模。
- 扩容触发：p95 写事务持续超过 200ms、锁等待/超时、状态 payload 明显增长或需要多 API 副本时，优先拆订单/订单行、支付退款、outbox/audit 为行级表和唯一索引。
- 回滚：当前无生产数据时只在新空库运行基线；不得对未知旧库原地覆盖。

## Scheduler/worker decision

- 当前 API 内运行团期、订单过期、领取窗口、退款和通知调和；单实例禁止重入，多个实例以 120 秒、每 30 秒续期的 Redis 租约竞争运行权。
- 每个调和步骤前复核租约 token；续租异常、返回失锁或最后成功时间超过 150 秒都会使 readiness 降级。单个已开始步骤仍以自身幂等/claim fence 收敛，不能把租约描述为数据库级 fencing。
- 服务重启或持有者退出后由租约过期恢复；健康端点提供 last-success/错误标志，不返回内部错误详情。
- 扩大规模前仍应拆独立 worker，并补齐队列深度、人工待办和集中告警；当前租约只降低重复运行风险，不解决单行数据锁吞吐，也不能替代真实 Redis 多副本验证。

## Observability and operations

- 结构化错误、审计、退款/通知状态和人工队列是当前运行证据。
- 发布前需补：数据库/Redis 健康、迁移幂等、备份恢复、队列深度、调和 last-success、退款人工挂起、通知人工任务告警。
- 禁止将单元/mock E2E 结果当作真实微信或 MySQL/Redis 预发布证据。

## 自提点定位契约 Delta（P1，待实现）

- **DEFAULT_ASSUMPTION**：这一迭代把 `ServiceArea.regionCode` 视为单个行政目录节点。`PickupPoint.serviceAreaId` 联结该节点是唯一行政归属链；路径校验只证明坐标反向编码结果与该节点相容，**不能证明**业务配送几何边界、正确门牌或通行性。若服务范围可自定义、重叠或不与目录节点对齐，停止实现，另建边界数据/运营/迁移决策。
- **EVIDENCE_INFERRED**：现有高德地图使用 GCJ-02；现有 OSM 回退在边界转换 WGS84/GCJ-02。后续 API 和持久化仍统一 GCJ-02；适配器必须显式声明输入/输出坐标系，禁止混存。公共 OSM 端点仅能作为本地开发/测试的明确许可对象，**不得**在未获用户批准的生产配置中自动回退使用。
- 实现一个提供方无关的 `ReverseLocationAdapter`。成功输出必须含：`coordinateSystem`、输入规范化坐标、`providerAdministrativeId`（原始标识）、`directoryRegionCode`（规范化目录节点）和展示地址；失败输出必须区分 `NOT_CONFIGURED`、`UNAVAILABLE` 与 `UNMAPPABLE`，不能把任何一种折叠为空 POI 结果。目录映射由受控目录映射器完成，未映射不得猜测父/子节点。
- 写入边界仅在创建、规范化地址改变、六位 GCJ-02 纬度/经度改变、或 INACTIVE→ACTIVE 时调用适配器。其他 PATCH 不调用适配器、不生成持久核验判断，且保留原地址和坐标。客户端回填的省市区、地址、POI 元数据或旧会话结果都不能替代服务端当场核验。
- 在触发事件中，只有 `MAPPED` 输出才可进行行政目录路径相容比较；`UNMAPPABLE`、`NOT_CONFIGURED`、`UNAVAILABLE`、地图交互不可用和路径不相容全部在写入事务前安全拒绝，产生零位置写入。检查通过也只可显示“行政路径相容”。
- 重复检查只在相同 `serviceAreaId` 内执行，PATCH 排除自身。按 DR-020 的地址规范化和 Haversine 计算返回候选；首次发现及明确 `confirmDuplicate: true` 覆写均产生审计证据。50 米和覆写字段是 **DEFAULT_ASSUMPTION**，不新增 POI ID、手工微调标志、核验状态或地理围栏表。
- 兼容：既有 `PickupPoint` 字段、公开目录输出和 `/api/v1` 路径保持不变；不作数据迁移、历史回填或“已/未核验”字段。若产品需要持久核验事实、已批准生产提供方或真实业务几何边界，须另建批准的数据/外部能力契约、迁移与回滚计划。

### 位置失败与安全回滚

- 表单只在当前打开会话中保留输入、候选和图钉；关闭、刷新或离开页面即丢弃，持久草稿不在范围。
- 地图瓦片或交互、适配器配置、提供方请求、目录映射分别呈现可识别状态；新建、位置变更和 INACTIVE→ACTIVE 在任一失败状态均不得写入。纯非位置 PATCH 仍可执行。
- 回滚不得恢复“未核验位置可写入”的旧 API 行为。若撤回 UI 或适配器实现，服务端仍对这三类事件返回 fail-closed 拒绝；只有在整个受控定位写路径保持关闭时，才可进行非触发编辑。真实覆盖不足只能阻止定位写入或由用户批准新的提供方/范围，不能放宽校验。

## Deployment, migration, compatibility, and rollback

1. 新空 MySQL 8.4 执行 `0001`，重复迁移幂等；Redis 健康。
2. 在安全环境注入生产 env/证书/模板/取货码密钥，bootstrap 首个超管。
3. 单 API 副本 + admin + HTTPS 网关；健康检查通过。
4. 真实登录、小额支付、取消/全额退款、多商品部分退款、消息模板和回调验收。
5. 失败回滚应用镜像；如无生产订单可回新空库；一旦存在真实订单不得丢弃/回退业务数据。

## Decisions

| ID | Topic | Decision | Status |
|---|---|---|---|
| ADR-001 | 单业务模式 | 只保留社区固定点位集中自提 | APPROVED |
| ADR-002 | 首发存储 | 单行聚合仅用于受控单副本首发；扩容前行级拆分 | APPROVED_WITH_GUARDRAIL |
| ADR-003 | 外部副作用 | fixed id + lease/fence + unknown/manual recovery | APPROVED |
| ADR-004 | 通知模板 | 四个已审模板映射七个语义事件；单次最多请求三个唯一模板 | APPROVED_PENDING_EXTERNAL_TEMPLATE_REVIEW |
| ADR-005 | 自提点行政归属 | 服务区域链唯一；仅校验行政路径相容；提供方、地图或映射失败安全拒绝 | APPROVED（需求冻结；实现待后续包） |
