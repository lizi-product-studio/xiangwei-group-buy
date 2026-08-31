---
title: "社区团购 — UX Specification"
status: APPROVED
version: 1.0.0
last_updated: "2026-08-31"
owner: ux
source_of_truth: project-document-set
---

# UX specification

## Navigation

| Role | Surface / default landing | Primary pages | Exit / recovery |
|---|---|---|---|
| USER | 小程序首页；我的作为账户入口 | 首页、团期、购物车、订单、消息、售后、意向 | 登录取消返回来源；失效清空前账号数据 |
| PICKUP_MANAGER | Web 点位工作台 | 到货、核销 | 无其他后台菜单；403 留在安全页 |
| OPERATOR | Web 工作台 | 商品、团期、订单、配送、点位、售后、治理 | 错误保留当前对象并可重试 |
| CUSTOMER_SERVICE | Web 售后与异常 | 售后、治理、必要订单 | 无财务/配置入口 |
| FINANCE | Web 财务 | 待退款、人工挂起、账本 | 无运营修改入口 |
| SUPER_ADMIN | Web 设置 | 员工、权限、审计、紧急代办 | 敏感动作二次确认 |

## User flows

| Journey | Main steps | Success | Alternate / error | Return / recovery |
|---|---|---|---|---|
| 参团 | 选区域点位→团期→购物车→结算→支付 | 订单显示已支付待截单 | 无覆盖转意向；库存冲突刷新；支付取消保留订单 | 返回订单详情继续支付或查看 |
| 截单履约 | 影响预览→截单→备货运输→到货→差异 | 可生成取货码 | 首次未成团顺延；第二次取消退款；运输异常显示责任 | 用户订单显示新时间/退款进度 |
| 领取 | 出示六码→逐项核销→可再次领取 | 累计领取/完成 | 错码、跨点、重复、截止时刻明确拒绝 | 仍可领取量保持可见 |
| 售后 | 订单入口→选择多商品行→提交→受理/决定/退款 | 案件 RESOLVED | 24h/数量/重复错误；拒绝显示原因 | 回订单详情和消息 |
| 通知 | 查看站内消息→分组授权微信提醒 | 七类语义映射完成 | 拒绝仍有站内消息；失败转人工证据 | “继续授权”处理剩余模板 |
| 数据权利 | 意向页查看→更正 NEW/撤回 | 列表更新 | 已处理更正转客服；撤回说明保留例外 | 保留状态与审计 |

## Page behavior

- 每页一个主任务；提交中禁用；成功先采用写接口真实状态，再刷新。
- 加载新身份前清空旧身份数据；所有同身份重复刷新使用 generation，迟到 data/loading/error 均不得覆盖新结果。
- destructive/sensitive：团期取消、顺延、点位停用、人工通知完成、意向撤回均提供原因/证据与二次确认。
- 错误说明发生了什么和下一步；正常空状态不能被网络错误冒充。

## Accessibility and responsive behavior

- Web 支持键盘焦点、表单 label、Alert live semantics、表格横向适配；移动小程序触控目标不小于常用按钮尺寸。
- 关键交互使用原生 button/switch/picker/input 或提供可访问名称和状态。
- 支持短/长商品名、空列表、错误、禁用和无权限状态；禁止只用颜色表达状态。

## Approval

- Evidence: `apps/admin-web/e2e/*.spec.ts`、`apps/miniprogram/src/pages`、`docs/03-role-journey-matrix.md`。
- Approved baseline: 1.0.0 / 2026-08-31；真实微信真机可访问性仍属于预发布证据。
