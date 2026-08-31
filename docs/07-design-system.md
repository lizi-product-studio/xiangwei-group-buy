---
title: "社区团购 — Design System"
status: APPROVED
version: 1.0.0
last_updated: "2026-08-31"
owner: ui
source_of_truth: project-document-set
---

# Design system

## Principles and tokens

- 一个页面一个主要任务，一个区域通常一个主按钮；信息层级先于解释文案。
- 小程序使用暖白背景、深灰正文、橙红主操作、绿色成功、金/红异常；后台沿用 Ant Design token 并统一状态 Tag/Alert。
- 字号、间距、圆角和颜色以现有 CSS/Ant Design theme 为代码权威，新增页面复用现有组件，不再引入第二套视觉系统。

| Token/category | Reference | Usage | Constraint |
|---|---|---|---|
| primary | 小程序 `#e94c2f` / 后台 theme primary | 主操作、勾选 | 白字对比需真机验证 |
| surface | `#fff` / `#faf9f4` | 内容与页面背景 | 错误不能只靠背景色 |
| text | `#27313d` / secondary gray | 正文/次要信息 | 正文保持可读对比 |
| radius | 16–26rpx / Ant defaults | 表单、状态容器 | 同类组件一致 |
| spacing | 14–32rpx | 标签、表单、卡片 | 不用填充卡片制造层级 |

## Components and variants

| Component | Variants/states | Content / accessibility | Pages |
|---|---|---|---|
| Primary button | default/loading/disabled | 明确动作；提交中不可重复 | 全端 |
| State panel/Alert | loading/empty/error/success/unauthorized | 错误含恢复动作；不把错误显示为空 | 全端 |
| Status Tag | lifecycle colors | 同时显示文字 | 后台列表 |
| Data Table | loading/empty/error/action | 稳定操作列；敏感值脱敏 | 后台 |
| Form | validation/confirm | label、必填、边界、保留输入 | 登录、配置、治理 |
| Order/notification row | unread/read/intermediate | 状态和下一步清楚 | 小程序 |
| Multi-item claim row | selected/unselected/error | switch、原因、数量、说明逐行关联 | 售后 |

## Copy baseline

- 使用“提交退款”“确认发车”“保存更正”“撤回意向”等动作词。
- 禁止“智能、贴心、赋能”等无证据修饰；不承诺微信一定送达或客服已联系。
- “开启提醒”改为“授权订单提醒/继续授权”；站内消息是稳定记录，订阅消息是用户逐次授权的外部能力。

## Responsive/accessibility

- Web 关键桌面宽度和窄视口均不得遮挡主操作；表格允许可控横向滚动。
- 小程序按钮、switch、picker/input 使用原生控件；关键状态提供文字。
- 真机需验证字体缩放、读屏标签、色彩对比、网络错误、长内容和安全区域。

## Visual QA

| Evidence | Page/state | Location | Result |
|---|---|---|---|
| UI-E2E-01 | 五角色默认页/菜单 | `apps/admin-web/e2e/role-defaults.spec.ts` | PASS |
| UI-E2E-02 | 治理完整流程 | `apps/admin-web/e2e/governance-ui.spec.ts` | PASS（新增证据字段待回归） |
| UI-E2E-03 | 物流空/错误 | `apps/admin-web/e2e/logistics-empty.spec.ts` | PASS |
| UI-MP-01 | 微信真机关键页/可访问性 | 预发布证据 | BLOCKED_EXTERNAL |
