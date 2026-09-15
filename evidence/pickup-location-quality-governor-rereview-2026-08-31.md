---
run_id: RUN-20260831T032435Z-be4a70
task_id: TASK-PICKUP-LOCATION-REQ-REPAIR
attempt: 2
role: quality_governor
review_type: owner_handoff_rereview
conclusion: PASS
date: "2026-08-31"
selected_model: gpt-5.6-sol
reasoning_effort: high
runtime_attestation: "Main Agent explicit spawn configuration; launch/session attestation only, with no independent runtime tool echo"
---

# 自提点定位需求修复独立复核

## 结论

`PASS`。

Owner 已无矛盾关闭第 1 次复核提出的 QG-RR-PL-01 与 QG-RR-PL-02；定点返工没有引入新的 P0/P1。结合第 1 次复核已通过的 QG-PL-02、QG-PL-04、QG-PL-05，以及本次关闭的 QG-PL-01/QG-PL-03 残留项，QG-PL-01 至 QG-PL-05 的需求层重进条件全部满足。

本结论只放行 Main Agent 后续建立独立 Engineering Lead 实现包；它不证明定位功能已经实现、真实提供方可用、真实农村覆盖、生产可用或发布通过。

## 第 2 次重进复核

### QG-RR-PL-01 — PASS

原问题：UX 把建议地址/行政路径相容重新表述成地址或实际服务范围已核验，并暗示“地址坐标不一致”是第二保存判断源。

关闭证据：

- `docs/06-ux-spec.md:56` 已把只读摘要从“服务范围”改为“行政目录”。
- `docs/06-ux-spec.md:61` 只显示适配器“建议展示地址”和行政目录路径相容状态，并明确建议地址不证明门牌，路径相容不证明实际服务范围、门牌或可达性。
- `docs/06-ux-spec.md:63` 删除“地址坐标不一致”状态名，并明确地址文本仅为运营提示，绝不参与行政归属或保存判定。
- `docs/06-ux-spec.md:58,78` 与上述语义一致：POI 地址保持“建议”性质，路径通过不得升级成实际服务范围验证。
- `docs/10-test-plan.md:31-34` 的 AC-PICKUP-LOC-02/03/05 仍只验证 provider-neutral adapter 与行政路径，不引入几何边界或门牌正确性声明。

反证结果：未再发现“经核验的展示地址”“逆编码行政区在范围内”“地址坐标不一致”或等价第二判断来源。QG-PL-01 的原始过度声明风险已关闭；ServiceArea 单目录节点仍正确保留为 `DEFAULT_ASSUMPTION` / `BLOCKING_UNKNOWN`，没有被升级为业务事实。

### QG-RR-PL-02 — PASS

原问题：未触发 PATCH 的位置原值保留在 DR/系统设计中是 MUST，但 API 写成 `may retain`；规范化等价地址和六位等价坐标缺少边界夹具。

关闭证据：

- `docs/09-api-data-contract.md:69` 现在要求：若规范化地址、六位 GCJ-02 坐标和 INACTIVE→ACTIVE 均未触发，API **MUST ignore** 所有提交的位置字段、**MUST preserve** 持久化地址/纬度/经度精确原值、**MUST skip** 适配器。
- 同一契约显式覆盖格式不同但规范化等价的地址，以及六位比较等价的纬度/经度，不再允许“跳过核验但写入细微变化”的实现分支。
- `docs/06-ux-spec.md:70-71` 已统一为“规范化地址改变”，并明确客户端提示不能替代服务端 API 判定；未触发 PATCH 必须忽略等价位置输入并逐值保留原值。
- `docs/10-test-plan.md:35` 的 AC-PICKUP-LOC-06 新增 NFKC/空白/中英文标点等价地址、六位等价坐标抖动和刚跨六位比较边界夹具；分别断言适配器跳过且原值 byte/number-identical，或触发核验且失败零位置写入。

反证结果：DR-019、UX、API 和 AC-06 现在对触发、忽略、原值保留与边界测试使用相同强度。未发现可让实现者在“忽略保留”和“未经核验写入”之间任选的剩余模态词。

## 完整 finding 状态

