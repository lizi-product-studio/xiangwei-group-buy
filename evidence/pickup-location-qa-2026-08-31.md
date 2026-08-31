---
run_id: RUN-20260831T032435Z-be4a70
task_id: TASK-PICKUP-LOCATION-IMPLEMENTATION
attempt: 3
role: qa
date: "2026-08-31"
conclusion: PASS
---

# 自提点定位独立 QA 验收

## 当前结论

`PASS`（本地实现与当前工作树）。

最终返工已关闭先前的 QA-PL-01 至 QA-PL-04：位置确认状态接入提交双门禁；经纬度只读；失败、恢复及重复覆写具确定性浏览器证据；确认成功后发生 Leaflet `tileerror` 也会进入可见 `FAILED` 并禁止位置写入，直到地图恢复并重新确认。服务端行政路径、fail-closed、PATCH 原值保留、重复候选/覆写/自身排除和无公共 OSM/Nominatim 生产回退维持通过。

真实 MySQL 8.4/Redis 7.4 集成环境和真实、获批准的位置提供方仍为 `BLOCKING_EXTERNAL`；本次 `PASS` 不能替代它们，也不能形成上线/预发布通过结论。

以下 attempt 1/2 finding 是审查历史；以 attempt 3 的最终定点复核为当前裁定。

## 已核对输入与范围

- `AGENTS.md`、`tasks/TASK-PICKUP-LOCATION-IMPLEMENTATION.yaml`、`docs/project-status.json`、`docs/00-project-context.md`、`docs/01-domain-rules.md`、`docs/02-glossary.md`。
- 任务包列出的全部上游输入：PRD、UX、系统设计、API/数据契约、测试计划、ADR、需求修复交接和 Quality Governor 复审。
- 实现方交接：`evidence/pickup-location-implementation-2026-08-31.md`。
- 只读检查当前工作树的实现差异、API/契约/后台测试与 E2E；未修改业务源码、测试、配置、需求或治理状态。

## 通过的独立核对

| 范围 | 结果 | 证据/判断 |
| --- | --- | --- |
| 权限与行政事实源 | PASS_LOCAL | 点位 GET/POST/PATCH 均要求 `OPERATOR` 或 `SUPER_ADMIN`；管理端只将 `serviceAreaId` 放入点位请求。`serviceAreaId → regionCode → directory` 用于服务端路径比较。 |
| 写入安全失败 | PASS_LOCAL | 注入的 `NOT_CONFIGURED`、`UNMAPPABLE`、路径不相容与 `UNAVAILABLE` 分别得到 503/422/409/502；相关测试断言未保存点位或保留旧值。 |
| PATCH 触发与精确保留 | PASS_LOCAL | 规范化等价地址、六位 GCJ-02 等价坐标及非位置修改跳过适配器并保留持久地址/坐标；跨六位阈值失败不写入。 |
| 重复提示 | PASS_LOCAL | 同服务区的地址/距离候选、首次 409、`confirmDuplicate` 覆写、审计以及 PATCH 自身排除均有 API/原语测试。50 米仍按契约作为 `DEFAULT_ASSUMPTION`。 |
| 公共 OSM 回退 | PASS_LOCAL | `rg` 未在应用源码发现 Nominatim/OpenStreetMap 端点；`geo-search.ts` 只调用高德，未配置 Key 时返回 503。 |
| 测试夹具泄漏 | PASS_LOCAL（静态） | 内置确定性逆编码夹具仅在 `NODE_ENV === "test"` 且未注入适配器时选择；`src/server.ts` 仅以 config 调用 `buildApp`，生产入口不会注入测试适配器。依赖注入接口本身仍应只在受控测试/启动边界使用。 |

## 必须返工的发现

### QA-PL-01 — 地图/逆编码失败后仍可保存（P1）

**已批准行为：** AC-PICKUP-LOC-08 和 UX 规定地图瓦片或交互失败时保留当前会话，但新建、位置变更和重新启用必须不可保存/启用；不得仅显示错误后继续提交。

**复现/代码证据：**

