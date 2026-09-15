---
run_id: RUN-20260831T032435Z-be4a70
task_id: TASK-PICKUP-LOCATION-REQ
attempt: 1
role: requirements
conclusion: PASS
date: "2026-08-31"
---

# 自提点定位需求交接

## 结论

`PASS`：本任务已冻结后续实现和独立 QA 所需的自提点定位规则、UX 恢复路径、最小 API/数据 Delta 与 Given/When/Then 验收基线。此结论只确认需求交付；定位功能尚未实施，不能作为生产地图/高德覆盖验证或发布通过证据。

## 输入与现状证据

已读取以下输入：

- 项目契约与事实基线：`AGENTS.md`、`docs/project-status.json`、`docs/00-project-context.md`、`docs/01-domain-rules.md`、`docs/02-glossary.md`。
- 上游规格：`docs/06-ux-spec.md`、`docs/08-system-design.md`、`docs/09-api-data-contract.md`、`docs/10-test-plan.md`。
- 定位实现证据：`apps/admin-web/src/App.tsx` 的区域/点位表单、`pickup-location-picker.tsx`、`pickup-address.ts`、`region-cascade.ts`、`api.ts`；`apps/api/src/app.ts` 的目录、地理和点位路由；`apps/api/src/modules/service-areas/geo-search.ts`；`packages/api-contracts/src/index.ts`。

现状结论：

| 结论 | 事实状态 | 证据 |
|---|---|---|
| 当前 UI 同时持有 `serviceAreaId` 与可编辑省/市/区；编辑时可按地址反推地区 | EVIDENCE_INFERRED | `App.tsx`、`region-cascade.ts` |
| 当前 API 只校验服务区域存在和坐标格式，未在写入时校验坐标的行政归属 | EVIDENCE_INFERRED | `app.ts`、`api-contracts/index.ts` |
| 当前地点搜索失败与逆编码失败会在地图组件中转为空结果或被吞掉 | EVIDENCE_INFERRED | `pickup-location-picker.tsx`、`geo-search.ts` |
| 地图内部坐标为 GCJ-02；OSM 回退在适配器边界转换 WGS84/GCJ-02 | EVIDENCE_INFERRED | `geo-search.ts`、`china-coords.ts` 调用 |
| 服务区域→地址/POI→地图微调→最终确认是批准方向 | CONFIRMED | `TASK-PICKUP-LOCATION-REQ.yaml#assumptions_and_risks` |
| 50 米疑似重复阈值、`confirmDuplicate` 重试字段和不持久化 POI ID/微调标志 | DEFAULT_ASSUMPTION | 本任务的可逆最小契约；见 ADR |
| 真实高德 Key、乡镇覆盖率及预发布实测 | BLOCKING_UNKNOWN / BLOCKING_EXTERNAL | 任务包、`docs/04-prd.md#RISK-006` |

## 变更的工件

| 工件 | 变更与验收关联 |
|---|---|
| `docs/01-domain-rules.md` | 增加 DR-017–020：唯一行政事实链、地图核验/越界拒绝、历史编辑兼容、疑似重复提示（AC-REQ-01/03） |
| `docs/04-prd.md` | 增加 REQ-015/016 与外部地图覆盖风险（AC-REQ-01–04） |
| `docs/06-ux-spec.md` | 冻结新建、POI 命中/无结果、上游/逆编码失败、农村点选、越界、编辑、重复和可访问性文案（AC-REQ-02） |
| `docs/08-system-design.md` | 记录 GCJ-02、服务端写入核验、错误与兼容/非目标（AC-REQ-01/03） |
| `docs/09-api-data-contract.md` | 记录最小 API Delta、409/502 恢复、包含关系、兼容边界（AC-REQ-03） |
| `docs/10-test-plan.md` | 新增 AC-PICKUP-LOC-01–07，均为 PLANNED，不冒充实现结果（AC-REQ-04） |
| `docs/decisions/2026-08-31-pickup-location-source-of-truth.md` | 记录选择、证据、替代方案、非目标、回滚触发与验收追踪（AC-REQ-01–04） |

## 验收证据

| 任务验收 | 已交付的可定位证据 | 状态 |
|---|---|---|
| AC-PICKUP-LOC-REQ-01 | ADR “决定”；DR-017 | PASS |
| AC-PICKUP-LOC-REQ-02 | UX “新建与重新定位流程”表和固定文案 | PASS |
| AC-PICKUP-LOC-REQ-03 | DR-018/019；API-PICKUP-LOCATION、错误/兼容定义 | PASS |
| AC-PICKUP-LOC-REQ-04 | AC-PICKUP-LOC-01–07 和位置测试准入项 | PASS |

验证已执行：

```text
git diff --check -- docs/01-domain-rules.md docs/04-prd.md docs/06-ux-spec.md docs/08-system-design.md docs/09-api-data-contract.md docs/10-test-plan.md docs/decisions/2026-08-31-pickup-location-source-of-truth.md
# exit 0; no whitespace errors
```

## 范围、风险与下游决定

- 未修改应用代码、测试、依赖、锁文件、迁移、环境文件、外部系统或生产数据；没有真实地图 Key/网络响应作为完成前提。
- 本轮不包含消费者实时定位、导航、路径规划、电子围栏、POI ID 持久化、联系人/排班/照片或地址治理后台。
- 后续 Engineering Lead 必须以 REQ-015/016、DR-017–020、ADR 和 AC-PICKUP-LOC-01–07 另建实现任务包；该包应拥有应用代码与测试文件，且在实现后安排独立 QA。
- 实现包必须保持服务区域单一事实链、服务端重新核验和历史点位不静默改区/丢坐标；若 50 米阈值或重复覆盖影响运营，应回报 Main Agent 决定，而非把默认假设升级为业务事实。
- Quality Governor 是下一责任角色，负责审查本需求基线后再放行实现路由。真实高德覆盖/Key 仍由用户授权的预发布活动处理。
