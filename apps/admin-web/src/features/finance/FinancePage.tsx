import { Table } from 'antd';
import type { Refund, Settlement } from '../../api.ts';

type StatusTag = (props: { value: string }) => React.ReactNode;

function StatCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className={`stat-card stat-card--${tone}`}><span className="stat-card__label">{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

/** Finance is deliberately presentation-only: mutations stay in their role-gated case queues. */
export function FinancePage({ refunds, settlements, loading, money, dateTime, StatusTag }: {
  refunds: Refund[];
  settlements: Settlement[];
  loading: boolean;
  money(cents: number): string;
  dateTime: Intl.DateTimeFormat;
  StatusTag: StatusTag;
}) {
  return <>
    <header className="section-header"><div><h1>财务管理</h1><p>查看平台退款记录与对账信息；社区团购不产生商户佣金或自提点结算。</p></div></header>
    <section className="stats">
      <StatCard label="历史撮合待结算（兼容）" value={money(settlements.reduce((sum, item) => sum + item.merchantReceivableCents, 0))} note="仅历史撮合订单，只读兼容" tone="green" />
      <StatCard label="历史平台服务费（兼容）" value={money(settlements.reduce((sum, item) => sum + item.commissionCents, 0))} note="不用于社区团购毛利" tone="red" />
      <StatCard label="退款处理中" value={String(refunds.filter((item) => ['CREATED', 'PROCESSING'].includes(item.status)).length)} note="笔退款" tone="amber" />
    </section>
    <section className="panel"><div className="panel__head"><div><span className="eyebrow">平台资金</span><h2>退款记录</h2></div></div><Table<Refund> rowKey="id" loading={loading} dataSource={refunds} pagination={{ pageSize: 10 }} scroll={{ x: 720 }} columns={[{ title: '订单', dataIndex: 'orderId' }, { title: '退款单号', dataIndex: 'providerRefundNo' }, { title: '金额', dataIndex: 'amountCents', render: (value: number) => money(value) }, { title: '状态', dataIndex: 'status', render: (value: string) => <StatusTag value={value} /> }, { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => dateTime.format(new Date(value)) }]} /></section>
    <section className="panel panel--spaced"><div className="panel__head"><div><span className="eyebrow">历史兼容 · 只读</span><h2>历史撮合结算</h2></div></div><Table<Settlement> rowKey="id" dataSource={settlements} pagination={{ pageSize: 8 }} columns={[{ title: '历史订单', dataIndex: 'outOrderNo' }, { title: '应收金额', dataIndex: 'merchantReceivableCents', render: (value: number) => money(value) }, { title: '历史服务费', dataIndex: 'commissionCents', render: (value: number) => money(value) }, { title: '状态', dataIndex: 'status', render: (value: string) => <StatusTag value={value} /> }]} /></section>
  </>;
}
