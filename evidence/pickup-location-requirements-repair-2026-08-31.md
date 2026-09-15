---
run_id: RUN-20260831T032435Z-be4a70
task_id: TASK-PICKUP-LOCATION-REQ-REPAIR
attempt: 1
role: requirements
conclusion: PASS
date: "2026-08-31"
selected_model: gpt-5.6-terra
reasoning_effort: high
runtime_attestation: "任务说明 selection; actual_model_attested is false, so this is not independently verified runtime evidence."
---

# 自提点定位需求修复交接

## 结论

`PASS`（owner 定点返工完成，仍待独立 QG 重进复核）：QG-RR-PL-01/02 已在需求层收紧，QG-PL-01 至 QG-PL-05 形成可执行且无冲突的需求/UX/API/测试基线。本修复只批准提供方无关、行政目录路径相容的后续实现；不证明真实业务配送边界、真实地址正确、乡镇覆盖或生产提供方可用。

## 输入与范围

已重新读取：`AGENTS.md`、`docs/project-status.json`、`docs/00-project-context.md`、`docs/01-domain-rules.md`、`docs/02-glossary.md`、全部 12 份相关输入文档，以及 Quality Governor 证据 `evidence/pickup-location-quality-governor-2026-08-31.md` 和 `evidence/pickup-location-quality-governor-rereview-2026-08-31.md`。

本任务只改动当时范围允许的需求、UX、架构、API 契约、测试计划、ADR 和本证据；未改动源码、测试实现、配置、依赖、迁移、外部系统或生产数据。

## QG 发现到修订的逐项映射

| QG finding | 精确修订 | 事实状态与残留风险 |
|---|---|---|
| QG-PL-01：行政目录包含被误述为实际服务区 | DR-017、REQ-015、UX 事实来源、架构 Delta、API 路径定义和 AC-01/02/05 全部改为“行政路径相容/不相容”；ADR 明确 ServiceArea 单节点仅为 `DEFAULT_ASSUMPTION` | 实际业务边界、门牌、可达性和相邻边界为 `BLOCKING_UNKNOWN`；若 ServiceArea 自定义/重叠/非目录对齐，停止实现并重新路由 |
| QG-PL-02：生产适配器/映射契约缺失 | `ReverseLocationAdapter` 固定输出 `MAPPED` 或 `NOT_CONFIGURED/UNAVAILABLE/UNMAPPABLE`，含坐标系、原始行政标识和规范化目录节点；API 新增 422/502/503 fail-closed 契约；禁止未批准公共 OSM 生产回退 | 真实提供方、条款、Key、映射稳定性与农村覆盖为 `BLOCKING_EXTERNAL`，仅可由获授权预发布证明 |
| QG-PL-03：无持久核验状态却宣称历史待核验 | DR-019、API PATCH matrix、UX 编辑状态明确：创建、规范化地址变、六位 GCJ-02 坐标变、INACTIVE→ACTIVE 才核验；其余 PATCH 保留值、跳过适配器；移除“历史已/待核验”文案 | 无持久核验事实是 `CONFIRMED` 的本轮边界；若产品需要已/未核验状态，另建数据契约与迁移任务 |
| QG-PL-04：农村/上游/地图失败与回滚不安全 | UX 新增适配器未配置、失败、不可映射及地图瓦片/交互不可用状态；只保留当前表单会话；架构/ADR 规定三类触发写入 fail-closed，回滚不能恢复未核验坐标可写 | 真实农村可恢复性仍为 `BLOCKING_UNKNOWN`；关闭/刷新/离页后表单输入丢失，不提供持久草稿 |
| QG-PL-05：50 米重复启发式不足 | DR-020/API/测试明确 `DEFAULT_ASSUMPTION`，PATCH 自身排除、NFKC/空白/中英文标点规范化、GCJ-02 Haversine（6,371,000m）、首次候选与覆写的审计 | 没有准确率/运营样本，不得作为唯一性、作弊判定或自动合并依据；真实覆写记录可触发调整/移除 |

### 独立复核后的定点修订

