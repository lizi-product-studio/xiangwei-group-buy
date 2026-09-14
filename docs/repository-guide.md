# 仓库导航与清理说明

适用于乡味集后续迭代。目录名称不等于文件价值：运行源码、开发工具、设计依据、历史证据和可重建产物分开管理。

## 1. 日常开发入口

| 要做的事 | 入口 | 说明 |
| --- | --- | --- |
| 改接口、登录、订单、配送、退款、通知 | `apps/api/` | 后端源码及测试，不能整体当作服务生成文件清理 |
| 改运营后台或点位负责人工作台 | `apps/admin-web/` | 两类网页入口共用该应用，不另建重复系统 |
| 改消费者小程序 | `apps/miniprogram/` | 微信开发者工具导入此目录；保留原有 AppID、本地受限配置及打包资源 |
| 改公共金额或状态规则 | `packages/domain/` | API 等包的构建依赖 |
| 改跨端请求和响应约定 | `packages/api-contracts/` | 公共接口契约及测试 |
| 改部署、数据迁移、运行环境 | `infra/`、两个应用的 `Dockerfile` | 新库基线不是清空现有数据库的脚本 |
| 改开发命令、资源生成、维护工具 | `scripts/`、根 `package.json` | 脚本也是项目源码，不能按扩展名当垃圾清掉 |
| 改自动质量检查 | `.github/workflows/`、ESLint/TypeScript/Playwright 配置 | 与包清单、锁文件一起保留 |

