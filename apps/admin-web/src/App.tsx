import { useEffect, useMemo, useState } from "react";
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import {
  api,
  auth,
  requiresLogin,
  type Campaign,
  type CatalogSku,
  type CommunityDelivery,
  type DeliveryPlan,
  type InternalStaff,
  type Order,
  type PickupLookup,
  type PickupPoint,
  type ServiceArea,
} from "./api.ts";
import { getAdminNavigation, type AdminPage } from "./navigation.ts";

const { Header, Sider, Content } = Layout;
const statusColor = (value: string) =>
  value.includes("ACTIVE") ||
  value.includes("OPEN") ||
  value.includes("SUCCEEDED") ||
  value.includes("ARRIVED")
    ? "green"
    : value.includes("PENDING") ||
        value.includes("DRAFT") ||
        value.includes("WAITING")
      ? "gold"
      : value.includes("FAILED") ||
          value.includes("REJECTED") ||
          value.includes("CANCEL")
        ? "red"
        : "blue";
const Status = ({ value }: { value: string }) => (
  <Tag color={statusColor(value)}>{value}</Tag>
);
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

function Login({ done }: { done: () => void }) {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const submit = async (value: { username: string; password: string }) => {
    setLoading(true);
    try {
      await api.login(value.username, value.password);
      done();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-page">
      <Card className="login-card">
        <Typography.Title level={2}>社区团购运营后台</Typography.Title>
        <Typography.Paragraph type="secondary">
          运营、客服、财务与点位负责人使用各自账号登录。
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={(value) => void submit(value)}>
          <Form.Item name="username" label="账号" rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, min: 12 }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </main>
  );
}

function Dashboard({
  areas,
  points,
  campaigns,
  orders,
}: {
  areas: ServiceArea[];
  points: PickupPoint[];
  campaigns: Campaign[];
  orders: Order[];
}) {
  return (
    <>
      <PageTitle title="运营工作台" subtitle="唯一社区团购主线的实时概览" />
      <div className="stats-grid">
        <Card>
          <Statistic
            title="已开通区域"
            value={areas.filter((v) => v.orderEnabled).length}
          />
        </Card>
        <Card>
          <Statistic
            title="启用自提点"
            value={points.filter((v) => v.status === "ACTIVE").length}
          />
        </Card>
        <Card>
          <Statistic
            title="进行中团期"
            value={
              campaigns.filter(
                (v) => !["COMPLETED", "CANCELLED"].includes(v.status),
              ).length
            }
          />
        </Card>
        <Card>
          <Statistic
            title="待处理订单"
            value={
              orders.filter(
                (v) =>
                  !["COMPLETED", "CANCELLED", "REFUNDED"].includes(v.status),
              ).length
            }
          />
        </Card>
      </div>
    </>
  );
}
function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="section-header">
      <div>
        <Typography.Title level={2}>{title}</Typography.Title>
        <Typography.Paragraph type="secondary">{subtitle}</Typography.Paragraph>
      </div>
      {action}
    </header>
  );
}

