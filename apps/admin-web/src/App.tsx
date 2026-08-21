import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppstoreOutlined,
  AuditOutlined,
  CarOutlined,
  EnvironmentOutlined,
  LogoutOutlined,
  PlusOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Skeleton,
  Table,
  Tag,
  message,
} from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import {
  api,
  auth,
  requiresLogin,
  type Campaign,
  type CommunityDelivery,
  type DeliveryPlan,
  type Merchant,
  type Order,
  type PickupOrderLookup,
  type PlatformSku,
  type PurchaseOrder,
  type OutboundOrder,
  type Product,
  type RegionDirectoryEntry,
  type ServiceArea,
  type PickupPoint,
  type ServiceAreaInterest,
  type AfterSale,
  type InternalStaff,
  type OrderNotification,
} from "./api.ts";
import { getAdminNavigation, isPointWorkbenchUser, type AdminPage } from "./navigation.ts";
import { beginPickupRequest, clearPickupRequest, getPendingPickupRequest, isTerminalPickupError, mapPickupRequestItemsToOrder, markPickupRequestConfirmed } from "./pickup-request.ts";
import { StaffCreateModal, StaffScopeModal, staffRoleOptions, type InternalStaffRole } from './features/staff/StaffModals.tsx';
import { FinancePage } from './features/finance/FinancePage.tsx';
import { CommunityCaseQueues } from './features/service/CommunityCaseQueues.tsx';
import { CommunityLogisticsPage } from './features/community/CommunityLogisticsPage.tsx';
import { PickupPointWorkbenchPage } from './features/community/PickupPointWorkbenchPage.tsx';

type Page = AdminPage;
const money = (cents: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    cents / 100,
  );
const dateTime = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const statusMeta: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "草稿", color: "default" },
  OPEN: { label: "收单中", color: "success" },
  LOCKED: { label: "已成团", color: "blue" },
  FULFILLING: { label: "履约中", color: "cyan" },
  COMPLETED: { label: "已完成", color: "default" },
  POSTPONED: { label: "已顺延", color: "orange" },
  CANCELLED: { label: "已取消", color: "error" },
  PENDING_SITE: { label: "待确认地点", color: "warning" },
  SITE_CONFIRMED: { label: "地点已确认", color: "processing" },
  VEHICLE_BOOKED: { label: "已预约车辆", color: "blue" },
  IN_TRANSIT: { label: "运输中", color: "processing" },
  ARRIVED: { label: "已到货", color: "success" },
  PENDING_REVIEW: { label: "待审核", color: "warning" },
  APPROVED: { label: "已上架", color: "success" },
  OFF_SHELF: { label: "已下架", color: "default" },
  DRAFT_PRODUCT: { label: "草稿", color: "default" },
  ACTIVE: { label: "已启用", color: "success" },
  SUSPENDED: { label: "已停用", color: "default" },
  REJECTED: { label: "已驳回", color: "error" },
  NEW: { label: "待联系", color: "warning" },
  CONTACTED: { label: "已联系", color: "processing" },
  CLOSED: { label: "已关闭", color: "default" },
  SUBMITTED: { label: "待受理", color: "warning" },
  PROCESSING: { label: "处理中", color: "processing" },
  RESOLVED: { label: "已解决", color: "success" },
  PENDING_PAYMENT: { label: "待支付", color: "warning" },
  PAID_WAITING_CLOSE: { label: "已付款待结团", color: "success" },
  ALLOCATING: { label: "备货中", color: "processing" },
  READY_FOR_PICKUP: { label: "待领取", color: "cyan" },
  PICKED_UP: { label: "已领取", color: "success" },
  REFUNDING: { label: "退款中", color: "warning" },
  REFUNDED: { label: "已退款", color: "default" },
  PENDING_ACTIVATION: { label: "待激活", color: "warning" },
  SUCCEEDED: { label: "已完成", color: "success" },
  FAILED: { label: "处理失败", color: "error" },
  INACTIVE: { label: "已停用", color: "default" },
  PARTIALLY_PICKED_UP: { label: "部分提货", color: "processing" },
  REGISTERED: { label: "待受理", color: "warning" },
};
const StatusTag = ({ value }: { value: string }) => {
  const meta = statusMeta[value] ?? { label: "待处理", color: "default" };
  return <Tag color={meta.color}>{meta.label}</Tag>;
};
const hasCommunityArrivalDifference = (delivery: CommunityDelivery) => delivery.status === 'ARRIVED' && delivery.arrivalResult === 'EXCEPTION';
const CommunityDeliveryStatusTag = ({ delivery }: { delivery: CommunityDelivery }) => {
  if (hasCommunityArrivalDifference(delivery)) return <Tag color="warning">已到货（有差异）</Tag>;
  return <StatusTag value={delivery.status}/>;
};
function PanelTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel__head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
function StatCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <article className={`stat-card stat-card--${tone}`}>
      <span className="stat-card__label">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activationUsername,setActivationUsername]=useState<string|null>(null);
  const submit = async (value: { username: string; password: string }) => {
    setLoading(true);
    setError("");
    try {
      await api.login(value.username, value.password);
      onSuccess();
    } catch (reason) {
      if((reason as {code?:string})?.code==='ACTIVATION_REQUIRED')setActivationUsername(value.username);
      setError(
        reason instanceof Error ? reason.message : "登录失败，请稍后重试",
      );
    } finally {
      setLoading(false);
    }
  };
  const activate=async(value:{initialCredential:string;newPassword:string})=>{
    if(!activationUsername)return;
    setLoading(true);setError("");
    try{await api.activateStaff(activationUsername,value.initialCredential,value.newPassword);onSuccess();}
    catch(reason){setError(reason instanceof Error?reason.message:'激活失败，请稍后重试');}
    finally{setLoading(false);}
  };
  return (
    <main className="login-page">
      <section className="login-story">
        <span className="eyebrow">平台运营入口</span>
        <h1>
          按团期组织收单
          <br />
          按区域安排集中送达
        </h1>
        <p>把今天需要人工确认的地点、车辆和到货任务放在一个工作台处理。</p>
      </section>
      <section className="login-card">
        <h2>{activationUsername?'首次激活账号':'登录运营工作台'}</h2>
        {error && <Alert type="error" showIcon title={error} />}
        {activationUsername?<Form layout="vertical" size="large" onFinish={activate}>
          <Alert type="info" showIcon message="请设置自己的登录密码" description={`账号 ${activationUsername} 需要使用管理员一次性提供的初始凭据完成激活。初始凭据不会再次显示。`} style={{marginBottom:16}}/>
          <Form.Item label="一次性初始凭据" name="initialCredential" rules={[{required:true,min:12}]}><Input.Password autoComplete="one-time-code" /></Form.Item>
          <Form.Item label="新密码" name="newPassword" rules={[{required:true,min:12}]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>激活并进入工作台</Button>
          <Button type="link" block onClick={()=>{setActivationUsername(null);setError('');}}>返回登录</Button>
        </Form>:<Form layout="vertical" size="large" onFinish={submit}>
          <Form.Item
            label="管理员账号"
            name="username"
            rules={[{ required: true }]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, min: 12 }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            进入工作台
          </Button>
        </Form>}
      </section>
    </main>
  );
}

interface CampaignValues {
  title: string;
  serviceAreaId: string;
  cutoffAt: Dayjs;
  dispatchAt: Dayjs;
  minTotalQuantity: number;
  failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
  skuIds: string[];
}
function CampaignModal({
  open,
  close,
  saved,
  areas,
  products,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  areas: ServiceArea[];
  products: Product[];
}) {
  const [form] = Form.useForm<CampaignValues>();
  const [busy, setBusy] = useState(false);
  const save = async (value: CampaignValues) => {
    setBusy(true);
    try {
      await api.createCampaign({
        ...value,
        cutoffAt: value.cutoffAt.toISOString(),
        dispatchAt: value.dispatchAt.toISOString(),
      });
      await saved();
      form.resetFields();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="新建团期"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          minTotalQuantity: 20,
          failureAction: "CANCEL_AND_REFUND",
        }}
        onFinish={save}
      >
        <Form.Item
          label="团期名称"
          name="title"
          rules={[{ required: true, min: 2 }]}
        >
          <Input placeholder="例：当季杂粮与熟食 · 莲池区" />
        </Form.Item>
        <Form.Item
          label="收货区域"
          name="serviceAreaId"
          rules={[{ required: true }]}
        >
          <Select
            placeholder="选择本次开团的区县"
            options={areas
              .filter((area) => area.orderEnabled)
              .map((area) => ({ value: area.id, label: area.name }))}
          />
        </Form.Item>
        <div className="form-grid">
          <Form.Item
            label="截单时间"
            name="cutoffAt"
            rules={[{ required: true }]}
          >
            <DatePicker showTime format="YYYY-MM-DD HH:mm" />
          </Form.Item>
          <Form.Item
            label="计划发车"
            name="dispatchAt"
            rules={[{ required: true }]}
          >
            <DatePicker showTime format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </div>
        <Form.Item label="参团商品" name="skuIds" rules={[{ required: true }]}>
          <Select
            mode="multiple"
            options={products
              .filter((item) => item.status === "APPROVED")
              .map((item) => ({
                value: item.sku.id,
                label: `${item.title} · ${money(item.sku.unitPriceCents)}`,
              }))}
          />
        </Form.Item>
        <div className="modal-note">
          保存草稿后，请在开售前绑定本团唯一的已启用固定自提点；消费者会在下单前确认该地点。
        </div>
        <div className="form-grid">
          <Form.Item label="最低成团件数" name="minTotalQuantity">
            <InputNumber min={1} precision={0} suffix="件" />
          </Form.Item>
          <Form.Item label="未成团处理" name="failureAction">
            <Radio.Group>
              <Radio value="CANCEL_AND_REFUND">取消退款</Radio>
              <Radio value="POSTPONE">顺延</Radio>
            </Radio.Group>
          </Form.Item>
        </div>
        <Button
          type="primary"
          htmlType="submit"
          block
          size="large"
          loading={busy}
        >
          保存团期草稿
        </Button>
      </Form>
    </Modal>
  );
}

