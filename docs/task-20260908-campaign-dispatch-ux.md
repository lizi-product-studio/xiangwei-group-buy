# 团期操作间距与发车复核纠正

- task_id: TASK-20260908-CAMPAIGN-DISPATCH-UX
- confirmed：用户要求迅速修正“添加商品”和“下一步：发布复核”按钮紧贴，以及发车复核零单零件、确认后泛化错误的问题。沿本会话已确认的修复、GitHub 同步与服务器更新授权执行本批次静态修复。
- ownership：flow_engineering 唯一源码、Git 和服务器写入者；root 文档与范围；flow_qa 只读定向验收。
- scope：后台 App.tsx、局部 logistics-ui 辅助函数及定向测试。保留 API 既有发车状态规则，不修改生产业务数据、支付、配置或数据库。
- evidence-inferred：发车按钮仅根据运输计划 VEHICLE_BOOKED 显示，缺少新批次要求团期 LOCKED 的前置判断；创建失败也追加“已创建批次可复用”，并由泛化 409 提示掩盖实际条件。
- evidence-inferred：旧复核从全局最近 100 条订单中筛选，既可能遗漏该团订单，又包含非履约订单。改用既有按团期查询的 packing-labels 权威清单；加载失败不伪装成零订单。
- compatibility：已有 DRAFT 批次在团期 FULFILLING 时允许复用；不能一律要求 LOCKED。已发车批次不作为新建批次；只有确认取得批次后才显示可复用提示。
- status：独立 QA attempt 2 PASS，正在同步与静态发布。
- 本地验证：6 项定向单测、typecheck、build、ESLint、diff-check 通过；浏览器 smoke 覆盖 OPEN 拦截、清单 503 不假报零且禁确认、恢复后 1 单 2 件、FULFILLING+DRAFT 复用不重复创建；全局 orders 始终为空，用于证明不依赖最新 100 条订单。
- 最终冻结：App SHA256 `27baa58df5a405cc1dfc85bcabb35c7ba6e100b79a5442058e08364935b77c97`；helper `d110e703d5a31d38e4ea1e8071872473d58b71287a88538916b471e4af76bc06`；test `3ac2b1b5726326394a9bc5b4121566dec68e83102052236a735f50df20683173`。
- QA 发现并修正：创建批次网络响应丢失时不能断言未创建，最终提示“批次创建未确认……请刷新核实后重试”。其他错误仅在确知已有批次时显示可复用。
- UI：“下一步”按钮独立成行，与添加商品保持 24px 间距；复核新增状态与前置条件、权威清单加载状态、失败重试。证据目录 `/Users/lizi/Backups/TASK-20260908-CAMPAIGN-DISPATCH-UX/`。

## 正式更新

- local `f65dd82`，GitHub `43278a25e2d7ac38668bbccc5741348c0e7fe976`；整树一致，非强制同步。当前后台静态目录 `/var/www/hometown-admin-43278a2`，切换前版本 `/var/www/hometown-admin-673e72e` 保留供回滚。
- 发布前旧静态双端备份 SHA256 `9251c699278954a33b83673b8791e3ed522ec38ee706371dfb57383466a84dab`；本轮显式目录 0755、文件 0644，并验证 Nginx 用户逐文件可读后原子切换。
- root 独立实时 HTTPS 后验：两域首页、关键 JS 与 ready 共 6 项返回 200；首页 SHA256 `15ae5bb1f763291429d3ba90c33847ccd3779bd49f3b788eabc3964e17983d13`，`index-C9qbB6tt.js` SHA256 `efa53513e3cceff3da81d896a2ebb1091a3e30f0aa89c9309d3708bc44bad4cd`，均与本轮产物一致。
- 未代用户创建批次或发车，未改后端状态规则。具体业务操作由用户按更新后的团期状态与提示执行；截图中的零订单不能单凭旧统计认定为真实无订单。

- 工程最终后验 PASS：30 项精确 HTTPS 检查通过；API/MySQL/Redis 容器及 API 环境、Nginx 指纹与切前一致。双端 release-evidence.json SHA256 为 `040f647d17b65b65a29bc5449d0facf51b7952fd2e7bee613d273317fd263893`；证据目录 `/Users/lizi/Backups/TASK-20260908-CAMPAIGN-DISPATCH-UX-RELEASE/`。本记录只作文档同步，不触发再次发布。