function Products({
  values,
  reload,
}: {
  values: CatalogSku[];
  reload: () => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const save = async (value: {
    title: string;
    category: string;
    origin: string;
    skuName: string;
    retailPriceCents: number;
    defaultSellableQuantity: number;
  }) => {
    try {
      await api.saveSku({ ...value, imageUrl: null, status: "ACTIVE" });
      setOpen(false);
      form.resetFields();
      await reload();
      void message.success("商品已保存");
    } catch (error) {
      void message.error((error as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        title="商品管理"
        subtitle="维护社区团购商品目录与默认可售量"
        action={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
          >
            新增商品
          </Button>
        }
      />
      <Table
        rowKey="id"
        dataSource={values}
        columns={[
          {
            title: "商品",
            render: (_, v) => (
              <>
                <b>{v.product.title}</b>
                <div>{v.name}</div>
              </>
            ),
          },
          {
            title: "分类/产地",
            render: (_, v) => `${v.product.category} / ${v.product.origin}`,
          },
          { title: "售价", render: (_, v) => money(v.retailPriceCents) },
          { title: "默认可售量", dataIndex: "defaultSellableQuantity" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
        ]}
      />
      <Modal
        open={open}
        title="新增商品"
        footer={null}
        onCancel={() => setOpen(false)}
      >
        <Form form={form} layout="vertical" onFinish={(v) => void save(v)}>
          <Form.Item
            name="title"
            label="商品名称"
            rules={[{ required: true, min: 2 }]}
          >
            <Input />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="category"
              label="分类"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="origin" label="产地" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="skuName" label="规格" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="retailPriceCents"
              label="售价（分）"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} />
            </Form.Item>
            <Form.Item
              name="defaultSellableQuantity"
              label="默认可售量"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} />
            </Form.Item>
          </div>
          <Button type="primary" htmlType="submit">
            保存商品
          </Button>
        </Form>
      </Modal>
    </>
  );
}

function Campaigns({
  values,
  areas,
  points,
  skus,
  reload,
}: {
  values: Campaign[];
  areas: ServiceArea[];
  points: PickupPoint[];
  skus: CatalogSku[];
  reload: () => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const areaId = Form.useWatch("serviceAreaId", form);
  const create = async (value: {
    title: string;
    serviceAreaId: string;
    pickupPointId: string;
    cutoffAt: dayjs.Dayjs;
    dispatchAt: dayjs.Dayjs;
    minTotalQuantity: number;
    failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
    items: Array<{
      catalogSkuId: string;
      retailPriceCents: number;
      sellableQuantity: number;
    }>;
  }) => {
    try {
      await api.createCampaign({
        ...value,
        cutoffAt: value.cutoffAt.toISOString(),
        dispatchAt: value.dispatchAt.toISOString(),
      });
      setOpen(false);
      form.resetFields();
      await reload();
      void message.success("团期已创建，固定自提点将在开售后保持不变");
    } catch (error) {
      void message.error((error as Error).message);
    }
  };
  const action = async (id: string, name: "open" | "close" | "cancel") => {
    try {
      await api.campaignAction(id, name);
      await reload();
    } catch (error) {
      void message.error((error as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        title="团期管理"
        subtitle="一团一固定自提点；商品、价格、可售量与时间均由后台配置"
        action={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
          >
            创建团期
          </Button>
        }
      />
      <Table
        rowKey="id"
        dataSource={values}
        columns={[
          {
            title: "团期",
            render: (_, v) => (
              <>
                <b>{v.title}</b>
                <div>{v.items.length} 个商品</div>
              </>
            ),
          },
          {
            title: "截单时间",
            render: (_, v) => dayjs(v.cutoffAt).format("YYYY-MM-DD HH:mm"),
          },
          {
            title: "固定自提点",
            render: (_, v) => v.deliveryPlan?.siteName ?? "—",
          },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, v) => (
              <Space>
                {v.status === "DRAFT" && (
                  <Button onClick={() => void action(v.id, "open")}>
                    开售
                  </Button>
                )}
                {v.status === "OPEN" && (
                  <Button onClick={() => void action(v.id, "close")}>
                    截单
                  </Button>
                )}
                {["DRAFT", "OPEN", "POSTPONED"].includes(v.status) && (
                  <Button danger onClick={() => void action(v.id, "cancel")}>
                    取消
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        width={760}
        open={open}
        title="创建社区团期"
        footer={null}
        onCancel={() => setOpen(false)}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            minTotalQuantity: 1,
            failureAction: "CANCEL_AND_REFUND",
            items: [{}],
          }}
          onFinish={(v) => void create(v)}
        >
          <Form.Item
            name="title"
            label="团期名称"
            rules={[{ required: true, min: 2 }]}
          >
            <Input />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="serviceAreaId"
              label="服务区域"
              rules={[{ required: true }]}
            >
              <Select
                options={areas
                  .filter((v) => v.orderEnabled)
                  .map((v) => ({ value: v.id, label: v.name }))}
              />
            </Form.Item>
            <Form.Item
              name="pickupPointId"
              label="固定自提点"
              rules={[{ required: true }]}
            >
              <Select
                options={points
                  .filter(
                    (v) => v.status === "ACTIVE" && v.serviceAreaId === areaId,
                  )
                  .map((v) => ({ value: v.id, label: v.name }))}
              />
            </Form.Item>
          </div>
          <div className="form-grid">
            <Form.Item
              name="cutoffAt"
              label="截单时间"
              rules={[{ required: true }]}
            >
              <DatePicker showTime />
            </Form.Item>
            <Form.Item
              name="dispatchAt"
              label="计划发车时间"
              rules={[{ required: true }]}
            >
              <DatePicker showTime />
            </Form.Item>
          </div>
          <div className="form-grid">
            <Form.Item name="minTotalQuantity" label="最小成团件数">
              <InputNumber min={1} />
            </Form.Item>
            <Form.Item name="failureAction" label="未成团处理">
              <Select
                options={[
                  { value: "CANCEL_AND_REFUND", label: "取消并退款" },
                  { value: "POSTPONE", label: "顺延" },
                ]}
              />
            </Form.Item>
          </div>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Card
                    key={field.key}
                    size="small"
                    style={{ marginBottom: 12 }}
                  >
                    <Space align="start" wrap>
                      <Form.Item
                        name={[field.name, "catalogSkuId"]}
                        label="商品"
                        rules={[{ required: true }]}
                      >
                        <Select
                          style={{ width: 240 }}
                          options={skus
                            .filter((v) => v.status === "ACTIVE")
                            .map((v) => ({
                              value: v.id,
                              label: `${v.product.title} · ${v.name}`,
                            }))}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "retailPriceCents"]}
                        label="本团售价（分）"
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={1} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "sellableQuantity"]}
                        label="可售量"
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={1} />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>
                        移除
                      </Button>
                    </Space>
                  </Card>
                ))}
                <Button onClick={() => add()}>添加商品</Button>
              </>
            )}
          </Form.List>
          <Button type="primary" htmlType="submit" style={{ marginTop: 16 }}>
            创建团期
          </Button>
        </Form>
      </Modal>
    </>
  );
}