| Finding | 第 2 次最终状态 | 证据边界 |
|---|---|---|
| QG-PL-01 | `PASS` | 单一行政事实链、行政路径相容措辞和残留风险一致；QG-RR-PL-01 已关闭 |
| QG-PL-02 | `PASS` | provider-neutral adapter、MAPPED/NOT_CONFIGURED/UNAVAILABLE/UNMAPPABLE、422/502/503 和无公共 OSM 默认回退已冻结；真实提供方仍为外部阻断 |
| QG-PL-03 | `PASS` | 无持久已/待核验状态、PATCH 触发矩阵、非触发精确原值保留及等价边界夹具一致；QG-RR-PL-02 已关闭 |
| QG-PL-04 | `PASS` | 搜索/地图/适配器/不可映射失败、当前会话恢复、零位置写入和安全回滚保持一致 |
| QG-PL-05 | `PASS` | 50 米仍为可覆写 `DEFAULT_ASSUMPTION`；自身排除、规范化、Haversine、首次候选/覆写审计与禁止自动合并保持不变 |

## 新矛盾与目标漂移检查

- `CONFIRMED`：本次定点修订只收紧 UX 文字、API MUST 语义、AC-06 边界夹具和 owner handoff；未扩大到实现、数据迁移、依赖、配置、真实 Key、生产端点或生产数据。
- `CONFIRMED`：AC-PICKUP-LOC-01 至 08 仍为 `PLANNED`，没有把需求/测试计划冒充实现或 QA 结果。
- `CONFIRMED`：真实提供方、许可/隐私/限流、目标农村覆盖、目录映射长期稳定性和真实预发布仍被保留为 `BLOCKING_EXTERNAL`，没有以本地夹具关闭。
- `BLOCKING_UNKNOWN`：ServiceArea 是否真实等同单个行政目录节点。若后续发现自定义、重叠或非目录对齐范围，现实现边界仍必须停止并回到 Requirements/Architecture。
- 未发现新的 P0/P1、权限扩大、不可逆行为、供应链默认回退或验收门禁弱化。

## 输入、快照与验证

第 2 次复核重新完整读取：

- `docs/06-ux-spec.md`
- `docs/09-api-data-contract.md`
- `docs/10-test-plan.md`
- `evidence/pickup-location-requirements-repair-2026-08-31.md`
- 本 evidence 的第 1 次 `NEEDS_REVISION` 内容，并以 QG-RR-PL-01/02 作为重进条件

本次读取快照 SHA-256：

- UX: `5884ddf5c0fde32514bc9e88451d1d6848fe98bed793502a5624eaa42ad098d5`
- API contract: `60f465d9b0762fa49a1b36ce42387f4cb40d7033791f5b5a36795a01a13e3ec1`
- Test Plan: `d8e423e0f77392ae31ef9aa62192e8263eb3ca98209f5c416769c86a4d7698e0`
- Owner repair handoff: `5ee293b7b0251f6f5f8a8afcc755b02288c93c0541f6834c2bdde10373b88ce1`

这些散列只界定本次实际读取快照，不证明交接后从未发生漂移。若上述输入在实现前变化，应重新确认本 PASS 是否仍适用。

执行证据：

```text
git diff --check -- docs/06-ux-spec.md docs/09-api-data-contract.md docs/10-test-plan.md evidence/pickup-location-requirements-repair-2026-08-31.md
# exit 0; no whitespace errors
```

该命令只证明差异没有空白错误；语义 PASS 来自上述逐项反证。

## 模型、权限与证据边界

- Main Agent 明确以 `model=gpt-5.6-sol`、`reasoning_effort=high` spawn 本 reviewer 子会话；这是 launch/session attestation。
- 工具没有返回可独立验证实际运行模型或思考强度的 runtime echo。任务说明 中 owner 的 `gpt-5.6-terra/high` 且 `actual_model_attested: false` 不是本 reviewer 的独立运行证明。
- 本会话没有启动子 agent；未修改需求、代码、测试、配置、任务说明 或项目状态；只更新本 evidence 文件。

## Handoff

- conclusion: `PASS`
- run_id: `RUN-20260831T032435Z-be4a70`
- task_id: `TASK-PICKUP-LOCATION-REQ-REPAIR`
- attempt: `2`
- closed_findings: `QG-RR-PL-01`, `QG-RR-PL-02`
- deviations: 无
- accepted_risks: 无新增风险接受；ServiceArea 语义和真实提供方外部风险继续按现有契约保留
- next_responsible_role: Main Agent。可建立独立 Engineering Lead 实现 任务说明；实现后仍需独立 QA，且不得以本 QG PASS 替代真实提供方/预发布/发布批准。
