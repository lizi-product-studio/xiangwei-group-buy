---
title: "社区团购 — Product Completeness Checklist"
status: IN_REVIEW
version: 1.1.0
last_updated: "2026-08-31"
owner: product_auditor
source_of_truth: project-document-set
---

# Product completeness checklist

`BLOCKED`/`GAP` 保持为真实发布阻断，不为通过校验而伪造 `COVERED`。Quality Governor 独立复核待完成。

| Item ID | Category | Capability/state | Applicability | Coverage | Requirement/feature/AC refs | Reason or evidence | Owner/target/risk owner |
|---|---|---|---|---|---|---|---|
| PCM-001 | Identity | Registration | NOT_APPLICABLE | COVERED | | WeChat 登录创建身份，无独立注册表 | product |
| PCM-002 | Identity | Login | REQUIRED | BLOCKED | REQ-003, AC-PAY-01 | 本地有契约；真实 AppID 待验 | release |
| PCM-003 | Identity | Verification code | NOT_APPLICABLE | COVERED | | 使用微信 code exchange，无短信验证码 | product |
| PCM-004 | Identity | Forgot/reset password | REQUIRED | COVERED | REQ-013, AC-AUTH-01 | 员工重置；用户使用微信身份 | security |
| PCM-005 | Identity | Logout | REQUIRED | COVERED | REQ-013, AC-AUTH-01 | 小程序退出和员工会话撤销 | security |
| PCM-006 | Identity | Account deletion | REQUIRED | BLOCKED | REQ-012 | 留存/匿名化规则未批准 | product/legal/finance |
| PCM-007 | Discovery | Home | REQUIRED | COVERED | REQ-001, FEAT-DISCOVERY | 真实区域/点位/团期首页 | product |
| PCM-008 | Discovery | Search | NOT_APPLICABLE | COVERED | | 首发小规模策展列表不需要搜索 | product |
| PCM-009 | Discovery | Filter/sort | NOT_APPLICABLE | COVERED | | 区域/固定点位即首发范围 | product |
| PCM-010 | Discovery | List | REQUIRED | COVERED | REQ-001, FEAT-DISCOVERY | 团期与订单列表 | product |
| PCM-011 | Discovery | Detail | REQUIRED | COVERED | REQ-002, FEAT-ORDER | 团期/订单详情 | product |
| PCM-012 | Account | Messages/notifications | REQUIRED | BLOCKED | REQ-011, AC-NOTIFY-01 | 本地闭环；真实模板触达待验 | release |
| PCM-013 | Account | Profile | REQUIRED | COVERED | REQ-013, FEAT-ADMIN-AUTH | 用户资料/登录状态 | product |
| PCM-014 | Account | Settings | NOT_APPLICABLE | COVERED | | 无必要消费者设置；提醒在消息页 | product |
| PCM-015 | Account | Account security | REQUIRED | BLOCKED | REQ-003, REQ-013 | 员工本地通过；真实微信/生产秘密待验 | security |
| PCM-016 | Account | Address/contact records | NOT_APPLICABLE | COVERED | | 固定自提，不采集家庭地址簿 | privacy |
| PCM-017 | Support/legal | Customer service | REQUIRED | BLOCKED | REQ-011, FEAT-NOTIFY | 外部批准渠道/SLA 未确定 | product/legal |
| PCM-018 | Support/legal | Feedback | DEFERRED | GAP | | 当前由客服入口承接，独立入口需证据 | owner=product; target=1.2; risk_owner=product |
| PCM-019 | Support/legal | Complaint | REQUIRED | BLOCKED | REQ-009, FEAT-AFTERSALE | 产品流存在；食品/法务升级 SLA 待批 | product/legal |
| PCM-020 | Support/legal | Help | REQUIRED | COVERED | REQ-009, FEAT-AFTERSALE | 帮助/客服/法律页 | product |
| PCM-021 | Support/legal | Terms/agreement | REQUIRED | BLOCKED | REQ-003 | 版本同意已做，最终法务批准待补 | legal |
| PCM-022 | Support/legal | Privacy | REQUIRED | BLOCKED | REQ-012, AC-PRIVACY-01 | 数据权利代码完成，生命周期政策待批 | legal |
| PCM-023 | Universal state | Loading | REQUIRED | COVERED | FEAT-DISCOVERY, FEAT-ORDER | 页面 load guard/后台加载态 | ux |
| PCM-024 | Universal state | Empty | REQUIRED | COVERED | FEAT-DISCOVERY, FEAT-AFTERSALE | 区域/物流/售后等空态 | ux |
| PCM-025 | Universal state | Failure | REQUIRED | COVERED | FEAT-ORDER, FEAT-LOGISTICS | 错误和重试路径 | qa |
| PCM-026 | Universal state | Offline | REQUIRED | GAP | FEAT-ORDER, FEAT-NOTIFY | 通用错误存在；真机离线态未验 | qa |
| PCM-027 | Universal state | Unauthorized | REQUIRED | COVERED | REQ-013, AC-AUTH-01 | 401/403/身份 epoch | security |
| PCM-028 | Universal state | Expired | REQUIRED | COVERED | REQ-008, REQ-009 | 会话/支付/领取/售后截止 | qa |
| PCM-029 | Object lifecycle | Create | REQUIRED | COVERED | REQ-001, REQ-002 | 运营对象、订单和案件创建 | qa |
| PCM-030 | Object lifecycle | Modify | REQUIRED | COVERED | REQ-005, REQ-012 | 配置/运输/意向更正 | qa |
| PCM-031 | Object lifecycle | Cancel | REQUIRED | COVERED | REQ-004, REQ-010 | 团期/订单取消与退款义务 | qa |
| PCM-032 | Object lifecycle | Delete | NOT_APPLICABLE | COVERED | | 业务事实状态化保留，不做硬删除 | audit |
| PCM-033 | Object lifecycle | Restore | NOT_APPLICABLE | COVERED | | 无删除恢复；员工/配置显式重启用 | audit |
| PCM-034 | Service/commerce | Review/approval | REQUIRED | COVERED | REQ-007, REQ-009 | 差异/售后/取消职责分离 | qa |
| PCM-035 | Service/commerce | Refund | REQUIRED | BLOCKED | REQ-010, AC-REFUND-01 | 本地恢复通过；真实微信退款待验 | release |
| PCM-036 | Service/commerce | After-sales | REQUIRED | COVERED | REQ-009, AC-CASE-01 | 多 SKU、CS→OPS→FINANCE | qa |
| PCM-037 | Service/commerce | Rating/review | NOT_APPLICABLE | COVERED | | 不证明首发履约价值 | product |
| PCM-038 | Service/commerce | Appeal | REQUIRED | GAP | REQ-009 | 拒绝后仅转客服，升级 owner/SLA 未定义 | product/legal |
| PCM-039 | Admin | Search/filter | REQUIRED | COVERED | REQ-005, FEAT-LOGISTICS | 订单查找和运营筛选 | operations |
| PCM-040 | Admin | Review/approve | REQUIRED | COVERED | REQ-007, REQ-009 | 治理审批 | operations |
| PCM-041 | Admin | Configuration | REQUIRED | COVERED | REQ-001, REQ-004 | 区域/点位/SKU/团期/员工 | operations |
| PCM-042 | Admin | Export | DEFERRED | GAP | | 无批准导出需求，避免隐私扩散 | owner=operations; target=1.2-if-proven; risk_owner=privacy |
| PCM-043 | Admin | Logs/audit | REQUIRED | COVERED | REQ-013, FEAT-ADMIN-AUTH | 脱敏审计日志 | security |
| PCM-044 | Admin | Roles/permissions | REQUIRED | COVERED | REQ-013, AC-AUTH-01 | 六角色/点位范围 | security |
| PCM-045 | Closure | Front-office action has backend/system handling | REQUIRED | BLOCKED | REQ-003, REQ-011 | 本地映射完整；真实微信/客服路径待验 | release |
| PCM-046 | Closure | State change and actor are defined | REQUIRED | COVERED | FEAT-CAMPAIGN, FEAT-REFUND | 状态/权限矩阵 | architecture |
| PCM-047 | Closure | User feedback and recovery are defined | REQUIRED | BLOCKED | FEAT-ORDER, FEAT-NOTIFY | 本地恢复完整；真机离线/外部恢复待验 | qa |
| PCM-048 | Closure | Audit/operations handling is defined | REQUIRED | BLOCKED | REQ-014, FEAT-DEPLOY | 运行责任人、恢复演练和告警待补 | operations |

## Conclusion

- 本地核心闭环具备定向代码与测试证据。
- 生产仍被真实微信、数据层/恢复、合规、离线、申诉升级和运行责任阻断。
- 搜索、优惠、评价或导出不会关闭任何当前 P0，不应抢占上线治理工作。
