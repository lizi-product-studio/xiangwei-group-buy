import { Button, Table } from 'antd';
import type { CommunityDelivery, DeliveryPlan } from '../../api.ts';

export function PickupPointWorkbenchPage({ deliveries, plans, loading, renderStatus, onConfirmArrival, onVerify }: {
  deliveries: CommunityDelivery[];
  plans: DeliveryPlan[];
  loading: boolean;
  renderStatus(delivery: CommunityDelivery): React.ReactNode;
  onConfirmArrival(delivery: CommunityDelivery): void;
  onVerify(plan: DeliveryPlan): void;
}) {
  return <>
    <header className="section-header"><div><span className="eyebrow">仅限已绑定自提点</span><h1>点位工作台</h1><p>确认我的待到货配送，查询订单并核验提货码；成本、退款、商品和团期配置均不可访问。</p></div></header>
    <section className="panel"><div className="panel__head"><div><span className="eyebrow">我的配送</span><h2>待确认到货与待领取订单</h2></div></div><Table<CommunityDelivery> rowKey="id" loading={loading} dataSource={deliveries} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} columns={[{ title: '团期', dataIndex: 'campaignTitle' }, { title: '自提点', dataIndex: 'siteName' }, { title: '状态', render: (_, item) => renderStatus(item) }, { title: '下一步', render: (_, item) => { const plan = plans.find((value) => value.id === item.id); if (item.status === 'IN_TRANSIT' && item.dispatchBatchId) return <Button type="link" onClick={() => onConfirmArrival(item)}>逐商品确认到货</Button>; if (item.status === 'ARRIVED' && plan) return <div>{item.arrivalResult === 'EXCEPTION' && <small className="cell-note">存在配送差异，仅可核销正常实到商品</small>}<Button type="link" onClick={() => onVerify(plan)}>查询订单并确认领取</Button></div>; return <span className="muted">{item.status === 'SITE_CONFIRMED' || item.status === 'VEHICLE_BOOKED' ? '等待发车' : '等待现场下一步'}</span>; } }]} /></section>
  </>;
}