工作区由 `pnpm-workspace.yaml` 的 `apps/*`、`packages/*` 组成。根 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.env.example`、`.gitignore`、`.dockerignore` 均保留。锁文件用于重现依赖版本，不是缓存。

## 2. 哪些内容不在产品运行链路中

| 内容 | 分类及本轮处置 | 后续使用方式 |
| --- | --- | --- |
| `prototypes/` | 设计参考，保留 | 静态原型不能证明真实登录、支付、权限或数据库已接通；浏览器脚本需要匹配其运行环境的检查配置 |
| `docs/task-*.md`、`docs/handoff-*.md`、`docs/evidence/` | 历史任务与验收，原位保留 | 按任务日期和提交号追溯；不要把旧 PASS 当作当前全系统 PASS |
| `tasks/`、`evidence/` | 历史契约和验收证据，原位保留 | 文档之间存在路径引用，移动前须迁移引用 |
| `.dingxinglizi/` | 历史流程资料与契约，原位保留 | 不属于应用运行依赖；保留不代表重新启用旧编排工具或被禁用的 skill |
| `design-qa.md` | 设计验收记录，保留 | 用于核对批准过的界面与回归，不当作运行配置 |
| `.codex/` | 本机任务配置，保留原位 | 当前未跟踪内容不顺手提交，不因其未跟踪就删除 |
| `node_modules/`、`.pnpm-store/` | 可重建依赖，已忽略 | 安装后本地开发要用，本轮保留，避免下一次迭代重新下载 |
| `dist/`、微信编译产物 | 可重建但可能正在被预览或运行使用 | 本轮保留；先确认使用方、构建命令和可恢复性，再单独清理 |
| `coverage/`、`test-results/`、`playwright-report/`、已知 `*.tsbuildinfo` | 可重建报告或增量缓存 | 通过维护脚本列出精确路径，归档验证后清理 |

运行需要的商品图片、字体、SVG、小程序静态资源都属于产品资产。**不能把所有图片、JavaScript 文件、SQL、测试代码或未跟踪文件当作垃圾批量删除。** 本地 `.env`、`infra/secrets/`、小程序私有配置只保留在原位置，不上传 GitHub。

## 3. 文档阅读顺序

1. [项目概览与运行命令](../README.md)、[产品需求](PRD.md)、[架构](architecture.md)、[上线清单](go-live-checklist.md)：进入项目的首要资料。
2. [订阅消息规格](wechat-subscription-template-design.md)、[状态权限矩阵](05-state-permission-matrix.md)、[接口与数据契约](09-api-data-contract.md)、[设计系统](07-design-system.md)：按本轮功能读取，并与后续已确认任务决定核对。
3. [迁移记录](task-20260907-housekeeping-migration.md)、[小程序目标环境](task-20260907-mini-target.md)：环境边界与历史证据；实际上线版本仍需实时验证。
4. [遗留项与方案](go-live-issues-and-solutions.md)、[容量交接](handoff-20260908-readiness.md)、[容量修复记录](task-20260908-readiness-repair.md)：继续未完成工作的起点，不能据此宣称千人容量已经验收。
5. `task-*`、`handoff-*`、`task-rem-*`、编号文档、`tasks/`、`evidence/` 和 `docs/project-status.json`：保留时间和版本上下文。尤其 `project-status.json` 的历史更新时间不能当作实时进度。

目录通过本页分组导航，保留旧路径以避免破坏任务、证据和代码引用。不要为“看起来整齐”制造同一文档的多个副本。

## 4. 清理方式

先运行 `pnpm clean:artifacts` 查看候选。只有明确的、被 Git 忽略且不含跟踪文件或符号链接的构建报告路径才允许进入清理清单。实际清理需提供仓库外的新归档目录；归档与内容哈希核对通过后才移除原产物。具体用法见脚本 `--help`。

清理工具不递归删除任意目录，不清依赖、构建运行目录、数据库卷、用户原型、配置或历史证据。每轮检查若需要报告证据，先归档再清理；本轮恢复清单及实际结果见 [整理记录](task-20260914-repo-organize.md)。

## 5. 分支与下一轮起点（2026-09-14 核对）

`evidence-inferred`：本地起点为 `codex/audit-remediation` 的 `f2162ad`，包含手机号登录文案、分享以及游客消息登录跳转修复。本轮整理在此基线上进行。

另一个 Agent 推送的 [`codex/prototype-sync-20260914`](https://github.com/lizi-product-studio/xiangwei-group-buy/tree/codex/prototype-sync-20260914)（[`cd9ed43`](https://github.com/lizi-product-studio/xiangwei-group-buy/commit/cd9ed435f35bb5d5d89a3fd3c586c8e227fbb2da)）包含新的统一原型、通知并发改动及隔离测试工具；该分支来自较早基线，并非本地上述修复之后的完整合并结果。其质量检查在 lint 阶段失败，后续测试未得到本次流水线验证。

已下载该固定提交的只读归档，与本地共同源码基线 `9f7b964` 逐文件对比：4 个文件修改、34 个新增、无删除。新增内容分类如下：

| 新提交内容 | 去向与待办 |
| --- | --- |
| `apps/api/src/modules/notifications/` 的改动、capacity 脚本与安全测试 | 业务与测试源码，保留在原开发分支；合并后验证通知并发、超时和迟到响应 |
| `infra/readiness-test/` | 隔离测试工具，保留；不属于线上运行服务，不按历史文档直接连接旧服务器 |
| 两份隔离服务器测试任务文档 | 历史测试交接，保留；记录未完成，不能当作测试通过 |
| `prototypes/xiangwei-group-buy-system-20260914/` | 新版统一设计参考，保留；浏览器原型需正确的 lint 环境配置 |
| `prototypes/admin-list-split-20260908/` | 旧列表设计参考，合并时归入历史原型索引 |
| `prototypes/miniprogram-15pm-20260909/assets/` | 6 张图与新版原型图片逐字节相同，共 2,452,235 字节；是可去重候选，需在原型分支核对所有引用并迁移后再去重，本轮未删除 |

新流水线 [Quality #78](https://github.com/lizi-product-studio/xiangwei-group-buy/actions/runs/34798404889) 共报告 39 个 lint 错误，已看到浏览器原型的 `URLSearchParams`、`location`、`document` 被当作未声明变量。这类检查配置问题不能通过删除原型或关闭整个检查来掩盖。

本次不通过整分支覆盖来“同步最新”。开始业务迭代前，应在保留两边提交的前提下合并新原型和待验收变更，修复检查配置，再验证相关业务。GitHub 默认分支、当前工作分支、生产服务器和微信版本分别核对。本页记录的是仓库整理边界，不是上线批准。