- `apps/admin-web/src/pickup-location-picker.tsx:126-128` 在 `tileerror` 时只设置 `mapError`；`reverseAt` 在失败时同样只设置错误文本（:89-102）。
- 该组件只把 `disabled` 关联到未选服务区域或目录加载失败（`App.tsx:2633-2638`），并未接收或上报 `mapError`/逆编码失败状态。
- 表单提交在 `App.tsx:2454-2528` 未检查地图/逆编码状态；保存按钮在 :2692+ 没有失效条件。只要经纬度字段有值，地址校验即可通过（:2623-2630）。

**影响：** 地图瓦片/交互失败后，运营仍能点击保存；若服务端逆编码可用，写入会成功，直接违反 AC-08 的 UI 门禁。若服务端也失败，虽由 API 拒绝位置写入，但客户端并未满足“不可保存/启用”的恢复契约。

**要求：** 将地图可用性、逆编码进行中/失败和当次已成功确认的状态提升到表单保存状态机；对新建、位置触发 PATCH 与 INACTIVE→ACTIVE 禁用提交直到地图确认成功。纯非位置 PATCH 仍必须可保存，保持 DR-019 兼容。新增确定性前端/E2E 故障注入，断言输入/图钉保留、保存/启用不可用且没有 POST/PATCH。

### QA-PL-02 — 运营人员仍可直接编辑经纬度（P1）

**已批准行为：** DR-018 和 UX 明确经纬度不是运营表单字段，运营不直接编辑数值；地址/POI 与地图点击或拖动图钉是输入/确认路径。

**代码证据：** `apps/admin-web/src/App.tsx:2651-2667` 渲染未禁用的 `InputNumber`（“地图经度”“地图纬度”）；现有 `community-ui.spec.ts:187-188` 也通过填入这两个控件完成创建。

**影响：** 可在地图不可用或未完成确认时手工构造坐标并绕过客户端地图确认，且自动化测试把这种被禁止的操作当作成功路径。这与 QA-PL-01 合并后使 AC-02/04/08 的管理端闭环不足。

**要求：** 移除或设为只读的数值坐标输入，仅以可访问的地图状态/图钉摘要展示；测试改为显式选择 POI 或地图交互。服务端现有核验必须保留，不能依赖 UI 隐藏作为安全边界。

### QA-PL-03 — AC-PICKUP-LOC 管理端自动化覆盖缺失（P1）

`pnpm test:e2e` 的社区流程通过，但定位段只测试选服务区域后点击省/市/区及手工填坐标创建。没有确定性覆盖：不自动选择首个 POI、搜索/逆编码/地图瓦片失败的保留与禁用、重复候选覆写、重新启用、位置 PATCH、或无障碍状态文案。当前后台单测也没有 `pickup-location-picker` 组件测试。

**要求：** 在修复 QA-PL-01/02 时补齐任务包要求的 AC-PICKUP-LOC-01 至 08 管理端/API 证据，尤其以失败注入验证零请求/零写入边界；不得再将旧的手工坐标 E2E 作为地图确认验收。

## 实际执行验证

使用受控本地 Node `v24.19.0`（项目要求 Node 22+）执行：

- `pnpm --filter @hometown/api-contracts test`：PASS，16 tests。
- `pnpm --filter @hometown/api test`：PASS，77 passed；`mysql-redis.integration.test.ts` 的 7 tests 因未配置真实 URL 跳过，非通过。
- `pnpm --filter @hometown/admin-web test`：PASS，56 tests。
- `pnpm check`：PASS（lint、类型、工作区测试、生产构建）；API 仍为 77 passed / 7 skipped。
- `pnpm test:e2e`：PASS，Playwright 11/11；`test-results/.last-run.json` 记录 `status: passed`。
- `git diff --check`：PASS。

初次直接运行时系统 PATH 缺少 `node`；未将该启动失败记为测试通过。通过桌面受控 Node 运行时重跑后取得以上结果。

## AC 状态与外部阻断