function Orders({ values }: { values: Order[] }) {
  return (
    <>
      <PageTitle title="订单管理" subtitle="查看支付、履约、领取与退款状态" />
      <Table
        rowKey="id"
        dataSource={values}
        columns={[
          { title: "订单号", dataIndex: "orderNo" },
          { title: "金额", render: (_, v) => money(v.totalCents) },
          {
            title: "商品",
            render: (_, v) =>
              v.items.map((i) => `${i.name} × ${i.quantity}`).join("；"),
          },
          {
            title: "支付时间",
            render: (_, v) =>
              v.paidAt ? dayjs(v.paidAt).format("MM-DD HH:mm") : "未支付",
          },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
        ]}
      />
    </>
  );
}

function Logistics({
  plans,
  deliveries,
  campaigns,
  reload,
}: {
  plans: DeliveryPlan[];
  deliveries: CommunityDelivery[];
  campaigns: Campaign[];
  reload: () => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [vehicle, setVehicle] = useState<DeliveryPlan | null>(null);
  const [arrival, setArrival] = useState<CommunityDelivery | null>(null);
  const [form] = Form.useForm();
  const createBatch = async (campaignId: string) => {
    try {
      const batch = await api.createBatch(campaignId);
      await api.dispatch(batch.id);
      await reload();
    } catch (error) {
      void message.error((error as Error).message);
    }
  };
  const saveVehicle = async (value: {
    logisticsPlatform: string;
    vehicleOrderNo: string;
    driverName?: string;
    driverPhone?: string;
    vehiclePlate?: string;
    estimatedArrivalAt?: dayjs.Dayjs;
  }) => {
    if (!vehicle) return;
    await api.bookVehicle(vehicle.id, {
      ...value,
      driverName: value.driverName ?? null,
      driverPhone: value.driverPhone ?? null,
      vehiclePlate: value.vehiclePlate ?? null,
      estimatedArrivalAt: value.estimatedArrivalAt?.toISOString() ?? null,
    });
    setVehicle(null);
    await reload();
  };
  const confirm = async (value: {
    receivedBy: string;
    confirmationNote?: string;
    items: Array<{
      catalogSkuId: string;
      receivedQuantity: number;
      shortQuantity: number;
      damagedQuantity: number;
      evidenceNote?: string;
    }>;
  }) => {
    if (!arrival?.dispatchBatchId) return;
    const items = value.items.map((item) => ({
      ...item,
      rejectedQuantity: 0,
      reason:
        item.shortQuantity > 0
          ? "SHORT_RECEIPT"
          : item.damagedQuantity > 0
            ? "TRANSIT_DAMAGE"
            : null,
      evidenceNote: item.evidenceNote ?? null,
    }));
    await api.confirmArrival(arrival.dispatchBatchId, {
      receivedBy: value.receivedBy,
      confirmationNote: value.confirmationNote ?? null,
      emergencyReason: null,
      items,
    });
    setArrival(null);
    await reload();
  };
  return (
    <>
      <PageTitle
        title="配送与到货"
        subtitle="运营登记车辆，点位负责人逐商品确认实到；差异先生成草案"
      />
      <Table
        rowKey="id"
        dataSource={plans}
        columns={[
          {
            title: "团期",
            render: (_, v) =>
              campaigns.find((c) => c.id === v.campaignId)?.title ??
              v.campaignId,
          },
          { title: "自提点", dataIndex: "siteName" },
          { title: "车辆", render: (_, v) => v.vehicleOrderNo ?? "未登记" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, v) => (
              <Space>
                {v.status === "SITE_CONFIRMED" && (
                  <Button onClick={() => setVehicle(v)}>登记车辆</Button>
                )}
                {v.status === "VEHICLE_BOOKED" && (
                  <Button onClick={() => void createBatch(v.campaignId)}>
                    创建批次并发车
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Typography.Title level={4}>点位到货</Typography.Title>
      <Table
        rowKey="id"
        dataSource={deliveries}
        columns={[
          { title: "团期", dataIndex: "campaignTitle" },
          { title: "自提点", dataIndex: "siteName" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "差异草案",
            render: (_, v) => v.allocationDraftStatus ?? "—",
          },
          {
            title: "操作",
            render: (_, v) => (
              <Space>
                {v.dispatchBatchId && !v.arrivalConfirmed && (
                  <Button onClick={() => setArrival(v)}>确认到货</Button>
                )}
                {v.communityDeliveryId &&
                  v.allocationDraftStatus ===
                    "PENDING_OPERATOR_CONFIRMATION" && (
                    <Button
                      type="primary"
                      onClick={() =>
                        void api
                          .confirmAllocation(v.communityDeliveryId!)
                          .then(reload)
                      }
                    >
                      确认差异分配
                    </Button>
                  )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!vehicle}
        title="登记运输信息"
        footer={null}
        onCancel={() => setVehicle(null)}
      >
        <Form layout="vertical" onFinish={(v) => void saveVehicle(v)}>
          <Form.Item
            name="logisticsPlatform"
            label="承运方"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="vehicleOrderNo"
            label="运输单号"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <div className="form-grid">
            <Form.Item name="driverName" label="司机">
              <Input />
            </Form.Item>
            <Form.Item name="driverPhone" label="电话">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="vehiclePlate" label="车牌">
            <Input />
          </Form.Item>
          <Form.Item name="estimatedArrivalAt" label="预计到达">
            <DatePicker showTime />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存
          </Button>
        </Form>
      </Modal>
      <Modal
        width={760}
        open={!!arrival}
        title="逐商品确认到货"
        footer={null}
        onCancel={() => setArrival(null)}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            items: arrival?.expectedItems.map((v) => ({
              catalogSkuId: v.catalogSkuId,
              receivedQuantity: v.expectedQuantity,
              shortQuantity: 0,
              damagedQuantity: 0,
            })),
          }}
          onFinish={(v) => void confirm(v)}
        >
          <Form.Item
            name="receivedBy"
            label="现场接收人"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.List name="items">
            {(fields) =>
              fields.map((field, index) => (
                <Card key={field.key} size="small" style={{ marginBottom: 8 }}>
                  <b>
                    {arrival?.expectedItems[index]?.title} ·{" "}
                    {arrival?.expectedItems[index]?.skuName}
                  </b>
                  <Form.Item name={[field.name, "catalogSkuId"]} hidden>
                    <Input />
                  </Form.Item>
                  <Space wrap>
                    <Form.Item
                      name={[field.name, "receivedQuantity"]}
                      label="实到"
                    >
                      <InputNumber min={0} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "shortQuantity"]}
                      label="短少"
                    >
                      <InputNumber min={0} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "damagedQuantity"]}
                      label="破损"
                    >
                      <InputNumber min={0} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "evidenceNote"]}
                      label="差异说明"
                    >
                      <Input />
                    </Form.Item>
                  </Space>
                </Card>
              ))
            }
          </Form.List>
          <Button type="primary" htmlType="submit">
            提交到货确认
          </Button>
        </Form>
      </Modal>
    </>
  );
}

function Areas({
  areas,
  points,
  reload,
}: {
  areas: ServiceArea[];
  points: PickupPoint[];
  reload: () => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [areaOpen, setAreaOpen] = useState(false);
  const [pointOpen, setPointOpen] = useState(false);
  return (
    <>
      <PageTitle
        title="区域与自提点"
        subtitle="全部运营参数由后台配置，不在代码中预设"
        action={
          <Space>
            <Button onClick={() => setAreaOpen(true)}>开通区域</Button>
            <Button type="primary" onClick={() => setPointOpen(true)}>
              新增自提点
            </Button>
          </Space>
        }
      />
      <Typography.Title level={4}>服务区域</Typography.Title>
      <Table
        rowKey="id"
        dataSource={areas}
        columns={[
          { title: "区域", dataIndex: "name" },
          { title: "行政区代码", dataIndex: "regionCode" },
          {
            title: "接单",
            render: (_, v) => (
              <Button
                onClick={() =>
                  void api.setArea(v.id, !v.orderEnabled).then(reload)
                }
              >
                {v.orderEnabled ? "暂停" : "开启"}
              </Button>
            ),
          },
        ]}
      />
      <Typography.Title level={4}>自提点</Typography.Title>
      <Table
        rowKey="id"
        dataSource={points}
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "地址", dataIndex: "address" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
        ]}
      />
      <Modal
        open={areaOpen}
        title="开通服务区域"
        footer={null}
        onCancel={() => setAreaOpen(false)}
      >
        <Form
          layout="vertical"
          onFinish={(v) =>
            void api
              .openArea(v.regionCode)
              .then(() => {
                setAreaOpen(false);
                return reload();
              })
              .catch((e) => message.error(e.message))
          }
        >
          <Form.Item
            name="regionCode"
            label="行政区代码"
            rules={[{ required: true, pattern: /^\d{6,12}$/ }]}
          >
            <Input placeholder="从行政区目录选择或输入代码" />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            开通
          </Button>
        </Form>
      </Modal>
      <Modal
        open={pointOpen}
        title="新增自提点"
        footer={null}
        onCancel={() => setPointOpen(false)}
      >
        <Form
          layout="vertical"
          onFinish={(v) =>
            void api
              .createPoint({ ...v, capacityPerDay: v.capacityPerDay ?? null })
              .then(() => {
                setPointOpen(false);
                return reload();
              })
          }
        >
          <Form.Item
            name="serviceAreaId"
            label="服务区域"
            rules={[{ required: true }]}
          >
            <Select
              options={areas.map((v) => ({ value: v.id, label: v.name }))}
            />
          </Form.Item>
          <Form.Item name="name" label="点位名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="address"
            label="详细地址"
            rules={[{ required: true, min: 5 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="capacityPerDay" label="日容量（可选）">
            <InputNumber min={1} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存
          </Button>
        </Form>
      </Modal>
    </>
  );
}

function PointWorkbench() {
  const { message } = AntApp.useApp();
  const [plans, setPlans] = useState<DeliveryPlan[]>([]);
  const [order, setOrder] = useState<PickupLookup | null>(null);
  const [planId, setPlanId] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => {
    void api.pickupPlans().then(setPlans);
  }, []);
  const lookup = async () => {
    try {
      setOrder(await api.lookupPickup(planId, orderNo));
    } catch (error) {
      void message.error((error as Error).message);
    }
  };
  const verify = async () => {
    if (!order) return;
    try {
      await api.verifyPickup({
        orderId: order.id,
        deliveryPlanId: order.deliveryPlanId,
        code,
        pickupRequestId: crypto.randomUUID(),
        items: order.items
          .filter((v) => v.remainingPickupQuantity > 0)
          .map((v) => ({
            catalogSkuId: v.skuId,
            quantity: v.remainingPickupQuantity,
          })),
      });
      void message.success("本次领取已核销");
      setOrder(null);
    } catch (error) {
      void message.error((error as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        title="我的点位工作台"
        subtitle="仅处理已授权点位的到货与领取，不提供消费者小程序工作入口"
      />
      <Card>
        <Space wrap>
          <Select
            style={{ width: 260 }}
            placeholder="选择已到货点位"
            value={planId || null}
            onChange={setPlanId}
            options={plans.map((v) => ({
              value: v.id,
              label: `${v.siteName} · ${v.address}`,
            }))}
          />
          <Input
            style={{ width: 220 }}
            placeholder="订单号"
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
          />
          <Button type="primary" onClick={() => void lookup()}>
            查询订单
          </Button>
        </Space>
      </Card>
      {order && (
        <Card title={`订单 ${order.orderNo}`} style={{ marginTop: 16 }}>
          <Table
            pagination={false}
            rowKey="skuId"
            dataSource={order.items}
            columns={[
              { title: "商品", dataIndex: "name" },
              { title: "可领取", dataIndex: "readyQuantity" },
              { title: "已领取", dataIndex: "alreadyPickedQuantity" },
              { title: "本次最多领取", dataIndex: "remainingPickupQuantity" },
            ]}
          />
          <Space style={{ marginTop: 16 }}>
            <Input
              placeholder="6 位取货码"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button
              type="primary"
              disabled={!/^\d{6}$/.test(code)}
              onClick={() => void verify()}
            >
              确认本次领取
            </Button>
          </Space>
        </Card>
      )}
    </>
  );
}

function Service({ reload }: { reload: () => Promise<void> }) {
  const [quality, setQuality] = useState<
    Awaited<ReturnType<typeof api.quality>>
  >([]);
  const [cancellations, setCancellations] = useState<
    Awaited<ReturnType<typeof api.cancellations>>
  >([]);
  const [exceptions, setExceptions] = useState<
    Awaited<ReturnType<typeof api.exceptions>>
  >([]);
  const load = async () => {
    const [v1, v2, v3] = await Promise.all([
      api.quality(),
      api.cancellations(),
      api.exceptions(),
    ]);
    setQuality(v1);
    setCancellations(v2);
    setExceptions(v3);
  };
  useEffect(() => {
    void load();
  }, []);
  void reload;
  return (
    <>
      <PageTitle
        title="售后与异常"
        subtitle="客服受理、运营决定、财务退款，职责分离"
      />
      <Typography.Title level={4}>品质售后</Typography.Title>
      <Table
        rowKey="id"
        dataSource={quality}
        columns={[
          { title: "订单", dataIndex: "orderId" },
          { title: "申报时间", dataIndex: "registeredAt" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, v) => (
              <Space>
                {v.status === "REGISTERED" && (
                  <Button
                    onClick={() =>
                      void api.acceptQuality(v.id, "客服已核对").then(load)
                    }
                  >
                    受理
                  </Button>
                )}
                {v.status === "ACCEPTED" && (
                  <Button
                    onClick={() =>
                      void api
                        .decideQuality(v.id, true, "运营同意退款")
                        .then(load)
                    }
                  >
                    批准退款
                  </Button>
                )}
                {v.status === "REFUNDING" && (
                  <Button
                    onClick={() => void api.refundQuality(v.id).then(load)}
                  >
                    财务退款
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Typography.Title level={4}>取消申请</Typography.Title>
      <Table
        rowKey="id"
        dataSource={cancellations}
        columns={[
          { title: "订单", dataIndex: "orderId" },
          { title: "原因", dataIndex: "reason" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, v) => (
              <Space>
                {v.status === "PENDING_REVIEW" && (
                  <Button
                    onClick={() =>
                      void api
                        .reviewCancellation(v.orderId, true, "运营同意")
                        .then(load)
                    }
                  >
                    批准
                  </Button>
                )}
                {v.status === "APPROVED_WAITING_FINANCE" && (
                  <Button
                    onClick={() =>
                      void api.refundCancellation(v.orderId).then(load)
                    }
                  >
                    财务退款
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Typography.Title level={4}>履约差异</Typography.Title>
      <Table
        rowKey="id"
        dataSource={exceptions}
        columns={[
          { title: "团期", dataIndex: "campaignId" },
          { title: "阶段", dataIndex: "sourceStage" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          { title: "说明", dataIndex: "resolutionNote" },
        ]}
      />
    </>
  );
}

function Finance() {
  const [refunds, setRefunds] = useState<Awaited<
    ReturnType<typeof api.finance>
  > | null>(null);
  const [ledger, setLedger] = useState<Awaited<ReturnType<typeof api.ledger>>>(
    [],
  );
  useEffect(() => {
    void Promise.all([api.finance(), api.ledger()]).then(([r, l]) => {
      setRefunds(r);
      setLedger(l);
    });
  }, []);
  return (
    <>
      <PageTitle title="财务管理" subtitle="查看全额/部分退款和双向平衡账本" />
      <Table
        rowKey="id"
        dataSource={[...(refunds?.full ?? []), ...(refunds?.partial ?? [])]}
        columns={[
          { title: "退款单", dataIndex: "providerRefundNo" },
          { title: "订单", dataIndex: "orderId" },
          { title: "金额", render: (_, v) => money(v.amountCents) },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
        ]}
      />
      <Typography.Title level={4}>财务流水</Typography.Title>
      <Table
        rowKey="id"
        dataSource={ledger}
        columns={[
          { title: "事件", dataIndex: "eventType" },
          { title: "关联单据", dataIndex: "referenceId" },
          { title: "时间", dataIndex: "createdAt" },
        ]}
      />
    </>
  );
}

function Settings({
  staff,
  points,
  reload,
}: {
  staff: InternalStaff[];
  points: PickupPoint[];
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [credential, setCredential] = useState("");
  const create = async (value: {
    displayName: string;
    username: string;
    phone: string;
    role: InternalStaff["role"];
    pickupPointIds?: string[];
  }) => {
    const result = await api.createStaff({
      ...value,
      pickupPointIds: value.pickupPointIds ?? [],
    });
    setCredential(result.initialCredential);
    setOpen(false);
    await reload();
  };
  return (
    <>
      <PageTitle
        title="系统设置"
        subtitle="后台开通员工账号、角色与点位权限；停用或变更后会话立即失效"
        action={
          <Button type="primary" onClick={() => setOpen(true)}>
            新增员工
          </Button>
        }
      />
      {credential && (
        <Card
          title="一次性初始凭据"
          extra={<Button onClick={() => setCredential("")}>关闭</Button>}
        >
          <Typography.Text copyable code>
            {credential}
          </Typography.Text>
        </Card>
      )}
      <Table
        rowKey="userId"
        dataSource={staff}
        columns={[
          {
            title: "员工",
            render: (_, v) => (
              <>
                <b>{v.displayName}</b>
                <div>{v.staffNo}</div>
              </>
            ),
          },
          { title: "电话", dataIndex: "phone" },
          { title: "角色", dataIndex: "role" },
          { title: "点位数", render: (_, v) => v.pickupPointIds.length },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
        ]}
      />
      <Modal
        open={open}
        title="新增内部员工"
        footer={null}
        onCancel={() => setOpen(false)}
      >
        <Form layout="vertical" onFinish={(v) => void create(v)}>
          <Form.Item
            name="displayName"
            label="姓名"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="username"
            label="登录账号"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[{ required: true, pattern: /^1[3-9]\d{9}$/ }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={[
                "SUPER_ADMIN",
                "OPERATOR",
                "CUSTOMER_SERVICE",
                "FINANCE",
                "PICKUP_MANAGER",
              ].map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue("role") === "PICKUP_MANAGER" ? (
                <Form.Item
                  name="pickupPointIds"
                  label="授权自提点"
                  rules={[{ required: true }]}
                >
                  <Select
                    mode="multiple"
                    options={points
                      .filter((v) => v.status === "ACTIVE")
                      .map((v) => ({ value: v.id, label: v.name }))}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Button type="primary" htmlType="submit">
            创建账号
          </Button>
        </Form>
      </Modal>
    </>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState(
    !requiresLogin || !!auth.token(),
  );
  const [page, setPage] = useState<AdminPage>("dashboard");
  const [loading, setLoading] = useState(false);
  const [areas, setAreas] = useState<ServiceArea[]>([]),
    [points, setPoints] = useState<PickupPoint[]>([]),
    [skus, setSkus] = useState<CatalogSku[]>([]),
    [campaigns, setCampaigns] = useState<Campaign[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [plans, setPlans] = useState<DeliveryPlan[]>([]),
    [deliveries, setDeliveries] = useState<CommunityDelivery[]>([]),
    [staff, setStaff] = useState<InternalStaff[]>([]);
  const roles = auth.roles().length ? auth.roles() : ["SUPER_ADMIN"];
  const navigation = useMemo(
    () => getAdminNavigation(roles),
    [roles.join(",")],
  );
  const reload = async () => {
    setLoading(true);
    try {
      const work = [api.areas().then(setAreas), api.points().then(setPoints)];
      if (!roles.includes("PICKUP_MANAGER") || roles.includes("SUPER_ADMIN"))
        work.push(
          api.skus().then(setSkus),
          api.campaigns().then(setCampaigns),
          api.orders().then(setOrders),
          api.plans().then(setPlans),
          api.deliveries().then(setDeliveries),
        );
      if (roles.includes("SUPER_ADMIN")) work.push(api.staff().then(setStaff));
      await Promise.all(work);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const expired = () => setAuthenticated(false);
    window.addEventListener("admin-auth-expired", expired);
    if (authenticated) void reload();
    return () => window.removeEventListener("admin-auth-expired", expired);
  }, [authenticated]);
  if (!authenticated)
    return (
      <AntApp>
        <Login done={() => setAuthenticated(true)} />
      </AntApp>
    );
  const pointManagerOnly =
    navigation.length === 1 &&
    navigation[0]?.items[0]?.key === "point-workbench";
  const currentPage: AdminPage = pointManagerOnly ? "point-workbench" : page;
  const content =
    currentPage === "dashboard" ? (
      <Dashboard {...{ areas, points, campaigns, orders }} />
    ) : currentPage === "products" ? (
      <Products values={skus} reload={reload} />
    ) : currentPage === "campaigns" ? (
      <Campaigns values={campaigns} {...{ areas, points, skus, reload }} />
    ) : currentPage === "orders" ? (
      <Orders values={orders} />
    ) : currentPage === "logistics" ? (
      <Logistics {...{ plans, deliveries, campaigns, reload }} />
    ) : currentPage === "pickup-points" ? (
      <Areas {...{ areas, points, reload }} />
    ) : currentPage === "point-workbench" ? (
      <PointWorkbench />
    ) : currentPage === "service" ? (
      <Service reload={reload} />
    ) : currentPage === "finance" ? (
      <Finance />
    ) : (
      <Settings {...{ staff, points, reload }} />
    );
  return (
    <AntApp>
      <Layout className="app-shell">
        <Sider width={230} theme="light">
          <div className="brand">
            <strong>社区团购</strong>
            <span>运营后台</span>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[currentPage]}
            onClick={({ key }) => setPage(key as AdminPage)}
            items={navigation.map((group) => ({
              type: "group",
              label: group.label,
              children: group.items.map((item) => ({
                key: item.key,
                label: item.label,
              })),
            }))}
          />
        </Sider>
        <Layout>
          <Header className="topbar">
            <span>单一社区团购运营系统</span>
            <Space>
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void reload()}
              >
                刷新
              </Button>
              {requiresLogin && (
                <Button
                  onClick={() =>
                    void api.logout().finally(() => {
                      auth.clear();
                      setAuthenticated(false);
                    })
                  }
                >
                  退出
                </Button>
              )}
            </Space>
          </Header>
          <Content className="content">{content}</Content>
        </Layout>
      </Layout>
    </AntApp>
  );
}
