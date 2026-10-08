import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Input, Modal, Space, Spin, Tag, Typography } from 'antd';
import { AdminTable as Table } from './admin-table.tsx';
import dayjs from 'dayjs';
import { displayLabel } from './labels.ts';
import { useCan } from './access-context.tsx';

export type ConsumerSummary = {
  id: number;
  maskedPhone: string | null;
  status: string;
  createdAt: string;
  phoneVerified: boolean;
  orderCount: number;
};
export type ConsumerDetail = ConsumerSummary & {
  phoneNumber?: string;
  orders: Array<{ orderNo: string; status: string; totalAmountCents: number; createdAt: string }>;
};
type ConsumerPage = { items: ConsumerSummary[]; total: number; page: number; pageSize: number };
type PageQuery = { query: string; page: number; pageSize: number };

// A cancelled or superseded request must never replace a newer result or error.
export function createConsumerRequestGate<T>() {
  let version = 0;
  return {
    cancel() { version += 1; },
    async run(load: () => Promise<T>, success: (value: T) => void, failure: () => void) {
      const requestVersion = ++version;
      try {
        const value = await load();
        if (version === requestVersion) success(value);
      } catch {
        if (version === requestVersion) failure();
      }
    },
  };
}
const time = (value: string) => dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
const verified = (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '手机号已认证' : '手机号未认证'}</Tag>;

export function Consumers({ loadPage, loadDetail }: {
  loadPage: (query: PageQuery) => Promise<ConsumerPage>;
  loadDetail: (id: number) => Promise<ConsumerDetail>;
}) {
  const can = useCan();
  const canViewPhone = can('consumers.phone.view');
  const loaders = useRef({ loadPage, loadDetail });
  loaders.current = { loadPage, loadDetail };
  const listGate = useRef(createConsumerRequestGate<ConsumerPage>());
  const detailGate = useRef(createConsumerRequestGate<ConsumerDetail>());
  const [input, setInput] = useState('');
  const [query, setQuery] = useState<PageQuery>({ query: '', page: 1, pageSize: 20 });
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<ConsumerPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConsumerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  const [detailRefresh, setDetailRefresh] = useState(0);
  useEffect(() => {
    const gate = listGate.current;
    setLoading(true); setFailed(false); setResult(null);
    void gate.run(() => loaders.current.loadPage(query), value => {
      setResult(value); setLoading(false);
    }, () => { setFailed(true); setLoading(false); });
    return () => gate.cancel();
  }, [query, refresh]);
  useEffect(() => {
    const gate = detailGate.current;
    setDetail(null); setDetailFailed(false);
    if (!selectedId) { setDetailLoading(false); return () => gate.cancel(); }
    setDetailLoading(true);
    void gate.run(() => loaders.current.loadDetail(selectedId), value => {
      setDetail(value); setDetailLoading(false);
    }, () => { setDetailFailed(true); setDetailLoading(false); });
    return () => gate.cancel();
  }, [selectedId, detailRefresh]);
  const closeDetail = () => {
    detailGate.current.cancel();
    setSelectedId(null); setDetail(null); setDetailFailed(false);
  };
  return <>
    <header className="section-header">
      <div><Typography.Title level={2}>用户</Typography.Title><Typography.Paragraph type="secondary">查看用户注册与订单摘要；列表中手机号保留必要的隐私保护。</Typography.Paragraph></div>
      <Button loading={loading} onClick={() => setRefresh(value => value + 1)}>刷新</Button>
    </header>
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search aria-label="搜索用户" placeholder="搜索用户ID、姓名或手机号" value={input} allowClear maxLength={80}
        onChange={event => setInput(event.target.value)} onSearch={value => setQuery({ ...query, query: value.trim(), page: 1 })} enterButton="搜索" />
    </Space>
    {failed && <Alert type="error" showIcon message="用户列表加载失败" description="请稍后重试。" action={<Button onClick={() => setRefresh(value => value + 1)}>重试列表</Button>} />}
    <Table<ConsumerSummary> rowKey="id" loading={loading} dataSource={result?.items ?? []} scroll={{ x: 900 }}
      locale={{ emptyText: failed ? '列表暂不可用' : query.query ? '没有匹配的用户' : '暂无用户' }}
      pagination={{ current: result?.page ?? query.page, pageSize: result?.pageSize ?? query.pageSize, total: result?.total ?? 0, showSizeChanger: true, showTotal: total => `共 ${total} 位用户`, onChange: (page, pageSize) => setQuery({ ...query, page: pageSize !== query.pageSize ? 1 : page, pageSize }) }}
      columns={[
        { title: '用户ID', dataIndex: 'id', render: value => <span className="mono">{value}</span> },
        { title: '手机号', dataIndex: 'maskedPhone', render: value => value ?? '未绑定' },
        { title: '账号状态', dataIndex: 'status', render: displayLabel },
        { title: '注册时间', dataIndex: 'createdAt', render: time },
        { title: '认证状态', dataIndex: 'phoneVerified', render: verified },
        { title: '订单数', dataIndex: 'orderCount' },
        { title: '操作', render: (_, consumer) => <Button onClick={() => { setDetail(null); setSelectedId(consumer.id); }}>查看详情</Button> },
      ]} />
    <Modal title="用户详情" open={selectedId !== null} onCancel={closeDetail} footer={<Button onClick={closeDetail}>关闭</Button>} width={900}>
      {detailLoading && <Spin tip="正在加载用户详情"><div style={{ minHeight: 120 }} /></Spin>}
      {detailFailed && <Alert type="error" showIcon message="用户详情加载失败" description="请稍后重试。" action={<Button onClick={() => setDetailRefresh(value => value + 1)}>重试详情</Button>} />}
      {detail && <>
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="用户ID">{detail.id}</Descriptions.Item>
          <Descriptions.Item label="手机号">{detail.phoneNumber ?? detail.maskedPhone ?? '未绑定'}</Descriptions.Item>
          <Descriptions.Item label="账号状态">{displayLabel(detail.status)}</Descriptions.Item>
          <Descriptions.Item label="注册时间">{time(detail.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="认证状态">{verified(detail.phoneVerified)}</Descriptions.Item>
          <Descriptions.Item label="订单数">{detail.orderCount}</Descriptions.Item>
        </Descriptions>
        <Typography.Title level={4}>近期订单（最多50笔）</Typography.Title>
        <Table<ConsumerDetail['orders'][number]> rowKey="orderNo" dataSource={detail.orders} scroll={{ x: 650 }} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: '暂无订单' }} columns={[
          { title: '订单编号', dataIndex: 'orderNo', ellipsis: true },
          { title: '状态', dataIndex: 'status', render: displayLabel },
          { title: '订单金额', dataIndex: 'totalAmountCents', render: (value: number) => `¥${(value / 100).toFixed(2)}` },
          { title: '创建时间', dataIndex: 'createdAt', render: time },
        ]} />
        {canViewPhone && <Typography.Paragraph type="secondary">完整手机号仅向授权岗位显示；查看已记录在操作日志中。</Typography.Paragraph>}
      </>}
    </Modal>
  </>;
}
