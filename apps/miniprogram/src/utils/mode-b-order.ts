type RefundStatus = 'PENDING'|'CREATED'|'PROCESSING'|'FAILED'|'SUCCEEDED'|null|undefined;

export function isModeBOrder(order: Pick<OrderDto, 'businessModelVersion'>): boolean {
  return order.businessModelVersion === 'PLATFORM_PROCUREMENT';
}

export function refundProgressText(status: RefundStatus): string {
  return ({
    PENDING: '待平台确认退款',
    CREATED: '退款排队处理中',
    PROCESSING: '退款处理中',
    FAILED: '退款处理失败，平台正在继续跟进',
    SUCCEEDED: '已退款',
  } as Record<Exclude<RefundStatus, null | undefined>, string>)[status ?? 'PENDING'] ?? '待平台确认退款';
}