interface SiteValues {
  campaignId: string;
  pickupPointId: string;
  siteName: string;
  address: string;
  arrivalStartAt?: Dayjs;
  arrivalEndAt?: Dayjs;
  contactName?: string;
  contactPhone?: string;
  remark?: string;
}
function DeliverySiteModal({
  open,
  close,
  saved,
  plan,
  campaigns,
  pickupPoints,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  plan: DeliveryPlan | null;
  campaigns: Campaign[];
  pickupPoints: PickupPoint[];
}) {
  const [form] = Form.useForm<SiteValues>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && plan)
      form.setFieldsValue({
        campaignId: plan.campaignId,
        ...(plan.pickupPointId?{pickupPointId:plan.pickupPointId}:{}),
        siteName: plan.siteName ?? "",
        address: plan.address ?? "",
        ...(plan.arrivalStartAt
          ? { arrivalStartAt: dayjs(plan.arrivalStartAt) }
          : {}),
        ...(plan.arrivalEndAt
          ? { arrivalEndAt: dayjs(plan.arrivalEndAt) }
          : {}),
        contactName: plan.contactName ?? "",
        contactPhone: plan.contactPhone ?? "",
        remark: plan.remark ?? "",
      });
  }, [open, plan, form]);
  const save = async (value: SiteValues) => {
    if (!plan) return;
    setBusy(true);
    try {
      await api.saveDeliveryPlan({
        campaignId: plan.campaignId,
        pickupPointId: value.pickupPointId,
        siteName: value.siteName || null,
        address: value.address || null,
        arrivalStartAt: value.arrivalStartAt?.toISOString() ?? null,
        arrivalEndAt: value.arrivalEndAt?.toISOString() ?? null,
        contactName: value.contactName || null,
        contactPhone: value.contactPhone || null,
        remark: value.remark || null,
      });
      await saved();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="确认本团集中领取地点"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      {plan?.status === "VEHICLE_BOOKED" && <Alert type="warning" showIcon message="修改地点、到货时间或联系人会自动取消原约车信息，请重新预约车辆。" style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item label="团期">
          <Input
            disabled
            value={
              campaigns.find((item) => item.id === plan?.campaignId)?.title ??
              ""
            }
          />
        </Form.Item>
        <Form.Item label="固定自提点" name="pickupPointId" rules={[{ required: true, message: "请选择自提点" }]}>
          <Select
            placeholder="选择本团唯一自提点"
            options={pickupPoints.filter((item) => item.serviceAreaId === plan?.serviceAreaId && item.status === "ACTIVE").map((item) => ({ value: item.id, label: `${item.name} · ${item.address}` }))}
            onChange={(id) => { const point=pickupPoints.find((item)=>item.id===id); if(point)form.setFieldsValue({ siteName:point.name,address:point.address }); }}
          />
        </Form.Item>
        <Form.Item
          label="地点名称"
          name="siteName"
          rules={[{ required: true, min: 2 }]}
        >
          <Input disabled placeholder="选择固定自提点后自动填写" />
        </Form.Item>
        <Form.Item
          label="详细地址"
          name="address"
          rules={[{ required: true, min: 5 }]}
        >
          <Input.TextArea disabled rows={2} />
        </Form.Item>
        <div className="form-grid">
          <Form.Item label="预计到达开始" name="arrivalStartAt">
            <DatePicker showTime format="MM-DD HH:mm" />
          </Form.Item>
          <Form.Item label="预计到达结束" name="arrivalEndAt">
            <DatePicker showTime format="MM-DD HH:mm" />
          </Form.Item>
        </div>
        <div className="form-grid">
          <Form.Item label="当地联系人" name="contactName">
            <Input />
          </Form.Item>
          <Form.Item label="联系人电话" name="contactPhone" rules={[{ pattern: /^1[3-9]\d{9}$/, message: "请输入11位中国大陆手机号" }]}>
            <Input inputMode="numeric" maxLength={11} />
          </Form.Item>
        </div>
        <Form.Item label="运营备注" name="remark">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          确认地点
        </Button>
      </Form>
    </Modal>
  );
}

function VehicleModal({
  open,
  close,
  saved,
  plan,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  plan: DeliveryPlan | null;
}) {
  const [busy, setBusy] = useState(false);
  const save = async (value: {
    logisticsPlatform?: string;
    vehicleOrderNo: string;
    driverName?: string;
    driverPhone?: string;
    vehiclePlate?: string;
    estimatedArrivalAt?: Dayjs;
  }) => {
    if (!plan) return;
    setBusy(true);
    try {
      await api.bookVehicle(plan.id, {
        logisticsPlatform: value.logisticsPlatform || '货拉拉',
        vehicleOrderNo: value.vehicleOrderNo,
        driverName: value.driverName || null,
        driverPhone: value.driverPhone || null,
        vehiclePlate: value.vehiclePlate || null,
        estimatedArrivalAt: value.estimatedArrivalAt?.toISOString() ?? null,
      });
      await saved();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="登记货拉拉预约"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <Form layout="vertical" onFinish={save}>
        <Form.Item label="配送平台" name="logisticsPlatform" initialValue="货拉拉" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
        <Form.Item
          label="运单号 / 约车凭证"
          name="vehicleOrderNo"
          rules={[{ required: true, min: 2 }]}
        >
          <Input />
        </Form.Item>
        <div className="form-grid">
          <Form.Item label="司机姓名" name="driverName">
            <Input />
          </Form.Item>
          <Form.Item label="司机电话" name="driverPhone" rules={[{ pattern: /^1[3-9]\d{9}$/, message: "请输入11位中国大陆手机号" }]}>
            <Input inputMode="numeric" maxLength={11} />
          </Form.Item>
        </div>
        <Form.Item label="车牌号" name="vehiclePlate">
          <Input />
        </Form.Item>
        <Form.Item label="预计到达时间" name="estimatedArrivalAt"><DatePicker showTime style={{width:'100%'}} /></Form.Item>
        <div className="modal-note">
          司机信息只保留在履约侧，不会展示给消费者。
        </div>
        <Button type="primary" htmlType="submit" block loading={busy}>
          保存运单并确认预约
        </Button>
      </Form>
    </Modal>
  );
}

function AreaModal({
  open,
  close,
  saved,
  directory,
  areas,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  directory: RegionDirectoryEntry[];
  areas: ServiceArea[];
}) {
  const [form] = Form.useForm<{ regionCode: string }>();
  const [busy, setBusy] = useState(false);
  const openedCodes = new Set(areas.map((area) => area.regionCode));
  const save = async (value: { regionCode: string }) => {
    setBusy(true);
    try {
      await api.openServiceArea(value);
      await saved();
      form.resetFields();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="开通收货区域"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <p className="modal-note">
        区域名称与行政归属由系统维护；选择区县后即可开放收单。
      </p>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item
          label="搜索并选择区县"
          name="regionCode"
          rules={[{ required: true, message: "请选择要开通的区县" }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="输入省、市或区县名称，例如：保定 莲池区"
            options={directory.map((entry) => ({
              value: entry.regionCode,
              label: entry.path,
              disabled: openedCodes.has(entry.regionCode),
            }))}
            filterOption={(input, option) =>
              String(option?.label ?? "").includes(input.trim())
            }
            notFoundContent="未找到匹配的区县"
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          开通并允许下单
        </Button>
      </Form>
    </Modal>
  );
}
function MerchantModal({
  open,
  close,
  saved,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const save = async (value: { name: string; commission: number }) => {
    setBusy(true);
    try {
      await api.createMerchant({
        name: value.name,
        defaultCommissionBps: Math.round(value.commission * 100),
        wechatSubMchid: null,
      });
      await saved();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="新增供货商"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <Form layout="vertical" initialValues={{ commission: 8 }} onFinish={save}>
        <Form.Item
          label="供货商名称"
          name="name"
          rules={[{ required: true, min: 2 }]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="平台服务费比例" name="commission">
          <InputNumber min={0} max={100} precision={2} suffix="%" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          保存供货商
        </Button>
      </Form>
    </Modal>
  );
}
function ProductModal({
  open,
  close,
  saved,
  merchants,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  merchants: Merchant[];
}) {
  const [busy, setBusy] = useState(false);
  const save = async (value: {
    merchantId: string;
    title: string;
    category: string;
    origin: string;
    imageUrl: string;
    skuName: string;
    price: number;
    stock: number;
  }) => {
    setBusy(true);
    try {
      await api.createProduct({
        merchantId: value.merchantId,
        title: value.title,
        category: value.category,
        origin: value.origin,
        imageUrl: value.imageUrl?.trim() || null,
        skuName: value.skuName,
        priceCents: Math.round(value.price * 100),
        stock: value.stock,
      });
      await saved();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="新增商品草稿"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <Form
        layout="vertical"
        initialValues={{ category: "地方特产" }}
        onFinish={save}
      >
        <Form.Item
          label="供货商"
          name="merchantId"
          rules={[{ required: true }]}
        >
          <Select
            options={merchants
              .filter((item) => item.status === "ACTIVE")
              .map((item) => ({ value: item.id, label: item.name }))}
          />
        </Form.Item>
        <Form.Item
          label="商品名称"
          name="title"
          rules={[{ required: true, min: 2 }]}
        >
          <Input />
        </Form.Item>
        <div className="form-grid">
          <Form.Item label="分类" name="category" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="产地" name="origin" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </div>
        <Form.Item label="商品主图 URL" name="imageUrl">
          <Input placeholder="https:// 或 /assets/..." />
        </Form.Item>
        <Form.Item label="规格" name="skuName" rules={[{ required: true }]}>
          <Input placeholder="例：500g/袋" />
        </Form.Item>
        <div className="form-grid">
          <Form.Item label="售价" name="price" rules={[{ required: true }]}>
            <InputNumber min={0.01} precision={2} prefix="¥" />
          </Form.Item>
          <Form.Item label="可售库存" name="stock" rules={[{ required: true }]}>
            <InputNumber min={0} precision={0} />
          </Form.Item>
        </div>
        <Button type="primary" htmlType="submit" block loading={busy}>
          保存商品草稿
        </Button>
      </Form>
    </Modal>
  );
}

function MerchantEditModal({
  open,
  close,
  saved,
  merchant,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  merchant: Merchant | null;
}) {
  const [form] = Form.useForm<{ name: string; commission: number }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && merchant)
      form.setFieldsValue({
        name: merchant.name,
        commission: merchant.defaultCommissionBps / 100,
      });
  }, [open, merchant, form]);
  const save = async (value: { name: string; commission: number }) => {
    if (!merchant) return;
    setBusy(true);
    try {
      await api.updateMerchant(merchant.id, {
        name: value.name,
        defaultCommissionBps: Math.round(value.commission * 100),
        wechatSubMchid: merchant.wechatSubMchid,
      });
      await saved();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="编辑供货商"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item
          label="供货商名称"
          name="name"
          rules={[{ required: true, min: 2 }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          label="平台服务费比例"
          name="commission"
          rules={[{ required: true }]}
        >
          <InputNumber min={0} max={100} precision={2} suffix="%" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          保存修改
        </Button>
      </Form>
    </Modal>
  );
}

function ProductEditModal({
  open,
  close,
  saved,
  product,
  merchants,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  product: Product | null;
  merchants: Merchant[];
}) {
  const [form] = Form.useForm<{
    merchantId: string;
    title: string;
    category: string;
    origin: string;
    imageUrl: string;
    skuName: string;
    price: number;
    stock: number;
  }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && product)
      form.setFieldsValue({
        merchantId: product.merchantId,
        title: product.title,
        category: product.category,
        origin: product.origin,
        imageUrl: product.imageUrl ?? "",
        skuName: product.sku.name,
        price: product.sku.unitPriceCents / 100,
        stock: product.sku.stock,
      });
  }, [open, product, form]);
  const save = async (value: {
    merchantId: string;
    title: string;
    category: string;
    origin: string;
    imageUrl: string;
    skuName: string;
    price: number;
    stock: number;
  }) => {
    if (!product) return;
    setBusy(true);
    try {
      await api.updateProduct(product.id, {
        ...value,
        imageUrl: value.imageUrl?.trim() || null,
        priceCents: Math.round(value.price * 100),
      });
      await saved();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="编辑商品"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item
          label="供货商"
          name="merchantId"
          rules={[{ required: true }]}
        >
          <Select
            options={merchants
              .filter(
                (item) =>
                  item.status === "ACTIVE" || item.id === product?.merchantId,
              )
              .map((item) => ({ value: item.id, label: item.name }))}
          />
        </Form.Item>
        <Form.Item
          label="商品名称"
          name="title"
          rules={[{ required: true, min: 2 }]}
        >
          <Input />
        </Form.Item>
        <div className="form-grid">
          <Form.Item label="分类" name="category" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="产地" name="origin" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </div>
        <Form.Item label="商品主图 URL" name="imageUrl">
          <Input placeholder="https:// 或 /assets/..." />
        </Form.Item>
        <Form.Item label="规格" name="skuName" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <div className="form-grid">
          <Form.Item label="售价" name="price" rules={[{ required: true }]}>
            <InputNumber min={0.01} precision={2} prefix="¥" />
          </Form.Item>
          <Form.Item label="可售库存" name="stock" rules={[{ required: true }]}>
            <InputNumber min={0} precision={0} />
          </Form.Item>
        </div>
        <div className="modal-note">
          已上架商品修改后会回到草稿，需重新审核；已在收单团期中的商品不可修改。
        </div>
        <Button type="primary" htmlType="submit" block loading={busy}>
          保存商品修改
        </Button>
      </Form>
    </Modal>
  );
}

function CampaignEditModal({
  open,
  close,
  saved,
  campaign,
  areas,
  products,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  campaign: Campaign | null;
  areas: ServiceArea[];
  products: Product[];
}) {
  const [form] = Form.useForm<CampaignValues>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && campaign)
      form.setFieldsValue({
        ...campaign,
        cutoffAt: dayjs(campaign.cutoffAt),
        dispatchAt: dayjs(campaign.dispatchAt),
      });
  }, [open, campaign, form]);
  const save = async (value: CampaignValues) => {
    if (!campaign) return;
    setBusy(true);
    try {
      await api.updateCampaign(campaign.id, {
        ...value,
        cutoffAt: value.cutoffAt.toISOString(),
        dispatchAt: value.dispatchAt.toISOString(),
      });
      await saved();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="编辑团期草稿"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item
          label="团期名称"
          name="title"
          rules={[{ required: true, min: 2 }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          label="收货区域"
          name="serviceAreaId"
          rules={[{ required: true }]}
        >
          <Select
            options={areas
              .filter((area) => area.orderEnabled)
              .map((area) => ({ value: area.id, label: area.name }))}
          />
        </Form.Item>
        <div className="form-grid">
          <Form.Item
            label="截单时间"
            name="cutoffAt"
            rules={[{ required: true }]}
          >
            <DatePicker showTime format="YYYY-MM-DD HH:mm" />
          </Form.Item>
          <Form.Item
            label="计划发车"
            name="dispatchAt"
            rules={[{ required: true }]}
          >
            <DatePicker showTime format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </div>
        <Form.Item label="参团商品" name="skuIds" rules={[{ required: true }]}>
          <Select
            mode="multiple"
            options={products
              .filter((item) => item.status === "APPROVED")
              .map((item) => ({
                value: item.sku.id,
                label: `${item.title} · ${money(item.sku.unitPriceCents)}`,
              }))}
          />
        </Form.Item>
        <Form.Item label="最低成团件数" name="minTotalQuantity">
          <InputNumber min={1} precision={0} suffix="件" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          保存草稿
        </Button>
      </Form>
    </Modal>
  );
}

function PostponeCampaignModal({
  open,
  close,
  saved,
  campaign,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  campaign: Campaign | null;
}) {
  const [form] = Form.useForm<{ cutoffAt: Dayjs; dispatchAt: Dayjs }>();
  const [busy, setBusy] = useState(false);
  const save = async (value: { cutoffAt: Dayjs; dispatchAt: Dayjs }) => {
    if (!campaign) return;
    setBusy(true);
    try {
      await api.postponeCampaign(campaign.id, {
        cutoffAt: value.cutoffAt.toISOString(),
        dispatchAt: value.dispatchAt.toISOString(),
      });
      await saved();
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="设置顺延时间"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <p className="modal-note">
        顺延会恢复收单。请先确认新的截单和发车时间，再通知已付款用户。
      </p>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item
          label="新截单时间"
          name="cutoffAt"
          rules={[{ required: true }]}
        >
          <DatePicker showTime format="YYYY-MM-DD HH:mm" />
        </Form.Item>
        <Form.Item
          label="新发车时间"
          name="dispatchAt"
          rules={[{ required: true }]}
        >
          <DatePicker showTime format="YYYY-MM-DD HH:mm" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          确认顺延并恢复收单
        </Button>
      </Form>
    </Modal>
  );
}

function VerifyPickupModal({
  open,
  close,
  saved,
  plan,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  plan: DeliveryPlan | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<PickupOrderLookup | null>(null);
  const [form] = Form.useForm<{orderNo:string;code:string;items:Array<{platformSkuId:string;quantity:number}>}>();
  useEffect(() => {
    setError("");
    setOrder(null);
    form.resetFields();
  }, [open, plan?.id, form]);
  const lookup = async () => {
    if (!plan) return;
    setBusy(true);setError("");
    try {
      const value=await form.validateFields(['orderNo']);
      const found=await api.lookupPickupOrder(plan.id,value.orderNo.trim());
      setOrder(found);
      const pending=getPendingPickupRequest(localStorage,{orderId:found.id,deliveryPlanId:plan.id});
      if (pending?.state==='PENDING') {
        form.setFieldsValue({items:mapPickupRequestItemsToOrder(found.items,pending.items)});
        setError('上次领取结果未确认，请重新输入取货码并按原数量重试；请勿修改本次商品数量。');
      } else {
        if (pending?.state==='CONFIRMED') clearPickupRequest(localStorage,pending);
        form.setFieldsValue({items:found.items.map((item)=>({platformSkuId:item.skuId,quantity:item.remainingPickupQuantity}))});
      }
    } catch (reason) { setError(reason instanceof Error?reason.message:'订单查询失败'); } finally { setBusy(false); }
  };
  const save = async (value: { orderNo: string; code: string; items?:Array<{platformSkuId:string;quantity:number}> }) => {
    if (!plan) return;
    if (!order) { setError('请先查询并核对订单商品'); return; }
    setBusy(true);
    setError("");
    let requestInput: { orderId:string; deliveryPlanId:string; items:Array<{platformSkuId:string;quantity:number}> } | null = null;
    let pendingRequest: ReturnType<typeof beginPickupRequest> | null = null;
    try {
      try {
        const selectedItems=(value.items??[]).filter((item):item is {platformSkuId:string;quantity:number}=>!!item&&typeof item.platformSkuId==='string'&&Number.isSafeInteger(item.quantity)&&item.quantity>0);
        if (!selectedItems.length) { setError('请至少填写一项本次领取数量'); return; }
        requestInput={orderId:order.id,deliveryPlanId:plan.id,items:selectedItems};
        pendingRequest=beginPickupRequest(localStorage,requestInput);
        await api.verifyPickup({
          orderId: order.id,
          deliveryPlanId: plan.id,
          code: value.code,
          pickupRequestId: pendingRequest.pickupRequestId,
          items:selectedItems,
        });
        markPickupRequestConfirmed(localStorage,pendingRequest);
      } catch (reason) {
        const apiError = reason as Error & { code?: string; statusCode?: number };
        const selectedItems=(value.items??[]).filter((item):item is {platformSkuId:string;quantity:number}=>!!item&&typeof item.platformSkuId==='string'&&Number.isSafeInteger(item.quantity)&&item.quantity>0);
        if (selectedItems.length && isTerminalPickupError(apiError)) {
          clearPickupRequest(localStorage,{orderId:order.id,deliveryPlanId:plan.id});
          form.setFieldValue('code','');
          try { await saved(); } catch { /* terminal API result remains authoritative even if a list refresh fails */ }
        }
        const detail = apiError instanceof Error ? apiError.message : "核销失败，请稍后重试";
        setError(
          apiError.code === "FORBIDDEN"
            ? `${detail}。请联系平台负责人在“自提点管理”的负责人账号中核对当前员工与点位范围。`
            : detail,
        );
        return;
      }
      await saved();
      if (requestInput) clearPickupRequest(localStorage,requestInput);
      close();
    } catch {
      setError('领取已确认，页面刷新失败，请重新查询订单后再继续操作。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="现场核销"
      open={open}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <p className="modal-note">仅核验当前到货点订单。先查询商品明细，再按实际领取数量确认全提或部分提货。</p>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item label="订单号" name="orderNo" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Button onClick={()=>void lookup()} loading={busy} block style={{marginBottom:16}}>查询订单商品</Button>
        {order&&<section className="panel" style={{padding:12,marginBottom:16}}><b>{order.orderNo} · <StatusTag value={order.status}/></b>{order.items.map((item,index)=><div key={item.skuId} className="pickup-line"><Form.Item hidden name={['items',index,'platformSkuId']}><Input/></Form.Item><span>{item.name}</span><span>待领 {item.remainingPickupQuantity} / 已领 {item.alreadyPickedQuantity} / 异常 {item.exceptionQuantity}</span>{item.remainingPickupQuantity>0&&<Form.Item label="本次领取数量" name={['items',index,'quantity']} rules={[{required:true}]}><InputNumber min={0} max={item.remainingPickupQuantity} precision={0} style={{width:'100%'}}/></Form.Item>}</div>)}</section>}
        <Form.Item
          label="六码取货码"
          name="code"
          rules={[{ required: true, pattern: /^\d{6}$/ }]}
        >
          <Input inputMode="numeric" maxLength={6} />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy} disabled={!order}>
          核验并确认本次领取
        </Button>
      </Form>
    </Modal>
  );
}

function WarehouseExceptionModal({
  open,
  close,
  saved,
  campaigns,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  campaigns: Campaign[];
}) {
  const [form] = Form.useForm<{ campaignId: string; platformSkuId: string; reason: 'WAREHOUSE_SHORTAGE'|'WAREHOUSE_DAMAGE'|'MIS_SORTED'; quantity: number; description: string }>();
  const [busy, setBusy] = useState(false);
  const campaignId = Form.useWatch('campaignId', form);
  const current = campaigns.find((item) => item.id === campaignId);
  useEffect(() => { if (!open) form.resetFields(); }, [open, form]);
  const save = async (value: { campaignId: string; platformSkuId: string; reason: 'WAREHOUSE_SHORTAGE'|'WAREHOUSE_DAMAGE'|'MIS_SORTED'; quantity: number; description: string }) => {
    setBusy(true);
    try {
      await api.registerWarehouseException(value.campaignId, { items: [{ platformSkuId: value.platformSkuId, reason: value.reason, shortQuantity: value.reason === 'WAREHOUSE_DAMAGE' ? 0 : value.quantity, damagedQuantity: value.reason === 'WAREHOUSE_DAMAGE' ? value.quantity : 0, description: value.description.trim(), evidenceUrl: null }] });
      await saved(); close();
    } finally { setBusy(false); }
  };
  return <Modal title="登记仓库差异" open={open} onCancel={close} footer={null} destroyOnHidden>
    <Alert type="info" showIcon message="系统按已付款销售需求核对数量" description="这里只登记事实；运营决定补货、调拨或退款。破损商品会进入隔离，不能恢复成可售库存。" style={{marginBottom:16}} />
    <Form form={form} layout="vertical" onFinish={save}>
      <Form.Item label="锁单团期" name="campaignId" rules={[{required:true,message:'请选择锁单团期'}]}><Select options={campaigns.map((item)=>({value:item.id,label:item.title}))} /></Form.Item>
      <Form.Item label="异常商品" name="platformSkuId" rules={[{required:true,message:'请选择商品'}]}><Select disabled={!current} options={(current?.items??[]).map((item)=>({value:item.skuId,label:`${item.title} · ${item.skuName}`}))} /></Form.Item>
      <Form.Item label="异常类型" name="reason" initialValue="WAREHOUSE_SHORTAGE" rules={[{required:true}]}><Select options={[{value:'WAREHOUSE_SHORTAGE',label:'仓内短少'},{value:'WAREHOUSE_DAMAGE',label:'仓内破损'},{value:'MIS_SORTED',label:'错分拣'}]} /></Form.Item>
      <Form.Item label="异常数量" name="quantity" rules={[{required:true,message:'请输入正整数'}]}><InputNumber min={1} precision={0} style={{width:'100%'}} /></Form.Item>
      <Form.Item label="证据说明" name="description" rules={[{required:true,min:5,message:'请至少说明 5 个字'}]}><Input.TextArea rows={4} maxLength={500} placeholder="例如：批次、清点结果、破损情况和复核人" /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={busy}>登记事实并进入异常队列</Button>
    </Form>
  </Modal>;
}

function GoodsReceiptModal({
  open,
  close,
  saved,
  purchaseOrders,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  purchaseOrders: PurchaseOrder[];
}) {
  type ReceiptForm = { purchaseOrderId: string; items: Array<{ purchaseOrderItemId: string; acceptedQuantity: number; rejectedQuantity: number; batchNo: string; productionDate: string; expiresAt: string; inspectionNote: string; exceptionReason: 'SHORT_RECEIPT'|'QUALITY_REJECTED'|'PACKAGE_DAMAGED'|null; evidenceUrl: string }> };
  const [form] = Form.useForm<ReceiptForm>();
  const [busy, setBusy] = useState(false);
  const purchaseOrderId = Form.useWatch('purchaseOrderId', form);
  const current = purchaseOrders.find((item) => item.id === purchaseOrderId);
  useEffect(() => { if (!open) form.resetFields(); }, [open, form]);
  useEffect(() => {
    if (current) form.setFieldValue('items', current.items.filter((item) => (item.remainingQuantity ?? item.plannedQuantity) > 0).map((item) => ({ purchaseOrderItemId: item.id, acceptedQuantity: item.remainingQuantity ?? item.plannedQuantity, rejectedQuantity: 0, batchNo: '', productionDate: '', expiresAt: '', inspectionNote: '', exceptionReason: null, evidenceUrl: '' })));
  }, [current, form]);
  const save = async (value: ReceiptForm) => {
    if (!current) return;
    setBusy(true);
    try {
      await api.receivePurchaseOrder(current.id, { items: value.items.map((item) => ({ ...item, batchNo: item.batchNo.trim() || null, productionDate: item.productionDate || null, expiresAt: item.expiresAt || null, inspectionNote: item.inspectionNote.trim() || null, evidenceUrl: item.evidenceUrl.trim() || null })) });
      await saved(); close();
    } finally { setBusy(false); }
  };
  const receivingOrders = purchaseOrders.filter((item) => ['ORDERED', 'RECEIVING'].includes(item.status) && item.items.some((line) => (line.remainingQuantity ?? line.plannedQuantity) > 0));
  return <Modal title="登记供应商收货验收" open={open} onCancel={close} footer={null} destroyOnHidden width={800}>
    <Alert type="info" showIcon message="每次收货都是独立批次，可继续补货验收" description="短收或拒收不会覆盖此前合格实收。请只登记本次实际到仓数量；合格数量入批次库存并形成供应商应付，拒收数量进入待补货异常。" style={{marginBottom:16}} />
    <Form form={form} layout="vertical" onFinish={save}>
      <Form.Item label="采购单" name="purchaseOrderId" rules={[{required:true,message:'请选择待验收采购单'}]}><Select options={receivingOrders.map((item) => ({value:item.id,label:`${item.purchaseNo} · ${item.status==='RECEIVING'?'待补货':'待验收'}`}))} /></Form.Item>
      <Form.List name="items">{(fields) => <>{fields.map((field, index) => { const line=current?.items.find((item) => item.id === form.getFieldValue(['items', index, 'purchaseOrderItemId'])); const remaining=line?.remainingQuantity ?? line?.plannedQuantity ?? 0; return <div key={field.key} className="panel" style={{padding:12,marginBottom:12}}><b>SKU {line?.platformSkuId.slice(0,8)} · 本次最多 {remaining} 件</b><Form.Item name={[field.name,'purchaseOrderItemId']} hidden><Input /></Form.Item><div className="form-grid"><Form.Item label="合格实收" name={[field.name,'acceptedQuantity']} rules={[{required:true}]}><InputNumber min={0} max={remaining} precision={0} style={{width:'100%'}} /></Form.Item><Form.Item label="拒收/短收" name={[field.name,'rejectedQuantity']} rules={[{required:true}]}><InputNumber min={0} max={remaining} precision={0} style={{width:'100%'}} /></Form.Item></div><Form.Item label="食品批次号（有合格实收时必填）" name={[field.name,'batchNo']}><Input maxLength={100} /></Form.Item><div className="form-grid"><Form.Item label="生产日期" name={[field.name,'productionDate']}><Input type="date" /></Form.Item><Form.Item label="到期日期" name={[field.name,'expiresAt']}><Input type="date" /></Form.Item></div><Form.Item label="证据链接（可选）" name={[field.name,'evidenceUrl']}><Input maxLength={2048} placeholder="https://…" /></Form.Item><Form.Item label="拒收原因（有拒收/短收时必填）" name={[field.name,'exceptionReason']}><Select allowClear options={[{value:'SHORT_RECEIPT',label:'供应商短收'},{value:'QUALITY_REJECTED',label:'质量拒收'},{value:'PACKAGE_DAMAGED',label:'包装破损'}]} /></Form.Item><Form.Item label="验收说明（有拒收/短收时必填）" name={[field.name,'inspectionNote']}><Input.TextArea rows={2} maxLength={500} placeholder="批次、验收依据、数量或质量差异" /></Form.Item></div>;})}</>}</Form.List>
      <Button type="primary" htmlType="submit" block disabled={!current} loading={busy}>保存本次验收批次</Button>
    </Form>
  </Modal>;
}

function OutboundDispatchModal({
  open,
  close,
  saved,
  campaign,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  campaign: Campaign | null;
}) {
  const [form] = Form.useForm<{ carrierReference: string }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) form.resetFields(); }, [open, form]);
  const save = async (value: { carrierReference: string }) => {
    if (!campaign) return;
    setBusy(true);
    try {
      await api.createPlatformOutbound(campaign.id, value.carrierReference.trim() || null);
      await saved();
      close();
    } finally { setBusy(false); }
  };
  return <Modal title="创建出库配送" open={open} onCancel={close} footer={null} destroyOnHidden>
    <Alert type="info" showIcon message="仅限已完成分拣且已预约固定自提点的团期" description="确认后库存从已分拣转为已出库，配送计划进入运输中；点位交接完成前不会开放领取。" style={{ marginBottom: 16 }} />
    <Form form={form} layout="vertical" onFinish={save}>
      <Form.Item label="锁单团期"><Input value={campaign?.title ?? ''} disabled /></Form.Item>
      <Form.Item label="配送/承运参考号" name="carrierReference"><Input maxLength={100} placeholder="例如：司机单号、物流单号或班次号" /></Form.Item>
      <Button type="primary" htmlType="submit" block disabled={!campaign} loading={busy}>确认出库配送</Button>
    </Form>
  </Modal>;
}

function PickupHandoverModal({
  open,
  close,
  saved,
  outboundOrders,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<unknown>;
  outboundOrders: OutboundOrder[];
}) {
  const [form] = Form.useForm<{ outboundId: string; receivedBy: string; exceptionNote: string; items: Array<{ platformSkuId: string; receivedQuantity: number; rejectedQuantity: number; shortQuantity: number; damagedQuantity: number; reason: string | null; evidenceNote: string | null }> }>();
  const [busy, setBusy] = useState(false);
  const outboundId = Form.useWatch('outboundId', form);
  const current = outboundOrders.find((item) => item.id === outboundId);
  useEffect(() => { if (!open) form.resetFields(); }, [open, form]);
  useEffect(() => {
    if (current) form.setFieldValue('items', current.items.map((item) => ({ platformSkuId: item.platformSkuId, receivedQuantity: item.quantity, rejectedQuantity: 0, shortQuantity: 0, damagedQuantity: 0, reason: null, evidenceNote: null })));
  }, [current, form]);
  const save = async (value: { outboundId: string; receivedBy: string; exceptionNote: string; items: Array<{ platformSkuId: string; receivedQuantity: number; rejectedQuantity: number; shortQuantity: number; damagedQuantity: number; reason: string | null; evidenceNote: string | null }> }) => {
    if (!current) return;
    setBusy(true);
    try {
      await api.completePickupHandover(current.id, {
        receivedBy: value.receivedBy.trim(),
        exceptionNote: value.exceptionNote.trim() || null,
        items: value.items,
      });
      await saved(); close();
    } finally { setBusy(false); }
  };
  return <Modal title="登记点位交接与差异" open={open} onCancel={close} footer={null} destroyOnHidden width={760}>
    <Alert type="info" showIcon message="先登记实际交接，再开放领取" description="逐商品填写实到、拒收、短少或破损数量；异常时必须选原因并提供证据说明。点位人员只能登记事实，运营再决定调拨或退款。" style={{marginBottom:16}} />
    <Form form={form} layout="vertical" onFinish={save}>
      <Form.Item label="待交接出库单" name="outboundId" rules={[{required:true,message:'请选择已发车出库单'}]}><Select options={outboundOrders.map((item)=>({value:item.id,label:`${item.outboundNo} · ${item.items.length} 个商品`}))} /></Form.Item>
      <Form.Item label="点位接货人" name="receivedBy" rules={[{required:true,min:2,message:'请填写实际接货人'}]}><Input maxLength={100} /></Form.Item>
      <Form.Item label="交接说明" name="exceptionNote"><Input.TextArea rows={3} maxLength={500} placeholder="可记录整体交接情况；异常证据请在对应商品填写。" /></Form.Item>
      <Form.List name="items">{(fields)=><>{fields.map((field,index)=>{const outboundItem=current?.items[index];return <div key={field.key} className="panel" style={{padding:12,marginBottom:12}}><b>{outboundItem?.platformSkuId.slice(0,8)} · 应交 {outboundItem?.quantity ?? 0} 件</b><Form.Item name={[field.name,'platformSkuId']} hidden><Input /></Form.Item><div className="form-grid"><Form.Item label="实到" name={[field.name,'receivedQuantity']} rules={[{required:true}]}><InputNumber min={0} precision={0} style={{width:'100%'}} /></Form.Item><Form.Item label="拒收" name={[field.name,'rejectedQuantity']} rules={[{required:true}]}><InputNumber min={0} precision={0} style={{width:'100%'}} /></Form.Item><Form.Item label="短少" name={[field.name,'shortQuantity']} rules={[{required:true}]}><InputNumber min={0} precision={0} style={{width:'100%'}} /></Form.Item><Form.Item label="破损" name={[field.name,'damagedQuantity']} rules={[{required:true}]}><InputNumber min={0} precision={0} style={{width:'100%'}} /></Form.Item></div><Form.Item label="差异原因（有差异时必填）" name={[field.name,'reason']}><Select allowClear options={[{value:'TRANSIT_SHORTAGE',label:'运输短少'},{value:'TRANSIT_DAMAGE',label:'运输破损'},{value:'WRONG_POINT',label:'错点'},{value:'PICKUP_POINT_REJECTED',label:'点位拒收'}]} /></Form.Item><Form.Item label="差异证据说明（有差异时必填）" name={[field.name,'evidenceNote']}><Input.TextArea rows={2} maxLength={500} /></Form.Item></div>;})}</>}</Form.List>
      <Button type="primary" htmlType="submit" block disabled={!current} loading={busy}>提交交接事实</Button>
    </Form>
  </Modal>;
}

function CommunityProductModal({open,close,onSaved,sku,showCommercialDetails}:{open:boolean;close:()=>void;onSaved:()=>void;sku:PlatformSku|null;showCommercialDetails:boolean}){
  const [form]=Form.useForm<{title:string;category:string;origin:string;imageUrl:string|null;skuName:string;retailPriceCents:number;defaultSellableQuantity:number;referencePurchaseCostCents:number|null;supplierNote:string|null}>();
  const [saving,setSaving]=useState(false);
  const save=async(value:{title:string;category:string;origin:string;imageUrl:string|null;skuName:string;retailPriceCents:number;defaultSellableQuantity:number;referencePurchaseCostCents:number|null;supplierNote:string|null})=>{setSaving(true);try{const payload={...value,referencePurchaseCostCents:value.referencePurchaseCostCents??null,supplierNote:value.supplierNote??null,status:sku?.status??'ACTIVE'} as const;await api.savePlatformSku(sku?{...payload,id:sku.id,productId:sku.productId}:payload);message.success('平台商品已保存，可加入新团期');form.resetFields();onSaved();close();}catch(error){message.error(error instanceof Error?error.message:'保存失败');}finally{setSaving(false);}};
  const initialValues=sku?{title:sku.product.title,category:sku.product.category,origin:sku.product.origin,imageUrl:sku.product.imageUrl,skuName:sku.name,retailPriceCents:sku.retailPriceCents,defaultSellableQuantity:sku.defaultSellableQuantity??0,referencePurchaseCostCents:sku.referencePurchaseCostCents??null,supplierNote:sku.supplierNote??null}:{category:'地方特产',origin:'保定',imageUrl:null,defaultSellableQuantity:0,referencePurchaseCostCents:null,supplierNote:null};
  return <Modal open={open} onCancel={close} footer={null} destroyOnHidden title={sku?'编辑平台商品':'新增平台商品'}><Alert type="info" showIcon message="商品是长期资料" description="采购成本和供应商备注仅作内部参考，不会进入消费者订单、退款或点位人员视图。" style={{marginBottom:16}}/><Form key={sku?.id??'new'} form={form} layout="vertical" initialValues={initialValues} onFinish={(value)=>void save(value)}><div className="form-grid"><Form.Item label="商品名称" name="title" rules={[{required:true,min:2}]}><Input /></Form.Item><Form.Item label="规格" name="skuName" rules={[{required:true,min:1}]}><Input /></Form.Item></div><div className="form-grid"><Form.Item label="分类" name="category" rules={[{required:true}]}><Input /></Form.Item><Form.Item label="产地" name="origin" rules={[{required:true}]}><Input /></Form.Item></div><div className="form-grid"><Form.Item label="默认零售价（分）" name="retailPriceCents" rules={[{required:true}]}><InputNumber min={1} precision={0} style={{width:'100%'}} /></Form.Item><Form.Item label="默认可售数量" name="defaultSellableQuantity" rules={[{required:true}]}><InputNumber min={0} precision={0} style={{width:'100%'}} /></Form.Item></div><Form.Item label="图片 URL（可选）" name="imageUrl"><Input /></Form.Item>{showCommercialDetails&&<><Form.Item label="采购成本（分，可选）" name="referencePurchaseCostCents"><InputNumber min={1} precision={0} style={{width:'100%'}} /></Form.Item><Form.Item label="供应商备注（可选）" name="supplierNote"><Input.TextArea rows={2} maxLength={500} /></Form.Item></>}<Button htmlType="submit" type="primary" loading={saving}>保存平台商品</Button></Form></Modal>;
}

function CommunityCampaignModal({open,close,skus,areas,points,onSaved}:{open:boolean;close:()=>void;skus:PlatformSku[];areas:ServiceArea[];points:PickupPoint[];onSaved:()=>void}){
  const [form]=Form.useForm<{title:string;serviceAreaId:string;pickupPointId:string;cutoffAt:Dayjs;dispatchAt:Dayjs;minTotalQuantity:number;items:Array<{platformSkuId:string;retailPriceCents:number;sellableQuantity:number}>}>();const [saving,setSaving]=useState(false);const areaId=Form.useWatch('serviceAreaId',form);
  const save=async(value:{title:string;serviceAreaId:string;pickupPointId:string;cutoffAt:Dayjs;dispatchAt:Dayjs;minTotalQuantity:number;items:Array<{platformSkuId:string;retailPriceCents:number;sellableQuantity:number}>})=>{setSaving(true);try{await api.createCommunityCampaign({title:value.title,serviceAreaId:value.serviceAreaId,pickupPointId:value.pickupPointId,cutoffAt:value.cutoffAt.toISOString(),dispatchAt:value.dispatchAt.toISOString(),minTotalQuantity:value.minTotalQuantity,failureAction:'CANCEL_AND_REFUND',items:value.items});message.success('社区团期已创建，请确认后开售');form.resetFields();onSaved();close();}catch(error){message.error(error instanceof Error?error.message:'创建失败');}finally{setSaving(false);}};
  return <Modal open={open} onCancel={close} footer={null} width={760} title="创建社区团期"><Alert type="info" showIcon message="一团一个固定自提点" description="创建后商品、团期售价和可售量会成为快照；不要求采购单、中心仓或批次库存。" style={{marginBottom:16}}/><Form form={form} layout="vertical" initialValues={{minTotalQuantity:1,items:[]}} onFinish={(value)=>void save(value)}><Form.Item label="团期名称" name="title" rules={[{required:true,min:2}]}><Input /></Form.Item><div className="form-grid"><Form.Item label="收货区域" name="serviceAreaId" rules={[{required:true}]}><Select options={areas.filter((area)=>area.status==='ENABLED'&&area.orderEnabled).map((area)=>({value:area.id,label:area.name}))} /></Form.Item><Form.Item label="固定自提点" name="pickupPointId" rules={[{required:true}]}><Select options={points.filter((point)=>point.status==='ACTIVE'&&(!areaId||point.serviceAreaId===areaId)).map((point)=>({value:point.id,label:point.name}))} /></Form.Item></div><div className="form-grid"><Form.Item label="截单时间" name="cutoffAt" rules={[{required:true}]}><DatePicker showTime style={{width:'100%'}} /></Form.Item><Form.Item label="预计提货/发车时间" name="dispatchAt" rules={[{required:true}]}><DatePicker showTime style={{width:'100%'}} /></Form.Item></div><Form.Item label="最小成团件数" name="minTotalQuantity" rules={[{required:true}]}><InputNumber min={1} precision={0} /></Form.Item><Form.List name="items">{(fields,{add,remove})=><><Button type="dashed" onClick={()=>add()} style={{marginBottom:12}}>添加团期商品</Button>{fields.map((field)=><div key={field.key} className="panel" style={{padding:12,marginBottom:12}}><Button type="link" danger onClick={()=>remove(field.name)}>移除</Button><Form.Item label="平台商品" name={[field.name,'platformSkuId']} rules={[{required:true}]}><Select options={skus.filter((sku)=>sku.status==='ACTIVE').map((sku)=>({value:sku.id,label:`${sku.product.title} · ${sku.name}`}))} /></Form.Item><div className="form-grid"><Form.Item label="本团售价（分）" name={[field.name,'retailPriceCents']} rules={[{required:true}]}><InputNumber min={1} precision={0} style={{width:'100%'}} /></Form.Item><Form.Item label="本团可售数量" name={[field.name,'sellableQuantity']} rules={[{required:true}]}><InputNumber min={1} precision={0} style={{width:'100%'}} /></Form.Item></div></div>)}</>}</Form.List><Button htmlType="submit" type="primary" loading={saving}>创建团期</Button></Form></Modal>;
}

function CommunityArrivalModal({open,close,saved,delivery,emergencyProxy=false}:{open:boolean;close:()=>void;saved:()=>Promise<unknown>;delivery:CommunityDelivery|null;emergencyProxy?:boolean}){
  const [form]=Form.useForm<{receivedBy:string;confirmationNote:string|null;emergencyReason:string|null;items:Array<{platformSkuId:string;receivedQuantity:number;rejectedQuantity:number;shortQuantity:number;damagedQuantity:number;reason:string|null;evidenceNote:string|null}>}>();const [saving,setSaving]=useState(false);
  useEffect(()=>{if(delivery)form.setFieldsValue({receivedBy:'',confirmationNote:null,emergencyReason:null,items:delivery.expectedItems.map((item)=>({platformSkuId:item.platformSkuId,receivedQuantity:item.expectedQuantity,rejectedQuantity:0,shortQuantity:0,damagedQuantity:0,reason:null,evidenceNote:null}))});},[delivery,form]);
  const save=async(value:{receivedBy:string;confirmationNote:string|null;emergencyReason:string|null;items:Array<{platformSkuId:string;receivedQuantity:number;rejectedQuantity:number;shortQuantity:number;damagedQuantity:number;reason:string|null;evidenceNote:string|null}>})=>{if(!delivery?.dispatchBatchId)return;setSaving(true);try{const hasDifference=value.items.some((item)=>item.rejectedQuantity+item.shortQuantity+item.damagedQuantity>0);await api.confirmCommunityArrival(delivery.dispatchBatchId,{...value,confirmationNote:value.confirmationNote||null,emergencyReason:emergencyProxy?value.emergencyReason?.trim()||null:null,items:value.items.map((item)=>({platformSkuId:item.platformSkuId,receivedQuantity:item.receivedQuantity,rejectedQuantity:item.rejectedQuantity,shortQuantity:item.shortQuantity,damagedQuantity:item.damagedQuantity,reason:item.reason||null,evidenceNote:item.evidenceNote||null}))});message.success(hasDifference?'已登记到货差异，正常商品已开放领取':'已确认全部商品到货，取货码已开放');await saved();close();}catch(error){message.error(error instanceof Error?error.message:'到货确认失败');}finally{setSaving(false);}};
  return <Modal open={open} onCancel={close} footer={null} width={760} destroyOnHidden title={emergencyProxy?'紧急代办：点位逐商品确认到货':'点位逐商品确认到货'}>{emergencyProxy&&<Alert showIcon type="warning" message="平台负责人紧急代办" description="必须说明代办原因。原因、平台负责人身份、时间与逐商品交接事实会一起写入不可变审计记录。" style={{marginBottom:16}}/>}<Alert showIcon type="info" message="只登记现场事实" description="实到、拒收、短少、破损之和必须等于应到数。差异商品须填写原因和文字证据；只有正常实到数量开放领取。" style={{marginBottom:16}}/><Form form={form} layout="vertical" onFinish={(value)=>void save(value)}><Form.Item label="接货人" name="receivedBy" rules={[{required:true,min:2}]}><Input /></Form.Item>{emergencyProxy&&<Form.Item label="紧急代办原因" name="emergencyReason" rules={[{required:true,min:2,message:'请填写至少两个字的紧急代办原因'}]}><Input.TextArea rows={2} maxLength={500}/></Form.Item>}<Form.Item label="交接说明（可选）" name="confirmationNote"><Input.TextArea rows={2} maxLength={500}/></Form.Item>{delivery?.expectedItems.map((item,index)=><section className="panel" key={item.platformSkuId} style={{padding:12,marginBottom:12}}><b>{item.title} · {item.skuName}</b><span className="cell-note">应到 {item.expectedQuantity} 件</span><Form.Item hidden name={['items',index,'platformSkuId']}><Input /></Form.Item><div className="form-grid"><Form.Item label="实到" name={['items',index,'receivedQuantity']} rules={[{required:true}]}><InputNumber min={0} precision={0} style={{width:'100%'}}/></Form.Item><Form.Item label="拒收" name={['items',index,'rejectedQuantity']} rules={[{required:true}]}><InputNumber min={0} precision={0} style={{width:'100%'}}/></Form.Item><Form.Item label="短少" name={['items',index,'shortQuantity']} rules={[{required:true}]}><InputNumber min={0} precision={0} style={{width:'100%'}}/></Form.Item><Form.Item label="破损" name={['items',index,'damagedQuantity']} rules={[{required:true}]}><InputNumber min={0} precision={0} style={{width:'100%'}}/></Form.Item></div><div className="form-grid"><Form.Item label="差异原因（有差异时必填）" name={['items',index,'reason']}><Select allowClear options={[{value:'TRANSIT_SHORTAGE',label:'运输短少'},{value:'TRANSIT_DAMAGE',label:'运输破损'},{value:'WRONG_POINT',label:'错发点位'},{value:'PICKUP_POINT_REJECTED',label:'点位拒收'},{value:'PACKAGE_DAMAGED',label:'包装破损'}]}/></Form.Item><Form.Item label="文字证据（有差异时必填）" name={['items',index,'evidenceNote']}><Input maxLength={500}/></Form.Item></div></section>)}<Button htmlType="submit" type="primary" loading={saving}>确认到货与差异</Button></Form></Modal>;
}


function PickupPointCreateModal({open,close,areas,saved}:{open:boolean;close:()=>void;areas:ServiceArea[];saved:()=>Promise<unknown>}){
  const [form]=Form.useForm<{serviceAreaId:string;name:string;address:string;capacityPerDay:number|null}>();
  const [saving,setSaving]=useState(false);
  const submit=async(value:{serviceAreaId:string;name:string;address:string;capacityPerDay:number|null})=>{setSaving(true);try{await api.createPickupPoint({...value,name:value.name.trim(),address:value.address.trim()});await saved();message.success('自提点已创建');form.resetFields();close();}catch(error){message.error(error instanceof Error?error.message:'创建自提点失败');}finally{setSaving(false);}};
  return <Modal open={open} onCancel={close} footer={null} destroyOnHidden title="新增自提点"><Alert type="info" showIcon message="先开通服务区域，再创建固定自提点" description="自提点创建后可绑定负责人；负责人只能看到自己绑定点位的配送和待领取订单。" style={{marginBottom:16}}/><Form form={form} layout="vertical" onFinish={(value)=>void submit(value)}><Form.Item label="服务区域" name="serviceAreaId" rules={[{required:true}]}><Select options={areas.filter((item)=>item.orderEnabled).map((item)=>({value:item.id,label:item.name}))}/></Form.Item><Form.Item label="自提点名称" name="name" rules={[{required:true,min:2}]}><Input maxLength={100}/></Form.Item><Form.Item label="详细地址" name="address" rules={[{required:true,min:5}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item><Form.Item label="预计日容量（可选）" name="capacityPerDay"><InputNumber min={1} precision={0} style={{width:'100%'}}/></Form.Item><Button type="primary" htmlType="submit" loading={saving}>创建自提点</Button></Form></Modal>;
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(
    !requiresLogin || Boolean(auth.token()),
  );
  const [page, setPage] = useState<Page>("dashboard");
  const [modal, setModal] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<DeliveryPlan | null>(null);
  const [selectedCommunityDelivery, setSelectedCommunityDelivery] = useState<CommunityDelivery | null>(null);
  const [selectedCommunitySku, setSelectedCommunitySku] = useState<PlatformSku | null>(null);
  const [selectedStaff,setSelectedStaff]=useState<InternalStaff|null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
    null,
  );
  const [selectedOutboundCampaign, setSelectedOutboundCampaign] = useState<Campaign | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(
    null,
  );
  const [busy, setBusy] = useState("");
  const [messageApi, holder] = message.useMessage();
  const queryClient = useQueryClient();
  const roles = requiresLogin ? auth.roles() : ["SUPER_ADMIN"];
  const can = (...allowedRoles: string[]) => roles.includes("SUPER_ADMIN") || allowedRoles.some((role) => roles.includes(role));
  useEffect(() => {
    const expired = () => setLoggedIn(false);
    window.addEventListener("admin-auth-expired", expired);
    return () => window.removeEventListener("admin-auth-expired", expired);
  }, []);
  const enabled = loggedIn;
  const isPointWorkbenchUserForCurrentRoles=isPointWorkbenchUser(roles);
  const canReadCampaigns = can("OPERATOR", "FULFILLMENT");
  const canReadOperations = can("OPERATOR", "FULFILLMENT");
  const canUsePickupVerifier = isPointWorkbenchUserForCurrentRoles;
  const canReadOrders = can("OPERATOR", "FULFILLMENT", "FINANCE", "CUSTOMER_SERVICE");
  const campaignsQ = useQuery({
    queryKey: ["campaigns"],
    queryFn: api.listCampaigns,
    enabled: enabled && canReadCampaigns,
  });
  const lockedPlatformCampaignsQ=useQuery({queryKey:['locked-platform-campaigns'],queryFn:api.listLockedPlatformCampaigns,enabled:enabled&&can('PROCUREMENT','WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT','OPERATOR')});
  const merchantsQ = useQuery({
    queryKey: ["merchants"],
    queryFn: api.listMerchants,
    enabled: enabled && can("OPERATOR"),
  });
  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: api.listProducts,
    enabled: enabled && can("OPERATOR", "REVIEWER"),
  });
  const areasQ = useQuery({
    queryKey: ["areas"],
    queryFn: api.listServiceAreas,
    enabled: enabled && can("OPERATOR"),
  });
  const pickupPointsQ = useQuery({ queryKey:["pickup-points"],queryFn:api.listPickupPoints,enabled: enabled && can("OPERATOR") });
  const staffQ=useQuery({queryKey:['internal-staff'],queryFn:()=>api.listInternalStaff(),enabled:enabled&&can('SUPER_ADMIN')});
  const directoryQ = useQuery({
    queryKey: ["region-directory"],
    queryFn: api.listRegionDirectory,
    enabled: enabled && can("OPERATOR"),
  });
  const plansQ = useQuery({
    queryKey: ["delivery-plans", canUsePickupVerifier ? "assigned" : "operations"],
    queryFn: canUsePickupVerifier ? api.listPickupDeliveryPlans : api.listDeliveryPlans,
    enabled: enabled && (canReadOperations || canUsePickupVerifier),
  });
  const ordersQ = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.listOrders(),
    enabled: enabled && canReadOrders,
  });
  const batchesQ = useQuery({
    queryKey: ["batches"],
    queryFn: api.listBatches,
    enabled: enabled && canReadOperations,
  });
  const settlementsQ = useQuery({
    queryKey: ["settlements"],
    queryFn: api.listSettlements,
    enabled: enabled && can("FINANCE"),
  });
  const refundsQ = useQuery({
    queryKey: ["refunds"],
    queryFn: api.listRefunds,
    enabled: enabled && can("FINANCE"),
  });
  const auditQ = useQuery({
    queryKey: ["audit"],
    queryFn: api.listAuditLogs,
    enabled: enabled && can("SUPER_ADMIN"),
  });
  const interestsQ = useQuery({
    queryKey: ["service-area-interests"],
    queryFn: api.listServiceAreaInterests,
    enabled: enabled && can("OPERATOR", "CUSTOMER_SERVICE", "FINANCE"),
  });
  const afterSalesQ = useQuery({
    queryKey: ["after-sales"],
    queryFn: api.listAfterSales,
    enabled: enabled && can("OPERATOR", "CUSTOMER_SERVICE", "FINANCE"),
  });
  const communityQualityCasesQ = useQuery({
    queryKey: ["community-quality-cases"],
    queryFn: api.listCommunityQualityCases,
    enabled: enabled && can("OPERATOR", "CUSTOMER_SERVICE", "FINANCE"),
  });
  const communityCancellationRequestsQ=useQuery({queryKey:['community-cancellation-requests'],queryFn:api.listCommunityCancellationRequests,enabled:enabled&&can('OPERATOR','FINANCE','CUSTOMER_SERVICE')});
  const communityPickupWindowsQ=useQuery({queryKey:['community-pickup-windows'],queryFn:api.listCommunityPickupWindows,enabled:enabled&&can('OPERATOR','FINANCE')});
  const platformSkusQ=useQuery({queryKey:['platform-skus'],queryFn:api.listPlatformSkus,enabled:enabled&&can('PROCUREMENT','OPERATOR')});
  const communityCampaignsQ=useQuery({queryKey:['community-campaigns'],queryFn:api.listCommunityCampaigns,enabled:enabled&&can('OPERATOR','FULFILLMENT')});
  const communityDeliveriesQ=useQuery({queryKey:['community-deliveries'],queryFn:api.listCommunityDeliveries,enabled:enabled&&(can('OPERATOR','FULFILLMENT')||canUsePickupVerifier)});
  const purchaseOrdersQ=useQuery({queryKey:['purchase-orders'],queryFn:api.listPurchaseOrders,enabled:enabled&&can('PROCUREMENT','WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FINANCE','OPERATOR')});
  const fulfillmentExceptionsQ=useQuery({queryKey:['fulfillment-exceptions'],queryFn:api.listFulfillmentExceptions,enabled:enabled&&can('OPERATOR','PROCUREMENT','WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT','FINANCE')});
  const platformOutboundOrdersQ=useQuery({queryKey:['platform-outbound-orders'],queryFn:api.listPlatformOutboundOrders,enabled:enabled&&can('WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT','OPERATOR')});
  const manualNotificationsQ = useQuery({
    queryKey: ["manual-notifications"],
    queryFn: api.listManualNotifications,
    enabled: enabled && can("OPERATOR", "CUSTOMER_SERVICE"),
  });
  const refresh = () => queryClient.invalidateQueries();
  const act = async (
    key: string,
    work: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(key);
    try {
      await work();
      await refresh();
      messageApi.success(success);
    } catch (reason) {
      messageApi.error(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy("");
    }
  };
  const resolutionNote = (title: string) => {
    const value = window.prompt(title)?.trim() ?? "";
    if (value.length < 2) {
      messageApi.warning("请输入至少 2 个字的处理说明");
      return null;
    }
    return value;
  };
  const campaigns = campaignsQ.data ?? [];
  const merchants = merchantsQ.data ?? [];
  const products = productsQ.data ?? [];
  const areas = areasQ.data ?? [];
  const pickupPoints = pickupPointsQ.data ?? [];
  const staffMembers=staffQ.data??[];
  const directory = directoryQ.data ?? [];
  const plans = plansQ.data ?? [];
  const orders = ordersQ.data ?? [];
  const batches = batchesQ.data ?? [];
  const loading = [campaignsQ, areasQ, plansQ, ordersQ, batchesQ].some(
    (query) => query.isLoading,
  );
  const pageQueries: Record<Page, Array<{ isError: boolean; refetch: () => Promise<unknown> }>> = {
    dashboard: isPointWorkbenchUserForCurrentRoles ? [communityDeliveriesQ] : [communityCampaignsQ, communityDeliveriesQ, ordersQ, fulfillmentExceptionsQ],
    products: [platformSkusQ],
    campaigns: [communityCampaignsQ, areasQ, pickupPointsQ],
    orders: [ordersQ],
    logistics: [communityDeliveriesQ, batchesQ],
    "pickup-points": [areasQ, directoryQ, pickupPointsQ, staffQ],
    service: [afterSalesQ, communityQualityCasesQ, communityCancellationRequestsQ, communityPickupWindowsQ, fulfillmentExceptionsQ, manualNotificationsQ],
    finance: [refundsQ, settlementsQ],
    settings: [staffQ, auditQ, manualNotificationsQ],
    "point-workbench": [communityDeliveriesQ, plansQ],
  };
  const failedPageQueries = pageQueries[page].filter((query) => query.isError);
  const retryPageQueries = () => {
    void Promise.all(pageQueries[page].map((query) => query.refetch()));
  };
  const areaName = (id: string) =>
    areas.find((item) => item.id === id)?.name ?? id;
  const campaignName = (id: string) =>
    campaigns.find((item) => item.id === id)?.title ?? id;
  const planByCampaign = useMemo(
    () => new Map(plans.map((item) => [item.campaignId, item])),
    [plans],
  );
  const regionPathByCode = useMemo(
    () => new Map(directory.map((item) => [item.regionCode, item.path])),
    [directory],
  );
  useEffect(()=>{
    if(isPointWorkbenchUserForCurrentRoles&&page!=='point-workbench')setPage('point-workbench');
    else if(!isPointWorkbenchUserForCurrentRoles&&!can('OPERATOR')&&can('FINANCE')&&page==='dashboard')setPage('finance');
    else if(!isPointWorkbenchUserForCurrentRoles&&!can('OPERATOR')&&!can('FINANCE')&&can('CUSTOMER_SERVICE')&&page==='dashboard')setPage('orders');
  },[isPointWorkbenchUserForCurrentRoles,page,roles.join(',')]);
  const openVerifier = (plan: DeliveryPlan) => {
    setSelectedPlan(plan);
    setModal("verify");
  };
  if (!loggedIn)
    return (
      <Login
        onSuccess={() => {
          setLoggedIn(true);
          void refresh();
        }}
      />
    );
  const dashboard = (
    <>
      <header className="workspace-header">
        <div>
          <h1>工作台</h1>
          <p>只保留今天需要人工处理的收单与履约任务。</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModal("campaign")}
        >
          新建团期
        </Button>
      </header>
      <section className="task-section">
        <PanelTitle eyebrow="需要处理" title="履约待办" />
        <div className="attention-grid">
          <button onClick={() => setPage("logistics")}>
            <span>待确认到货地点</span>
            <b>
              {plans.filter((item) => item.status === "PENDING_SITE").length}
            </b>
          </button>
          <button onClick={() => setPage("logistics")}>
            <span>待登记约车</span>
            <b>
              {plans.filter((item) => item.status === "SITE_CONFIRMED").length}
            </b>
          </button>
          <button onClick={() => setPage("logistics")}>
            <span>可创建发车批次</span>
            <b>
              {
                campaigns.filter(
                  (item) =>
                    item.status === "LOCKED" &&
                    planByCampaign.get(item.id)?.status === "VEHICLE_BOOKED",
                ).length
              }
            </b>
          </button>
          <button onClick={() => setPage("logistics")}>
            <span>运输中待确认到货</span>
            <b>{plans.filter((item) => item.status === "IN_TRANSIT").length}</b>
          </button>
        </div>
      </section>
      <section className="dashboard-grid">
        <article className="panel">
          <PanelTitle eyebrow="本期进度" title="下一班配送" />
          {loading ? (
            <Skeleton active paragraph={{ rows: 2 }} />
          ) : plans.find((item) =>
              ["VEHICLE_BOOKED", "IN_TRANSIT"].includes(item.status),
            ) ? (
            <div className="next-dispatch">
              <div>
                <small>收货区域</small>
                <b>
                  {areaName(
                    plans.find((item) =>
                      ["VEHICLE_BOOKED", "IN_TRANSIT"].includes(item.status),
                    )!.serviceAreaId,
                  )}
                </b>
                <StatusTag
                  value={
                    plans.find((item) =>
                      ["VEHICLE_BOOKED", "IN_TRANSIT"].includes(item.status),
                    )!.status
                  }
                />
              </div>
              <div className="dispatch-divider">
                <span />
              </div>
              <div>
                <small>对应团期</small>
                <b>
                  {campaignName(
                    plans.find((item) =>
                      ["VEHICLE_BOOKED", "IN_TRANSIT"].includes(item.status),
                    )!.campaignId,
                  )}
                </b>
                <span>地点与车辆信息已由履约侧登记</span>
              </div>
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无待发车配送"
            />
          )}
        </article>
        <article className="panel">
          <PanelTitle eyebrow="实时概览" title="业务数据" />
          <div className="metric-grid">
            <StatCard
              label="收单中"
              value={String(
                campaigns.filter((item) => item.status === "OPEN").length,
              )}
              note="个团期"
              tone="red"
            />
            <StatCard
              label="已开放区域"
              value={String(areas.filter((item) => item.orderEnabled).length)}
              note="个区县"
              tone="green"
            />
            <StatCard
              label="待履约订单"
              value={String(
                orders.filter((item) =>
                  ["ALLOCATING", "IN_TRANSIT", "READY_FOR_PICKUP"].includes(
                    item.status,
                  ),
                ).length,
              )}
              note="笔订单"
              tone="ink"
            />
            <StatCard
              label="已到货团期"
              value={String(
                plans.filter((item) => item.status === "ARRIVED").length,
              )}
              note="等待领取"
              tone="amber"
            />
          </div>
        </article>
      </section>
    </>
  );
  const settlements = settlementsQ.data ?? [];
  const refunds = refundsQ.data ?? [];
  const financePage = <FinancePage refunds={refunds} settlements={settlements} loading={refundsQ.isLoading} money={money} dateTime={dateTime} StatusTag={StatusTag} />;
  const servicePage = (
    <>
      <header className="section-header">
        <div>
          <h1>客服与售后</h1>
          <p>统一处理用户提交的区域开通意向和订单售后，所有状态变化均写入操作记录。</p>
        </div>
      </header>
      <section className="panel">
        <PanelTitle eyebrow="区域拓展" title="开通意向" />
        <Table<ServiceAreaInterest>
          rowKey="id"
          dataSource={interestsQ.data ?? []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "提交时间", dataIndex: "createdAt", render: (value: string) => dateTime.format(new Date(value)) },
            { title: "所在地区", dataIndex: "regionText" },
            { title: "联系人", dataIndex: "contactName" },
            { title: "联系电话", dataIndex: "contactPhone", render: (value: string) => value.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2") },
            { title: "隐私同意", render: (_, record) => record.privacyVersion && record.privacyConsentedAt ? <div><b>{record.privacyVersion}</b><small className="cell-note">{dateTime.format(new Date(record.privacyConsentedAt))}</small></div> : <span className="muted">历史记录未留痕</span> },
            { title: "状态", dataIndex: "status", render: (value: string) => <StatusTag value={value} /> },
            {
              title: "操作",
              render: (_, record) => record.status === "NEW" ? (
                <Button type="link" loading={busy === `interest-${record.id}`} onClick={() => void act(`interest-${record.id}`, () => api.updateServiceAreaInterestStatus(record.id, "CONTACTED"), "已标记为已联系")}>标记已联系</Button>
              ) : record.status === "CONTACTED" ? (
                <Button type="link" loading={busy === `interest-${record.id}`} onClick={() => void act(`interest-${record.id}`, () => api.updateServiceAreaInterestStatus(record.id, "CLOSED"), "开通意向已关闭")}>关闭意向</Button>
              ) : <span className="muted">已完成</span>,
            },
          ]}
        />
      </section>
      <section className="panel panel--spaced">
        <PanelTitle eyebrow="订单触达" title="待人工通知" />
        <Alert type="info" showIcon message="未开启订单提醒的用户会进入这里。联系完成后请勾销，避免临时领取地点无人知晓。" style={{ marginBottom: 16 }} />
        <Table<OrderNotification>
          rowKey="id"
          dataSource={manualNotificationsQ.data ?? []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "触发时间", dataIndex: "createdAt", render: (value: string) => dateTime.format(new Date(value)) },
            { title: "订单", dataIndex: "orderId", render: (value: string) => <span className="mono">{value}</span> },
            { title: "通知", dataIndex: "title" },
            { title: "内容", dataIndex: "content", ellipsis: true },
            { title: "状态", dataIndex: "status", render: (value: string) => <StatusTag value={value} /> },
            { title: "操作", render: (_, record) => record.status === "PENDING_DELIVERY" ? <Button type="link" loading={busy === `manual-notification-${record.id}`} onClick={() => void act(`manual-notification-${record.id}`, () => api.retryPendingNotification(record.id), "已重试微信通知")}>重试微信通知</Button> : <Button type="link" loading={busy === `manual-notification-${record.id}`} onClick={() => void act(`manual-notification-${record.id}`, () => api.completeManualNotification(record.id), "已记录人工通知")}>标记已通知</Button> },
          ]}
        />
      </section>
      <CommunityCaseQueues pickupWindows={communityPickupWindowsQ.data ?? []} cancellations={communityCancellationRequestsQ.data ?? []} qualityCases={communityQualityCasesQ.data ?? []} exceptions={fulfillmentExceptionsQ.data ?? []} loading={communityPickupWindowsQ.isLoading || communityCancellationRequestsQ.isLoading || communityQualityCasesQ.isLoading || fulfillmentExceptionsQ.isLoading} can={can} act={act} note={resolutionNote} dateTime={dateTime} StatusTag={StatusTag} api={api} />
      <section className="panel panel--spaced">
        <PanelTitle eyebrow="订单保障" title="售后申请" />
        <Table<AfterSale>
          rowKey="id"
          dataSource={afterSalesQ.data ?? []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "提交时间", dataIndex: "createdAt", render: (value: string) => dateTime.format(new Date(value)) },
            { title: "订单", dataIndex: "orderId", render: (value: string) => <span className="mono">{value}</span> },
            { title: "问题类型", dataIndex: "reason" },
            { title: "用户说明", dataIndex: "description", ellipsis: true },
            { title: "状态", dataIndex: "status", render: (value: string) => <StatusTag value={value} /> },
            {
              title: "操作",
              render: (_, record) => record.status === "SUBMITTED" ? (
                can("OPERATOR", "CUSTOMER_SERVICE") ? <Button type="link" loading={busy === `after-sale-${record.id}`} onClick={() => void act(`after-sale-${record.id}`, () => api.updateAfterSaleStatus(record.id, "PROCESSING"), "售后已受理")}>受理</Button> : <span className="muted">待客服受理</span>
              ) : record.status === "PROCESSING" ? (
                <div className="table-actions">
                  {can("FINANCE") && <Button type="link" loading={busy === `after-sale-${record.id}`} onClick={() => { const note=resolutionNote("请输入批准全额原路退款的处理说明"); if(note)void act(`after-sale-${record.id}`, () => api.refundAfterSale(record.id,note), "退款已完成并关联售后单"); }}>批准全额退款</Button>}
                  {can("OPERATOR", "CUSTOMER_SERVICE") && <Button danger type="link" loading={busy === `after-sale-${record.id}`} onClick={() => { const note=resolutionNote("请输入驳回原因"); if(note)void act(`after-sale-${record.id}`, () => api.updateAfterSaleStatus(record.id,"REJECTED",note), "售后已驳回"); }}>驳回</Button>}
                </div>
              ) : <span className="muted">{record.resolutionType === "FULL_REFUND" && record.refundAmountCents !== null ? `已退款 ${money(record.refundAmountCents)}` : record.resolutionNote ?? "已结束"}</span>,
            },
          ]}
        />
      </section>
    </>
  );
  const productManagementPage = (
    <>
      <header className="section-header">
        <div><span className="eyebrow">长期资料</span><h1>商品管理</h1><p>维护平台商品的展示、规格、默认售价与默认可售数量；商品加入并发布团期后才会对消费者可见。</p></div>
        {can('OPERATOR') && <Button type="primary" icon={<PlusOutlined />} onClick={()=>{setSelectedCommunitySku(null);setModal('community-product');}}>新增商品</Button>}
      </header>
      <section className="panel">
        <Table<PlatformSku> rowKey="id" loading={platformSkusQ.isLoading} dataSource={platformSkusQ.data??[]} pagination={{pageSize:10}} scroll={{x:760}} columns={[
          {title:'商品',render:(_,item)=><div><b>{item.product.title}</b><small className="cell-note">{item.product.category} · {item.name}</small></div>},
          {title:'默认零售价',dataIndex:'retailPriceCents',render:(value:number)=>money(value)},
          {title:'默认可售数量',dataIndex:'defaultSellableQuantity'},
          {title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},
          {title:'操作',render:(_,item)=>can('OPERATOR')?<div className="table-actions"><Button type="link" onClick={()=>{setSelectedCommunitySku(item);setModal('community-product');}}>编辑</Button>{item.status==='ACTIVE'&&<Popconfirm title="停用商品？已发布团期不受影响。" onConfirm={()=>void act(`community-sku-off-${item.id}`,()=>api.savePlatformSku({id:item.id,productId:item.productId,title:item.product.title,category:item.product.category,origin:item.product.origin,imageUrl:item.product.imageUrl,skuName:item.name,retailPriceCents:item.retailPriceCents,defaultSellableQuantity:item.defaultSellableQuantity??0,referencePurchaseCostCents:item.referencePurchaseCostCents??null,supplierNote:item.supplierNote??null,status:'INACTIVE'}),'商品已停用')}><Button type="link" danger>停用</Button></Popconfirm>}</div>:<span className="muted">只读</span>},
        ]}/>
      </section>
    </>
  );
  const communityCampaignPage = (
    <>
      <header className="section-header">
        <div><span className="eyebrow">上架与收单</span><h1>团期管理</h1><p>选择已启用商品，设置本团售价、数量、时间、区域和固定自提点；发布后才进入消费者可见范围。</p></div>
        {can('OPERATOR') && <Button type="primary" icon={<PlusOutlined />} onClick={()=>setModal('community-campaign')}>创建团期</Button>}
      </header>
      <section className="panel">
        <Table<Campaign> rowKey="id" loading={communityCampaignsQ.isLoading} dataSource={communityCampaignsQ.data??[]} pagination={{pageSize:10}} scroll={{x:760}} columns={[
          {title:'团期',dataIndex:'title',render:(value:string,item)=><div><b>{value}</b><small className="cell-note">{areaName(item.serviceAreaId)} · {item.items?.length??0} 个商品</small></div>},
          {title:'固定自提点',render:(_,item)=>plans.find((plan)=>plan.campaignId===item.id)?.siteName??'已在团期创建时绑定'},
          {title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},
          {title:'下一步',render:(_,item)=>item.status==='DRAFT'&&can('OPERATOR')?<Button type="link" onClick={()=>void act(`community-open-${item.id}`,()=>api.openCampaign(item.id),'团期已发布开售')}>发布开售</Button>:item.status==='OPEN'?<span className="muted">等待截单</span>:<span className="muted">履约进度请到物流管理查看</span>},
        ]}/>
      </section>
    </>
  );
  const orderManagementPage = (
    <>
      <header className="section-header"><div><span className="eyebrow">销售订单</span><h1>订单管理</h1><p>按团期与自提点查看订单、支付与售后进度；商品配置、发车和退款执行在各自工作页面完成。</p></div></header>
      <section className="panel"><Table<Order> rowKey="id" loading={ordersQ.isLoading} dataSource={orders} pagination={{pageSize:12}} scroll={{x:760}} columns={[
        {title:'订单号',dataIndex:'orderNo'},
        {title:'团期',dataIndex:'campaignId',render:(value:string)=>campaignName(value)},
        {title:'自提点',dataIndex:'pickupPointId',render:(value:string)=>pickupPoints.find((item)=>item.id===value)?.name??value},
        {title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},
        {title:'实付金额',dataIndex:'totalCents',render:(value:number)=>money(value)},
        {title:'支付时间',dataIndex:'paidAt',render:(value:string|null)=>value?dateTime.format(new Date(value)):'—'},
      ]}/></section>
    </>
  );
  const logisticsManagementPage = <CommunityLogisticsPage deliveries={communityDeliveriesQ.data ?? []} plans={plans} batches={batches} loading={communityDeliveriesQ.isLoading} can={can} act={act} dateTime={dateTime} renderStatus={(delivery) => <CommunityDeliveryStatusTag delivery={delivery} />} onEditVehicle={(plan) => { setSelectedPlan(plan); setModal('vehicle'); }} onEmergencyArrival={(delivery) => { setSelectedCommunityDelivery(delivery); setModal('community-arrival'); }} onGoToService={() => setPage('service')} api={api} />;
  const pickupPointManagementPage = (
    <>
      <header className="section-header"><div><span className="eyebrow">场地与现场人员</span><h1>自提点管理</h1><p>维护收货区域、固定自提点和负责人账号范围；负责人只可处理自己绑定点位的到货与领取。</p></div></header>
      <section className="panel"><PanelTitle eyebrow="服务区域" title="已开通区域" action={can('OPERATOR')?<Button onClick={()=>setModal('area')}>开通区域</Button>:undefined}/><Table<ServiceArea> rowKey="id" loading={areasQ.isLoading} dataSource={areas} pagination={{pageSize:6}} columns={[
        {title:'区域',render:(_,item)=><div><b>{item.name}</b><small className="cell-note">{regionPathByCode.get(item.regionCode)??item.name}</small></div>},
        {title:'收单状态',dataIndex:'orderEnabled',render:(value:boolean)=>value?<Tag color="success">收单中</Tag>:<Tag>已暂停</Tag>},
        {title:'操作',render:(_,item)=>can('OPERATOR')?<Button type="link" onClick={()=>void act(`area-${item.id}`,()=>api.updateServiceAreaOrderStatus(item.id,!item.orderEnabled),item.orderEnabled?'已暂停收单':'已恢复收单')}>{item.orderEnabled?'暂停收单':'恢复收单'}</Button>:<span className="muted">只读</span>},
      ]}/></section>
      <section className="panel panel--spaced"><PanelTitle eyebrow="固定场地" title="自提点" action={can('OPERATOR')?<Button type="primary" onClick={()=>setModal('pickup-point')}>新增自提点</Button>:undefined}/><Table<PickupPoint> rowKey="id" loading={pickupPointsQ.isLoading} dataSource={pickupPoints} pagination={{pageSize:8}} columns={[
        {title:'自提点',render:(_,item)=><div><b>{item.name}</b><small className="cell-note">{item.address}</small></div>},
        {title:'服务区域',dataIndex:'serviceAreaId',render:(value:string)=>areaName(value)},
        {title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},
        {title:'日容量',dataIndex:'capacityPerDay',render:(value:number|null)=>value??'未设置'},
      ]}/></section>
      <section className="panel panel--spaced"><PanelTitle eyebrow="负责人账号与权限" title="点位负责人" action={can('SUPER_ADMIN')?<Button type="primary" onClick={()=>setModal('staff-create')}>新增内部员工</Button>:<span className="panel__hint">仅平台负责人可创建、变更或停用员工账号</span>}/>{can('SUPER_ADMIN')?<Table<InternalStaff> rowKey="userId" dataSource={staffMembers.filter((item)=>item.role==='PICKUP_MANAGER')} pagination={{pageSize:8}} columns={[
        {title:'员工',render:(_,item)=><div><b>{item.displayName}</b><small className="cell-note">{item.staffNo} · {item.phone}</small></div>},
        {title:'负责点位',render:(_,item)=>item.pickupPointIds.map((id)=>pickupPoints.find((point)=>point.id===id)?.name??id).join('、')||'未绑定'},
        {title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},
        {title:'操作',render:(_,item)=><Button type="link" onClick={()=>{setSelectedStaff(item);setModal('staff-scope');}}>变更范围/停用</Button>},
      ]}/>:<Alert type="info" showIcon message="负责人账号由平台负责人维护" description="运营可以查看自提点，不会接触员工凭据、手机号或跨点位授权信息。"/>}</section>
    </>
  );
  const pointWorkbenchPage = <PickupPointWorkbenchPage deliveries={communityDeliveriesQ.data ?? []} plans={plans} loading={communityDeliveriesQ.isLoading} renderStatus={(delivery) => <CommunityDeliveryStatusTag delivery={delivery} />} onConfirmArrival={(delivery) => { setSelectedCommunityDelivery(delivery); setModal('community-arrival'); }} onVerify={openVerifier} />;
  const settingsPage = (
    <>
      <header className="section-header"><div><span className="eyebrow">账号、权限与记录</span><h1>系统设置</h1><p>平台负责人维护内部员工、角色与点位范围；所有高风险操作都有审计记录，旧撮合数据只读兼容。</p></div>{can('SUPER_ADMIN')&&<Button type="primary" icon={<PlusOutlined/>} onClick={()=>setModal('staff-create')}>新增内部员工</Button>}</header>
      {can('SUPER_ADMIN')&&<section className="panel"><PanelTitle eyebrow="账号生命周期" title="内部员工目录"/><Table<InternalStaff> rowKey="userId" loading={staffQ.isLoading} dataSource={staffMembers} pagination={{pageSize:10}} scroll={{x:820}} columns={[
        {title:'员工',render:(_,item)=><div><b>{item.displayName}</b><small className="cell-note">{item.staffNo} · {item.phone}</small></div>},
        {title:'角色',dataIndex:'role',render:(value:InternalStaffRole)=>staffRoleOptions.find((item)=>item.value===value)?.label??value},
        {title:'点位范围',render:(_,item)=>item.pickupPointIds.map((id)=>pickupPoints.find((point)=>point.id===id)?.name??id).join('、')||'—'},
        {title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},
        {title:'操作',render:(_,item)=><div className="table-actions"><Button type="link" onClick={()=>{setSelectedStaff(item);setModal('staff-scope');}}>变更/停用</Button><Button type="link" danger onClick={()=>{const reason=resolutionNote('请填写重置一次性凭据的原因');if(reason)void act(`staff-reset-${item.userId}`,async()=>{const result=await api.resetInternalStaffCredential(item.userId,reason);Modal.success({title:'新的一次性初始凭据',content:<Input value={result.initialCredential} readOnly onFocus={(event)=>event.currentTarget.select()}/>});},'已重置凭据并回收会话');}}>重置凭据</Button></div>},
      ]}/></section>}
      {can('SUPER_ADMIN')&&<section className="panel panel--spaced"><PanelTitle eyebrow="操作记录" title="关键审计"/><Table rowKey="id" dataSource={auditQ.data??[]} pagination={{pageSize:8}} columns={[{title:'时间',dataIndex:'createdAt',render:(value:string)=>dateTime.format(new Date(value))},{title:'操作',dataIndex:'action',render:(value:string)=>value==='COMMUNITY_DELIVERY_EMERGENCY_CONFIRMED'?'紧急代办点位到货确认':value},{title:'对象',render:(_,item)=>`${item.resourceType} · ${item.resourceId}`},{title:'紧急代办原因',render:(_,item)=>item.action==='COMMUNITY_DELIVERY_EMERGENCY_CONFIRMED'?((item.afterData as {emergencyReason?:string}|null)?.emergencyReason??'—'):'—'},{title:'操作人',dataIndex:'actorId'}]}/></section>}
      <section className="panel panel--spaced"><PanelTitle eyebrow="历史兼容数据" title="旧撮合与通知记录"/><Alert type="info" showIcon message="历史撮合结算、旧核销授权和通知失败记录仅用于兼容与追溯" description="它们不属于日常运营入口；不会用于新社区团购的商品、团期、物流、点位或退款流程。"/></section>
    </>
  );
  const content = {
    dashboard,
    products: productManagementPage,
    campaigns: communityCampaignPage,
    orders: orderManagementPage,
    logistics: logisticsManagementPage,
    "pickup-points": pickupPointManagementPage,
    service: servicePage,
    finance: financePage,
    settings: settingsPage,
    "point-workbench": pointWorkbenchPage,
  }[page];
  const navIcons: Record<Page, React.ReactNode> = {
    dashboard: <AppstoreOutlined />, products: <AppstoreOutlined />, campaigns: <CarOutlined />, orders: <AuditOutlined />,
    logistics: <CarOutlined />, "pickup-points": <EnvironmentOutlined />, service: <AuditOutlined />, finance: <WalletOutlined />,
    settings: <AuditOutlined />, "point-workbench": <EnvironmentOutlined />,
  };
  const navGroups = getAdminNavigation(roles).map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, icon: navIcons[item.key] })),
  }));
  return (
    <div className="shell">
      {holder}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark">乡</span>
          <div>
            <b>乡味集</b>
            <small>团购运营平台</small>
          </div>
        </div>
        <nav aria-label="主导航">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group__label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  className={`nav-item ${page === item.key ? "nav-item--active" : ""}`}
                  onClick={() => setPage(item.key)}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar__foot">
          <span className="environment-dot" />
          {requiresLogin ? "生产环境" : "演示环境"}
          <small>人工约车信息仅在履约侧展示</small>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={() => {
              void api.logout().finally(() => {
                auth.clear();
                setLoggedIn(false);
              });
            }}
          >
            退出登录
          </Button>
        </div>
      </aside>
      <main>
        {failedPageQueries.length > 0 && (
          <Alert
            className="page-load-error"
            type="error"
            showIcon
            message="部分数据未能加载"
            description="当前显示的零值或空列表可能不完整。请重试后再进行运营判断或操作。"
            action={
              <Button type="primary" size="small" onClick={retryPageQueries}>
                重新加载
              </Button>
            }
          />
        )}
        {content}
      </main>
      <CampaignModal
        open={modal === "campaign"}
        close={() => setModal(null)}
        saved={refresh}
        areas={areas}
        products={products}
      />
      <DeliverySiteModal
        open={modal === "site"}
        close={() => {
          setModal(null);
          setSelectedPlan(null);
        }}
        saved={refresh}
        plan={selectedPlan}
        campaigns={campaigns}
        pickupPoints={pickupPoints}
      />
      <VehicleModal
        open={modal === "vehicle"}
        close={() => {
          setModal(null);
          setSelectedPlan(null);
        }}
        saved={refresh}
        plan={selectedPlan}
      />
      <AreaModal
        open={modal === "area"}
        close={() => setModal(null)}
        saved={refresh}
        directory={directory}
        areas={areas}
      />
      <MerchantModal
        open={modal === "merchant"}
        close={() => setModal(null)}
        saved={refresh}
      />
      <ProductModal
        open={modal === "product"}
        close={() => setModal(null)}
        saved={refresh}
        merchants={merchants}
      />
      <MerchantEditModal
        open={modal === "merchant-edit"}
        close={() => { setModal(null); setSelectedMerchant(null); }}
        saved={refresh}
        merchant={selectedMerchant}
      />
      <ProductEditModal
        open={modal === "product-edit"}
        close={() => { setModal(null); setSelectedProduct(null); }}
        saved={refresh}
        product={selectedProduct}
        merchants={merchants}
      />
      <CampaignEditModal
        open={modal === "campaign-edit"}
        close={() => { setModal(null); setSelectedCampaign(null); }}
        saved={refresh}
        campaign={selectedCampaign}
        areas={areas}
        products={products}
      />
      <PostponeCampaignModal
        open={modal === "campaign-postpone"}
        close={() => { setModal(null); setSelectedCampaign(null); }}
        saved={refresh}
        campaign={selectedCampaign}
      />
      <VerifyPickupModal
        open={modal === "verify"}
        close={() => { setModal(null); setSelectedPlan(null); }}
        saved={refresh}
        plan={selectedPlan}
      />
      <WarehouseExceptionModal
        open={modal === "warehouse-exception"}
        close={() => setModal(null)}
        saved={refresh}
        campaigns={lockedPlatformCampaignsQ.data ?? []}
      />
      <GoodsReceiptModal
        open={modal === "goods-receipt"}
        close={() => setModal(null)}
        saved={refresh}
        purchaseOrders={purchaseOrdersQ.data ?? []}
      />
      <OutboundDispatchModal
        open={modal === "platform-outbound"}
        close={() => { setModal(null); setSelectedOutboundCampaign(null); }}
        saved={refresh}
        campaign={selectedOutboundCampaign}
      />
      <PickupHandoverModal
        open={modal === "pickup-handover"}
        close={() => setModal(null)}
        saved={refresh}
        outboundOrders={(platformOutboundOrdersQ.data ?? []).filter((item) => item.status === 'DISPATCHED')}
      />
      <CommunityProductModal open={modal === 'community-product'} close={()=>{setModal(null);setSelectedCommunitySku(null);}} onSaved={refresh} sku={selectedCommunitySku} showCommercialDetails={can('PROCUREMENT')} />
      <CommunityCampaignModal open={modal === 'community-campaign'} close={()=>setModal(null)} skus={platformSkusQ.data??[]} areas={areas} points={pickupPoints} onSaved={refresh} />
      <CommunityArrivalModal open={modal === 'community-arrival'} close={()=>{setModal(null);setSelectedCommunityDelivery(null);}} saved={refresh} delivery={selectedCommunityDelivery} emergencyProxy={can('SUPER_ADMIN')&&!canUsePickupVerifier} />
      <StaffCreateModal open={modal === 'staff-create'} close={()=>setModal(null)} pickupPoints={pickupPoints} saved={refresh} />
      <StaffScopeModal open={modal === 'staff-scope'} close={()=>{setModal(null);setSelectedStaff(null);}} staff={selectedStaff} pickupPoints={pickupPoints} saved={refresh} />
      <PickupPointCreateModal open={modal === 'pickup-point'} close={()=>setModal(null)} areas={areas} saved={refresh} />
    </div>
  );
}
