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
  Tooltip,
  message,
  type TableColumnsType,
} from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import {
  api,
  auth,
  requiresLogin,
  type Campaign,
  type CommunityDelivery,
  type CampaignStatus,
  type DeliveryPlan,
  type DispatchBatch,
  type Merchant,
  type Order,
  type PickupVerifierAssignment,
  type PickupOrderLookup,
  type PlatformSupplier,
  type PlatformSku,
  type PurchaseOrder,
  type InventoryBalance,
  type FulfillmentException,
  type OutboundOrder,
  type SupplierPayable,
  type Product,
  type RegionDirectoryEntry,
  type ServiceArea,
  type PickupPoint,
  type ServiceAreaInterest,
  type AfterSale,
  type CommunityQualityCase,
  type InternalStaff,
  type InternalStaffRole,
  type OrderNotification,
  type Refund,
  type Settlement,
} from "./api.ts";
import { getAdminNavigation, isPointWorkbenchUser, type AdminPage } from "./navigation.ts";
import { beginPickupRequest, clearPickupRequest, getPendingPickupRequest, isTerminalPickupError, mapPickupRequestItemsToOrder, markPickupRequestConfirmed } from "./pickup-request.ts";

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
const communityQualityReasonLabel: Record<CommunityQualityCase["items"][number]["reason"], string> = {
  PICKUP_SHORTAGE: "提货短少",
  PICKUP_DAMAGE: "提货破损",
  QUALITY_CLAIM: "品质问题",
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

const staffRoleOptions:Array<{value:InternalStaffRole;label:string}>=[
  {value:'SUPER_ADMIN',label:'平台负责人'}, {value:'OPERATOR',label:'运营'}, {value:'CUSTOMER_SERVICE',label:'客服'}, {value:'FINANCE',label:'财务'}, {value:'PICKUP_MANAGER',label:'自提点负责人'},
];

function StaffCreateModal({open,close,pickupPoints,saved}:{open:boolean;close:()=>void;pickupPoints:PickupPoint[];saved:()=>Promise<unknown>}){
  const [form]=Form.useForm<{displayName:string;username:string;phone:string;role:InternalStaffRole;pickupPointIds:string[];status:'PENDING_ACTIVATION'|'SUSPENDED'}>();
  const [saving,setSaving]=useState(false);const role=Form.useWatch('role',form);
  const submit=async(value:{displayName:string;username:string;phone:string;role:InternalStaffRole;pickupPointIds:string[];status:'PENDING_ACTIVATION'|'SUSPENDED'})=>{setSaving(true);try{const result=await api.createInternalStaff(value);Modal.success({title:'员工已创建，请安全转交一次性初始凭据',content:<div><p>{result.staff.displayName}（{result.staff.staffNo}）创建完成。此凭据仅显示一次，员工首次登录必须修改密码。</p><Input value={result.initialCredential} readOnly onFocus={(event)=>event.currentTarget.select()} /></div>,okText:'我已记录并安全转交'});form.resetFields();await saved();close();}catch(error){message.error(error instanceof Error?error.message:'创建员工失败');}finally{setSaving(false);}};
  return <Modal open={open} onCancel={close} footer={null} destroyOnHidden title="新增内部员工"><Alert type="info" showIcon message="员工账号与消费者账号隔离" description="创建后生成一次性初始凭据，明文不会在目录或后续页面再次显示。" style={{marginBottom:16}}/><Form form={form} layout="vertical" initialValues={{role:'PICKUP_MANAGER',pickupPointIds:[],status:'PENDING_ACTIVATION'}} onFinish={(value)=>void submit(value)}><div className="form-grid"><Form.Item label="员工姓名" name="displayName" rules={[{required:true,min:2}]}><Input /></Form.Item><Form.Item label="登录账号" name="username" rules={[{required:true,min:3,pattern:/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/}]}><Input autoComplete="off" /></Form.Item></div><Form.Item label="联系手机号" name="phone" rules={[{required:true,pattern:/^1[3-9]\d{9}$/}]}><Input inputMode="numeric" /></Form.Item><div className="form-grid"><Form.Item label="角色" name="role" rules={[{required:true}]}><Select options={staffRoleOptions}/></Form.Item><Form.Item label="创建状态" name="status" rules={[{required:true}]}><Select options={[{value:'PENDING_ACTIVATION',label:'待激活'},{value:'SUSPENDED',label:'已停用'}]}/></Form.Item></div>{role==='PICKUP_MANAGER'&&<Form.Item label="负责自提点" name="pickupPointIds" rules={[{required:true,message:'自提点负责人至少绑定一个启用点位'}]}><Select mode="multiple" options={pickupPoints.filter((point)=>point.status==='ACTIVE').map((point)=>({value:point.id,label:`${point.name} · ${point.address}`}))}/></Form.Item>}<Button type="primary" htmlType="submit" loading={saving}>创建并生成初始凭据</Button></Form></Modal>;
}

function StaffScopeModal({open,close,staff,pickupPoints,saved}:{open:boolean;close:()=>void;staff:InternalStaff|null;pickupPoints:PickupPoint[];saved:()=>Promise<unknown>}){
  const [form]=Form.useForm<{role:InternalStaffRole;status:'PENDING_ACTIVATION'|'ACTIVE'|'SUSPENDED';pickupPointIds:string[];reason?:string}>(); const [saving,setSaving]=useState(false);const role=Form.useWatch('role',form);const status=Form.useWatch('status',form);
  const submit=async(value:{role:InternalStaffRole;status:'PENDING_ACTIVATION'|'ACTIVE'|'SUSPENDED';pickupPointIds:string[];reason?:string})=>{if(!staff)return;setSaving(true);try{const reason=value.reason?.trim();await api.updateInternalStaff(staff.userId,{role:value.role,status:value.status,pickupPointIds:value.pickupPointIds,...(reason?{reason}:{})});await saved();message.success('员工角色与点位范围已更新，原会话已回收');close();}catch(error){message.error(error instanceof Error?error.message:'更新员工失败');}finally{setSaving(false);}};
  return <Modal open={open} onCancel={close} footer={null} destroyOnHidden title="调整员工角色与点位"><Form key={staff?.userId??'none'} form={form} layout="vertical" initialValues={staff?{role:staff.role,status:staff.status,pickupPointIds:staff.pickupPointIds}:{}} onFinish={(value)=>void submit(value)}><Alert type="warning" showIcon message="变更会立即回收该员工已登录会话" description="自提点负责人必须保留至少一个启用点位；停用时必须记录原因。" style={{marginBottom:16}}/><Form.Item label="员工" ><Input value={staff?`${staff.displayName} · ${staff.staffNo}`:''} disabled /></Form.Item><div className="form-grid"><Form.Item label="角色" name="role" rules={[{required:true}]}><Select options={staffRoleOptions}/></Form.Item><Form.Item label="状态" name="status" rules={[{required:true}]}><Select options={[{value:'PENDING_ACTIVATION',label:'待激活'},{value:'ACTIVE',label:'启用'},{value:'SUSPENDED',label:'已停用'}]}/></Form.Item></div>{role==='PICKUP_MANAGER'&&<Form.Item label="负责自提点" name="pickupPointIds" rules={[{required:true,message:'至少选择一个启用自提点'}]}><Select mode="multiple" options={pickupPoints.filter((point)=>point.status==='ACTIVE').map((point)=>({value:point.id,label:point.name}))}/></Form.Item>}{status==='SUSPENDED'&&<Form.Item label="停用原因" name="reason" rules={[{required:true,min:2}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item>}<Button type="primary" htmlType="submit" loading={saving}>保存并回收会话</Button></Form></Modal>;
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
  // The historical verifier assignment screen is retained only for compatibility.
  // It is deliberately not fetched or exposed through the normal staff workflow.
  const verifierAssignmentsQ = { isLoading: false };
  const activeVerifierAssignments: PickupVerifierAssignment[] = [];
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
    enabled: enabled && can("OPERATOR", "CUSTOMER_SERVICE"),
  });
  const afterSalesQ = useQuery({
    queryKey: ["after-sales"],
    queryFn: api.listAfterSales,
    enabled: enabled && can("OPERATOR", "CUSTOMER_SERVICE", "FINANCE"),
  });
  const communityQualityCasesQ = useQuery({
    queryKey: ["community-quality-cases"],
    queryFn: api.listCommunityQualityCases,
    enabled: enabled && can("OPERATOR", "CUSTOMER_SERVICE"),
  });
  const platformSuppliersQ=useQuery({queryKey:['platform-suppliers'],queryFn:api.listPlatformSuppliers,enabled:enabled&&can('PROCUREMENT','FINANCE')});
  const platformSkusQ=useQuery({queryKey:['platform-skus'],queryFn:api.listPlatformSkus,enabled:enabled&&can('PROCUREMENT','OPERATOR')});
  const communityCampaignsQ=useQuery({queryKey:['community-campaigns'],queryFn:api.listCommunityCampaigns,enabled:enabled&&can('OPERATOR','FULFILLMENT')});
  const communityDeliveriesQ=useQuery({queryKey:['community-deliveries'],queryFn:api.listCommunityDeliveries,enabled:enabled&&(can('OPERATOR','FULFILLMENT')||canUsePickupVerifier)});
  const purchaseOrdersQ=useQuery({queryKey:['purchase-orders'],queryFn:api.listPurchaseOrders,enabled:enabled&&can('PROCUREMENT','WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FINANCE','OPERATOR')});
  const platformInventoryQ=useQuery({queryKey:['platform-inventory'],queryFn:api.listPlatformInventory,enabled:enabled&&can('WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','PROCUREMENT','FINANCE')});
  const supplierPayablesQ=useQuery({queryKey:['supplier-payables'],queryFn:api.listSupplierPayables,enabled:enabled&&can('FINANCE','PROCUREMENT')});
  const platformSortingTasksQ=useQuery({queryKey:['platform-sorting-tasks'],queryFn:api.listPlatformSortingTasks,enabled:enabled&&can('WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT','OPERATOR')});
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
  const platformSortingTasks = platformSortingTasksQ.data ?? [];
  const platformOutboundOrders = platformOutboundOrdersQ.data ?? [];
  const sortingTaskByCampaign = useMemo(() => new Map(platformSortingTasks.map((item) => [item.campaignId, item])), [platformSortingTasks]);
  const outboundByCampaign = useMemo(() => new Map(platformOutboundOrders.map((item) => [item.campaignId, item])), [platformOutboundOrders]);
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
    service: [afterSalesQ, communityQualityCasesQ, fulfillmentExceptionsQ, manualNotificationsQ],
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
  const openSite = (plan: DeliveryPlan) => {
    setSelectedPlan(plan);
    setModal("site");
  };
  const openVehicle = (plan: DeliveryPlan) => {
    setSelectedPlan(plan);
    setModal("vehicle");
  };
  const openCampaignEditor = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setModal("campaign-edit");
  };
  const openProductEditor = (product: Product) => {
    setSelectedProduct(product);
    setModal("product-edit");
  };
  const openMerchantEditor = (merchant: Merchant) => {
    setSelectedMerchant(merchant);
    setModal("merchant-edit");
  };
  const openVerifier = (plan: DeliveryPlan) => {
    setSelectedPlan(plan);
    setModal("verify");
  };
  const renderPlanActions = (record: DeliveryPlan) => {
    if (canUsePickupVerifier) {
      return record.status === "ARRIVED" ? <Button type="link" onClick={() => openVerifier(record)}>现场核销</Button> : <span className="muted">等待到货确认</span>;
    }
    if (record.status === "PENDING_SITE") {
      return <Button type="link" onClick={() => openSite(record)}>确认地点</Button>;
    }
    if (record.status === "SITE_CONFIRMED") {
      return <div className="table-actions"><Button type="link" onClick={() => openSite(record)}>修改地点</Button><Button type="link" onClick={() => openVehicle(record)}>登记约车</Button></div>;
    }
    if (record.status === "VEHICLE_BOOKED") {
      return <div className="table-actions"><Button type="link" onClick={() => openSite(record)}>变更地点</Button><Button type="link" onClick={() => void act(`batch-${record.id}`, () => api.createBatch(record.campaignId), "发车批次已创建")}>创建发车批次</Button></div>;
    }
    if (record.status === "IN_TRANSIT") return <span className="muted">等待到货确认</span>;
    if (record.status === "ARRIVED") return <Button type="link" onClick={() => openVerifier(record)}>现场核销</Button>;
    return <span className="muted">—</span>;
  };
  const fulfillmentColumns = useMemo<TableColumnsType<DeliveryPlan>>(() => {
    const columns: TableColumnsType<DeliveryPlan> = [
      {
        title: "团期 / 区域",
        render: (_: unknown, record: DeliveryPlan) => <div><b>{campaignName(record.campaignId)}</b><small className="cell-note">{areaName(record.serviceAreaId)}</small></div>,
      },
      {
        title: "集中领取地点",
        responsive: ["md"],
        render: (_: unknown, record: DeliveryPlan) => record.siteName ? <div><b>{record.siteName}</b><small className="cell-note">{record.address}</small></div> : <span className="muted">待确认</span>,
      },
      { title: "状态", dataIndex: "status", render: (value: string) => <StatusTag value={value} /> },
      { title: "操作", width: 260, render: (_: unknown, record: DeliveryPlan) => <div className="table-actions">{renderPlanActions(record)}</div> },
    ];
    if (!canUsePickupVerifier) {
      columns.splice(2, 0, {
        title: "预约车辆",
        responsive: ["lg"],
        render: (_: unknown, record: DeliveryPlan) => record.vehicleOrderNo ? <div><b>{record.vehicleOrderNo}</b><small className="cell-note">{record.vehiclePlate ?? "车牌待补"}{record.driverName ? ` · ${record.driverName}` : ""}</small></div> : <span className="muted">待预约</span>,
      });
    }
    return columns;
  }, [canUsePickupVerifier, campaigns, areas, plans, busy]);
  if (!loggedIn)
    return (
      <Login
        onSuccess={() => {
          setLoggedIn(true);
          void refresh();
        }}
      />
    );
  const openPostpone = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setModal("campaign-postpone");
  };
  const renderCampaignActions = (record: Campaign) => {
    if (!can("OPERATOR")) return <span className="muted">—</span>;
    return (
      <div className="table-actions">
        {record.status === "DRAFT" && (
          <>
            <Button type="link" onClick={() => openCampaignEditor(record)}>
              编辑
            </Button>
            <Button
              type="link"
              loading={busy === `open-${record.id}`}
              onClick={() =>
                void act(
                  `open-${record.id}`,
                  () => api.openCampaign(record.id),
                  "团期已开售",
                )
              }
            >
              开售
            </Button>
            <Popconfirm
              title="取消此草稿团期？"
              onConfirm={() =>
                void act(
                  `cancel-${record.id}`,
                  () => api.cancelCampaign(record.id),
                  "团期已取消",
                )
              }
            >
              <Button type="link" danger>
                取消
              </Button>
            </Popconfirm>
          </>
        )}
        {record.status === "OPEN" && (
          <>
            <Popconfirm
              title="确认立即结团？"
              description="未成团订单将按规则退款。"
              onConfirm={() =>
                void act(
                  `close-${record.id}`,
                  () => api.closeCampaign(record.id),
                  "结团处理完成",
                )
              }
            >
              <Button type="link">结团</Button>
            </Popconfirm>
            <Popconfirm
              title="取消收单中的团期？"
              description="已付款订单会进入退款流程。"
              onConfirm={() =>
                void act(
                  `cancel-${record.id}`,
                  () => api.cancelCampaign(record.id),
                  "团期已取消，退款流程已发起",
                )
              }
            >
              <Button type="link" danger>
                取消
              </Button>
            </Popconfirm>
          </>
        )}
        {record.status === "POSTPONED" && (
          <>
            <Button type="link" onClick={() => openPostpone(record)}>
              设置新时间
            </Button>
            <Popconfirm
              title="取消已顺延团期？"
              onConfirm={() =>
                void act(
                  `cancel-${record.id}`,
                  () => api.cancelCampaign(record.id),
                  "团期已取消",
                )
              }
            >
              <Button type="link" danger>
                取消
              </Button>
            </Popconfirm>
          </>
        )}
        {!['DRAFT', 'OPEN', 'POSTPONED'].includes(record.status) && (
          <span className="muted">状态自动流转</span>
        )}
      </div>
    );
  };
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
  const campaignPage = (
    <>
      <header className="section-header">
        <div>
          <span className="eyebrow">统一收单 · 区域开团</span>
          <h1>团期</h1>
          <p>草稿可编辑；开售后商品、价格和库存已锁定为本团快照。</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModal("campaign")}
        >
          新建团期
        </Button>
      </header>
      <section className="panel">
        <Table<Campaign>
          rowKey="id"
          loading={campaignsQ.isLoading}
          dataSource={campaigns}
          className="campaign-table"
          tableLayout="fixed"
          columns={[
            {
              title: "团期",
              dataIndex: "title",
              width: 260,
              render: (value: string, record) => (
                <div>
                  <b>{value}</b>
                  <small className="cell-note">
                    {areaName(record.serviceAreaId)} · {record.skuIds.length}{" "}
                    件商品
                  </small>
                </div>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 88,
              render: (value: CampaignStatus) => <StatusTag value={value} />,
            },
            {
              title: "截单",
              dataIndex: "cutoffAt",
              width: 104,
              render: (value: string) => dateTime.format(new Date(value)),
            },
            {
              title: "计划发车",
              dataIndex: "dispatchAt",
              width: 104,
              render: (value: string) => dateTime.format(new Date(value)),
            },
            {
              title: "配送安排",
              width: 112,
              render: (_, record) => (
                <StatusTag
                  value={
                    planByCampaign.get(record.id)?.status ?? "PENDING_SITE"
                  }
                />
              ),
            },
            {
              title: "操作",
              width: 150,
              render: (_, record) => can("OPERATOR") ? (
                <div className="table-actions">
                  {record.status === "DRAFT" && (
                    <>
                      <Button
                        type="link"
                        onClick={() => openCampaignEditor(record)}
                      >
                        编辑
                      </Button>
                      <Button
                        type="link"
                        loading={busy === `open-${record.id}`}
                        onClick={() =>
                          void act(
                            `open-${record.id}`,
                            () => api.openCampaign(record.id),
                            "团期已开售",
                          )
                        }
                      >
                        开售
                      </Button>
                      <Popconfirm
                        title="取消此草稿团期？"
                        onConfirm={() =>
                          void act(
                            `cancel-${record.id}`,
                            () => api.cancelCampaign(record.id),
                            "团期已取消",
                          )
                        }
                      >
                        <Button type="link" danger>
                          取消
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                  {record.status === "OPEN" && (
                    <>
                      <Popconfirm
                        title="确认立即结团？"
                        description="未成团订单将按规则退款。"
                        onConfirm={() =>
                          void act(
                            `close-${record.id}`,
                            () => api.closeCampaign(record.id),
                            "结团处理完成",
                          )
                        }
                      >
                        <Button type="link">结团</Button>
                      </Popconfirm>
                      <Popconfirm
                        title="取消收单中的团期？"
                        description="已付款订单会进入退款流程。"
                        onConfirm={() =>
                          void act(
                            `cancel-${record.id}`,
                            () => api.cancelCampaign(record.id),
                            "团期已取消，退款流程已发起",
                          )
                        }
                      >
                        <Button type="link" danger>
                          取消
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                  {record.status === "POSTPONED" && (
                    <>
                      <Button type="link" onClick={() => openPostpone(record)}>
                        设置新时间
                      </Button>
                      <Popconfirm
                        title="取消已顺延团期？"
                        onConfirm={() =>
                          void act(
                            `cancel-${record.id}`,
                            () => api.cancelCampaign(record.id),
                            "团期已取消",
                          )
                        }
                      >
                        <Button type="link" danger>
                          取消
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                  {!["DRAFT", "OPEN", "POSTPONED"].includes(record.status) && (
                    <span className="muted">状态自动流转</span>
                  )}
                </div>
              ) : <span className="muted">—</span>,
            },
          ]}
        />
        <div className="campaign-card-list">
          {campaigns.map((campaign) => (
            <article className="campaign-card" key={campaign.id}>
              <div className="campaign-card__head">
                <div>
                  <b>{campaign.title}</b>
                  <small>
                    {areaName(campaign.serviceAreaId)} · {campaign.skuIds.length} 件商品
                  </small>
                </div>
                <StatusTag value={campaign.status} />
              </div>
              <dl className="campaign-card__schedule">
                <div>
                  <dt>截单</dt>
                  <dd>{dateTime.format(new Date(campaign.cutoffAt))}</dd>
                </div>
                <div>
                  <dt>计划发车</dt>
                  <dd>{dateTime.format(new Date(campaign.dispatchAt))}</dd>
                </div>
                <div>
                  <dt>配送安排</dt>
                  <dd>
                    <StatusTag
                      value={planByCampaign.get(campaign.id)?.status ?? "PENDING_SITE"}
                    />
                  </dd>
                </div>
              </dl>
              <div className="campaign-card__actions">
                {renderCampaignActions(campaign)}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
  const commercePage = (
    <>
      <header className="section-header">
        <div>
          <h1>供货与商品</h1>
          <p>
            资料可编辑；有团期或订单历史的数据按下架、停用和归档处理，不直接抹除。
          </p>
        </div>
        {can("OPERATOR") && <div className="header-actions">
          <Button onClick={() => setModal("merchant")}>新增供货商</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModal("product")}
          >
            新增商品
          </Button>
        </div>}
      </header>
      <section className="panel">
        <PanelTitle eyebrow="商品库" title="商品管理" />
        <Table<Product>
          rowKey="id"
          dataSource={products}
          scroll={{ x: 1060 }}
          columns={[
            {
              title: "商品",
              render: (_, record) => (
                <div>
                  <b>{record.title}</b>
                  <small className="cell-note">
                    {record.category} · {record.origin}
                  </small>
                </div>
              ),
            },
            { title: "规格", dataIndex: ["sku", "name"] },
            {
              title: "售价",
              dataIndex: ["sku", "unitPriceCents"],
              render: (value: number) => money(value),
            },
            {
              title: "可售库存",
              render: (_, record) => record.sku.stock - record.sku.soldQuantity,
            },
            {
              title: "状态",
              dataIndex: "status",
              render: (value: string) => <StatusTag value={value} />,
            },
            {
              title: "操作",
              width: 285,
              render: (_, record) => (
                <div className="table-actions">
                  {record.status !== "PENDING_REVIEW" && can("OPERATOR") && (
                    <Button
                      type="link"
                      onClick={() => openProductEditor(record)}
                    >
                      编辑
                    </Button>
                  )}
                  {can("OPERATOR") && ["DRAFT", "REJECTED"].includes(record.status) && (
                    <>
                      <Button
                        type="link"
                        onClick={() =>
                          void act(
                            `submit-${record.id}`,
                            () => api.submitProduct(record.id),
                            "已提交商品审核",
                          )
                        }
                      >
                        提交审核
                      </Button>
                      <Popconfirm
                        title="删除商品草稿？"
                        description="有团期或订单记录的商品不会允许删除。"
                        onConfirm={() =>
                          void act(
                            `delete-${record.id}`,
                            () => api.deleteProduct(record.id),
                            "商品草稿已删除",
                          )
                        }
                      >
                        <Button type="link" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                  {record.status === "PENDING_REVIEW" && can("REVIEWER") && (
                    <div className="table-actions">
                      <Button
                        type="link"
                        onClick={() =>
                          void act(
                            `review-${record.id}`,
                            () => api.reviewProduct(record.id, "APPROVE"),
                            "审核通过，商品已上架",
                          )
                        }
                      >
                        审核通过
                      </Button>
                      <Button
                        danger
                        type="link"
                        onClick={() => {
                          let reason = "";
                          Modal.confirm({
                            title: "驳回商品审核",
                            content: <Input.TextArea autoFocus placeholder="请填写驳回原因，商品方据此修改" onChange={(event) => { reason = event.target.value; }} />,
                            okText: "确认驳回",
                            okButtonProps: { danger: true },
                            onOk: () => {
                              if (!reason.trim()) return Promise.reject(new Error("请填写驳回原因"));
                              return act(`reject-${record.id}`, () => api.reviewProduct(record.id, "REJECT", reason.trim()), "商品已驳回并退回草稿");
                            },
                          });
                        }}
                      >
                        驳回
                      </Button>
                    </div>
                  )}
                  {record.status === "APPROVED" && can("OPERATOR") && (
                    <Popconfirm
                      title="下架此商品？"
                      description="收单中的团期引用该商品时会被系统保护。"
                      onConfirm={() =>
                        void act(
                          `off-${record.id}`,
                          () => api.offShelfProduct(record.id),
                          "商品已下架",
                        )
                      }
                    >
                      <Button type="link" danger>
                        下架
                      </Button>
                    </Popconfirm>
                  )}
                  {record.status === "OFF_SHELF" && can("OPERATOR") && (
                    <Button
                      type="link"
                      onClick={() =>
                        void act(
                          `restore-${record.id}`,
                          () => api.restoreProduct(record.id),
                          "商品已恢复为草稿，请重新审核",
                        )
                      }
                    >
                      恢复草稿
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </section>
      <section className="panel panel--spaced">
        <PanelTitle eyebrow="采购来源" title="供货商管理" />
        <Table<Merchant>
          rowKey="id"
          dataSource={merchants}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 760 }}
          columns={[
            { title: "名称", dataIndex: "name" },
            {
              title: "状态",
              dataIndex: "status",
              render: (value: string) => <StatusTag value={value} />,
            },
            {
              title: "服务费",
              dataIndex: "defaultCommissionBps",
              render: (value: number) => `${(value / 100).toFixed(2)}%`,
            },
            {
              title: "操作",
              width: 250,
              render: (_, record) => can("OPERATOR") ? (
                <div className="table-actions">
                  <Button
                    type="link"
                    onClick={() => openMerchantEditor(record)}
                  >
                    编辑
                  </Button>
                  {record.status === "ACTIVE" ? (
                    <Popconfirm
                      title="停用供货商？"
                      description="正在草稿或收单的团期会被保护。"
                      onConfirm={() =>
                        void act(
                          `merchant-${record.id}`,
                          () =>
                            api.updateMerchantStatus(record.id, "SUSPENDED"),
                          "供货商已停用",
                        )
                      }
                    >
                      <Button type="link" danger>
                        停用
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button
                      type="link"
                      onClick={() =>
                        void act(
                          `merchant-${record.id}`,
                          () => api.updateMerchantStatus(record.id, "ACTIVE"),
                          "供货商已启用",
                        )
                      }
                    >
                      启用
                    </Button>
                  )}
                  <Popconfirm
                    title="删除供货商？"
                    description="存在商品记录时系统不会允许删除。"
                    onConfirm={() =>
                      void act(
                        `merchant-delete-${record.id}`,
                        () => api.deleteMerchant(record.id),
                        "供货商已删除",
                      )
                    }
                  >
                    <Button type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              ) : <span className="muted">—</span>,
            },
          ]}
        />
      </section>
    </>
  );
  const platformPage = (
    <>
      <header className="section-header"><div><span className="eyebrow">平台自营 · 模式 B</span><h1>采购与中心仓</h1><p>平台零售价、供应商采购价、合格批次库存和供应商应付分开管理；历史撮合订单仍在旧兼容区，只读结算。</p></div></header>
      <Alert type="info" showIcon message="按下一步处理" description="先维护供应商、平台商品与采购价，再开团；锁单生成采购单，验收生成批次和应付，分拣/出库/点位交接完成后才开放取货码。" />
      <section className="dashboard-grid" style={{marginTop:16}}>
        <article className="panel"><PanelTitle eyebrow="采购准备" title="供应商与平台商品" /><Table<PlatformSupplier> size="small" rowKey="id" pagination={false} dataSource={platformSuppliersQ.data??[]} columns={[{title:'供应商',dataIndex:'name'},{title:'状态',dataIndex:'status',render:(v:string)=><StatusTag value={v}/>}]} /><Table<PlatformSku> size="small" rowKey="id" pagination={false} dataSource={platformSkusQ.data??[]} columns={[{title:'平台商品',render:(_,v)=><span>{v.product.title} · {v.name}</span>},{title:'零售价',dataIndex:'retailPriceCents',render:(v:number)=>money(v)},{title:'状态',dataIndex:'status',render:(v:string)=><StatusTag value={v}/>}]} /></article>
        <article className="panel"><PanelTitle eyebrow="中心仓" title="批次库存与待付货款" /><Table<InventoryBalance> size="small" rowKey="inventoryLotId" pagination={false} dataSource={platformInventoryQ.data??[]} columns={[{title:'批次',dataIndex:'lotNo'},{title:'合格在库',dataIndex:'qualified'},{title:'已分拣',dataIndex:'sorted'},{title:'已出库',dataIndex:'outbound'},{title:'隔离/报损',dataIndex:'quarantine'}]} /><Table<SupplierPayable> size="small" rowKey="id" pagination={false} dataSource={supplierPayablesQ.data??[]} columns={[{title:'应付金额',dataIndex:'amountCents',render:(v:number)=>money(v)},{title:'合格件数',dataIndex:'qualifiedQuantity'},{title:'状态',dataIndex:'status',render:(v:string)=><StatusTag value={v}/>}]} /></article>
      </section>
      <section className="panel" style={{marginTop:16}}><PanelTitle eyebrow="锁单后" title="采购单与验收队列" action={can('WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR')?<Button type="primary" onClick={()=>setModal('goods-receipt')}>登记收货验收</Button>:undefined} /><Table<PurchaseOrder> rowKey="id" pagination={false} dataSource={purchaseOrdersQ.data??[]} columns={[{title:'采购单',dataIndex:'purchaseNo'},{title:'状态',dataIndex:'status',render:(v:string)=><StatusTag value={v}/>},{title:'计划品项',render:(_unused,v)=>v.items.length},{title:'本次待验收',render:(_unused,v)=>v.items.reduce((sum,item)=>sum+(item.remainingQuantity??item.plannedQuantity),0)},...(can('PROCUREMENT','FINANCE')?[{title:'采购金额估算',render:(_unused:unknown,v:PurchaseOrder)=>money(v.items.reduce((sum,item)=>sum+item.plannedQuantity*(item.purchaseUnitCents??0),0))}]:[]),{title:'说明',render:()=> <span className="cell-note">短收后可继续登记补货验收；每次合格批次独立入库并形成应付。</span>}]} /></section>
      <section className="panel" style={{marginTop:16}}><PanelTitle eyebrow="仓内事实登记" title="仓库差异" action={can('WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR')?<Button onClick={()=>setModal('warehouse-exception')}>登记仓库差异</Button>:undefined} /><Alert type="warning" showIcon message="数量由已付款销售需求自动计算" description="不输入“应有数量”。登记短少/破损会创建待处置异常；破损进入隔离，不能恢复为可售库存。" /></section>
      <section className="panel" style={{marginTop:16}}><PanelTitle eyebrow="中心仓作业" title="分拣与出库配送" /><Alert type="info" showIcon message="按固定顺序完成" description="合格验收后先创建并完成分拣，再创建出库配送；出库后由点位登记逐 SKU 实到和差异。" style={{marginBottom:12}} /><Table<Campaign> rowKey="id" pagination={false} dataSource={lockedPlatformCampaignsQ.data??[]} columns={[{title:'锁单团期',dataIndex:'title'},{title:'分拣状态',render:(_unused,record)=>{const task=sortingTaskByCampaign.get(record.id);return task?<StatusTag value={task.status}/>:<span className="muted">待创建</span>;}},{title:'下一步',render:(_unused,record)=>{const task=sortingTaskByCampaign.get(record.id);const outbound=outboundByCampaign.get(record.id);if(outbound)return <span className="muted">已出库：{outbound.outboundNo}</span>;if(!task)return can('WAREHOUSE_OPERATOR')?<Button type="link" loading={busy===`sorting-create-${record.id}`} onClick={()=>void act(`sorting-create-${record.id}`,()=>api.createPlatformSorting(record.id),'分拣任务已创建')}>创建分拣任务</Button>:<span className="muted">等待仓库创建分拣</span>;if(task.status==='PENDING')return can('WAREHOUSE_OPERATOR')?<Button type="link" loading={busy===`sorting-complete-${record.id}`} onClick={()=>void act(`sorting-complete-${record.id}`,()=>api.completePlatformSorting(record.id),'分拣已完成，可创建出库配送')}>完成分拣</Button>:<span className="muted">等待仓库完成分拣</span>;if(task.status==='COMPLETED')return can('WAREHOUSE_OPERATOR','FULFILLMENT')?<Button type="link" onClick={()=>{setSelectedOutboundCampaign(record);setModal('platform-outbound');}}>创建出库配送</Button>:<span className="muted">等待出库配送</span>;return <span className="muted">分拣任务已取消</span>;}}]} /></section>
      <section className="panel" style={{marginTop:16}}><PanelTitle eyebrow="点位到货" title="交接登记" action={can('FULFILLMENT')?<Button onClick={()=>setModal('pickup-handover')}>登记交接事实</Button>:undefined} /><Table<OutboundOrder> size="small" rowKey="id" pagination={{pageSize:5}} dataSource={(platformOutboundOrdersQ.data??[]).filter((item)=>item.status==='DISPATCHED'||item.status==='EXCEPTION')} columns={[{title:'出库单',dataIndex:'outboundNo'},{title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},{title:'商品件数',render:(_,value)=>value.items.reduce((sum,item)=>sum+item.quantity,0)},{title:'提示',render:(_,value)=>value.status==='EXCEPTION'?'请进入异常队列登记调拨复验或退款处置':'可登记每个商品的实到与差异'}]} /></section>
      <section className="panel" style={{marginTop:16}}><PanelTitle eyebrow="异常待处理" title="差异交接与部分退款" action={<span className="panel__hint">现场只能登记事实；运营确认处置，财务才可执行退款。</span>} /><Table<FulfillmentException> rowKey="id" pagination={{pageSize:8}} dataSource={fulfillmentExceptionsQ.data??[]} columns={[{title:'来源',dataIndex:'sourceStage'},{title:'异常数量',render:(_,v)=>v.items.reduce((sum,item)=>sum+item.rejectedQuantity+item.shortQuantity+item.damagedQuantity,0)},{title:'退款金额依据',render:(_,v)=><div className="cell-note">{v.refundBreakdown.map((line)=><div key={line.salesOrderItemId}>订单 {line.orderNo} · {line.productName} / {line.skuName}（SKU {line.platformSkuId}）：异常 {line.exceptionQuantity} 件，已退 {line.refundedQuantity} 件，本退 {line.refundableQuantity} 件 × {money(line.unitPriceCents)} = {money(line.refundableAmountCents)}</div>)}<b>待退 {money(v.refundableAmountCents)} · 已退 {money(v.refundedAmountCents)}</b></div>},{title:'原因',render:(_,v)=>v.items.map((item)=>item.reason).join('、')},{title:'责任',dataIndex:'responsibility'},{title:'状态',dataIndex:'status',render:(v:string)=><StatusTag value={v}/>},{title:'下一步',render:(_,v)=> <>{can('OPERATOR')&&['REGISTERED','WAITING_REPLENISHMENT'].includes(v.status)&&v.items.some((item)=>item.reason==='WRONG_POINT')&&<Button type="link" onClick={()=>{const note=resolutionNote('请填写调拨至正确点位、重新验收的运营安排');if(note)void act(`exception-transfer-plan-${v.id}`,()=>api.decideFulfillmentException(v.id,{status:'TRANSFER_PENDING',responsibility:v.responsibility,resolutionNote:note}),'已安排调拨复验')}}>安排调拨</Button>}{can('OPERATOR')&&['REGISTERED','WAITING_REPLENISHMENT','TRANSFER_PENDING'].includes(v.status)&&!v.items.some((item)=>item.reason==='WRONG_POINT')&&<Button type="link" onClick={()=>{const note=resolutionNote('请填写无法补货/补送后的退款处置说明');if(note)void act(`exception-refund-${v.id}`,()=>api.decideFulfillmentException(v.id,{status:'REFUND_CONFIRMED',responsibility:v.responsibility,resolutionNote:note}),'已确认部分退款')}}>确认退款</Button>}{can('WAREHOUSE_RECEIVER','QUALITY_INSPECTOR','WAREHOUSE_OPERATOR','FULFILLMENT')&&v.status==='TRANSFER_PENDING'&&v.items.some((item)=>item.reason==='WRONG_POINT')&&<Button type="link" onClick={()=>{const note=resolutionNote('请填写调拨到正确点位后的复验说明');const wrongItems=v.items.filter((item)=>item.reason==='WRONG_POINT');if(note)void act(`exception-transfer-${v.id}`,()=>api.reinspectWrongPointTransfer(v.id,{evidenceNote:note,items:wrongItems.map((item)=>({platformSkuId:item.platformSkuId,acceptedQuantity:item.rejectedQuantity+item.shortQuantity+item.damagedQuantity}))}),'调拨复验完成，已恢复对应领取权益')}}>完成调拨复验</Button>}{can('FINANCE')&&v.status==='REFUND_CONFIRMED'&&<Popconfirm title="按以下订单快照价执行已确认异常的部分退款？" description={<div>{v.refundBreakdown.map((line)=><div key={line.salesOrderItemId}><b>订单 {line.orderNo}</b><br/>{line.productName} / {line.skuName}（SKU {line.platformSkuId}）<br/>异常 {line.exceptionQuantity} 件 · 已退 {line.refundedQuantity} 件 · 本退 {line.refundableQuantity} 件 × {money(line.unitPriceCents)} = <b>{money(line.refundableAmountCents)}</b><br/>订单实付 {money(line.orderTotalCents)} · 累计已退 {money(line.orderRefundedAmountCents)} · 退款处理中 {money(line.orderRefundInFlightAmountCents)} · 可退余额 {money(line.orderRefundableBalanceCents)}</div>)}<div>本次合计：<b>{money(v.refundableAmountCents)}</b></div></div>} onConfirm={()=>{const note=resolutionNote('请填写财务二次确认说明');if(note)void act(`exception-pay-${v.id}`,()=>api.executePartialRefund(v.id,note),'已提交部分退款')}}><Button type="link" danger>核对后执行退款</Button></Popconfirm>}</>}]} /></section>
    </>
  );
  const communityOperationsPage = (
    <>
      <header className="section-header"><div><span className="eyebrow">平台自营 · 社区团购</span><h1>配送与领取</h1><p>日常只处理商品、团期、人工配送、点位实到与用户领取。采购、仓储和历史撮合数据保留在兼容区，不再阻塞新团期。</p></div><div className="header-actions">{can('OPERATOR')&&<Button onClick={()=>setModal('community-product')}>新增平台商品</Button>}{can('OPERATOR')&&<Button type="primary" icon={<PlusOutlined />} onClick={()=>setModal('community-campaign')}>创建社区团期</Button>}</div></header>
      <Alert type="info" showIcon message="轻量履约主线" description="商品建档 → 团期发布 → 截单 → 录入货拉拉/运单并发车 → 点位逐商品确认实到 → 用户按提货码领取。到货与异常仅影响对应商品数量。" />
      <section className="dashboard-grid" style={{marginTop:16}}>
        <article className="panel"><PanelTitle eyebrow="长期资料" title="平台商品" /><Table<PlatformSku> size="small" rowKey="id" pagination={{pageSize:5}} dataSource={platformSkusQ.data??[]} columns={[{title:'商品',render:(_,item)=><span>{item.product.title} · {item.name}</span>},{title:'默认零售价',dataIndex:'retailPriceCents',render:(value:number)=>money(value)},{title:'默认可售',dataIndex:'defaultSellableQuantity'},{title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},{title:'操作',render:(_,item)=>can('OPERATOR')?<><Button type="link" onClick={()=>{setSelectedCommunitySku(item);setModal('community-product');}}>编辑</Button>{item.status==='ACTIVE'&&<Popconfirm title="停用后不能加入新的社区团期，已发布团期不受影响。" onConfirm={()=>void act(`community-sku-off-${item.id}`,()=>api.savePlatformSku({id:item.id,productId:item.productId,title:item.product.title,category:item.product.category,origin:item.product.origin,imageUrl:item.product.imageUrl,skuName:item.name,retailPriceCents:item.retailPriceCents,defaultSellableQuantity:item.defaultSellableQuantity??0,referencePurchaseCostCents:item.referencePurchaseCostCents??null,supplierNote:item.supplierNote??null,status:'INACTIVE'}),'平台商品已停用')}><Button type="link" danger>停用</Button></Popconfirm>}</>:null}]} /></article>
        <article className="panel"><PanelTitle eyebrow="待发车 / 待点位确认" title="配送单" /><Table size="small" rowKey="id" pagination={{pageSize:5}} dataSource={communityDeliveriesQ.data??[]} columns={[{title:'团期',dataIndex:'campaignTitle'},{title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},{title:'人工运单',render:(_,item)=>item.vehicleOrderNo?`${item.logisticsPlatform??'配送'} · ${item.vehicleOrderNo}`:'待录入'},{title:'下一步',render:(_,item)=>item.status==='SITE_CONFIRMED'&&can('FULFILLMENT','OPERATOR')?<Button type="link" onClick={()=>{const plan=plans.find((value)=>value.id===item.id);if(plan){setSelectedPlan(plan);setModal('vehicle');}}}>录入运单</Button>:item.status==='VEHICLE_BOOKED'?<span className="muted">等待确认发车</span>:item.status==='IN_TRANSIT'&&item.dispatchBatchId&&(canUsePickupVerifier||can('SUPER_ADMIN'))?<Button type="link" onClick={()=>{setSelectedCommunityDelivery(item);setModal('community-arrival');}}>逐商品确认到货</Button>:item.status==='IN_TRANSIT'?<span className="muted">等待点位清点</span>:item.status==='ARRIVED'&&(canUsePickupVerifier||can('SUPER_ADMIN'))?<Button type="link" onClick={()=>{const plan=plans.find((value)=>value.id===item.id);if(plan){setSelectedPlan(plan);setModal('verify');}}}>按提货码确认领取</Button>:<span className="muted">已到货</span>}]} /></article>
      </section>
      <section className="panel" style={{marginTop:16}}><PanelTitle eyebrow="团期管理" title="新社区团期" /><Table<Campaign> rowKey="id" pagination={{pageSize:8}} dataSource={communityCampaignsQ.data??[]} columns={[{title:'团期',dataIndex:'title'},{title:'固定点位',render:(_,campaign)=>plans.find((plan)=>plan.campaignId===campaign.id)?.siteName??'待确认'},{title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},{title:'商品数',render:(_,campaign)=>campaign.items?.length??0},{title:'下一步',render:(_,campaign)=>{const batch=batches.find((item)=>item.campaignId===campaign.id);if(campaign.status==='DRAFT'&&can('OPERATOR'))return <Button type="link" onClick={()=>void act(`community-open-${campaign.id}`,()=>api.openCampaign(campaign.id),'团期已发布')}>发布开售</Button>;if(['LOCKED','FULFILLING'].includes(campaign.status)&&can('FULFILLMENT','OPERATOR')){if(!batch&&campaign.status==='LOCKED')return <Button type="link" onClick={()=>void act(`community-batch-${campaign.id}`,()=>api.createBatch(campaign.id),'配送批次已创建，请录入运单并确认发车')}>创建配送批次</Button>;if(batch?.status==='DRAFT')return <Button type="link" onClick={()=>void act(`community-dispatch-${batch.id}`,()=>api.dispatchBatch(batch.id),'已确认发车，等待点位清点')}>确认发车</Button>;}return <span className="muted">{campaign.status==='OPEN'?'等待截单':'按当前状态处理'}</span>;}}]} /></section>
      <section className="panel" style={{marginTop:16}}><PanelTitle eyebrow="异常与售后" title="待处理异常" action={<span className="panel__hint">点位只登记事实；运营确认补送或退款，财务执行退款。</span>} /><Table<FulfillmentException> rowKey="id" pagination={{pageSize:8}} dataSource={(fulfillmentExceptionsQ.data??[]).filter((item)=>communityCampaignsQ.data?.some((campaign)=>campaign.id===item.campaignId))} columns={[{title:'来源',dataIndex:'sourceStage'},{title:'异常数量',render:(_,item)=>item.items.reduce((sum,line)=>sum+line.rejectedQuantity+line.shortQuantity+line.damagedQuantity,0)},{title:'退款依据',render:(_,item)=><div className="cell-note">{item.refundBreakdown.map((line)=><div key={line.salesOrderItemId}>订单 {line.orderNo} · {line.productName}/{line.skuName}：异常 {line.exceptionQuantity} 件，已退 {line.refundedQuantity} 件，本退 {line.refundableQuantity} 件 × {money(line.unitPriceCents)} = {money(line.refundableAmountCents)}</div>)}<b>待退 {money(item.refundableAmountCents)} · 已退 {money(item.refundedAmountCents)}</b></div>},{title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},{title:'下一步',render:(_,item)=><>{can('OPERATOR')&&item.status==='REGISTERED'&&<Button type="link" onClick={()=>{const note=resolutionNote('请填写补送、调拨或待补货安排');if(note)void act(`community-wait-${item.id}`,()=>api.decideFulfillmentException(item.id,{status:'WAITING_REPLENISHMENT',responsibility:item.responsibility,resolutionNote:note}),'已登记等待补送')}}>等待补送</Button>}{can('OPERATOR')&&['REGISTERED','WAITING_REPLENISHMENT'].includes(item.status)&&<Button type="link" onClick={()=>{const note=resolutionNote('请填写确认部分退款的处置依据');if(note)void act(`community-refund-${item.id}`,()=>api.decideFulfillmentException(item.id,{status:'REFUND_CONFIRMED',responsibility:item.responsibility,resolutionNote:note}),'已确认部分退款')}}>确认部分退款</Button>}{can('FINANCE')&&item.status==='REFUND_CONFIRMED'&&<Popconfirm title="按订单快照价执行本次已确认异常退款？" description={<div>{item.refundBreakdown.map((line)=><div key={line.salesOrderItemId}>订单 {line.orderNo} · {line.productName}/{line.skuName}<br/>异常 {line.exceptionQuantity} 件 · 已退 {line.refundedQuantity} 件 · 本退 {line.refundableQuantity} 件 × {money(line.unitPriceCents)} = <b>{money(line.refundableAmountCents)}</b><br/>订单可退余额 {money(line.orderRefundableBalanceCents)}</div>)}<div>本次合计：<b>{money(item.refundableAmountCents)}</b></div></div>} onConfirm={()=>{const note=resolutionNote('请填写财务二次确认说明');if(note)void act(`community-refund-execute-${item.id}`,()=>api.executePartialRefund(item.id,note),'已提交部分退款')}}><Button type="link" danger>核对后执行退款</Button></Popconfirm>}</>}]} /></section>
      <Alert style={{marginTop:16}} type="warning" showIcon message="历史兼容入口" description="旧采购与中心仓、供应商应付和历史撮合结算仍保留为只读兼容能力，不属于新社区团购的日常操作路径。" />
    </>
  );
  const networkPage = (
    <>
      <header className="section-header">
        <div>
          <span className="eyebrow">全国行政区划目录</span>
          <h1>收货区域</h1>
          <p>
            系统已维护省、市、区县；运营只需选择要开放收单的区域，不填写代码或名称。
          </p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModal("area")}
        >
          开通区域
        </Button>
      </header>
      <section className="panel">
        <Table<ServiceArea>
          rowKey="id"
          loading={areasQ.isLoading || directoryQ.isLoading}
          dataSource={areas}
          pagination={{ pageSize: 12 }}
          columns={[
            {
              title: "已开通区域",
              render: (_, record) => (
                <div>
                  <b>{record.name}</b>
                  <small className="cell-note">
                    {regionPathByCode.get(record.regionCode) ?? record.name}
                  </small>
                </div>
              ),
            },
            {
              title: "收单状态",
              dataIndex: "orderEnabled",
              render: (value: boolean) =>
                value ? <Tag color="success">收单中</Tag> : <Tag>已暂停</Tag>,
            },
            {
              title: "当前团期",
              render: (_, record) =>
                campaigns.filter(
                  (campaign) =>
                    campaign.serviceAreaId === record.id &&
                    ["DRAFT", "OPEN", "LOCKED", "FULFILLING"].includes(
                      campaign.status,
                    ),
                ).length,
            },
            {
              title: "操作",
              render: (_, record) =>
                record.orderEnabled ? (
                  <Popconfirm
                    title="暂停本区域收单？"
                    description="已有订单不受影响，之后不能再创建新订单。"
                    onConfirm={() =>
                      void act(
                        `area-${record.id}`,
                        () =>
                          api.updateServiceAreaOrderStatus(record.id, false),
                        "已暂停该区域收单",
                      )
                    }
                  >
                    <Button
                      type="link"
                      danger
                      loading={busy === `area-${record.id}`}
                    >
                      暂停收单
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button
                    type="link"
                    loading={busy === `area-${record.id}`}
                    onClick={() =>
                      void act(
                        `area-${record.id}`,
                        () => api.updateServiceAreaOrderStatus(record.id, true),
                        "已恢复该区域收单",
                      )
                    }
                  >
                    恢复收单
                  </Button>
                ),
            },
          ]}
        />
      </section>
    </>
  );
  const verifierPage = (
    <>
      <header className="section-header">
        <div>
          <span className="eyebrow">最小权限 · 点位范围授权</span>
          <h1>核销员授权</h1>
          <p>为现场人员授予指定自提点的核销权限；撤销后立即不能查询或核销该点订单。</p>
        </div>
      </header>
      <section className="panel">
        <PanelTitle eyebrow="新增授权" title="授予自提点核销权限" />
        <Alert
          type="info"
          showIcon
          message="请录入核销员账号的用户 ID"
          description="当前不提供用户目录，避免在运营端暴露消费者资料。用户 ID 需由核销员从其受控账号资料中提供；系统会校验该账号和自提点均为启用状态。"
          style={{ marginBottom: 16 }}
        />
        <Form
          layout="vertical"
          className="verifier-assignment-form"
          onFinish={(value: { userId: string; pickupPointId: string }) =>
            void act(
              "verifier-grant",
              () => api.grantPickupVerifier({ userId: value.userId.trim(), pickupPointId: value.pickupPointId }),
              "已授予该自提点的现场核销权限",
            )
          }
        >
          <div className="form-grid">
            <Form.Item
              label="核销员用户 ID"
              name="userId"
              extra="仅用于权限校验和审计，不展示用户姓名、手机号或订单资料。"
              rules={[{ required: true, whitespace: true, message: "请输入核销员用户 ID" }]}
            >
              <Input autoComplete="off" placeholder="例如 verifier-001" />
            </Form.Item>
            <Form.Item
              label="授权自提点"
              name="pickupPointId"
              rules={[{ required: true, message: "请选择启用中的自提点" }]}
            >
              <Select
                placeholder="选择启用中的自提点"
                options={pickupPoints
                  .filter((point) => point.status === "ACTIVE")
                  .map((point) => ({
                    value: point.id,
                    label: `${point.name} · ${point.address}`,
                  }))}
                notFoundContent="暂无启用中的自提点"
              />
            </Form.Item>
          </div>
          <Button type="primary" htmlType="submit" loading={busy === "verifier-grant"}>
            授予核销权限
          </Button>
        </Form>
      </section>
      <section className="panel panel--spaced">
        <PanelTitle
          eyebrow="当前生效"
          title="已授权核销员"
          action={<span className="panel__hint">授权与撤销均记录在操作审计中</span>}
        />
        <Table<PickupVerifierAssignment>
          rowKey={(record) => `${record.userId}:${record.pickupPointId}`}
          loading={verifierAssignmentsQ.isLoading || pickupPointsQ.isLoading}
          dataSource={activeVerifierAssignments}
          locale={{ emptyText: <Empty description="暂未授予任何核销权限" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 740 }}
          columns={[
            { title: "核销员用户 ID", dataIndex: "userId", render: (value: string) => <span className="mono">{value}</span> },
            {
              title: "自提点",
              dataIndex: "pickupPointId",
              render: (value: string) => {
                const point = pickupPoints.find((item) => item.id === value);
                return point ? <div><b>{point.name}</b><small className="cell-note">{point.address}</small></div> : <span className="mono">{value}</span>;
              },
            },
            {
              title: "状态",
              render: () => <Tag color="success">已授权</Tag>,
            },
            {
              title: "最近授权",
              dataIndex: "createdAt",
              render: (value: string) => dateTime.format(new Date(value)),
            },
            {
              title: "操作",
              render: (_, record) => (
                <Popconfirm
                  title="撤销该核销权限？"
                  description="该账号将立即不能查询或核销此自提点订单。"
                  okText="确认撤销"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => act(
                    `verifier-revoke-${record.userId}-${record.pickupPointId}`,
                    () => api.revokePickupVerifier({ userId: record.userId, pickupPointId: record.pickupPointId }),
                    "已撤销该自提点核销权限",
                  )}
                >
                  <Button type="link" danger loading={busy === `verifier-revoke-${record.userId}-${record.pickupPointId}`}>撤销授权</Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </section>
    </>
  );
  const fulfillmentPage = (
    <>
      <header className="section-header">
        <div>
          <span className="eyebrow">地点确认 · 人工约车 · 到货通知</span>
          <h1>配送与领取</h1>
          <p>
            先和当地合作方确认集中领取地点，再登记货拉拉预约；到货确认后系统才开放取货码。
          </p>
        </div>
        <Tooltip title={plans.filter((item) => item.status === "ARRIVED").length === 0 ? "请先在“发车与到货”中确认到货，才能核销取货码" : plans.filter((item) => item.status === "ARRIVED").length > 1 ? "有多个已到货团期，请在对应团期行中点击“现场核销”" : undefined}>
          <span>
            <Button
              disabled={plans.filter((item) => item.status === "ARRIVED").length !== 1}
              onClick={() => {
                const arrivedPlan = plans.find((item) => item.status === "ARRIVED");
                if (arrivedPlan) openVerifier(arrivedPlan);
              }}
            >
              现场核销
            </Button>
          </span>
        </Tooltip>
      </header>
      {canUsePickupVerifier && plansQ.isSuccess && plans.length === 0 && (
        <Alert
          type="warning"
          showIcon
          message="暂无可核销的到货团期"
          description="仅会显示已到货且已授权给当前账号的自提点。若现场已有到货团期，请联系运营人员在“核销员授权”中核对当前账号与自提点的授权；未到货计划不会显示。"
          style={{ marginBottom: 18 }}
        />
      )}
      <section className="panel">
        <PanelTitle eyebrow="每团一处到货点" title="配送计划" />
        <Table<DeliveryPlan>
          className="fulfillment-plans-table"
          rowKey="id"
          dataSource={plans}
          scroll={{ x: 800 }}
          columns={fulfillmentColumns}
        />
        <div className="fulfillment-card-list">
          {plans.map((record) => (
            <article className="fulfillment-card" key={record.id}>
              <div className="fulfillment-card__head">
                <div><b>{campaignName(record.campaignId)}</b><small>{areaName(record.serviceAreaId)}</small></div>
                <StatusTag value={record.status} />
              </div>
              <div className="fulfillment-card__site"><span>固定自提点</span><b>{record.siteName ?? "待确认"}</b><small>{record.address ?? "请先确认本团固定自提点"}</small></div>
              <div className="fulfillment-card__actions">{renderPlanActions(record)}</div>
            </article>
          ))}
        </div>
      </section>
      {!canUsePickupVerifier && <section className="panel panel--spaced">
        <PanelTitle eyebrow="批次执行" title="发车与到货" />
        <Table<DispatchBatch>
          rowKey="id"
          dataSource={batches}
          columns={[
            {
              title: "团期",
              dataIndex: "campaignId",
              render: (value: string) => campaignName(value),
            },
            {
              title: "区域",
              dataIndex: "serviceAreaId",
              render: (value: string) => areaName(value),
            },
            {
              title: "状态",
              dataIndex: "status",
              render: (value: string) => <StatusTag value={value} />,
            },
            {
              title: "发车时间",
              dataIndex: "dispatchedAt",
              render: (value: string | null) =>
                value ? dateTime.format(new Date(value)) : "—",
            },
            {
              title: "操作",
              render: (_, record) => {
                const plan = planByCampaign.get(record.campaignId);
                if (record.status === "DRAFT")
                  return (
                    <Button
                      type="link"
                      onClick={() =>
                        void act(
                          record.id,
                          () => api.dispatchBatch(record.id),
                          "已确认发车",
                        )
                      }
                    >
                      确认发车
                    </Button>
                  );
                if (record.status === "IN_TRANSIT" && plan)
                  return (
                    <Popconfirm
                      title="确认货物已送达集中领取地点？"
                      onConfirm={() =>
                        void act(
                          `arrive-${record.id}`,
                          () => api.receiveBatch(record.id, plan.id),
                          "到货确认完成，取货码已开放",
                        )
                      }
                    >
                      <Button type="link">确认到货</Button>
                    </Popconfirm>
                  );
                return <span className="muted">—</span>;
              },
            },
          ]}
        />
      </section>}
      {!canUsePickupVerifier && <section className="panel panel--spaced">
        <PanelTitle eyebrow="订单进度" title="最近订单" />
        <Table<Order>
          rowKey="id"
          dataSource={orders}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 900 }}
          columns={[
            { title: "订单号", dataIndex: "orderNo" },
            {
              title: "团期",
              dataIndex: "campaignId",
              render: (value: string) => campaignName(value),
            },
            {
              title: "收货区域",
              dataIndex: "serviceAreaId",
              render: (value: string) => areaName(value),
            },
            {
              title: "状态",
              dataIndex: "status",
              render: (value: string) => <StatusTag value={value} />,
            },
            {
              title: "金额",
              dataIndex: "totalCents",
              render: (value: number) => money(value),
            },
          ]}
        />
      </section>}
    </>
  );
  const settlements = settlementsQ.data ?? [];
  const refunds = refundsQ.data ?? [];
  const financePage = (
    <>
      <header className="section-header">
        <div>
          <h1>财务管理</h1>
          <p>查看平台退款记录与对账信息；社区团购不产生商户佣金或自提点结算。</p>
        </div>
      </header>
      <section className="stats">
        <StatCard
          label="历史撮合待结算（兼容）"
          value={money(
            settlements.reduce(
              (sum, item) => sum + item.merchantReceivableCents,
              0,
            ),
          )}
          note="仅历史撮合订单，只读兼容"
          tone="green"
        />
        <StatCard
          label="历史平台服务费（兼容）"
          value={money(
            settlements.reduce((sum, item) => sum + item.commissionCents, 0),
          )}
          note="不用于社区团购毛利"
          tone="red"
        />
        <StatCard
          label="退款处理中"
          value={String(
            refunds.filter((item) =>
              ["CREATED", "PROCESSING"].includes(item.status),
            ).length,
          )}
          note="笔退款"
          tone="amber"
        />
      </section>
      <section className="panel"><PanelTitle eyebrow="平台资金" title="退款记录"/><Table<Refund> rowKey="id" loading={refundsQ.isLoading} dataSource={refunds} pagination={{pageSize:10}} scroll={{x:720}} columns={[{title:'订单',dataIndex:'orderId'},{title:'退款单号',dataIndex:'providerRefundNo'},{title:'金额',dataIndex:'amountCents',render:(value:number)=>money(value)},{title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>},{title:'创建时间',dataIndex:'createdAt',render:(value:string)=>dateTime.format(new Date(value))}]}/></section>
      <section className="panel panel--spaced"><PanelTitle eyebrow="历史兼容 · 只读" title="历史撮合结算"/><Alert type="info" showIcon message="仅用于历史订单追溯" description="新社区团购不创建商户结算或平台佣金。" style={{marginBottom:12}}/><Table<Settlement> rowKey="id" dataSource={settlements} pagination={{pageSize:8}} columns={[{title:'历史订单',dataIndex:'outOrderNo'},{title:'应收金额',dataIndex:'merchantReceivableCents',render:(value:number)=>money(value)},{title:'历史服务费',dataIndex:'commissionCents',render:(value:number)=>money(value)},{title:'状态',dataIndex:'status',render:(value:string)=><StatusTag value={value}/>}]}/></section>
    </>
  );
  const auditPage = (
    <>
      <header className="section-header">
        <div>
          <h1>操作记录</h1>
          <p>地点确认、约车和到货等关键操作均会留下记录。</p>
        </div>
      </header>
      <section className="panel">
        <Table
          rowKey="id"
          dataSource={auditQ.data ?? []}
          pagination={{ pageSize: 20 }}
          columns={[
            {
              title: "时间",
              dataIndex: "createdAt",
              render: (value: string) => dateTime.format(new Date(value)),
            },
            { title: "操作", dataIndex: "action" },
            {
              title: "对象",
              render: (_, record) =>
                `${record.resourceType} · ${record.resourceId}`,
            },
            { title: "操作人", dataIndex: "actorId" },
          ]}
        />
      </section>
    </>
  );
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
      {can("OPERATOR", "CUSTOMER_SERVICE") && <section className="panel panel--spaced">
        <PanelTitle eyebrow="社区团购 · 只读追踪" title="品质售后案件" />
        <Alert type="info" showIcon message="用户提交后自动进入此列表" description="这里展示用户已领取商品的品质问题事实和待受理状态；案件处理决定及退款会在后续流程中开放，本页不会改变案件状态。" style={{ marginBottom: 16 }} />
        <Table<CommunityQualityCase>
          rowKey="id"
          loading={communityQualityCasesQ.isLoading}
          dataSource={communityQualityCasesQ.data ?? []}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 880 }}
          columns={[
            { title: "申请时间", dataIndex: "registeredAt", render: (value: string) => dateTime.format(new Date(value)) },
            { title: "订单 / 点位", render: (_, record) => <div><b className="mono">{record.order.orderNo}</b><small className="cell-note">{record.order.pickupPointName}</small></div> },
            { title: "商品与数量", render: (_, record) => <div>{record.items.map((item) => <div key={item.salesOrderItemId}><b>{item.skuName}</b><small className="cell-note">申报 {item.disputedQuantity} 件 / 已领取 {item.pickedUpQuantitySnapshot} 件</small></div>)}</div> },
            { title: "问题说明", render: (_, record) => <div>{record.items.map((item) => <div key={`${item.salesOrderItemId}-reason`}><b>{communityQualityReasonLabel[item.reason]}</b><small className="cell-note">{item.description}</small></div>)}</div> },
            { title: "状态", dataIndex: "status", render: (value: string) => <StatusTag value={value} /> },
            { title: "操作", render: () => <span className="muted">只读追踪</span> },
          ]}
        />
      </section>}
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
  const logisticsManagementPage = (
    <>
      <header className="section-header"><div><span className="eyebrow">备货完成到自提点</span><h1>物流管理</h1><p>仅处理人工运单、确认发车和点位交接结果；正式到货必须由点位负责人现场逐商品确认。</p></div></header>
      <Alert type="info" showIcon message="人工录入货拉拉/配送信息" description="团期截单后创建配送批次，录入平台、运单号、司机、车牌和预计到达时间后确认发车。物流单号不会自动把订单改为已到货。" style={{marginBottom:16}}/>
      <section className="panel"><Table<CommunityDelivery> rowKey="id" loading={communityDeliveriesQ.isLoading} dataSource={communityDeliveriesQ.data??[]} pagination={{pageSize:10}} scroll={{x:860}} columns={[
        {title:'团期',dataIndex:'campaignTitle'},
        {title:'自提点',dataIndex:'siteName',render:(value:string|null,item)=>value??item.pickupPointId??'待绑定'},
        {title:'配送状态',render:(_,item)=><CommunityDeliveryStatusTag delivery={item}/>},
        {title:'货拉拉/运单',render:(_,item)=>item.vehicleOrderNo?`${item.logisticsPlatform??'配送'} · ${item.vehicleOrderNo}`:'待录入'},
        {title:'发车/预计到达',render:(_,item)=><span className="cell-note">{item.dispatchedAt?`已发车 ${dateTime.format(new Date(item.dispatchedAt))}`:'未发车'}{item.estimatedArrivalAt?` · 预计 ${dateTime.format(new Date(item.estimatedArrivalAt))}`:''}</span>},
        {title:'下一步',render:(_,item)=>{
          const plan=plans.find((value)=>value.id===item.id);
          const batch=batches.find((value)=>value.campaignId===item.campaignId);
          if(item.status==='SITE_CONFIRMED'&&can('OPERATOR','FULFILLMENT'))return <Button type="link" onClick={()=>{if(plan){setSelectedPlan(plan);setModal('vehicle');}}}>录入运单</Button>;
          if(item.status==='VEHICLE_BOOKED'&&can('OPERATOR','FULFILLMENT'))return batch?<Button type="link" onClick={()=>void act(`community-dispatch-${batch.id}`,()=>api.dispatchBatch(batch.id),'已确认发车，等待点位清点')}>确认发车</Button>:<Button type="link" onClick={()=>void act(`community-batch-${item.campaignId}`,()=>api.createBatch(item.campaignId),'配送已创建，请确认发车')}>创建配送</Button>;
          if(item.status==='IN_TRANSIT')return can('SUPER_ADMIN')&&item.dispatchBatchId?<Button danger type="link" onClick={()=>{setSelectedCommunityDelivery(item);setModal('community-arrival');}}>紧急代办点位确认</Button>:<span className="muted">等待点位现场确认</span>;
          if(item.status==='ARRIVED'&&hasCommunityArrivalDifference(item))return <div><Button type="link" onClick={()=>setPage('service')}>处理配送异常</Button><small className="cell-note">正常商品已可领取</small></div>;
          if(item.status==='ARRIVED')return <span className="muted">等待用户领取</span>;
          return <span className="muted">查看点位交接结果</span>;
        }},
      ]}/></section>
    </>
  );
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
  const pointWorkbenchPage = (
    <>
      <header className="section-header"><div><span className="eyebrow">仅限已绑定自提点</span><h1>点位工作台</h1><p>确认我的待到货配送，查询订单并核验提货码；成本、退款、商品和团期配置均不可访问。</p></div></header>
      <section className="panel"><PanelTitle eyebrow="我的配送" title="待确认到货与待领取订单"/><Table<CommunityDelivery> rowKey="id" loading={communityDeliveriesQ.isLoading} dataSource={communityDeliveriesQ.data??[]} pagination={{pageSize:10}} scroll={{x:700}} columns={[
        {title:'团期',dataIndex:'campaignTitle'}, {title:'自提点',dataIndex:'siteName'}, {title:'状态',render:(_,item)=><CommunityDeliveryStatusTag delivery={item}/>},
        {title:'下一步',render:(_,item)=>{const plan=plans.find((value)=>value.id===item.id);if(item.status==='IN_TRANSIT'&&item.dispatchBatchId)return <Button type="link" onClick={()=>{setSelectedCommunityDelivery(item);setModal('community-arrival');}}>逐商品确认到货</Button>;if(item.status==='ARRIVED'&&plan)return <div>{hasCommunityArrivalDifference(item)&&<small className="cell-note">存在配送差异，仅可核销正常实到商品</small>}<Button type="link" onClick={()=>openVerifier(plan)}>查询订单并确认领取</Button></div>;return <span className="muted">{item.status==='SITE_CONFIRMED'||item.status==='VEHICLE_BOOKED'?'等待发车':'等待现场下一步'}</span>;}}
      ]}/></section>
    </>
  );
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
  // Legacy marketplace and warehouse components remain in source for historical compatibility,
  // but are intentionally not routable from the daily community operations navigation.
  void platformPage; void communityOperationsPage; void commercePage; void verifierPage; void fulfillmentPage; void campaignPage; void networkPage; void auditPage;
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