| AC | 独立 QA 状态 | 说明 |
| --- | --- | --- |
| AC-PICKUP-LOC-01/02 | PASS_LOCAL | 单一服务区域行政事实链、提供方中立的 API 校验边界和只读坐标 UI 均已复核。 |
| AC-PICKUP-LOC-03/04/05 | PASS_LOCAL | 搜索/逆编码/路径失败维持 fail-closed；本次 UI 的 503 恢复与地图失败门禁具确定性浏览器证据。 |
| AC-PICKUP-LOC-06/07 | PASS_LOCAL | PATCH 保留、六位阈值、重复候选/覆写/自身排除已由 API 测试覆盖；管理端覆写流程已复核。 |
| AC-PICKUP-LOC-08 | PASS_LOCAL | 逆编码失败和确认后的 Leaflet tile error 都保留会话、禁用保存且零位置写入，地图恢复并重新确认后才恢复。 |
| MySQL/Redis 集成 | BLOCKING_EXTERNAL | 未配置 `INTEGRATION_DATABASE_URL` 与 `INTEGRATION_REDIS_URL`，7 项集成测试跳过。 |
| 真实位置提供方 | BLOCKING_EXTERNAL | 无真实高德 Key、批准/条款/覆盖或预发布抽样证据；无 OSM 回退不等于真实提供方通过。 |

## 交接

- run_id: `RUN-20260831T032435Z-be4a70`
- task_id: `TASK-PICKUP-LOCATION-IMPLEMENTATION`
- attempt: `1`
- artifacts changed: 仅本证据文件。
- assumptions: 50 米重复阈值继续按 DR-020 标记为 `DEFAULT_ASSUMPTION`；ServiceArea 单一行政节点语义继续为 `BLOCKING_UNKNOWN` 的业务边界风险。
- deviations: 无源码修复；未配置真实集成或地图凭据。
- next responsible role: Orchestrator，继续处理外部发布证据与 go-live 阻断；无需本地定位返工。

---

## 返工后独立复核（attempt 2）

### 复核范围与结果

对最终差异重新检查了 `apps/admin-web/src/App.tsx`、`apps/admin-web/src/pickup-location-picker.tsx`、新增的 `pickup-location-picker.test.tsx` 和 `community-ui.spec.ts`，并在独立受控 Node 24.19.0 运行时实际执行：

- `pnpm --filter @hometown/admin-web test`：PASS，11 files / 58 tests。
- `pnpm exec playwright test apps/admin-web/e2e/community-ui.spec.ts`：PASS，1/1；`test-results/.last-run.json` 为 `passed`。
- `git diff --check`：PASS。

返工已关闭以下原发现：

1. **QA-PL-02 已关闭。** “地图经度/纬度”可编辑 `InputNumber` 已移除；页面只保留带 `aria-live` 的“地图图钉坐标（只读确认）”摘要，提交仍由隐藏的表单字段承载。
2. **QA-PL-03 大部分已关闭。** E2E 以浏览器路由确定性注入 reverse 503，再改为 200 并点击“重试核验”；测试断言失败时保存按钮 disabled、零点位 POST，成功后才保存。首次重复 POST 以局部 409 注入触发确认弹窗；带 `confirmDuplicate: true` 的第二次请求继续到真实内存 API，未替换生产重复覆写逻辑。该测试没有放宽全局 4xx/5xx 规则，只局部豁免这两项已断言的预期响应。
3. **QA-PL-01 部分关闭。** `UNCONFIRMED/VERIFYING/CONFIRMED/FAILED` 状态和 `isPickupLocationSubmissionBlocked` 已接入保存按钮和 onFinish 双门禁；编辑点位的纯非位置修改保留 `locationChangeRequired=false`，即使定位状态为失败仍可保存，符合 DR-019。

### 残余必须返工：QA-PL-04 — 已确认后地图瓦片失败被忽略（P1）

**结论：** 仍为 `NEEDS_REVISION`，不能将 AC-PICKUP-LOC-08 标记通过。

**契约：** UX 的“地图瓦片或交互不可用”状态要求在新建、位置变更和 INACTIVE→ACTIVE 时保留会话但不可保存/启用。该要求没有“此前一次逆编码已成功”例外。