| Re-review finding | 本次精确修订 | 验收边界 |
|---|---|---|
| QG-RR-PL-01：UX 把建议地址/路径相容写成已核验地址或范围 | UX 将“服务范围”摘要改为“行政目录”；农村成功状态仅展示适配器**建议展示地址**和路径相容；删除“地址坐标不一致”作为状态/判断源；AC-02/03/05 保持只验证目录路径 | 建议展示地址不证明门牌正确；路径相容不证明实际业务边界或可达性 |
| QG-RR-PL-02：未触发 PATCH 的保留不是 MUST，等价边界缺夹具 | API 改为 MUST 忽略全部未触发位置字段、MUST 逐值保留持久地址/坐标、MUST 跳过适配器；UX 使用“规范化地址改变”；AC-06 加入 NFKC/空白/中英文标点等价、六位 GCJ-02 等价抖动及刚跨边界夹具 | 等价输入不得暗中更新未经当场核验的原始位置；刚跨比较边界必须触发核验，失败零位置写入 |

## 更新工件

- `docs/01-domain-rules.md`：DR-017–020 与定位对象不变量，版本 1.2.0。
- `docs/04-prd.md`：REQ-015/016、RISK-007，版本 1.2.0。
- `docs/06-ux-spec.md`：建议展示地址/目录路径措辞、安全失败状态、当前会话边界与 PATCH UX 触发矩阵，版本 1.2.1。
- `docs/08-system-design.md`：提供方无关适配器、事件写入边界和安全回滚，版本 1.2.0。
- `docs/09-api-data-contract.md`：适配器结果、422/502/503、409 行政路径不相容，以及未触发 PATCH 的 MUST 原值保留，版本 1.2.1。
- `docs/10-test-plan.md`：AC-PICKUP-LOC-01–08、零写入失败、重复审计与 PATCH 等价边界夹具，版本 1.2.1。
- `docs/decisions/2026-08-31-pickup-location-source-of-truth.md`：ADR 版本 1.1.0，收紧 ServiceArea 语义、适配器、无状态编辑与回滚。

## 验收与验证证据

| 修复验收 | 证据 | 结果 |
|---|---|---|
| AC-PICKUP-LOC-REPAIR-01 | DR-017、REQ-015、ADR 决定、API `PICKUP_LOCATION_ADMIN_PATH_MISMATCH`、AC-01/02/05 | PASS |
| AC-PICKUP-LOC-REPAIR-02 | DR-018/019、UX 状态表/编辑矩阵、架构适配器与回滚、API 422/502/503、AC-03/04/06/08 | PASS |
| AC-PICKUP-LOC-REPAIR-03 | DR-020、API Duplicate determinism、AC-07 | PASS |
| QG-RR-PL-01 | UX 农村/不相容状态、AC-02/03/05 的行政路径限定 | PASS（owner 修订，待 QG 复核） |
| QG-RR-PL-02 | API PATCH MUST、UX 规范化触发、AC-06 等价/边界夹具 | PASS（owner 修订，待 QG 复核） |

执行的任务定义验证：

```text
git diff --check -- docs/01-domain-rules.md docs/04-prd.md docs/06-ux-spec.md docs/08-system-design.md docs/09-api-data-contract.md docs/10-test-plan.md docs/decisions/2026-08-31-pickup-location-source-of-truth.md evidence/pickup-location-requirements-repair-2026-08-31.md
# exit 0; no whitespace errors
```

## 下游决定与阻断

1. 下一责任角色为 Quality Governor，按 QG-PL-01–05 以及 QG-RR-PL-01/02 复核本修复；通过后 Engineering Lead 才能建立独立实现包。
2. 实现包不得把行政路径相容命名、测试或运营文案升级为真实业务几何边界证明；若 ServiceArea 非单目录节点，必须 `BLOCKED` 回到 Requirements/Architecture。
3. 实现包不得接入真实 Key、生产提供方或公共 OSM 默认回退；未配置、不可映射、提供方/地图失败时新建、位置变更、INACTIVE→ACTIVE 均零位置写入。
4. 真实提供方/农村覆盖、条款/许可/限流与目标地区预发布抽样仍为外部发布阻断，不是本需求修复可关闭的证据。
