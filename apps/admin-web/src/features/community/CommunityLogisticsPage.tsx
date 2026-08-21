import { Alert, Button, Table } from 'antd';
import type { CommunityDelivery, DeliveryPlan, DispatchBatch } from '../../api.ts';

type Can = (...roles: string[]) => boolean;
type Act = (key: string, work: () => Promise<unknown>, success: string) => Promise<void>;

export function CommunityLogisticsPage({ deliveries, plans, batches, loading, can, act, dateTime, renderStatus, onEditVehicle, onEmergencyArrival, onGoToService, api }: {
  deliveries: CommunityDelivery[];
  plans: DeliveryPlan[];
  batches: DispatchBatch[];
  loading: boolean;
  can: Can;
  act: Act;
  dateTime: Intl.DateTimeFormat;
  renderStatus(delivery: CommunityDelivery): React.ReactNode;
  onEditVehicle(plan: DeliveryPlan): void;
  onEmergencyArrival(delivery: CommunityDelivery): void;
  onGoToService(): void;
  api: { dispatchBatch(id: string): Promise<unknown>; createBatch(campaignId: string): Promise<unknown>; confirmCommunityAllocationDraft(id: string): Promise<unknown> };
}) {
  return <>
    <header className="section-header"><div><span className="eyebrow">备货完成到自提点</span><h1>物流管理</h1><p>仅处理人工运单、确认发车和点位交接结果；正式到货必须由点位负责人现场逐商品确认。</p></div></header>
    <Alert type="info" showIcon message="人工录入货拉拉/配送信息" description="团期截单后创建配送批次，录入平台、运单号、司机、车牌和预计到达时间后确认发车。物流单号不会自动把订单改为已到货。" style={{ marginBottom: 16 }} />
    <section className="panel"><Table<CommunityDelivery> rowKey="id" loading={loading} dataSource={deliveries} pagination={{ pageSize: 10 }} scroll={{ x: 860 }} columns={[{ title: '团期', dataIndex: 'campaignTitle' }, { title: '自提点', dataIndex: 'siteName', render: (value: string | null, item) => value ?? item.pickupPointId ?? '待绑定' }, { title: '配送状态', render: (_, item) => renderStatus(item) }, { title: '货拉拉/运单', render: (_, item) => item.vehicleOrderNo ? `${item.logisticsPlatform ?? '配送'} · ${item.vehicleOrderNo}` : '待录入' }, { title: '发车/预计到达', render: (_, item) => <span className="cell-note">{item.dispatchedAt ? `已发车 ${dateTime.format(new Date(item.dispatchedAt))}` : '未发车'}{item.estimatedArrivalAt ? ` · 预计 ${dateTime.format(new Date(item.estimatedArrivalAt))}` : ''}</span> }, { title: '下一步', render: (_, item) => {
      const plan = plans.find((value) => value.id === item.id);
      const batch = batches.find((value) => value.campaignId === item.campaignId);
      if (item.status === 'SITE_CONFIRMED' && can('OPERATOR', 'FULFILLMENT')) return <Button type="link" onClick={() => { if (plan) onEditVehicle(plan); }}>录入运单</Button>;
      if (item.status === 'VEHICLE_BOOKED' && can('OPERATOR', 'FULFILLMENT')) return batch ? <Button type="link" onClick={() => void act(`community-dispatch-${batch.id}`, () => api.dispatchBatch(batch.id), '已确认发车，等待点位清点')}>确认发车</Button> : <Button type="link" onClick={() => void act(`community-batch-${item.campaignId}`, () => api.createBatch(item.campaignId), '配送已创建，请确认发车')}>创建配送</Button>;
      if (item.status === 'IN_TRANSIT') return can('SUPER_ADMIN') && item.dispatchBatchId ? <Button danger type="link" onClick={() => onEmergencyArrival(item)}>紧急代办点位确认</Button> : <span className="muted">等待点位现场确认</span>;
      if (item.status === 'ARRIVED' && item.arrivalResult === 'EXCEPTION') return <div>{item.allocationDraftStatus === 'PENDING_OPERATOR_CONFIRMATION' && can('OPERATOR', 'SUPER_ADMIN') ? <Button type="link" onClick={() => void act(`community-allocation-${item.communityDeliveryId}`, () => api.confirmCommunityAllocationDraft(item.communityDeliveryId!), '差异分配草案已确认，正常实到商品已开放领取')}>确认差异分配草案</Button> : item.allocationDraftStatus === 'PENDING_OPERATOR_CONFIRMATION' ? <small className="cell-note">等待运营确认分配草案</small> : <Button type="link" onClick={onGoToService}>处理配送异常</Button>}<small className="cell-note">{item.allocationDraftStatus === 'CONFIRMED' ? '正常商品已可领取' : '确认前不会开放领取'}</small></div>;
      if (item.status === 'ARRIVED') return <span className="muted">等待用户领取</span>;
      return <span className="muted">查看点位交接结果</span>;
    } }]} /></section>
  </>;
}