**最终代码证据：** `pickup-location-picker.tsx:157-164` 的 `tileerror` 回调在 `verificationStateRef.current === "CONFIRMED"` 时直接 return，并刻意注释为不使已确认坐标失效。此时不会报告 `FAILED`、不会展示 map error，也不会使 `App.tsx` 的 `isPickupLocationSubmissionBlocked(locationChangeRequired, locationVerification)` 返回 true。因此，已确认地点随后瓦片/地图交互失败时，位置写入仍可提交。

**验证缺口：** 新 E2E 只验证“确认前 reverse 503 → disabled → retry 200”，没有注入或断言确认后的 tile/interaction 失败。它不能证明上述例外满足 AC-08。

**修复要求：** 对本次仍需要位置确认的创建、位置变更与重新启用，一旦地图瓦片/交互在会话中不可用，须进入可见 `FAILED` 并禁用保存，直至地图恢复且当前图钉重新完成确认；纯非位置 PATCH 继续允许。补充确认成功后再发生 tile/interaction 失败的确定性 E2E，断言保存禁用、无 POST/PATCH、现有输入和图钉保留。

### 外部阻断不变

真实 MySQL/Redis 集成 URL、真实获批准位置提供方的 Key/条款/目标区域覆盖和预发布抽样均继续为 `BLOCKING_EXTERNAL`。本复核未把本地模拟、浏览器 route mock 或 E2E 绿色结果当作这些外部证据。

### attempt 2 handoff

- run_id: `RUN-20260831T032435Z-be4a70`
- task_id: `TASK-PICKUP-LOCATION-IMPLEMENTATION`
- attempt: `2`
- conclusion: `NEEDS_REVISION`（已由 attempt 3 覆盖）
- evidence: 本文件“返工后独立复核（attempt 2）”；定向后台测试、定向 E2E、`git diff --check`。
- artifacts changed: 仅本 QA evidence 文件。
- next responsible role: Engineering Lead，定点修复 QA-PL-04；之后由新鲜独立 QA 会话复审。

---

## 最终定点复核（attempt 3）

### 修复核对

`apps/admin-web/src/pickup-location-picker.tsx:154-157` 已删除此前对 `CONFIRMED` 的 tile-error 豁免：任意 Leaflet `tileerror` 都设置可见地图错误并报告 `FAILED`。父表单的 `isPickupLocationSubmissionBlocked` 因而对创建、位置变更和重新启用禁用保存；`onFinish` 再次执行相同判断。地图“重试”会清理地图实例、返回 `UNCONFIRMED`，只能在重新点击/拖动图钉并成功逆编码后恢复 `CONFIRMED`。由于纯非位置 PATCH 的 `locationChangeRequired=false`，该兼容路径仍不被地图故障阻断。

### 独立执行证据

- `pnpm exec playwright test apps/admin-web/e2e/community-ui.spec.ts`：PASS，1/1（本 QA 会话实际重跑）。
- `git diff --check`：PASS（本 QA 会话实际重跑）。

该 E2E 在同一表单会话中确定性验证：reverse 503 → 保存禁用/零点位 POST → 逆编码成功；随后对已确认的 `.leaflet-tile` 直接派发 `error` → 地图错误可见、保存再次禁用、仍为零点位 POST；点击“重试地图”并重新点选图钉 → 成功逆编码后保存恢复。后续重复点首次 POST 只在浏览器局部注入 409 以验证确认 UI，`confirmDuplicate:true` 的第二次请求仍进入真实内存 API。因此该模拟不改变或放宽生产逆编码、路径检查或重复覆写逻辑。

### attempt 3 handoff

- run_id: `RUN-20260831T032435Z-be4a70`
- task_id: `TASK-PICKUP-LOCATION-IMPLEMENTATION`
- attempt: `3`
- conclusion: `PASS`
- evidence: 本文件“最终定点复核（attempt 3）”；定向 E2E 1/1、`git diff --check`。
- artifacts changed: 仅本 QA evidence 文件。
- accepted risks: 无本地风险接受；真实 MySQL/Redis 与真实提供方继续为 `BLOCKING_EXTERNAL`，不计入 PASS。
- next responsible role: Orchestrator，更新发布证据/外部阻断状态。
