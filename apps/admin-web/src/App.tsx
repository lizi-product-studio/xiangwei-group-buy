import { newestFirst, earliestFirst, refundHistory } from "./list-order.ts";
import { OperationsQueueTable } from "./operations-queue-table.tsx";
import { Consumers } from "./consumers-page.tsx";
import { ProductImageField, ProductPicture } from "./ProductImageField.tsx";
import { getEntryBranding } from "./entry-branding.ts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  Alert,
  App as AntApp,
  Avatar,
  Breadcrumb,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Dropdown,
  Drawer,
  Empty,
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
import {
  AppstoreOutlined,
  CarOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  BranchesOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  UsergroupAddOutlined,
  DownOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  api,
  auth,
  adminErrorText,
  AdminApiError,
  hasValidAdminSession,
  loginRetryMessage,
  loginRetryRemainingSeconds,
  requiresLogin,
  type Campaign,
  type CatalogSku,
  type ProductCategory,
  type CommunityArrivalRequest,
  type CommunityDelivery,
  type DeliveryPlan,
  type FulfillmentException,
  type InternalStaff,
  type Order,
  type PackingLabel,
  type PickupLookup,
  type PickupPoint,
  type PickupWindow,
  type RegionDirectoryEntry,
  type ServiceArea,
} from "./api.ts";
import {
  getAdminNavigation,
  getAdminPageModule,
  getAdminNavigationPath,
  getDefaultAdminPage,
  isAllowedAdminPage,
  type AdminPage,
} from "./navigation.ts";
import {
  centsToYuan,
  validateYuanInput,
  yuanToCents,
} from "./money-input.ts";
import {
  beginPickupRequest,
  clearPickupRequest,
  isTerminalPickupError,
  markPickupRequestConfirmed,
  type PendingPickupRequest,
} from "./pickup-request.ts";
import { GovernancePage } from "./governance-page.tsx";
import { AuditPage } from "./audit-page.tsx";
import {
  isPickupLocationSubmissionBlocked,
  PickupLocationPicker,
  type PickupLocationVerificationState,
} from "./pickup-location-picker.tsx";
import { displayLabel, STAFF_ROLE_OPTIONS } from "./labels.ts";
import {
  adminLoadErrorText,
  getDeliveryActionLabels,
  getDeliveryNextStep,
  dispatchBlockReason,
  dispatchFailureText,
  getLogisticsViewState,
} from "./logistics-ui.ts";
import {
  campaignScheduleError,
  formatValidationDetails,
} from "./campaign-form.ts";

const { Header, Sider, Content } = Layout;
const statusColor = (value: string) => {
  if (
    ["ACTIVE", "OPEN", "SUCCEEDED", "ARRIVED", "COMPLETED", "PICKED_UP", "REFUNDED", "RESOLVED", "CONFIRMED", "MANUAL_COMPLETED"].includes(value)
  ) return "green";
  if (
    ["FAILED", "RETRYABLE_FAILURE", "MANUAL_HOLD", "SUBMISSION_UNKNOWN", "BLOCKED", "EXCEPTION"].includes(value)
  ) return "red";
  if (
    ["PENDING_PAYMENT", "PENDING_REVIEW", "REGISTERED", "ACCEPTED", "CANCELLING", "PENDING_OPERATOR_CONFIRMATION", "APPROVED_WAITING_FINANCE", "REFUND_CONFIRMED", "MANUAL_REQUIRED", "EXPIRED_PENDING"].includes(value)
  ) return "gold";
  if (["CANCELLED", "REJECTED", "CLOSED", "INACTIVE", "SUSPENDED", "DISABLED"].includes(value))
    return "default";
  return "blue";
};
const Status = ({ value }: { value: string }) => (
  <Tag className="status-tag" color={statusColor(value)}>
    <span className="status-tag__dot" aria-hidden="true" />
    {displayLabel(value)}
  </Tag>
);
const money = (cents: number) => `¥${centsToYuan(cents)}`;
const normalizePickupLocationText = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\u3000]+/gu, " ")
    .replace(/[，,。.;；:：]+/gu, ",")
    .replace(/^,+|,+$/gu, "")
    .trim()
    .replace(/^,+|,+$/gu, "");
const roundedPickupCoordinate = (value: number) => Number(value.toFixed(6));
const pickupLocationChangeRequiresConfirmation = (
  before: PickupPoint | null,
  values: {
    address?: string;
    latitude?: number;
    longitude?: number;
    status?: PickupPoint["status"];
  },
) => {
  if (!before) return true;
  return (
    (values.address !== undefined &&
      normalizePickupLocationText(values.address) !==
        normalizePickupLocationText(before.address)) ||
    (values.latitude !== undefined &&
      roundedPickupCoordinate(values.latitude) !==
        roundedPickupCoordinate(before.latitude)) ||
    (values.longitude !== undefined &&
      roundedPickupCoordinate(values.longitude) !==
        roundedPickupCoordinate(before.longitude)) ||
    (before.status === "INACTIVE" && values.status === "ACTIVE")
  );
};
const mutationErrorText = (error: unknown): string => {
  const value = error as Error & {
    details?: unknown;
  };
  const details = value.details;
  const validationMessage = formatValidationDetails(details);
  if (validationMessage) return validationMessage;
  const impact = details as {
    campaignCount?: number;
    unfinishedOrderCount?: number;
    deliveryPlanCount?: number;
    activeManagerCount?: number;
  } | null;
  if (
    impact &&
    (impact.campaignCount !== undefined ||
      impact.unfinishedOrderCount !== undefined ||
      impact.deliveryPlanCount !== undefined ||
      impact.activeManagerCount !== undefined)
  ) {
    const parts = [
      impact.campaignCount !== undefined
        ? `${impact.campaignCount} 个进行中团期`
        : null,
      impact.unfinishedOrderCount !== undefined
        ? `${impact.unfinishedOrderCount} 个未完成订单`
        : null,
      impact.deliveryPlanCount !== undefined
        ? `${impact.deliveryPlanCount} 个进行中配送计划`
        : null,
      impact.activeManagerCount !== undefined
        ? `${impact.activeManagerCount} 个有效点位负责人授权`
        : null,
    ].filter((part): part is string => Boolean(part));
    return `${adminErrorText(error)}（影响：${parts.join("，")}）`;
  }
  const transportError =
    value && typeof value === "object" && ("statusCode" in value || "code" in value);
  if (
    error instanceof Error &&
    error.message &&
    /[\u3400-\u9fff]/u.test(error.message) &&
    !transportError
  ) {
    return error.message;
  }
  return adminErrorText(error);
};
const refreshAfterMutation = async (
  reload: () => Promise<void>,
  message: { success: (content: string) => unknown; warning: (content: string) => unknown },
  successText: string,
) => {
  try {
    await reload();
    message.success(successText);
  } catch {
    message.warning("已保存，列表刷新失败，请刷新");
  }
};
const priceRule = {
  validator: (_: unknown, value: unknown) => {
    const error = validateYuanInput(value);
    return error ? Promise.reject(new Error(error)) : Promise.resolve();
  },
};

type CampaignDraftValues = {
  title: string;
  serviceAreaId: string;
  pickupPointId: string;
  cutoffAt: dayjs.Dayjs;
  dispatchAt: dayjs.Dayjs;
  estimatedArrivalStartAt: dayjs.Dayjs;
  estimatedArrivalEndAt: dayjs.Dayjs;
  minTotalQuantity: number;
  failureAction: "CANCEL_AND_REFUND" | "POSTPONE";
  items: Array<{
    catalogSkuId: string;
    expectedQuantity: number;
    retailPriceYuan: string;
    sellableQuantity: number;
  }>;
};

const failureActionText = (value: CampaignDraftValues["failureAction"]) =>
  value === "CANCEL_AND_REFUND" ? "取消并原路退款" : "顺延并通知消费者";
const dateTime = (value: string | dayjs.Dayjs) =>
  dayjs(value).format("YYYY-MM-DD HH:mm");

function AccessiblePasswordInput({
  fieldLabel,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "suffix"> & {
  fieldLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  const accessibleField = fieldLabel.replace("密码", "凭据");
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      suffix={
        <button
          type="button"
          className="password-visibility-button"
          aria-label={`${visible ? "隐藏" : "显示"}${accessibleField}内容`}
          aria-pressed={visible}
          disabled={props.disabled}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
        </button>
      }
    />
  );
}

const entryBranding = getEntryBranding(typeof window === "undefined" ? "" : window.location.hostname);

function Login({
  done,
  notice,
}: {
  done: () => void;
  notice?: string | null;
}) {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [passwordChange, setPasswordChange] = useState<{
    token: string;
    username: string;
  } | null>(null);
  const [loginForm] = Form.useForm();
  const [passwordChangeForm] = Form.useForm();
  const rateLimitRemaining = loginRetryRemainingSeconds(rateLimitUntil, clockNow);
  useEffect(() => {
    if (!rateLimitUntil || rateLimitUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClockNow(now);
      if (now >= rateLimitUntil) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [rateLimitUntil]);
  const submit = async (value: { username: string; password: string }) => {
    if (loading) return;
    setLoading(true);
    setErrorText(null);
    try {
      const result = await api.login(value.username, value.password);
      if (result.nextAction === "CHANGE_PASSWORD") {
        setPasswordChange({ token: result.passwordChangeToken, username: value.username });
        passwordChangeForm.resetFields();
      } else {
        done();
      }
    } catch (error) {
      if (error instanceof AdminApiError && error.code === "LOGIN_RATE_LIMITED") {
        const seconds = error.retryAfterSeconds ?? 15 * 60;
        const now = Date.now();
        setClockNow(now);
        setRateLimitUntil(now + seconds * 1_000);
      } else {
        setErrorText(mutationErrorText(error));
      }
      loginForm.setFieldValue("password", "");
    } finally {
      setLoading(false);
    }
  };
  const completePasswordChange = async (value: { newPassword: string }) => {
    if (!passwordChange || loading) return;
    setLoading(true);
    setErrorText(null);
    try {
      await api.completePasswordChange(
        passwordChange.token,
        value.newPassword,
        passwordChange.username,
      );
      void message.success("密码已设置，请继续使用");
      done();
    } catch (error) {
      setErrorText(mutationErrorText(error));
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-story" aria-label={entryBranding.storyTitle}>
        <div className="login-brand">
          <span className="login-brand__mark" aria-hidden="true">
            <BranchesOutlined />
          </span>
          <strong>{entryBranding.loginBrand}</strong>
          <span>{entryBranding.loginSection}</span>
        </div>
        <div className="login-story__copy">
          <span className="login-story__rule" aria-hidden="true" />
          <Typography.Title level={1}>{entryBranding.storyTitle}</Typography.Title>
          <Typography.Paragraph className="login-story__description">
            {entryBranding.description}
          </Typography.Paragraph>
        </div>
      </section>
      <section className="login-panel" aria-label="登录表单">
        <div className="login-card">
          <Typography.Title level={2}>
            {passwordChange ? "请先设置新密码" : entryBranding.loginTitle}
          </Typography.Title>
          <Typography.Paragraph className="login-card__intro">
            {passwordChange
              ? entryBranding.passwordDescription
              : entryBranding.description}
          </Typography.Paragraph>
          {notice ? (
            <Alert
              className="login-notice"
              type="info"
              showIcon
              role="status"
              message={notice}
            />
          ) : null}
          {rateLimitRemaining > 0 || errorText ? (
            <Alert
              className="login-error"
              type="error"
              showIcon
              role="alert"
              aria-live="polite"
              message={
                rateLimitRemaining > 0
                  ? loginRetryMessage(rateLimitRemaining)
                  : errorText
              }
            />
          ) : null}
          {passwordChange ? (
            <Form
              className="login-form"
              form={passwordChangeForm}
              layout="vertical"
              onFinish={(value) => void completePasswordChange(value)}
            >
              <Form.Item label="账号">
                <Input prefix={<UserOutlined />} value={passwordChange.username} disabled />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label="新密码"
                rules={[
                  { required: true, message: "请输入新密码" },
                  { min: 8, max: 128, message: "密码长度为 8–128 位" },
                ]}
              >
                <AccessiblePasswordInput
                  fieldLabel="新密码"
                  prefix={<LockOutlined />}
                  autoComplete="new-password"
                  disabled={loading}
                />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label="确认新密码"
                dependencies={["newPassword"]}
                rules={[
                  { required: true, message: "请再次输入新密码" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || value === getFieldValue("newPassword"))
                        return Promise.resolve();
                      return Promise.reject(new Error("两次输入的密码不一致"));
                    },
                  }),
                ]}
              >
                <AccessiblePasswordInput
                  fieldLabel="确认新密码"
                  prefix={<LockOutlined />}
                  autoComplete="new-password"
                  disabled={loading}
                />
              </Form.Item>
              <Space direction="vertical" className="login-actions">
                <Button type="primary" htmlType="submit" block loading={loading}>
                  {loading ? "保存中…" : "保存新密码"}
                </Button>
                <Button
                  block
                  disabled={loading}
                  onClick={() => {
                    setErrorText(null);
                    setPasswordChange(null);
                  }}
                >
                  退出并返回登录
                </Button>
              </Space>
            </Form>
          ) : (
            <Form
              className="login-form"
              form={loginForm}
              layout="vertical"
              onFinish={(value) => void submit(value)}
            >
              <Form.Item
                name="username"
                label="账号"
                rules={[
                  { required: true, message: "请输入账号" },
                  { min: 3, max: 64, message: "账号长度为 3–64 位" },
                ]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder="请输入账号"
                  autoComplete="username"
                  disabled={loading || rateLimitRemaining > 0}
                />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[
                  { required: true, message: "请输入密码" },
                  { min: 8, max: 128, message: "密码长度为 8–128 位" },
                ]}
              >
                <AccessiblePasswordInput
                  fieldLabel="密码"
                  prefix={<LockOutlined />}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  disabled={loading || rateLimitRemaining > 0}
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={loading}
                disabled={rateLimitRemaining > 0}
              >
                {loading ? "登录中…" : "登录"}
              </Button>
              <Button
                type="link"
                className="login-help-link"
                disabled={loading}
                onClick={() => setHelpOpen(true)}
              >
                忘记密码？请联系超级管理员重置
              </Button>
            </Form>
          )}
        </div>
      </section>
      <Modal
        open={helpOpen}
        title="密码重置说明"
        okText="返回登录"
        cancelButtonProps={{ style: { display: "none" } }}
        onOk={() => setHelpOpen(false)}
        onCancel={() => setHelpOpen(false)}
      >
        <Typography.Paragraph>
          当前页面不能自助找回密码，请联系超级管理员重置临时密码后再登录。
        </Typography.Paragraph>
      </Modal>
    </main>
  );
}

function ChangeOwnPasswordButton() {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [form] = Form.useForm();
  const close = () => {
    if (submitting) return;
    setOpen(false);
    setErrorText(null);
    form.resetFields();
  };
  const submit = async (value: {
    currentPassword: string;
    newPassword: string;
  }) => {
    if (submitting) return;
    setSubmitting(true);
    setErrorText(null);
    try {
      await api.changeOwnPassword(value.currentPassword, value.newPassword);
      setOpen(false);
      form.resetFields();
      void message.success("密码已修改，其他旧会话已失效");
    } catch (error) {
      setErrorText(mutationErrorText(error));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <Button type="link" onClick={() => setOpen(true)}>修改我的密码</Button>
      <Modal
        open={open}
        title="修改密码"
        footer={null}
        destroyOnHidden
        maskClosable={!submitting}
        closable={!submitting}
        onCancel={close}
      >
        <Typography.Paragraph type="secondary">
          修改成功后，其他设备和浏览器中的旧会话会立即失效。
        </Typography.Paragraph>
        {errorText ? (
          <Alert
            type="error"
            showIcon
            role="alert"
            message={errorText}
          />
        ) : null}
        <Form
          form={form}
          layout="vertical"
          onFinish={(value) => void submit(value)}
        >
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[
              { required: true, message: "请输入当前密码" },
              { min: 8, max: 128, message: "密码长度为 8–128 位" },
            ]}
          >
            <AccessiblePasswordInput
              fieldLabel="当前密码"
              autoComplete="current-password"
              disabled={submitting}
            />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: 8, max: 128, message: "密码长度为 8–128 位" },
            ]}
          >
            <AccessiblePasswordInput
              fieldLabel="新密码"
              autoComplete="new-password"
              disabled={submitting}
            />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: "请再次输入新密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || value === getFieldValue("newPassword"))
                    return Promise.resolve();
                  return Promise.reject(new Error("两次输入的密码不一致"));
                },
              }),
            ]}
          >
            <AccessiblePasswordInput
              fieldLabel="确认新密码"
              autoComplete="new-password"
              disabled={submitting}
            />
          </Form.Item>
          <Space>
            <Button onClick={close} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {submitting ? "保存中…" : "保存新密码"}
            </Button>
          </Space>
        </Form>
      </Modal>
    </>
  );
}

function AccountMenu({
  displayName,
  username,
  role,
  onLogout,
  className,
  placement = "topLeft",
}: {
  displayName?: string | undefined;
  username?: string | null;
  role?: string | undefined;
  onLogout: () => void;
  className?: string;
  placement?: "topLeft" | "topCenter" | "topRight" | "bottomLeft" | "bottomCenter" | "bottomRight";
}) {
  const label = displayName || username || "当前账号";
  return (
    <Dropdown
      trigger={["click"]}
      overlayClassName="account-dropdown"
      placement={placement}
      {...(className ? { className } : {})}
      menu={{
        items: [
          {
            key: "identity",
            label: (
              <div className="account-dropdown__identity" aria-label="当前账号信息">
                <strong>{label}</strong>
                <span>{displayLabel(role)}</span>
              </div>
            ),
            disabled: true,
          },
          { type: "divider" },
          { key: "change-password", label: <ChangeOwnPasswordButton /> },
          { key: "logout", label: "退出登录", danger: true, onClick: onLogout },
        ],
      }}
    >
      <Button type="text" className="account-trigger" aria-label="打开账号菜单">
        <Avatar size={34} icon={<UserOutlined />} />
        <span className="account-trigger__copy">
          <strong>{label}</strong>
          <small>{displayLabel(role)}</small>
        </span>
        <DownOutlined className="account-trigger__chevron" />
      </Button>
    </Dropdown>
  );
}

function navigationGroupIcon(groupKey: string) {
  if (["dashboard", "products", "campaigns", "orders"].includes(groupKey)) return <AppstoreOutlined aria-hidden="true" />;
  if (groupKey === "fulfillment") return <CarOutlined aria-hidden="true" />;
  if (["consumers", "service", "governance"].includes(groupKey)) return <UsergroupAddOutlined aria-hidden="true" />;
  return <SafetyCertificateOutlined aria-hidden="true" />;
}

function Dashboard({
  areas,
  points,
  campaigns,
  orders,
  onNavigate,
}: {
  areas: ServiceArea[];
  points: PickupPoint[];
  campaigns: Campaign[];
  orders: Order[];
  onNavigate: (page: AdminPage) => void;
}) {
  return (
    <>
      <PageTitle title="运营工作台" subtitle="从团期到领取，查看当前运营与履约进度" />
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
      <div className="dashboard-grid">
        <Card title="当前团期" extra={<Button type="link" onClick={() => onNavigate("campaigns")}>查看团期</Button>}>
          {campaigns.filter((campaign) => !["COMPLETED", "CANCELLED"].includes(campaign.status)).length === 0
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无进行中的团期，配置商品与自提点后即可创建" />
            : <div className="dashboard-campaign-list">
              {newestFirst(campaigns).filter((campaign) => !["COMPLETED", "CANCELLED"].includes(campaign.status)).slice(0, 5).map((campaign) => (
                <div className="dashboard-campaign-row" key={campaign.id}>
                  <div><strong>{campaign.title}</strong><span>截单 {dayjs(campaign.cutoffAt).format("MM-DD HH:mm")}</span></div>
                  <Status value={campaign.status} />
                </div>
              ))}
            </div>}
        </Card>
        <Card title="订单履约概览" extra={<Button type="link" onClick={() => onNavigate("orders")}>查看订单</Button>}>
          <div className="dashboard-order-stages">
            {[
              { label: "待履约", statuses: ["PAID_WAITING_CLOSE"] },
              { label: "备货与运输", statuses: ["LOCKED", "ALLOCATING", "IN_TRANSIT"] },
              { label: "待领取", statuses: ["READY_FOR_PICKUP"] },
              { label: "退款处理中", statuses: ["REFUNDING"] },
            ].map((stage) => <div key={stage.label}><span>{stage.label}</span><strong>{orders.filter((order) => stage.statuses.includes(order.status)).length}</strong></div>)}
          </div>
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
function PageLoadError({
  page,
  reload,
}: {
  page: AdminPage;
  reload: () => Promise<void>;
}) {
  return (
    <Card>
      <Alert
        type="error"
        showIcon
        message={`${displayLabel(page)}数据加载失败`}
        description="后台服务暂时无法连接，已保留填写内容，请启动服务后重试。"
        action={<Button onClick={() => void reload().catch(() => undefined)}>重试</Button>}
      />
    </Card>
  );
}
function ListFilters({label,query,onQuery,status,onStatus,statuses}: {label:string;query:string;onQuery:(value:string)=>void;status:string;onStatus:(value:string)=>void;statuses:Array<{value:string;label:string}>}) {
  return <Space wrap style={{marginBottom:16}}>
    <Input allowClear aria-label={`${label}关键词`} placeholder={`${label}关键词`} value={query} onChange={event=>onQuery(event.target.value)} style={{width:260}} />
    <Select aria-label={`${label}状态`} value={status} onChange={onStatus} style={{width:170}} options={[{value:"ALL",label:"全部状态"},...statuses]} />
  </Space>;
}
const matchesKeyword = (query:string,...values:unknown[]) => !query.trim() || values.some(value => String(value ?? "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

function PanelDialog({ inline, children, ...props }: ComponentProps<typeof Modal> & { inline?: boolean }) {
  return inline ? <Card title={props.title}>{children}</Card> : <Modal {...props}>{children}</Modal>;
}

function Products({
  view,
  values,
  categories,
  reload,
}: {
  view: AdminPage;
  values: CatalogSku[];
  categories: ProductCategory[];
  reload: () => Promise<void>;
}) {
  const [query,setQuery] = useState("");
  const [filterStatus,setFilterStatus] = useState("ALL");
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogSku | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const uploadBusyRef = useRef(false);
  const updateImage = (value: string | null) => { imageUrlRef.current = value; setImageUrl(value); };
  const updateImageBusy = (busy: boolean) => { uploadBusyRef.current = busy; setUploadingImage(busy); };
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryForm] = Form.useForm();
  const [form] = Form.useForm();
  const save = async (value: {
    title: string;
    category: string;
    categoryId?: string | null;
    origin: string;
    skuName: string;
    retailPriceYuan: string;
    defaultSellableQuantity: number;
    status: "ACTIVE" | "INACTIVE";
  }) => {
    if (saving || uploadBusyRef.current) return;
    setSaving(true);
    try {
      const { retailPriceYuan, ...product } = value;
      await api.saveSku({
        ...(editing ? { id: editing.id, productId: editing.productId } : {}),
        ...product,
        retailPriceCents: yuanToCents(retailPriceYuan),
        imageUrl: imageUrlRef.current,
      });
      setOpen(false);
      setEditing(null);
      form.resetFields();
      await refreshAfterMutation(reload, message, "商品已保存；历史订单快照不会改变");
    } catch (error) {
      void message.error(mutationErrorText(error));
    } finally {
      setSaving(false);
    }
  };
  const toggleStatus = async (value: CatalogSku) => {
    if (saving) return;
    setSaving(true);
    try {
      await api.saveSku({
        id: value.id,
        productId: value.productId,
        title: value.product.title,
        category: value.product.category,
        categoryId: value.categoryId ?? null,
        origin: value.product.origin,
        imageUrl: value.product.imageUrl,
        skuName: value.name,
        retailPriceCents: value.retailPriceCents,
        defaultSellableQuantity: value.defaultSellableQuantity,
        status: value.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
      await refreshAfterMutation(
        reload,
        message,
        value.status === "ACTIVE"
          ? "商品已停用，公共目录不再展示"
          : "商品已重新启用",
      );
    } catch (error) {
      void message.error(mutationErrorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageTitle
        title={view === "categories" ? "分类管理" : "商品列表"}
        subtitle="维护社区团购商品目录与默认可售量"
        action={view !== "categories" &&
          <Space>
          <Button onClick={() => { setEditingCategory(null); categoryForm.resetFields(); setCategoryOpen(true); }}>分类管理</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              updateImage(null);
              updateImageBusy(false);
              form.resetFields();
              form.setFieldsValue({ status: "ACTIVE" });
              setOpen(true);
            }}
          >
            新增商品
          </Button>
          </Space>
        }
      />
      {view !== "categories" && <>
      <ListFilters label="商品" query={query} onQuery={setQuery} status={filterStatus} onStatus={setFilterStatus} statuses={[{value:"ACTIVE",label:"启用"},{value:"INACTIVE",label:"已停用"}]} />
      <Table
        rowKey="id"
        dataSource={newestFirst(values).filter(v => (filterStatus === "ALL" || v.status === filterStatus) && matchesKeyword(query,...[v.product.title,v.name,v.product.category,v.product.origin]))}
        locale={{ emptyText: "暂无商品，请先创建商品" }}
        columns={[
          {
            title: "商品",
            render: (_, v) => (
              <Space><ProductPicture src={v.product.imageUrl} /><div><b>{v.product.title}</b><div>{v.name}</div></div></Space>
            ),
          },
          {
            title: "分类/产地",
            render: (_, v) => `${v.product.category} / ${v.product.origin}`,
          },
          { title: "默认售价", render: (_, v) => money(v.retailPriceCents) },
          { title: "默认团期可售量", dataIndex: "defaultSellableQuantity" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, value: CatalogSku) => (
              <Space>
                <Button
                  onClick={() => {
                    setEditing(value);
                    updateImage(value.product.imageUrl);
                    updateImageBusy(false);
                    form.setFieldsValue({
                      title: value.product.title,
                      category: value.product.category,
                      categoryId: value.categoryId ?? null,
                      origin: value.product.origin,
                      skuName: value.name,
                      retailPriceYuan: centsToYuan(value.retailPriceCents),
                      defaultSellableQuantity: value.defaultSellableQuantity,
                      status: value.status,
                    });
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Button
                  danger={value.status === "ACTIVE"}
                  loading={saving}
                  disabled={saving}
                  onClick={() => void toggleStatus(value)}
                >
                  {value.status === "ACTIVE" ? "停用" : "启用"}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      </>}
      <Modal
        open={open}
        title={editing ? "编辑商品" : "新增商品"}
        footer={null}
        onCancel={() => {
          if (saving) return;
          setOpen(false);
          setEditing(null);
          updateImageBusy(false);
        }}
      >
        <Form form={form} layout="vertical" onFinish={(v) => void save(v)}>
          <Form.Item label="商品主图">
            {open && <ProductImageField key={editing?.id ?? "new"} value={imageUrl} onChange={updateImage} onBusyChange={updateImageBusy} disabled={saving} />}
          </Form.Item>
          <Form.Item
            name="title"
            label="商品名称"
            rules={[{ required: true, min: 2 }]}
          >
            <Input />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="categoryId"
              label="分类"
              rules={[{ required: true, message: "请选择有效分类；没有分类请先创建" }]}
            >
              <Select
                showSearch
                allowClear
                options={categories.filter((category) => category.status === "ACTIVE").map((category) => ({
                  value: category.id,
                  label: category.name,
                }))}
                placeholder={
                  categories.length ? "请选择启用分类" : "暂无分类，请先创建"
                }
                onChange={(categoryId) => {
                  const category = categories.find((item) => item.id === categoryId);
                  if (category)
                    form.setFieldValue("category", category.name);
                }}
              />
            </Form.Item>
            <Form.Item name="category" hidden>
              <Input />
            </Form.Item>
            <Form.Item
              name="origin"
              label="产地"
              rules={[{ required: true, min: 2, message: "请填写明确产地" }]}
            >
              <Input />
            </Form.Item>
          </div>
          <Form.Item
            name="skuName"
            label="销售规格（包装单位）"
            rules={[{ required: true }]}
          >
            <Input placeholder="例如 500克/袋、12枚/盒" />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="retailPriceYuan"
              label="默认售价（元）"
              rules={[priceRule]}
            >
              <Input
                inputMode="decimal"
                placeholder="例如 19.90"
                autoComplete="off"
              />
            </Form.Item>
            <Form.Item
              name="defaultSellableQuantity"
              label="默认团期可售量"
              extra="创建团期时带出的建议数量，团期内可调整"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={10_000_000} />
            </Form.Item>
          </div>
          <Form.Item name="status" label="目录状态" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "ACTIVE", label: "启用（公共目录可见）" },
                { value: "INACTIVE", label: "停用（历史快照保留）" },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} disabled={saving || uploadingImage}>
            保存商品
          </Button>
        </Form>
      </Modal>
      <PanelDialog inline={view === "categories"}
        open={categoryOpen}
        title="分类管理"
        footer={null}
        onCancel={() => setCategoryOpen(false)}
      >
        <Form
          form={categoryForm}
          layout="inline"
          onFinish={async (value) => {
            if (savingCategory) return;
            setSavingCategory(true);
            try {
              await api.saveCategory({
                ...(editingCategory ? { id: editingCategory.id } : {}),
                ...value,
              });
              categoryForm.resetFields();
              setEditingCategory(null);
              await refreshAfterMutation(
                reload,
                message,
                editingCategory ? "分类名称已更新" : "分类已保存",
              );
            } catch (error) {
              message.error(mutationErrorText(error));
            } finally {
              setSavingCategory(false);
            }
          }}
        >
          <Form.Item name="name" rules={[{ required: true, min: 2, message: "分类名称至少 2 个字" }]}>
            <Input placeholder="例如：蔬菜" />
          </Form.Item>
          <Form.Item name="sortOrder" initialValue={0}>
            <InputNumber min={0} max={1_000_000} aria-label="排序" />
          </Form.Item>
          <Form.Item name="status" hidden initialValue="ACTIVE">
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={savingCategory}>
            {editingCategory ? "保存分类" : "新增分类"}
          </Button>
          {editingCategory && (
            <Button onClick={() => { setEditingCategory(null); categoryForm.resetFields(); }}>
              取消编辑
            </Button>
          )}
        </Form>
        <Table
          rowKey="id"
          pagination={false}
          dataSource={categories}
          locale={{ emptyText: "暂无分类，请先新增分类" }}
          columns={[
            { title: "分类", dataIndex: "name" },
            { title: "排序", dataIndex: "sortOrder" },
            { title: "状态", render: (_, value) => <Status value={value.status} /> },
            {
              title: "操作",
              render: (_, value) => (
                <Space>
                  <Button onClick={() => {
                    setEditingCategory(value);
                    categoryForm.setFieldsValue({ name: value.name, sortOrder: value.sortOrder, status: value.status });
                  }}>重命名</Button>
                  <Button
                    danger={value.status === "ACTIVE"}
                    loading={savingCategory}
                    onClick={() => {
                      if (savingCategory) return;
                      setSavingCategory(true);
                      void api
                        .saveCategory({
                          id: value.id,
                          name: value.name,
                          sortOrder: value.sortOrder,
                          status: value.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                        })
                        .then(() =>
                          refreshAfterMutation(
                            reload,
                            message,
                            value.status === "ACTIVE" ? "分类已停用" : "分类已启用",
                          ),
                        )
                        .catch((error) => message.error(mutationErrorText(error)))
                        .finally(() => setSavingCategory(false));
                    }}
                  >
                    {value.status === "ACTIVE" ? "停用" : "启用"}
                  </Button>
                  <Button
                    danger
                    onClick={() => {
                      Modal.confirm({
                        title: "删除分类",
                        content: `确定删除分类“${value.name}”吗？已被商品引用的分类无法删除。`,
                        okText: "确认删除",
                        cancelText: "取消",
                        onOk: async () => {
                          if (savingCategory) return;
                          setSavingCategory(true);
                          try {
                            await api.deleteCategory(value.id);
                            await refreshAfterMutation(reload, message, "分类已删除");
                          } catch (error) {
                            message.error(mutationErrorText(error));
                          } finally {
                            setSavingCategory(false);
                          }
                        },
                      });
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </PanelDialog>
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
  const [query,setQuery] = useState("");
  const [filterStatus,setFilterStatus] = useState("ALL");
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleteReview, setDeleteReview] = useState<Campaign | null>(null);
  const [reviewNow, setReviewNow] = useState(Date.now());
  const [createReview, setCreateReview] = useState<CampaignDraftValues | null>(
    null,
  );
  const [openReview, setOpenReview] = useState<Campaign | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [labelCampaign, setLabelCampaign] = useState<Campaign | null>(null);
  const [labels, setLabels] = useState<PackingLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [postponeCampaign, setPostponeCampaign] = useState<Campaign | null>(
    null,
  );
  const [closeReview, setCloseReview] = useState<Campaign | null>(null);
  const [cancelReview, setCancelReview] = useState<{
    campaign: Campaign;
    impact: {
      pendingPaymentOrderCount: number;
      paidOrderCount: number;
      estimatedRefundCents: number;
    };
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [postponeForm] = Form.useForm();
  const [form] = Form.useForm();
  const areaId = Form.useWatch("serviceAreaId", form);
  useEffect(() => {
    if (!openReview) return;
    setReviewNow(Date.now());
    const timer = window.setInterval(() => setReviewNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [openReview]);
  const openExpired = !!openReview && Date.parse(openReview.cutoffAt) <= reviewNow;
  const campaignError = (error: unknown) => {
    if (error instanceof AdminApiError) {
      const texts: Record<string, string> = {
        CAMPAIGN_CLOSED: "截单时间已过，不能开售。请编辑草稿，将截单及后续时间调整后重新复核。",
        CAMPAIGN_NOT_DRAFT: "团期已不再是草稿，不能编辑或删除。请刷新查看当前状态。",
        CAMPAIGN_VERSION_CONFLICT: "团期已被其他操作修改，请刷新后重新编辑。",
        CAMPAIGN_TRANSPORT_CONFLICT: "计划发车时间晚于已登记运输的预计到达时间。请先在发货与运输中调整运输安排，再修改草稿。",
        CAMPAIGN_HAS_REFERENCES: "团期已有订单、批次或运输登记，不能删除；已登记运输的草稿编辑时须保留原区域和自提点。",
        DELIVERY_SITE_NOT_CONFIRMED: "固定自提点尚不可用，请编辑草稿选择可用区域和自提点后开售。",
      };
      if (error.code && texts[error.code]) return texts[error.code];
    }
    return mutationErrorText(error);
  };
  const editDraft = (campaign: Campaign) => {
    setOpenReview(null);
    setEditing(campaign);
    form.setFieldsValue({
      ...campaign,
      pickupPointId: campaign.deliveryPlan?.pickupPointId,
      cutoffAt: dayjs(campaign.cutoffAt), dispatchAt: dayjs(campaign.dispatchAt),
      estimatedArrivalStartAt: dayjs(campaign.estimatedArrivalStartAt),
      estimatedArrivalEndAt: dayjs(campaign.estimatedArrivalEndAt),
      items: campaign.items.map(item => ({catalogSkuId:item.skuId,retailPriceYuan:(item.unitPriceCents/100).toFixed(2),sellableQuantity:item.stock})),
    });
    setOpen(true);
  };
  const removeDraft = async () => {
    if (!deleteReview || submitting) return;
    setSubmitting(true);
    try {
      await api.deleteCampaign(deleteReview.id, deleteReview.version);
      setDeleteReview(null);
      await refreshAfterMutation(reload, message, "草稿团期已删除");
    } catch(error) { void message.error(campaignError(error)); }
    finally { setSubmitting(false); }
  };
  const create = async () => {
    if (!createReview) return;
    setSubmitting(true);
    try {
      const { items, ...campaign } = createReview;
      const body = {
        ...campaign,
        cutoffAt: campaign.cutoffAt.toISOString(),
        dispatchAt: campaign.dispatchAt.toISOString(),
        estimatedArrivalStartAt:
          campaign.estimatedArrivalStartAt.toISOString(),
        estimatedArrivalEndAt: campaign.estimatedArrivalEndAt.toISOString(),
        items: items.map(({ retailPriceYuan, ...item }) => ({
          ...item,
          retailPriceCents: yuanToCents(retailPriceYuan),
        })),
      };
      if (editing) await api.updateCampaign(editing.id, {...body,version:editing.version});
      else await api.createCampaign(body);
      setOpen(false);
      setCreateReview(null);
      form.resetFields();
      await refreshAfterMutation(reload, message, editing ? "草稿已更新，开售前请再次复核" : "团期已创建，开售前请再次复核");
    } catch (error) {
      // Keep the draft/review open so the operator can fix the exact field
      // rejected by the API instead of losing all entered values.
      void message.error(campaignError(error));
    } finally {
      setSubmitting(false);
    }
  };
  const action = async (id: string, name: "open" | "close" | "cancel") => {
    if (submitting) return;
    if (name === "cancel") {
      const campaign = values.find((value) => value.id === id);
      if (!campaign) return;
      try {
        setCancelReview({
          campaign,
          impact: await api.campaignCancelImpact(id),
        });
        setCancelReason("");
      } catch (error) {
        void message.error(campaignError(error));
      }
      return;
    }
    if (name === "close") {
      const campaign = values.find((value) => value.id === id);
      if (campaign) setCloseReview(campaign);
      return;
    }
    if (name === "open") {
      const campaign = values.find(value => value.id === id);
      if (campaign && Date.parse(campaign.cutoffAt) <= Date.now()) {
        void message.error("截单时间已过，请编辑草稿调整时间后再开售");
        setReviewNow(Date.now());
        return;
      }
    }
    try {
      setSubmitting(true);
      await api.campaignAction(id, name);
      await refreshAfterMutation(reload, message, name === "open" ? "团期已开售" : "团期操作已完成");
      if (name === "open") setOpenReview(null);
    } catch (error) {
      void message.error(campaignError(error));
    } finally {
      setSubmitting(false);
    }
  };
  const confirmClose = async () => {
    if (!closeReview) return;
    setSubmitting(true);
    try {
      const result = await api.campaignAction(closeReview.id, "close", {
        reason: "运营后台手动截单",
      });
      setCloseReview(null);
      const successText =
        result.status === "LOCKED"
          ? "已截单并成团，已付款订单进入履约"
          : result.status === "POSTPONED"
            ? "本次未成团，团期已顺延一次"
            : result.status === "CANCELLED"
              ? "本次未成团，团期已取消并进入退款处理"
              : "团期截单结果已更新";
      await refreshAfterMutation(reload, message, successText);
    } catch (error) {
      void message.error(campaignError(error));
    } finally {
      setSubmitting(false);
    }
  };
  const confirmCancel = async () => {
    if (!cancelReview || cancelReason.trim().length < 2) return;
    setSubmitting(true);
    try {
      await api.campaignAction(cancelReview.campaign.id, "cancel", {
        reason: cancelReason.trim(),
      });
      setCancelReview(null);
      await refreshAfterMutation(reload, message, "团期已取消，待付款订单已释放，已付款订单已进入退款义务");
    } catch (error) {
      void message.error(mutationErrorText(error));
    } finally {
      setSubmitting(false);
    }
  };
  const postpone = async (value: {
    cutoffAt: dayjs.Dayjs;
    dispatchAt: dayjs.Dayjs;
    estimatedArrivalStartAt: dayjs.Dayjs;
    estimatedArrivalEndAt: dayjs.Dayjs;
  }) => {
    if (!postponeCampaign) return;
    setSubmitting(true);
    try {
      await api.postponeCampaign(postponeCampaign.id, {
        cutoffAt: value.cutoffAt.toISOString(),
        dispatchAt: value.dispatchAt.toISOString(),
        estimatedArrivalStartAt: value.estimatedArrivalStartAt.toISOString(),
        estimatedArrivalEndAt: value.estimatedArrivalEndAt.toISOString(),
      });
      setPostponeCampaign(null);
      postponeForm.resetFields();
      await refreshAfterMutation(reload, message, "团期已顺延并重新进入开售；通知已进入既有队列");
    } catch (caught) {
      void message.error(mutationErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  };
  const openLabels = async (campaign: Campaign) => {
    setLabelCampaign(campaign);
    setLabels([]);
    setLabelsError(null);
    setLabelsLoading(true);
    try {
      setLabels(await api.packingLabels(campaign.id));
    } catch (caught) {
      setLabelsError(
        mutationErrorText(caught),
      );
    } finally {
      setLabelsLoading(false);
    }
  };
  const labelsText = () =>
    labels
      .map((label, index) =>
        [
          `标签 ${index + 1}`,
          `订单号：${label.orderNo}`,
          `自提点：${label.pickupPointName ?? label.pickupPointId}`,
          ...label.items.map((item) => `${item.name} × ${item.quantity}`),
        ].join("\n"),
      )
      .join("\n\n");
  const exportLabels = () => {
    const blob = new Blob([labelsText()], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${labelCampaign?.title ?? "community"}-packing-labels.txt`;
    anchor.click();
    URL.revokeObjectURL(href);
  };
  const printLabels = () => {
    const popup = window.open("", "_blank");
    if (!popup) {
      void message.error("浏览器阻止了打印窗口，请允许弹出窗口后重试");
      return;
    }
    popup.document.write(
      `<pre style="font:16px/1.6 sans-serif;white-space:pre-wrap">${labelsText().replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre>`,
    );
    popup.document.close();
    popup.focus();
    popup.print();
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
            onClick={() => {
              const area =
                areas.find(
                  (value) => value.orderEnabled && value.regionCode === "000000",
                ) ?? areas.find((value) => value.orderEnabled);
              const point = area
                ? (points.find(
                    (value) =>
                      value.status === "ACTIVE" &&
                      value.serviceAreaId === area.id &&
                      value.id === "point-national-default",
                  ) ??
                  points.find(
                    (value) =>
                      value.status === "ACTIVE" &&
                      value.serviceAreaId === area.id,
                  ))
                : undefined;
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({
                serviceAreaId: area?.id,
                pickupPointId: point?.id,
              });
              setOpen(true);
            }}
          >
            创建团期
          </Button>
        }
      />
      <Modal open={!!deleteReview} title="删除草稿团期" okText="确认删除" okButtonProps={{danger:true}} confirmLoading={submitting} onOk={() => void removeDraft()} onCancel={() => setDeleteReview(null)}>
        <p>确认删除“{deleteReview?.title}”？仅允许删除没有订单或运输履约记录的草稿，同时移除其自动生成的配送计划。删除后不能恢复，审计记录保留。</p>
      </Modal>
      <ListFilters label="团期" query={query} onQuery={setQuery} status={filterStatus} onStatus={setFilterStatus} statuses={["DRAFT","OPEN","CLOSING","LOCKED","FULFILLING","POSTPONED","COMPLETED","CANCELLED"].map(value=>({value,label:displayLabel(value)}))} />
      <Table
        rowKey="id"
        dataSource={newestFirst(values).filter(v => (filterStatus === "ALL" || v.status === filterStatus) && matchesKeyword(query,...[v.title,v.deliveryPlan?.siteName]))}
        locale={{ emptyText: "暂无团期，请先配置商品、区域和自提点" }}
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
            render: (_, v) => dateTime(v.cutoffAt),
          },
          {
            title: "预计到货",
            render: (_, v) =>
              `${dateTime(v.estimatedArrivalStartAt)} 至 ${dateTime(v.estimatedArrivalEndAt)}`,
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
                {v.status === "DRAFT" && <>
                  <Button disabled={submitting} onClick={() => editDraft(v)}>编辑</Button>
                  <Button danger disabled={submitting} onClick={() => setDeleteReview(v)}>删除</Button>
                </>}
                {v.status === "DRAFT" && (
                  <Button loading={submitting} disabled={submitting} onClick={() => setOpenReview(v)}>
                    开售
                  </Button>
                )}
                {v.status === "OPEN" && (
                  <Button loading={submitting} disabled={submitting} onClick={() => void action(v.id, "close")}>
                    截单
                  </Button>
                )}
                {v.status === "POSTPONED" && (
                  <Button
                    type="primary"
                    disabled={submitting}
                    onClick={() => {
                      setPostponeCampaign(v);
                      postponeForm.setFieldsValue({
                        cutoffAt: dayjs(v.cutoffAt),
                        dispatchAt: dayjs(v.dispatchAt),
                        estimatedArrivalStartAt: dayjs(v.estimatedArrivalStartAt),
                        estimatedArrivalEndAt: dayjs(v.estimatedArrivalEndAt),
                      });
                    }}
                  >
                    顺延团期
                  </Button>
                )}
                {["DRAFT", "OPEN", "POSTPONED"].includes(v.status) && (
                  <Button danger loading={submitting} disabled={submitting} onClick={() => void action(v.id, "cancel")}>
                    取消
                  </Button>
                )}
                {["LOCKED", "FULFILLING", "COMPLETED"].includes(v.status) && (
                  <Button onClick={() => void openLabels(v)}>
                    生成装袋标签
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
        title={editing ? "编辑草稿团期" : "创建社区团期"}
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
          onFinish={(v: CampaignDraftValues) => setCreateReview(v)}
        >
          {editing?.deliveryPlan?.status === "VEHICLE_BOOKED" && <Alert style={{marginBottom:16}} type="info" message="已登记运输：保留原区域、自提点及车辆信息。修改发车时间不得晚于已登记的预计到达时间。" />}
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
                disabled={editing?.deliveryPlan?.status === "VEHICLE_BOOKED"}
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
                disabled={editing?.deliveryPlan?.status === "VEHICLE_BOOKED"}
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
              dependencies={["cutoffAt"]}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator: (_, value: dayjs.Dayjs | undefined) => {
                    const cutoffAt = getFieldValue("cutoffAt") as
                      | dayjs.Dayjs
                      | undefined;
                    const error = campaignScheduleError("dispatchAt", value, {
                      cutoffAt,
                    });
                    return error
                      ? Promise.reject(new Error(error))
                      : Promise.resolve();
                  },
                }),
              ]}
            >
              <DatePicker showTime />
            </Form.Item>
          </div>
          <div className="form-grid">
            <Form.Item
              name="estimatedArrivalStartAt"
              label="预计到货开始"
              dependencies={["dispatchAt"]}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator: (_, value: dayjs.Dayjs | undefined) => {
                    const dispatchAt = getFieldValue("dispatchAt") as
                      | dayjs.Dayjs
                      | undefined;
                    const error = campaignScheduleError(
                      "estimatedArrivalStartAt",
                      value,
                      { dispatchAt },
                    );
                    return error
                      ? Promise.reject(new Error(error))
                      : Promise.resolve();
                  },
                }),
              ]}
            >
              <DatePicker showTime />
            </Form.Item>
            <Form.Item
              name="estimatedArrivalEndAt"
              label="预计到货结束"
              dependencies={["estimatedArrivalStartAt"]}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator: (_, value: dayjs.Dayjs | undefined) => {
                    const startAt = getFieldValue(
                      "estimatedArrivalStartAt",
                    ) as dayjs.Dayjs | undefined;
                    const error = campaignScheduleError(
                      "estimatedArrivalEndAt",
                      value,
                      { estimatedArrivalStartAt: startAt },
                    );
                    return error
                      ? Promise.reject(new Error(error))
                      : Promise.resolve();
                  },
                }),
              ]}
            >
              <DatePicker showTime />
            </Form.Item>
          </div>
          <div className="form-grid">
            <Form.Item name="minTotalQuantity" label="最小成团件数">
              <InputNumber min={1} max={1_000_000} />
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
          <Typography.Paragraph type="secondary">
            选择商品后自动带入商品默认售价，本期可单独调整。
          </Typography.Paragraph>
          <Form.List name="items">
            {(fields, { add, remove }) => {
              const selectedSkuIds = (form.getFieldValue("items") ?? [])
                .map((item: { catalogSkuId?: string }) => item?.catalogSkuId)
                .filter((id: string | undefined): id is string => Boolean(id));
              return (
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
                            .filter(
                              (v) =>
                                v.status === "ACTIVE" &&
                                (v.id === form.getFieldValue(["items", field.name, "catalogSkuId"]) ||
                                  !selectedSkuIds.includes(v.id)),
                            )
                            .map((v) => ({
                              value: v.id,
                              label: `${v.product.title} · ${v.name} · 产地：${v.product.origin}`,
                            }))}
                          onChange={(catalogSkuId: string) => {
                            const sku = skus.find((value) => value.id === catalogSkuId);
                            if (!sku) return;
                            form.setFieldValue(
                              ["items", field.name, "retailPriceYuan"],
                              centsToYuan(sku.retailPriceCents),
                            );
                            form.setFieldValue(
                              ["items", field.name, "sellableQuantity"],
                              sku.defaultSellableQuantity,
                            );
                          }}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "retailPriceYuan"]}
                        label="本团售价（元）"
                        rules={[priceRule]}
                      >
                        <Input
                          inputMode="decimal"
                          placeholder="例如 19.90"
                          autoComplete="off"
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "sellableQuantity"]}
                        label="可售量"
                        rules={[
                          { required: true },
                          { type: "number", min: 1, message: "可售量至少 1" },
                        ]}
                      >
                        <InputNumber min={1} max={1_000_000} />
                      </Form.Item>
                      <Form.Item label={<span aria-hidden="true">&nbsp;</span>} colon={false}>
                        <Button danger onClick={() => remove(field.name)}>
                          移除
                        </Button>
                      </Form.Item>
                    </Space>
                  </Card>
                ))}
                <Button onClick={() => add()}>添加商品</Button>
              </>
              );
            }}
          </Form.List>
          <div style={{ marginTop: 24 }}>
            <Button type="primary" htmlType="submit">
              下一步：发布复核
            </Button>
          </div>
        </Form>
      </Modal>
      <Modal
        open={Boolean(postponeCampaign)}
        title="顺延团期"
        footer={null}
        destroyOnHidden
        onCancel={() => !submitting && setPostponeCampaign(null)}
      >
        <Alert
          type="info"
          showIcon
          message="请填写新的完整时间窗口"
          description="所有时间必须晚于当前时间，并满足截单早于发车、预计到货不早于发车。"
          style={{ marginBottom: 16 }}
        />
        <Form form={postponeForm} layout="vertical" onFinish={(value) => void postpone(value)}>
          <div className="form-grid">
            <Form.Item
              name="cutoffAt"
              label="新截单时间"
              rules={[{ required: true, message: "请选择新的截单时间" }]}
            >
              <DatePicker showTime disabled={submitting} />
            </Form.Item>
            <Form.Item
              name="dispatchAt"
              label="新发车时间"
              dependencies={["cutoffAt"]}
              rules={[
                { required: true, message: "请选择新的发车时间" },
                ({ getFieldValue }) => ({
                  validator: (_, value: dayjs.Dayjs | undefined) => {
                    const cutoffAt = getFieldValue("cutoffAt") as dayjs.Dayjs | undefined;
                    return !value || !cutoffAt || value.isAfter(cutoffAt)
                      ? Promise.resolve()
                      : Promise.reject(new Error("发车时间必须晚于截单时间"));
                  },
                }),
              ]}
            >
              <DatePicker showTime disabled={submitting} />
            </Form.Item>
          </div>
          <div className="form-grid">
            <Form.Item
              name="estimatedArrivalStartAt"
              label="新预计到货开始"
              dependencies={["dispatchAt"]}
              rules={[
                { required: true, message: "请选择预计到货开始" },
                ({ getFieldValue }) => ({
                  validator: (_, value: dayjs.Dayjs | undefined) => {
                    const dispatchAt = getFieldValue("dispatchAt") as dayjs.Dayjs | undefined;
                    return !value || !dispatchAt || !value.isBefore(dispatchAt)
                      ? Promise.resolve()
                      : Promise.reject(new Error("预计到货不能早于发车"));
                  },
                }),
              ]}
            >
              <DatePicker showTime disabled={submitting} />
            </Form.Item>
            <Form.Item
              name="estimatedArrivalEndAt"
              label="新预计到货结束"
              dependencies={["estimatedArrivalStartAt"]}
              rules={[
                { required: true, message: "请选择预计到货结束" },
                ({ getFieldValue }) => ({
                  validator: (_, value: dayjs.Dayjs | undefined) => {
                    const start = getFieldValue("estimatedArrivalStartAt") as dayjs.Dayjs | undefined;
                    return !value || !start || !value.isBefore(start)
                      ? Promise.resolve()
                      : Promise.reject(new Error("预计到货结束不能早于开始"));
                  },
                }),
              ]}
            >
              <DatePicker showTime disabled={submitting} />
            </Form.Item>
          </div>
          <Button type="primary" htmlType="submit" loading={submitting}>
            确认顺延
          </Button>
        </Form>
      </Modal>
      <Modal
        width={760}
        open={!!createReview}
        title={editing ? "保存草稿前复核" : "创建前发布复核"}
        okText={editing ? "确认保存草稿" : "确认创建团期"}
        cancelText="返回修改"
        confirmLoading={submitting}
        onOk={() => void create()}
        onCancel={() => setCreateReview(null)}
      >
        {createReview && (
          <CampaignReview
            title={createReview.title}
            point={points.find((v) => v.id === createReview.pickupPointId)}
            cutoffAt={createReview.cutoffAt}
            dispatchAt={createReview.dispatchAt}
            estimatedArrivalStartAt={createReview.estimatedArrivalStartAt}
            estimatedArrivalEndAt={createReview.estimatedArrivalEndAt}
            minTotalQuantity={createReview.minTotalQuantity}
            failureAction={failureActionText(createReview.failureAction)}
            items={createReview.items.map((item) => ({
              id: item.catalogSkuId,
              title:
                skus.find((v) => v.id === item.catalogSkuId)
                  ? `${skus.find((v) => v.id === item.catalogSkuId)!.product.title} · ${skus.find((v) => v.id === item.catalogSkuId)!.name} · 产地：${skus.find((v) => v.id === item.catalogSkuId)!.product.origin}`
                  : item.catalogSkuId,
              price: money(yuanToCents(item.retailPriceYuan)),
              sellableQuantity: item.sellableQuantity,
            }))}
          />
        )}
      </Modal>
      <Modal
        width={760}
        open={!!openReview}
        title="开售前二次确认"
        confirmLoading={submitting}
        okButtonProps={{disabled: openExpired || submitting}}
        okText="已复核，确认开售"
        cancelText="暂不开售"
        onOk={() => openReview && void action(openReview.id, "open")}
        onCancel={() => setOpenReview(null)}
      >
        {openReview && <Alert style={{marginBottom:16}} type={openExpired ? "error" : "info"}
          message={openExpired ? "截单时间已过，不能开售" : "请确认时间与商品信息后开售"}
          description={openExpired ? "请编辑草稿，调整截单、发车及到货时间后重新复核。" : "开售后商品价格与固定自提点将锁定。"}
          action={<Button onClick={() => editDraft(openReview)}>编辑草稿</Button>} />}
        {openReview && (
          <CampaignReview
            title={openReview.title}
            point={points.find(
              (v) => v.id === openReview.deliveryPlan?.pickupPointId,
            )}
            cutoffAt={openReview.cutoffAt}
            dispatchAt={openReview.dispatchAt}
            estimatedArrivalStartAt={openReview.estimatedArrivalStartAt}
            estimatedArrivalEndAt={openReview.estimatedArrivalEndAt}
            minTotalQuantity={openReview.minTotalQuantity}
            failureAction={failureActionText(openReview.failureAction)}
            items={openReview.items.map((item) => ({
              id: item.skuId,
              title: `${item.title} · ${item.skuName} · 产地：${item.origin ?? "—"}`,
              price: money(item.unitPriceCents),
              sellableQuantity: item.stock,
            }))}
          />
        )}
      </Modal>
      <Modal
        width={720}
        open={!!labelCampaign}
        title={labelCampaign ? `${labelCampaign.title} · 装袋标签` : "装袋标签"}
        onCancel={() => setLabelCampaign(null)}
        footer={
          <Space>
            <Button
              onClick={() => labelCampaign && void openLabels(labelCampaign)}
              loading={labelsLoading}
            >
              重试加载
            </Button>
            <Button disabled={!labels.length} onClick={printLabels}>
              打印标签
            </Button>
            <Button type="primary" disabled={!labels.length} onClick={exportLabels}>
              导出标签
            </Button>
          </Space>
        }
      >
        {labelsLoading ? (
          <Card loading />
        ) : labelsError ? (
          <Alert
            type="error"
            showIcon
            message="装袋标签加载失败"
            description={labelsError}
            action={
              <Button
                size="small"
                onClick={() => labelCampaign && void openLabels(labelCampaign)}
              >
                重试
              </Button>
            }
          />
        ) : labels.length === 0 ? (
          <Empty description="该已截单团期暂无合格已付款订单，无需生成装袋标签" />
        ) : (
          <Table
            rowKey="orderId"
            pagination={false}
            dataSource={labels}
            columns={[
              { title: "订单号", dataIndex: "orderNo" },
              {
                title: "自提点",
                render: (_, label) => label.pickupPointName ?? label.pickupPointId,
              },
              {
                title: "逐商品",
                render: (_, label) =>
                  label.items.map((item) => `${item.name} × ${item.quantity}`).join("；"),
              },
            ]}
          />
        )}
      </Modal>
      <Modal
        open={!!closeReview}
        title="确认立即截单"
        okText="立即截单"
        cancelText="返回"
        confirmLoading={submitting}
        onOk={() => void confirmClose()}
        onCancel={() => !submitting && setCloseReview(null)}
        destroyOnHidden
      >
        {closeReview && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              type="warning"
              showIcon
              message={`${closeReview.title} 将立即停止收单`}
              description={
                (closeReview.paidQuantity ?? closeReview.items.reduce((sum, item) => sum + (item.paidQuantity ?? 0), 0)) < closeReview.minTotalQuantity
                  ? `当前未达到 ${closeReview.minTotalQuantity} 件成团门槛；截单后将按“${closeReview.failureAction === "POSTPONE" && (closeReview.postponementCount ?? 0) < 1 ? "顺延一次" : "取消并退款"}”处理。`
                  : "已达到成团门槛；截单后待付款订单将关闭，已付款订单进入履约。"
              }
            />
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="原计划截单">
                {dateTime(closeReview.cutoffAt)}
              </Descriptions.Item>
              <Descriptions.Item label="当前成团进度">
                已支付 {closeReview.paidQuantity ?? closeReview.items.reduce((sum, item) => sum + (item.paidQuantity ?? 0), 0)} / {closeReview.minTotalQuantity} 件
              </Descriptions.Item>
              <Descriptions.Item label="预计到货">
                {dateTime(closeReview.estimatedArrivalStartAt)} 至 {dateTime(closeReview.estimatedArrivalEndAt)}
              </Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </Modal>
      <Modal
        open={!!cancelReview}
        title="取消团期前二次确认"
        okText="确认取消并创建退款义务"
        cancelText="返回"
        confirmLoading={submitting}
        okButtonProps={{ danger: true, disabled: cancelReason.trim().length < 2 }}
        onOk={() => void confirmCancel()}
        onCancel={() => {
          if (!submitting) {
            setCancelReview(null);
            setCancelReason("");
          }
        }}
        destroyOnHidden
      >
        {cancelReview && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              type="error"
              showIcon
              message="取消后不可重新开售"
              description="待付款订单会释放库存；已付款订单会创建唯一、可恢复的退款义务，并按既有通知队列处理。"
            />
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="待付款订单">
                {cancelReview.impact.pendingPaymentOrderCount} 单
              </Descriptions.Item>
              <Descriptions.Item label="已付款订单">
                {cancelReview.impact.paidOrderCount} 单
              </Descriptions.Item>
              <Descriptions.Item label="预计退款金额">
                {money(cancelReview.impact.estimatedRefundCents)}
              </Descriptions.Item>
            </Descriptions>
            <Input.TextArea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="请填写取消原因（至少 2 个字符）"
              rows={3}
              disabled={submitting}
              aria-label="取消原因"
            />
          </Space>
        )}
      </Modal>
    </>
  );
}

function CampaignReview({
  title,
  point,
  cutoffAt,
  dispatchAt,
  estimatedArrivalStartAt,
  estimatedArrivalEndAt,
  minTotalQuantity,
  failureAction,
  items,
}: {
  title: string;
  point: PickupPoint | undefined;
  cutoffAt: string | dayjs.Dayjs;
  dispatchAt: string | dayjs.Dayjs;
  estimatedArrivalStartAt: string | dayjs.Dayjs;
  estimatedArrivalEndAt: string | dayjs.Dayjs;
  minTotalQuantity: number;
  failureAction: string;
  items: Array<{
    id: string;
    title: string;
    price: string;
    sellableQuantity: number;
  }>;
}) {
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="warning"
        showIcon
        message="开售后不可修改"
        description="固定自提点、截单时间、预计到货窗口、商品及售价、可售量、成团门槛和未成团处理将被锁定。"
      />
      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label="团期">{title}</Descriptions.Item>
        <Descriptions.Item label="固定自提点">
          {point ? `${point.name}（${point.address}）` : "未找到自提点"}
        </Descriptions.Item>
        <Descriptions.Item label="截单时间">
          {dateTime(cutoffAt)}
        </Descriptions.Item>
        <Descriptions.Item label="计划发车时间">
          {dateTime(dispatchAt)}
        </Descriptions.Item>
        <Descriptions.Item label="预计到货窗口">
          {dateTime(estimatedArrivalStartAt)} 至 {dateTime(estimatedArrivalEndAt)}
        </Descriptions.Item>
        <Descriptions.Item label="最小成团件数">
          {minTotalQuantity} 件
        </Descriptions.Item>
        <Descriptions.Item label="未成团处理">
          {failureAction}
        </Descriptions.Item>
      </Descriptions>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={items}
        columns={[
          { title: "商品", dataIndex: "title" },
          { title: "售价", dataIndex: "price" },
          { title: "可售量", dataIndex: "sellableQuantity" },
        ]}
      />
    </Space>
  );
}

function Orders({
  values,
  campaigns,
  roles,
  reload,
  onNavigate,
}: {
  values: Order[];
  campaigns: Campaign[];
  roles: string[];
  reload: () => Promise<void>;
  onNavigate: (page: AdminPage) => void;
}) {
  const { message } = AntApp.useApp();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [displayValues, setDisplayValues] = useState(values);
  useEffect(() => setDisplayValues(values), [values]);
  const search = async () => {
    setSearching(true);
    try {
      const result = await api.orders(query.trim());
      setDisplayValues(result);
      // The parent reload remains the source of truth for all other page
      // resources; update the selected detail immediately from the exact
      // order-number lookup and then refresh the list generation.
      setSelected((current) =>
        current ? result.find((value) => value.id === current.id) ?? null : current,
      );
      if (!query.trim()) await reload();
      void message.success(query.trim() ? "订单搜索完成" : "订单列表已刷新");
    } catch (error) {
      void message.error(mutationErrorText(error));
    } finally {
      setSearching(false);
    }
  };
  const detailCampaign = selected
    ? campaigns.find((campaign) => campaign.id === selected.campaignId)
    : undefined;
  const casePage = isAllowedAdminPage(roles, "service") ? "service" : "finance";
  return (
    <>
      <PageTitle
        title="订单列表"
        subtitle="查看订单的支付、履约、领取、退款与售后进度"
        action={
          <Space>
            <Input.Search
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onSearch={() => void search()}
              allowClear
              enterButton="搜索订单号"
              loading={searching}
              placeholder="输入完整订单号"
              aria-label="订单号搜索"
            />
            <Button onClick={() => void search()} loading={searching}>
              刷新
            </Button>
          </Space>
        }
      />
      <Table
        rowKey="id"
        dataSource={displayValues}
        locale={{ emptyText: query.trim() ? "未找到匹配订单，请检查完整订单号" : "暂无订单" }}
        columns={[
          { title: "订单号", dataIndex: "orderNo" },
          { title: "实付金额", render: (_, v) => money(v.totalCents) },
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
          { title: "订单状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, v) => (
              <Button onClick={() => setSelected(v)}>查看详情</Button>
            ),
          },
        ]}
      />
      <Modal
        width={900}
        open={!!selected}
        title={selected ? `订单详情 · ${selected.orderNo}` : "订单详情"}
        footer={null}
        onCancel={() => setSelected(null)}
        destroyOnHidden
      >
        {selected && (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="订单号">{selected.orderNo}</Descriptions.Item>
              <Descriptions.Item label="订单状态"><Status value={selected.status} /></Descriptions.Item>
              <Descriptions.Item label="团期">
                {selected.campaignTitle ?? detailCampaign?.title ?? selected.campaignId}
              </Descriptions.Item>
              <Descriptions.Item label="固定自提点">
                {selected.pickupPointName ?? selected.deliveryPlan?.siteName ?? selected.pickupPointId}
              </Descriptions.Item>
              <Descriptions.Item label="支付状态">
                {selected.paidAt ? `已支付（${dateTime(selected.paidAt)}）` : "待支付"}
              </Descriptions.Item>
              <Descriptions.Item label="支付截止">
                {selected.expiresAt ? dateTime(selected.expiresAt) : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="实付金额">{money(selected.totalCents)}</Descriptions.Item>
              <Descriptions.Item label="领取进度">
                {selected.items.reduce((sum, item) => sum + item.pickedUpQuantity, 0)} /
                {selected.items.reduce((sum, item) => sum + item.fulfilledQuantity, 0)} 件
              </Descriptions.Item>
              <Descriptions.Item label="配送状态">
                {selected.deliveryPlan ? displayLabel(selected.deliveryPlan.status) : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="领取截止">
                {selected.pickupDeadlineAt ? dateTime(selected.pickupDeadlineAt) : "—"}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5}>商品与规格快照</Typography.Title>
            <Table
              rowKey={(item) => `${item.skuId ?? item.name}-${item.quantity}`}
              size="small"
              pagination={false}
              dataSource={selected.items}
              columns={[
                { title: "商品", render: (_, item) => item.productTitle ?? item.name },
                { title: "规格", render: (_, item) => item.skuName ?? item.name },
                { title: "数量", dataIndex: "quantity" },
                { title: "单价", render: (_, item) => money(item.unitPriceCents ?? 0) },
                { title: "小计", render: (_, item) => money(item.amountCents ?? 0) },
                { title: "已履约", dataIndex: "fulfilledQuantity" },
                { title: "已领取", dataIndex: "pickedUpQuantity" },
                { title: "已退款", dataIndex: "refundedQuantity" },
              ]}
            />
            <Typography.Title level={5}>退款与售后记录</Typography.Title>
            {(selected.partialRefunds?.length ?? 0) === 0 &&
            !selected.cancellation &&
            (selected.communityQualityCases?.length ?? 0) === 0 &&
            (selected.fulfillmentExceptions?.length ?? 0) === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无退款或售后记录" />
            ) : (
              <Space direction="vertical" style={{ width: "100%" }}>
                {selected.cancellation && (
                  <Alert
                    type="info"
                    message={`取消申请：${displayLabel(selected.cancellation.status)}`}
                    description={`${selected.cancellation.reason}${selected.cancellation.refundId ? ` · 退款单 ${selected.cancellation.refundId}` : ""}`}
                    action={
                      <Button type="link" onClick={() => onNavigate(isAllowedAdminPage(roles, "cancellations") ? "cancellations" : "finance")}>
                        查看取消队列
                      </Button>
                    }
                  />
                )}
                {selected.partialRefunds?.map((refund) => (
                  <Alert
                    key={refund.id}
                    type={refund.status === "SUCCEEDED" ? "success" : "warning"}
                    message={`部分退款 ${money(refund.amountCents)} · ${displayLabel(refund.status)}`}
                    description={`关联异常 ${refund.exceptionId}`}
                    action={isAllowedAdminPage(roles, "finance-records") &&
                      <Button type="link" onClick={() => onNavigate("finance-records")}>
                        查看财务记录
                      </Button>
                    }
                  />
                ))}
                {selected.communityQualityCases?.map((qualityCase) => (
                  <Alert
                    key={qualityCase.id}
                    type="info"
                    message={`品质售后 ${displayLabel(qualityCase.status)}`}
                    description={qualityCase.items.map((item) => `${item.name} × ${item.quantity}：${item.description}`).join("；")}
                    action={
                      <Button type="link" onClick={() => onNavigate(casePage)}>
                        查看品质队列
                      </Button>
                    }
                  />
                ))}
                {selected.fulfillmentExceptions?.map((exception) => (
                  <Alert
                    key={exception.id}
                    type="warning"
                    message={`履约异常 · ${displayLabel(exception.status)}`}
                    description={`${exception.sourceStage} · ${exception.responsibility}${exception.resolutionNote ? ` · ${exception.resolutionNote}` : ""}`}
                    action={
                      <Button type="link" onClick={() => onNavigate(casePage)}>
                        查看异常队列
                      </Button>
                    }
                  />
                ))}
              </Space>
            )}
          </Space>
        )}
      </Modal>
    </>
  );
}

type ArrivalFormValues = {
  receivedBy: string;
  confirmationNote?: string;
  emergencyReason?: string;
  items: Array<{
    catalogSkuId: string;
    expectedQuantity: number;
    receivedQuantity: number;
    rejectedQuantity: number;
    shortQuantity: number;
    damagedQuantity: number;
    evidenceNote?: string;
  }>;
};

/** The normal point-manager payload deliberately omits emergencyReason. */
export function buildCommunityArrivalRequest(
  value: ArrivalFormValues,
  emergencyReason?: string,
): CommunityArrivalRequest {
  const items = value.items.map((item) => {
    const abnormal =
      item.rejectedQuantity + item.shortQuantity + item.damagedQuantity;
    if (item.receivedQuantity + abnormal !== item.expectedQuantity)
      throw new Error("数量之和必须等于应到数量（每个商品分别核对实到、拒收、短少和破损）");
    if (abnormal > 0 && !item.evidenceNote?.trim())
      throw new Error("存在短少、破损或拒收时必须填写差异说明");
    return {
      catalogSkuId: item.catalogSkuId,
      receivedQuantity: item.receivedQuantity,
      rejectedQuantity: item.rejectedQuantity,
      shortQuantity: item.shortQuantity,
      damagedQuantity: item.damagedQuantity,
      reason:
        item.rejectedQuantity > 0
          ? "PICKUP_POINT_REJECTED" as const
          : item.shortQuantity > 0
            ? "SHORT_RECEIPT" as const
            : item.damagedQuantity > 0
              ? "TRANSIT_DAMAGE" as const
              : null,
      evidenceNote: abnormal > 0 ? item.evidenceNote?.trim() || null : null,
    };
  });
  const request: CommunityArrivalRequest = {
    receivedBy: value.receivedBy.trim(),
    confirmationNote: value.confirmationNote?.trim() || null,
    items,
  };
  return emergencyReason?.trim()
    ? { ...request, emergencyReason: emergencyReason.trim() }
    : request;
}

function ArrivalConfirmationModal({
  arrival,
  emergencyProxy,
  onClose,
  onConfirmed,
  onSuccess,
}: {
  arrival: CommunityDelivery | null;
  emergencyProxy: boolean;
  onClose: () => void;
  onConfirmed: () => Promise<void>;
  onSuccess?: () => void;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<ArrivalFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    form.resetFields();
    if (arrival)
      form.setFieldsValue({
        items: arrival.expectedItems.map((item) => ({
          catalogSkuId: item.catalogSkuId,
          expectedQuantity: item.expectedQuantity,
          receivedQuantity: item.expectedQuantity,
          rejectedQuantity: 0,
          shortQuantity: 0,
          damagedQuantity: 0,
        })),
      });
  }, [arrival, form]);
  const submit = async (value: ArrivalFormValues) => {
    if (!arrival?.dispatchBatchId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.confirmArrival(
        arrival.dispatchBatchId,
        buildCommunityArrivalRequest(
          value,
          emergencyProxy ? value.emergencyReason : undefined,
        ),
      );
      onClose();
      await onConfirmed();
      onSuccess?.();
    } catch (caught) {
      const detail = mutationErrorText(caught);
      setError(detail);
      void message.error(detail);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Modal
      width={760}
      open={!!arrival}
      title={emergencyProxy ? "紧急代办：逐商品确认到货" : "逐商品确认到货"}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
    >
      {emergencyProxy && (
        <Alert
          type="warning"
          showIcon
          message="紧急代办将写入审计记录，请填写原因。"
          style={{ marginBottom: 16 }}
        />
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 16 }}
        />
      )}
      <Form form={form} layout="vertical" onFinish={(value) => void submit(value)}>
        <Form.Item
          name="receivedBy"
          label="现场接收人"
          rules={[{ required: true, min: 2, message: "请填写现场接收人" }]}
        >
          <Input disabled={submitting} />
        </Form.Item>
        {emergencyProxy && (
          <Form.Item
            name="emergencyReason"
            label="紧急代办原因"
            rules={[{ required: true, min: 2, message: "紧急代办必须填写原因" }]}
          >
            <Input disabled={submitting} />
          </Form.Item>
        )}
        <Form.Item name="confirmationNote" label="现场备注">
          <Input disabled={submitting} />
        </Form.Item>
        <Form.List name="items">
          {(fields) =>
            fields.map((field, index) => (
              <Card key={field.key} size="small" style={{ marginBottom: 8 }}>
                <b>
                  {arrival?.expectedItems[index]?.title} · {arrival?.expectedItems[index]?.skuName}
                </b>
                <Form.Item name={[field.name, "catalogSkuId"]} hidden>
                  <Input />
                </Form.Item>
                <Form.Item name={[field.name, "expectedQuantity"]} hidden>
                  <InputNumber />
                </Form.Item>
                <Space wrap>
                  <Form.Item name={[field.name, "receivedQuantity"]} label="实到" rules={[{ required: true }]}>
                    <InputNumber min={0} disabled={submitting} />
                  </Form.Item>
                  <Form.Item name={[field.name, "rejectedQuantity"]} label="拒收" rules={[{ required: true }]}>
                    <InputNumber min={0} disabled={submitting} />
                  </Form.Item>
                  <Form.Item name={[field.name, "shortQuantity"]} label="短少" rules={[{ required: true }]}>
                    <InputNumber min={0} disabled={submitting} />
                  </Form.Item>
                  <Form.Item name={[field.name, "damagedQuantity"]} label="破损" rules={[{ required: true }]}>
                    <InputNumber min={0} disabled={submitting} />
                  </Form.Item>
                  <Form.Item name={[field.name, "evidenceNote"]} label="差异说明">
                    <Input disabled={submitting} />
                  </Form.Item>
                </Space>
              </Card>
            ))
          }
        </Form.List>
        <Button type="primary" htmlType="submit" loading={submitting} disabled={!arrival?.dispatchBatchId}>
          提交到货确认
        </Button>
      </Form>
    </Modal>
  );
}

function Logistics({
  view,
  plans,
  deliveries,
  batches,
  campaigns,
  roles,
  loading,
  error,
  reload,
  onNavigate,
}: {
  view: AdminPage;
  plans: DeliveryPlan[];
  deliveries: CommunityDelivery[];
  batches: Array<{ id: string; campaignId: string; status: string }>;
  campaigns: Campaign[];
  orders: Order[];
  roles: string[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  onNavigate: (page: AdminPage) => void;
}) {
  const { message } = AntApp.useApp();
  const [vehicle, setVehicle] = useState<DeliveryPlan | null>(null);
  const [vehicleEmergency, setVehicleEmergency] = useState(false);
  const [vehicleForm] = Form.useForm();
  const [arrival, setArrival] = useState<CommunityDelivery | null>(null);
  const [allocationSubmitting, setAllocationSubmitting] = useState(false);
  const [dispatchReview, setDispatchReview] = useState<DeliveryPlan | null>(
    null,
  );
  const [dispatchLabels, setDispatchLabels] = useState<PackingLabel[] | null>(null);
  const [dispatchLoadError, setDispatchLoadError] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [reviewReload, setReviewReload] = useState(0);
  const reviewCampaign = campaigns.find((value) => value.id === dispatchReview?.campaignId);
  const reviewBatch = batches.find((value) => value.campaignId === dispatchReview?.campaignId);
  const reviewBlock = dispatchReview ? dispatchBlockReason({
    ...(reviewCampaign ? { campaignStatus: reviewCampaign.status } : {}),
    planStatus: dispatchReview.status,
    ...(reviewBatch ? { batchStatus: reviewBatch.status } : {}),
  }) : null;
  useEffect(() => {
    let cancelled = false;
    setDispatchLabels(null);
    setDispatchLoadError(null);
    setDispatchError(null);
    if (dispatchReview && !reviewBlock) {
      void api.packingLabels(dispatchReview.campaignId).then((values) => {
        if (!cancelled) setDispatchLabels(values);
      }).catch((error: unknown) => {
        if (!cancelled) setDispatchLoadError(`无法核实本团待发货订单：${dispatchFailureText(error, mutationErrorText(error))}`);
      });
    }
    return () => { cancelled = true; };
  }, [dispatchReview, reviewBlock, reviewReload]);
  const dispatchQuantity = dispatchLabels?.flatMap((value) => value.items).reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const cannotDispatch = reviewBlock ?? dispatchLoadError ??
    (dispatchLabels === null ? "正在核实本团已付款待发货订单，请稍候" :
      dispatchLabels.length === 0 || dispatchQuantity === 0 ? "本团没有可发货的已付款订单，请先到订单管理核实付款与订单状态" : null);
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
  const [vehicleSubmitting, setVehicleSubmitting] = useState(false);
  const canOperate =
    roles.includes("OPERATOR") || roles.includes("SUPER_ADMIN");
  const emergencyProxy = roles.includes("SUPER_ADMIN");
  const viewState = getLogisticsViewState({
    loading,
    error,
    planCount: plans.length,
  });
  const openVehicle = (plan: DeliveryPlan, emergency = false) => {
    setVehicleEmergency(emergency);
    setVehicle(plan);
    vehicleForm.setFieldsValue({
      logisticsPlatform: plan.logisticsPlatform ?? undefined,
      vehicleOrderNo: plan.vehicleOrderNo ?? undefined,
      driverName: plan.driverName ?? undefined,
      driverPhone: plan.driverPhone ?? undefined,
      vehiclePlate: plan.vehiclePlate ?? undefined,
      estimatedArrivalAt: plan.estimatedArrivalAt
        ? dayjs(plan.estimatedArrivalAt)
        : undefined,
      reason: undefined,
    });
  };
  const dispatch = async () => {
    if (!dispatchReview || cannotDispatch || dispatchSubmitting) return;
    const campaignId = dispatchReview.campaignId;
    const existing = batches.find((value) => value.campaignId === campaignId);
    setDispatchSubmitting(true);
    setDispatchError(null);
    let createdBatch = existing;
    try {
      const batch = existing ?? (await api.createBatch(campaignId));
      createdBatch = batch;
      if (batch.status !== "DRAFT") {
        setDispatchError("该批次已不处于待发车状态，请刷新查看最新运输状态");
        return;
      }
      await api.dispatch(batch.id);
      setDispatchReview(null);
      await refreshAfterMutation(reload, message, "批次已发车");
    } catch (error) {
      const reason = dispatchFailureText(error, mutationErrorText(error));
      setDispatchError(createdBatch
        ? `发车未完成：${reason}。已创建的批次保留，可在条件满足后重试发车。`
        : `批次创建未确认：${reason}。请刷新核实后重试。`);
    } finally {
      setDispatchSubmitting(false);
    }
  };
  const saveVehicle = async (value: {
    logisticsPlatform: string;
    vehicleOrderNo: string;
    driverName?: string;
    driverPhone?: string;
    vehiclePlate?: string;
    estimatedArrivalAt?: dayjs.Dayjs;
    reason?: string;
  }) => {
    if (!vehicle || vehicleSubmitting) return;
    setVehicleSubmitting(true);
    try {
      const body = {
        logisticsPlatform: value.logisticsPlatform,
        vehicleOrderNo: value.vehicleOrderNo,
        driverName: value.driverName ?? null,
        driverPhone: value.driverPhone ?? null,
        vehiclePlate: value.vehiclePlate ?? null,
        estimatedArrivalAt: value.estimatedArrivalAt?.toISOString() ?? null,
      };
      if (vehicleEmergency)
        await api.correctVehicle(vehicle.id, {
          ...body,
          reason: value.reason?.trim() ?? "",
        });
      else await api.bookVehicle(vehicle.id, body);
      setVehicle(null);
      await refreshAfterMutation(reload, message, "运输信息已保存");
    } catch (error) {
      void message.error(mutationErrorText(error));
    } finally {
      setVehicleSubmitting(false);
    }
  };
  const confirmAllocation = async (communityDeliveryId: string) => {
    if (allocationSubmitting) return;
    setAllocationSubmitting(true);
    try {
      await api.confirmAllocation(communityDeliveryId);
      await refreshAfterMutation(reload, message, "到货异常范围已确认");
    } catch (error) {
      void message.error(mutationErrorText(error));
    } finally {
      setAllocationSubmitting(false);
    }
  };
  return (
    <>
      <PageTitle
        title={view === "arrival-exceptions" ? "到货异常处理" : "发货与运输"}
        subtitle="管理已成团订单的运输信息和发车进度；发车后由对应自提点确认到货"
      />
      {view !== "arrival-exceptions" && <>
      {viewState === "error" ? (
        <Alert
          type="error"
          showIcon
          message="发货数据加载失败"
          description={error}
          action={
            <Button aria-label="重试" onClick={() => void reload().catch(() => undefined)}>
              重试
            </Button>
          }
        />
      ) : viewState === "empty" ? (
        <Card title="发货任务">
          <Empty description="暂无可发货团期，请先创建商品和团期">
            <Typography.Paragraph type="secondary">
              创建团期并绑定自提点后，运营可在此登记运输信息；登记后仍可在发车前编辑。
            </Typography.Paragraph>
            <Button type="primary" onClick={() => onNavigate("campaigns")}>
              去创建团期
            </Button>
          </Empty>
        </Card>
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={newestFirst(plans)}
          columns={[
          {
            title: "团期与车辆",
            render: (_, v) => (
              <Space direction="vertical" size={2}>
                <Typography.Text strong>
                  {campaigns.find((c) => c.id === v.campaignId)?.title ?? v.campaignId}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {v.vehicleOrderNo ? `运输单 ${v.vehicleOrderNo}` : "运输信息未登记"}
                </Typography.Text>
              </Space>
            ),
          },
          { title: "履约状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "下一步",
            render: (_, v) => {
              const batch = batches.find((value) => value.campaignId === v.campaignId);
              return getDeliveryNextStep({
                status: v.status,
                ...(batch ? { batchStatus: batch.status } : {}),
              });
            },
          },
          { title: "送达自提点", dataIndex: "siteName" },
          {
            title: "操作",
            render: (_, v) => {
              const batch = batches.find(
                (value) => value.campaignId === v.campaignId,
              );
              const actionLabels = getDeliveryActionLabels({
                status: v.status,
                canOperate,
                emergencyProxy,
                ...(batch ? { batchStatus: batch.status } : {}),
              });
              const overdue =
                v.status === "IN_TRANSIT" &&
                Boolean(v.estimatedArrivalAt) &&
                dayjs(v.estimatedArrivalAt).isBefore(dayjs());
              return (
                <Space wrap>
                  {actionLabels.includes("登记运输信息") && (
                    <Button onClick={() => openVehicle(v)}>
                      登记运输信息
                    </Button>
                  )}
                  {actionLabels.includes("编辑运输信息") && (
                    <>
                      <Button onClick={() => openVehicle(v)}>
                        编辑运输信息
                      </Button>
                      {actionLabels.includes("确认发车") ||
                      actionLabels.includes("创建批次并发车") ? (
                        <Button
                          type="primary"
                          onClick={() => setDispatchReview(v)}
                        >
                          {actionLabels.includes("确认发车")
                            ? "确认发车"
                            : "创建批次并发车"}
                        </Button>
                      ) : null}
                    </>
                  )}
                  {actionLabels.includes("紧急纠正运输信息") && (
                      <Button danger onClick={() => openVehicle(v, true)}>
                        紧急纠正运输信息
                      </Button>
                  )}
                  {batch?.status === "DRAFT" && !canOperate && (
                    <Typography.Text type="secondary">
                      批次已创建，等待运营确认发车
                    </Typography.Text>
                  )}
                  {overdue && (
                    <Tag color="red">已超过预计到达时间，请跟进</Tag>
                  )}
                </Space>
              );
            },
          },
        ]}
        />
      )}
      </>}
      {view === "arrival-exceptions" && <>
      {error && <Alert type="error" showIcon message="到货数据加载失败" description={error} action={<Button onClick={() => void reload().catch(() => undefined)}>重试</Button>} />}
      <Typography.Title level={4}>到货与异常</Typography.Title>
      {viewState === "error" ? null : deliveries.length === 0 && !loading ? (
        <Card title="到货与异常">
          <Empty description="暂无点位到货记录">
            <Typography.Paragraph type="secondary">
              团期发车后，由授权点位负责人逐商品确认到货；如有短少或破损，由运营确认受影响订单后交财务处理。
            </Typography.Paragraph>
          </Empty>
        </Card>
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={newestFirst(deliveries, value => value.arrivalConfirmedAt ?? value.createdAt)}
          columns={[
          { title: "团期", dataIndex: "campaignTitle" },
          { title: "自提点", dataIndex: "siteName" },
          { title: "到货状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "异常处理",
            render: (_, v) =>
              v.allocationDraftStatus
                ? displayLabel(v.allocationDraftStatus)
                : "—",
          },
          {
            title: "操作",
            render: (_, v) => (
              <Space wrap>
                {emergencyProxy && v.dispatchBatchId && !v.arrivalConfirmed && (
                  <Button danger onClick={() => setArrival(v)}>
                    紧急代办到货
                  </Button>
                )}
                {canOperate &&
                  v.communityDeliveryId &&
                  v.allocationDraftStatus ===
                    "PENDING_OPERATOR_CONFIRMATION" && (
                    <Button
                      type="primary"
                      loading={allocationSubmitting}
                      disabled={allocationSubmitting}
                      onClick={() => void confirmAllocation(v.communityDeliveryId!)}
                    >
                      确认异常范围
                    </Button>
                  )}
                {!v.arrivalConfirmed && !v.dispatchBatchId && (
                  <Typography.Text type="secondary">
                    等待运营发车
                  </Typography.Text>
                )}
                {!v.arrivalConfirmed &&
                  v.dispatchBatchId &&
                  v.status === "IN_TRANSIT" &&
                  !emergencyProxy && (
                    <Typography.Text type="secondary">
                      等待点位负责人确认到货
                    </Typography.Text>
                  )}
                {v.arrivalConfirmed &&
                  v.allocationDraftStatus ===
                    "PENDING_OPERATOR_CONFIRMATION" && (
                    <Typography.Text type="warning">
                      待运营确认异常范围
                    </Typography.Text>
                  )}
                {v.arrivalConfirmed &&
                  v.allocationDraftStatus !==
                    "PENDING_OPERATOR_CONFIRMATION" && (
                    <Typography.Text type="secondary">
                      到货已确认
                    </Typography.Text>
                  )}
              </Space>
            ),
          },
        ]}
        />
      )}
      </>}
      <Modal
        open={!!vehicle}
        title={
          vehicleEmergency
            ? "紧急纠正运输信息"
            : vehicle?.status === "SITE_CONFIRMED"
              ? "登记运输信息"
              : "编辑运输信息"
        }
        footer={null}
        onCancel={() => {
          setVehicle(null);
          setVehicleEmergency(false);
          vehicleForm.resetFields();
        }}
      >
        {vehicleEmergency && (
          <Alert
            type="warning"
            showIcon
            message="发车后普通编辑已锁定，仅超级管理员可紧急纠正；操作会写入审计。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          form={vehicleForm}
          layout="vertical"
          onFinish={(v) => void saveVehicle(v)}
        >
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
          {vehicleEmergency && (
            <Form.Item
              name="reason"
              label="紧急纠正原因"
              rules={[{ required: true, min: 2, message: "请填写纠正原因" }]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          )}
          <Button
            type="primary"
            htmlType="submit"
            loading={vehicleSubmitting}
            disabled={vehicleSubmitting}
          >
            保存
          </Button>
        </Form>
      </Modal>
      <Modal
        open={!!dispatchReview}
        title="发车前复核"
        confirmLoading={dispatchSubmitting}
        okButtonProps={{ disabled: Boolean(cannotDispatch) }}
        okText="确认发车"
        cancelText="返回修改"
        onCancel={() => setDispatchReview(null)}
        onOk={() => void dispatch()}
      >
        {dispatchReview && (
          <>
          {cannotDispatch && <Alert type={dispatchLabels === null && !reviewBlock && !dispatchLoadError ? "info" : "warning"} showIcon message={cannotDispatch} style={{ marginBottom: 16 }}
            action={dispatchLoadError ? <Button size="small" onClick={() => setReviewReload((value) => value + 1)}>重试核实</Button> : undefined} />}
          {dispatchError && <Alert type="error" showIcon message={dispatchError} style={{ marginBottom: 16 }} />}
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="团期">
              {campaigns.find((value) => value.id === dispatchReview.campaignId)?.title ??
                dispatchReview.campaignId}
            </Descriptions.Item>
            <Descriptions.Item label="团期状态">
              {reviewCampaign ? <Status value={reviewCampaign.status} /> : "尚未加载"}
            </Descriptions.Item>
            <Descriptions.Item label="自提点">
              {dispatchReview.siteName}
            </Descriptions.Item>
            <Descriptions.Item label="承运方">
              {dispatchReview.logisticsPlatform ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label="运输单号">
              {dispatchReview.vehicleOrderNo ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label="司机 / 车牌">
              {[dispatchReview.driverName, dispatchReview.vehiclePlate]
                .filter(Boolean)
                .join(" / ") || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="预计到达">
              {dispatchReview.estimatedArrivalAt
                ? dateTime(dispatchReview.estimatedArrivalAt)
                : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="已付款发货订单 / 商品数量">
              {dispatchLabels === null ? "待核实" : `${dispatchLabels.length} 单 / ${dispatchQuantity} 件`}
            </Descriptions.Item>
          </Descriptions>
          </>
        )}
      </Modal>
      <ArrivalConfirmationModal
        arrival={arrival}
        emergencyProxy={emergencyProxy}
        onClose={() => setArrival(null)}
        onConfirmed={reload}
      />
    </>
  );
}

function Areas({
  view,
  areas,
  points,
  reload,
}: {
  view: AdminPage;
  areas: ServiceArea[];
  points: PickupPoint[];
  reload: () => Promise<void>;
}) {
  const [areaQuery,setAreaQuery] = useState("");
  const [areaStatus,setAreaStatus] = useState("ALL");
  const [pointQuery,setPointQuery] = useState("");
  const [pointStatus,setPointStatus] = useState("ALL");
  const { message } = AntApp.useApp();
  const [areaOpen, setAreaOpen] = useState(false);
  const [pointOpen, setPointOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<PickupPoint | null>(null);
  const [regions, setRegions] = useState<RegionDirectoryEntry[]>([]);
  const [regionLoadError, setRegionLoadError] = useState<string | null>(null);
  const [locationChangeRequired, setLocationChangeRequired] = useState(true);
  const [locationVerification, setLocationVerification] =
    useState<PickupLocationVerificationState>("UNCONFIRMED");
  const [submitting, setSubmitting] = useState(false);
  const [pointForm] = Form.useForm();
  const pointLatitude = Form.useWatch("latitude", pointForm);
  const pointLongitude = Form.useWatch("longitude", pointForm);
  const selectedServiceAreaId = Form.useWatch("serviceAreaId", pointForm) as
    | string
    | undefined;
  const selectedServiceArea = areas.find(
    (area) => area.id === selectedServiceAreaId,
  );
  const selectedRegion = regions.find(
    (region) => region.regionCode === selectedServiceArea?.regionCode,
  );
  useEffect(() => {
    void api
      .regions()
      .then((value) => {
        setRegions(value);
        setRegionLoadError(null);
      })
      .catch(() => {
        setRegions([]);
        setRegionLoadError("行政目录暂时不可用，请重试后再配置位置");
      });
  }, []);
  const startCreatePoint = () => {
    setEditingPoint(null);
    setLocationChangeRequired(true);
    setLocationVerification("UNCONFIRMED");
    pointForm.resetFields();
    pointForm.setFieldsValue({
      businessHours: "每日 09:00–20:00",
      pickupInstructions: "到店出示领取码",
    });
    setPointOpen(true);
  };
  const editablePointFields = (point: PickupPoint) => ({
    serviceAreaId: point.serviceAreaId,
    name: point.name,
    address: point.address,
    businessHours: point.businessHours,
    pickupInstructions: point.pickupInstructions,
    latitude: point.latitude,
    longitude: point.longitude,
    capacityPerDay: point.capacityPerDay,
    status: point.status,
  });
  const startEditPoint = (point: PickupPoint) => {
    setEditingPoint(point);
    setLocationChangeRequired(false);
    setLocationVerification("CONFIRMED");
    pointForm.setFieldsValue(editablePointFields(point));
    setPointOpen(true);
  };
  return (
    <>
      <PageTitle
        title={view === "areas" ? "区域管理" : "自提点管理"}
        subtitle="先配置真实区域与启用自提点，再建立商品和团期；未覆盖地区仅收集开通意向"
        action={
          <Space>
            <Button onClick={() => setAreaOpen(true)}>开通更多区域</Button>
            <Button type="primary" onClick={startCreatePoint}>
              新增自提点
            </Button>
          </Space>
        }
      />
      {view === "areas" && <>
      <Typography.Title level={4}>服务区域</Typography.Title>
      <ListFilters label="区域" query={areaQuery} onQuery={setAreaQuery} status={areaStatus} onStatus={setAreaStatus} statuses={[{value:"ENABLED",label:"接单中"},{value:"DISABLED",label:"已暂停接单"}]} />
      <Table
        rowKey="id"
        dataSource={areas.filter(v=>(areaStatus === "ALL" || (v.orderEnabled ? "ENABLED" : "DISABLED") === areaStatus) && matchesKeyword(areaQuery,v.name,v.regionCode))}
        locale={{ emptyText: "暂无服务区域，请从行政目录开通" }}
        columns={[
          { title: "区域", dataIndex: "name" },
          {
            title: "行政目录",
            render: (_, value) =>
              regions.find((region) => region.regionCode === value.regionCode)?.path ??
              value.name,
          },
          {
            title: "接单",
            render: (_, v) => (
              <Button
                loading={submitting}
                disabled={submitting}
                onClick={() => {
                  const nextEnabled = !v.orderEnabled;
                  Modal.confirm({
                    title: nextEnabled ? "确认恢复接单？" : "确认暂停区域接单？",
                    content: nextEnabled
                      ? "恢复后新团期可以继续使用该区域。"
                      : "暂停只影响后续新团期，进行中的团期和未完成订单不受影响；请确认已知晓影响范围。",
                    okText: nextEnabled ? "确认开启" : "确认暂停",
                    cancelText: "返回",
                    onOk: async () => {
                      if (submitting) return;
                      setSubmitting(true);
                      try {
                        await api.setArea(v.id, nextEnabled);
                        await refreshAfterMutation(
                          reload,
                          message,
                          nextEnabled ? "区域已开启接单" : "区域已暂停接单",
                        );
                      } catch (error) {
                        message.error(mutationErrorText(error));
                      } finally {
                        setSubmitting(false);
                      }
                    },
                  });
                }}
              >
                {v.orderEnabled ? "暂停" : "开启"}
              </Button>
            ),
          },
        ]}
      />
      </>}
      {view !== "areas" && <>
      <Typography.Title level={4}>自提点</Typography.Title>
      <ListFilters label="自提点" query={pointQuery} onQuery={setPointQuery} status={pointStatus} onStatus={setPointStatus} statuses={[{value:"ACTIVE",label:"启用"},{value:"INACTIVE",label:"停用"}]} />
      <Table
        rowKey="id"
        dataSource={points.filter(v=>(pointStatus === "ALL" || v.status === pointStatus) && matchesKeyword(pointQuery,v.name,v.address,v.contactName,areas.find(area=>area.id===v.serviceAreaId)?.name))}
        locale={{ emptyText: "暂无自提点，请先选择服务区域并新增" }}
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "地址", dataIndex: "address" },
          { title: "营业时间", dataIndex: "businessHours" },
          {
            title: "联系人",
            render: (_, v) =>
              v.contactName || v.contactPhone
                ? `${v.contactName} ${v.contactPhone}`.trim()
                : "未关联负责人",
          },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, v) => (
              <Space>
                <Button onClick={() => startEditPoint(v)}>编辑</Button>
                <Button
                  danger={v.status === "ACTIVE"}
                  onClick={() => {
                    startEditPoint(v);
                    pointForm.setFieldsValue({
                      ...editablePointFields(v),
                      status: v.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                    });
                  }}
                >
                  {v.status === "ACTIVE" ? "停用" : "启用"}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      </>}
      <Modal
        open={areaOpen}
        title="开通服务区域"
        footer={null}
        onCancel={() => setAreaOpen(false)}
      >
        {regionLoadError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="行政目录加载失败"
            description={regionLoadError}
            action={
              <Button
                size="small"
                onClick={() =>
                  void api
                    .regions()
                    .then((value) => {
                      setRegions(value);
                      setRegionLoadError(null);
                    })
                    .catch(() =>
                      setRegionLoadError("行政目录暂时不可用，请重试后再配置区域"),
                    )
                }
              >
                重试
              </Button>
            }
          />
        )}
        <Form
          layout="vertical"
          onFinish={async (v) => {
            if (submitting) return;
            setSubmitting(true);
            try {
              await api.openArea(v.regionCode);
              setAreaOpen(false);
              await refreshAfterMutation(reload, message, "服务区域已开通");
            } catch (e) {
              message.error(mutationErrorText(e));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item
            name="regionCode"
            label="服务区域"
            rules={[{ required: true, message: "请选择行政目录中的服务区域" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={regionLoadError ? "行政目录加载失败，请重试" : "从行政目录选择服务区域"}
              loading={!regions.length && !regionLoadError}
              options={regions.map((region) => ({
                value: region.regionCode,
                label: `${region.path}（${region.regionCode}）`,
              }))}
              notFoundContent={regionLoadError ? "行政目录暂时不可用" : "暂无可选区域"}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} disabled={submitting}>
            开通
          </Button>
        </Form>
      </Modal>
      <Drawer
        width={600}
        className="pickup-point-drawer"
        open={pointOpen}
        title={editingPoint ? "编辑自提点" : "新增自提点"}
        footer={
          <div className="pickup-point-drawer__footer">
            <Button onClick={() => setPointOpen(false)}>取消</Button>
            <Button type="primary" htmlType="submit" form="pickup-point-form"
              loading={submitting}
              disabled={submitting || isPickupLocationSubmissionBlocked(locationChangeRequired, locationVerification)}>
              {editingPoint ? "保存修改" : "保存"}
            </Button>
          </div>
        }
        destroyOnHidden
        onClose={() => {
          setPointOpen(false);
          setEditingPoint(null);
          setLocationChangeRequired(true);
          setLocationVerification("UNCONFIRMED");
        }}
      >
        <Typography.Paragraph type="secondary" className="modal-note">
            选择服务区域，搜索地址并确认实际位置。
        </Typography.Paragraph>
        {regionLoadError && (
          <Alert
            type="error"
            showIcon
            message={regionLoadError}
            action={
              <Button
                size="small"
                onClick={() =>
                  void api
                    .regions()
                    .then((value) => {
                      setRegions(value);
                      setRegionLoadError(null);
                    })
                    .catch(() => undefined)
                }
              >
                重试
              </Button>
            }
          />
        )}
        <Form
          id="pickup-point-form"
          form={pointForm}
          layout="vertical"
          onValuesChange={(changedValues, values) => {
            const requiresConfirmation =
              pickupLocationChangeRequiresConfirmation(editingPoint, values);
            setLocationChangeRequired(requiresConfirmation);
            // Address and coordinates are updated by the picker only after it
            // has started a new verification.  Do not let those programmatic
            // form writes race the picker's final CONFIRMED notification.
            // Service-area and reactivation changes have no picker event, so
            // they must explicitly require a fresh verification here.
            const changedLocationScope = ["serviceAreaId", "status"].some(
              (field) => field in changedValues,
            );
            if (requiresConfirmation && changedLocationScope)
              setLocationVerification("UNCONFIRMED");
          }}
          onFinish={(v) => {
            if (
              isPickupLocationSubmissionBlocked(
                locationChangeRequired,
                locationVerification,
              )
            ) {
              message.error("请先通过地点选择或地图图钉完成位置核验，再保存");
              return;
            }
            const {
              serviceAreaId,
              status,
              name,
              ...details
            } = v;
            const payload = {
              ...details,
              name: (name?.trim() || details.address.trim()).slice(0, 120),
              address: details.address.trim(),
              capacityPerDay: details.capacityPerDay ?? null,
              pickupInstructions:
                details.pickupInstructions?.trim() || "到店出示领取码",
              businessHours: details.businessHours?.trim() || "每日 09:00–20:00",
              ...(editingPoint ? {} : { contactName: "", contactPhone: "" }),
            };
            const savePoint = async (confirmDuplicate = false) => {
              if (submitting) return;
              setSubmitting(true);
              const request = editingPoint
                ? api.updatePoint(
                    editingPoint.id,
                    {
                      ...payload,
                      ...(status ? { status } : {}),
                      ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
                    } as Parameters<typeof api.updatePoint>[1],
                  )
                : api.createPoint(
                    {
                      ...payload,
                      serviceAreaId,
                      ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
                    } as Parameters<typeof api.createPoint>[0],
                  );
              try {
                await request;
                setPointOpen(false);
                setEditingPoint(null);
                pointForm.resetFields();
                await refreshAfterMutation(reload, message, editingPoint ? "自提点已更新" : "自提点已创建");
              } catch (error) {
                const code = (error as { code?: string }).code;
                const candidates = (
                  error as { details?: { candidates?: unknown[] } }
                ).details?.candidates;
                if (
                  !confirmDuplicate &&
                  code === "POSSIBLE_DUPLICATE_PICKUP_LOCATION"
                ) {
                  const candidateSummary = Array.isArray(candidates)
                    ? candidates
                        .slice(0, 3)
                        .map((candidate) => {
                          const value = candidate as {
                            name?: string;
                            address?: string;
                            distanceMeters?: number;
                          };
                          return `${value.name ?? "已有点位"}（${value.address ?? "地址未知"}，约 ${value.distanceMeters ?? "?"} 米）`;
                        })
                        .join("；")
                    : "已有点位";
                  Modal.confirm({
                    title: "发现疑似重复自提点",
                    content: `同一服务区域内已存在：${candidateSummary}。请确认不是同一领取地点后再继续保存。`,
                    okText: "确认不同，仍保存",
                    cancelText: "返回修改",
                    onOk: () => savePoint(true),
                  });
                  return;
                }
                message.error(mutationErrorText(error));
              } finally {
                setSubmitting(false);
              }
            };
            void savePoint();
          }}
        >
          {areas.length > 1 ? (
            <Form.Item
              name="serviceAreaId"
              label="服务区域"
              rules={[{ required: true }]}
            >
              <Select
                options={areas.map((v) => ({ value: v.id, label: v.name }))}
                disabled={!!editingPoint}
              />
            </Form.Item>
          ) : (
            <Form.Item
              name="serviceAreaId"
              label="服务区域"
              rules={[{ required: true, message: "请选择服务区域" }]}
            >
              <Select
                options={areas.map((v) => ({ value: v.id, label: v.name }))}
                disabled={!!editingPoint}
                placeholder="请选择服务区域"
              />
            </Form.Item>
          )}
          <div className="pickup-region-summary" aria-label="行政目录">
            <span>行政归属</span>
            <strong>{selectedServiceArea ? selectedRegion?.path ?? "该服务区域尚未映射到行政目录" : "选择服务区域后显示"}</strong>
            <details>
              <summary>位置核验说明</summary>
              <p>行政目录由服务区域唯一派生，仅核验本次坐标的行政路径相容性，不代表实际配送范围、门牌或可达性已确认。</p>
            </details>
          </div>
          {!selectedServiceArea && (
            <Alert
              type="info"
              showIcon
              message="请先选择服务区域，再输入详细地址或在地图上确认位置。"
            />
          )}
          <Form.Item name="name" label="自提点名称" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="如：朝阳大悦城提货点" />
          </Form.Item>
          <Form.Item
            name="address"
            label="详细地址或地点名称"
            extra="请选择地点或在地图上确认图钉；地址文字不决定行政归属"
            rules={[
              { required: true, min: 5, message: "请填写详细地址，或在地图上点选" },
              {
                validator: async () => {
                  if (pointForm.getFieldValue("latitude") == null || pointForm.getFieldValue("longitude") == null)
                    throw new Error("请选择搜索候选或地图图钉，完成位置核验");
                },
              },
            ]}
          >
            <PickupLocationPicker
              active={pointOpen}
              disabled={!selectedServiceArea || Boolean(regionLoadError)}
              latitude={pointLatitude}
              longitude={pointLongitude}
              searchBias={selectedRegion?.path.replace(/\s*\/\s*/g, "") ?? ""}
              onVerificationStateChange={(state) => {
                if (state === "VERIFYING") setLocationChangeRequired(true);
                setLocationVerification(state);
              }}
              onLocated={(place) => {
                pointForm.setFieldsValue({
                  latitude: place.latitude,
                  longitude: place.longitude,
                  ...(place.replaceAddress && place.address
                    ? { address: place.address }
                    : {}),
                  ...(place.title && !pointForm.getFieldValue("name")
                    ? { name: place.title }
                    : {}),
                });
                void pointForm.validateFields(["address"]).catch(() => undefined);
              }}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary" aria-live="polite">
            地图图钉坐标（只读确认）：
            {pointLatitude != null && pointLongitude != null
              ? `${Number(pointLatitude).toFixed(6)}, ${Number(pointLongitude).toFixed(6)}`
              : "尚未确认"}
            {locationChangeRequired &&
              locationVerification !== "CONFIRMED" &&
              "。位置尚未核验，不能保存。"}
          </Typography.Paragraph>
          <Form.Item name="longitude" hidden rules={[{ required: true }]}>
            <Input type="hidden" />
          </Form.Item>
          <Form.Item name="latitude" hidden rules={[{ required: true }]}>
            <Input type="hidden" />
          </Form.Item>
          <div className="form-grid">
            <Form.Item name="businessHours" label="营业时间">
              <Input placeholder="每日 09:00–20:00" />
            </Form.Item>
            <Form.Item name="pickupInstructions" label="领取提示">
              <Input placeholder="到店出示领取码" />
            </Form.Item>
          </div>
          {editingPoint && (
            <Form.Item name="capacityPerDay" label="日容量（可选）">
              <InputNumber min={1} />
            </Form.Item>
          )}
          {editingPoint && (
            <Form.Item name="status" label="点位状态" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "ACTIVE", label: "启用" },
                  { value: "INACTIVE", label: "停用" },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Drawer>
    </>
  );
}

function PointWorkbench({
  view,
  deliveries,
  roles,
  loading,
  error,
  reload,
}: {
  view: AdminPage;
  deliveries: CommunityDelivery[];
  roles: string[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [plans, setPlans] = useState<DeliveryPlan[]>([]);
  const [order, setOrder] = useState<PickupLookup | null>(null);
  const [planId, setPlanId] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [code, setCode] = useState("");
  const [pickupQuantities, setPickupQuantities] = useState<
    Record<string, number>
  >({});
  const [pickupReview, setPickupReview] = useState<PendingPickupRequest | null>(
    null,
  );
  const [submittingPickup, setSubmittingPickup] = useState(false);
  const [arrival, setArrival] = useState<CommunityDelivery | null>(null);
  const [arrivalNotice, setArrivalNotice] = useState(false);
  const [pickupLoading, setPickupLoading] = useState(true);
  const [pickupError, setPickupError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const loadPlans = async () => {
      setPickupLoading(true);
      setPickupError(null);
      try {
        const values = await api.pickupPlans();
        if (active) setPlans(values);
      } catch (caught) {
        if (active)
          setPickupError(adminLoadErrorText(caught));
      } finally {
        if (active) setPickupLoading(false);
      }
    };
    void loadPlans();
    return () => {
      active = false;
    };
  }, []);
  const refreshAfterArrival = async () => {
    try {
      await reload();
      setPlans(await api.pickupPlans());
    } catch {
      message.warning("已保存，列表刷新失败，请刷新");
    }
  };
  const pendingArrivals = earliestFirst(deliveries.filter(
    (delivery) => delivery.dispatchBatchId && !delivery.arrivalConfirmed,
  ), value => value.estimatedArrivalAt);
  const processingArrivals = newestFirst(deliveries.filter(
    (delivery) =>
      delivery.arrivalConfirmed &&
      delivery.allocationDraftStatus === "PENDING_OPERATOR_CONFIRMATION",
  ), value => value.arrivalConfirmedAt ?? value.createdAt);
  const completedArrivals = newestFirst(deliveries.filter(
    (delivery) =>
      delivery.arrivalConfirmed &&
      delivery.allocationDraftStatus !== "PENDING_OPERATOR_CONFIRMATION",
  ), value => value.arrivalConfirmedAt ?? value.createdAt);
  const setLookupOrder = (nextOrder: PickupLookup) => {
    setOrder(nextOrder);
    setPickupQuantities(
      Object.fromEntries(nextOrder.items.map((item) => [item.skuId, 0])),
    );
  };
  const lookup = async () => {
    try {
      setLookupOrder(await api.lookupPickup(planId, orderNo.trim()));
    } catch (error) {
      void message.error(mutationErrorText(error));
    }
  };
  const openPickupReview = () => {
    if (!order) return;
    const items = order.items
      .map((item) => ({
        catalogSkuId: item.skuId,
        quantity: pickupQuantities[item.skuId] ?? 0,
      }))
      .filter((item) => item.quantity > 0);
    if (items.length === 0) {
      void message.error("请至少填写一项大于 0 的本次领取数量");
      return;
    }
    try {
      setPickupReview(
        beginPickupRequest(localStorage, {
          orderId: order.id,
          deliveryPlanId: order.deliveryPlanId,
          items,
        }),
      );
    } catch (error) {
      void message.error(mutationErrorText(error));
    }
  };
  const verify = async () => {
    if (!order || !pickupReview) return;
    setSubmittingPickup(true);
    try {
      await api.verifyPickup({
        orderId: order.id,
        deliveryPlanId: order.deliveryPlanId,
        code,
        pickupRequestId: pickupReview.pickupRequestId,
        items: pickupReview.items,
      });
      markPickupRequestConfirmed(localStorage, pickupReview);
      const refreshed = await api.lookupPickup(planId, orderNo.trim());
      clearPickupRequest(localStorage, pickupReview);
      setLookupOrder(refreshed);
      setPickupReview(null);
      void message.success("本次领取已核销");
    } catch (error) {
      if (isTerminalPickupError(error as { statusCode?: number; code?: string })) {
        clearPickupRequest(localStorage, pickupReview);
        setPickupReview(null);
      }
      void message.error(mutationErrorText(error));
    } finally {
      setSubmittingPickup(false);
    }
  };
  return (
    <>
      <PageTitle
        title={view === "point-pickup" ? "领取核销" : "到货确认"}
        subtitle={view === "point-pickup" ? "选择自提点并查询订单，核对本次领取商品与取货码" : "对照实物确认到货数量，短少或破损请如实登记"}
      />
      {view !== "point-pickup" && <>
      {arrivalNotice && (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setArrivalNotice(false)}
          message="到货事实已登记"
          description="数量一致的商品可进入领取；短少或破损商品由平台继续处理。"
          style={{ marginBottom: 16 }}
        />
      )}
      {!roles.includes("PICKUP_MANAGER") ? (
        <Alert
          type="warning"
          showIcon
          message="当前账号无点位到货确认权限"
          description="请使用已分配自提点的负责人账号登录。"
        />
      ) : loading ? (
        <Card loading title="待确认到货" />
      ) : error ? (
        <Alert
          type="error"
          showIcon
          message="待确认到货加载失败"
          description={error}
          action={<Button onClick={() => void reload().catch(() => undefined)}>重新加载</Button>}
        />
      ) : pendingArrivals.length === 0 ? (
        <Card title="待确认到货">
          <Empty description="暂无已发车、待确认的授权点位配送" />
        </Card>
      ) : (
        <Card title="待确认到货">
          <Table
            rowKey="id"
            pagination={false}
            dataSource={pendingArrivals}
            columns={[
              { title: "团期", dataIndex: "campaignTitle" },
              { title: "自提点", dataIndex: "siteName" },
              {
                title: "操作",
                render: (_, delivery) => (
                  <Button
                    type="primary"
                    disabled={!delivery.dispatchBatchId}
                    onClick={() => setArrival(delivery)}
                  >
                    逐商品确认到货
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}
      {processingArrivals.length > 0 && (
        <Card title="平台处理中" style={{ marginTop: 16 }}>
          <Alert
            type="warning"
            showIcon
            message="仅异常商品暂不可领取"
            description="平台正在核对短少或破损对应的订单；同一批次中数量一致的商品可继续领取。"
            style={{ marginBottom: 16 }}
          />
          <Table
            rowKey="id"
            pagination={false}
            dataSource={processingArrivals}
            columns={[
              { title: "团期", dataIndex: "campaignTitle" },
              { title: "自提点", dataIndex: "siteName" },
              {
                title: "处理状态",
                render: () => <Status value="PENDING_OPERATOR_CONFIRMATION" />,
              },
              {
                title: "说明",
                render: () => "平台确认异常范围后会更新可领取数量",
              },
            ]}
          />
        </Card>
      )}
      {completedArrivals.length > 0 && (
        <Card title="近期到货记录" style={{ marginTop: 16 }}>
          <Table
            rowKey="id"
            pagination={false}
            dataSource={completedArrivals}
            columns={[
              { title: "团期", dataIndex: "campaignTitle" },
              { title: "自提点", dataIndex: "siteName" },
              { title: "到货结果", render: () => "数量已确认" },
              { title: "状态", render: () => <Status value="CONFIRMED" /> },
            ]}
          />
        </Card>
      )}
      </>}
      {view === "point-pickup" && <>
      <Card>
        {pickupError && (
          <Alert
            type="error"
            showIcon
            message="可领取点位加载失败"
            description={pickupError}
            style={{ marginBottom: 16 }}
          />
        )}
        <Space wrap>
          <Select
            style={{ width: 260 }}
            placeholder="选择已到货点位"
            value={planId || null}
            onChange={setPlanId}
            loading={pickupLoading}
            disabled={pickupLoading || !!pickupError || plans.length === 0}
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
          <Button
            type="primary"
            disabled={!planId || !orderNo.trim() || pickupLoading}
            onClick={() => void lookup()}
          >
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
              { title: "到货可领总量", dataIndex: "readyQuantity" },
              { title: "已领取", dataIndex: "alreadyPickedQuantity" },
              { title: "本次最多领取", dataIndex: "remainingPickupQuantity" },
              {
                title: "本次领取数量",
                render: (_, item) => (
                  <InputNumber
                    aria-label={`${item.name} 本次领取数量`}
                    min={0}
                    max={item.remainingPickupQuantity}
                    precision={0}
                    value={pickupQuantities[item.skuId] ?? 0}
                    disabled={submittingPickup || item.remainingPickupQuantity === 0}
                    onChange={(value) =>
                      setPickupQuantities((current) => ({
                        ...current,
                        [item.skuId]: Math.max(
                          0,
                          Math.min(item.remainingPickupQuantity, Number(value ?? 0)),
                        ),
                      }))
                    }
                    onBlur={(event) =>
                      setPickupQuantities((current) => ({
                        ...current,
                        [item.skuId]: Math.max(
                          0,
                          Math.min(
                            item.remainingPickupQuantity,
                            Number(event.target.value || 0),
                          ),
                        ),
                      }))
                    }
                  />
                ),
              },
            ]}
          />
          <Space style={{ marginTop: 16 }}>
            <Button
              disabled={submittingPickup}
              onClick={() =>
                setPickupQuantities(
                  Object.fromEntries(
                    order.items.map((item) => [
                      item.skuId,
                      item.remainingPickupQuantity,
                    ]),
                  ),
                )
              }
            >
              填满剩余
            </Button>
            <Button
              disabled={submittingPickup}
              onClick={() =>
                setPickupQuantities(
                  Object.fromEntries(order.items.map((item) => [item.skuId, 0])),
                )
              }
            >
              清零
            </Button>
            <Input
              placeholder="6 位取货码"
              maxLength={6}
              value={code}
              disabled={submittingPickup}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button
              type="primary"
              disabled={!/^\d{6}$/.test(code) || submittingPickup}
              onClick={openPickupReview}
            >
              确认本次领取
            </Button>
          </Space>
        </Card>
      )}
      </>}
      <Modal
        open={!!pickupReview}
        title="本次领取复核"
        okText="确认提交核销"
        cancelText="返回修改"
        confirmLoading={submittingPickup}
        okButtonProps={{ disabled: !/^\d{6}$/.test(code) || submittingPickup }}
        onOk={() => void verify()}
        onCancel={() => !submittingPickup && setPickupReview(null)}
      >
        <Typography.Paragraph>
          请复核本次领取数量和取货码；提交后将按该请求号幂等执行。
        </Typography.Paragraph>
        <Table
          rowKey="catalogSkuId"
          pagination={false}
          dataSource={pickupReview?.items ?? []}
          columns={[
            {
              title: "商品",
              render: (_, item) =>
                order?.items.find((value) => value.skuId === item.catalogSkuId)
                  ?.name ?? item.catalogSkuId,
            },
            { title: "本次数量", dataIndex: "quantity" },
          ]}
        />
      </Modal>
      <ArrivalConfirmationModal
        arrival={arrival}
        emergencyProxy={false}
        onClose={() => setArrival(null)}
        onConfirmed={refreshAfterArrival}
        onSuccess={() => setArrivalNotice(true)}
      />
    </>
  );
}

function PickupWindowQueue({
  values,
  roles,
  reload,
}: {
  values: PickupWindow[];
  roles: string[];
  reload: () => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [action, setAction] = useState<{
    window: PickupWindow;
    type: "extend" | "refund" | "loss";
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<{
    deadlineAt?: dayjs.Dayjs;
    note: string;
  }>();
  const canOperate = roles.includes("OPERATOR") || roles.includes("SUPER_ADMIN");
  if (!canOperate) return null;
  const submit = async (value: { deadlineAt?: dayjs.Dayjs; note: string }) => {
    if (!action) return;
    setSubmitting(true);
    try {
      if (action.type === "extend") {
        if (!value.deadlineAt) return;
        await api.extendPickup(action.window.orderId, {
          deadlineAt: value.deadlineAt.toISOString(),
          note: value.note.trim(),
        });
      } else {
        await api.disposePickup(action.window.orderId, {
          action: action.type === "refund" ? "REFUND" : "LOSS",
          note: value.note.trim(),
        });
      }
      setAction(null);
      form.resetFields();
      await refreshAfterMutation(reload, message, "领取窗口已更新");
    } catch (caught) {
      void message.error(mutationErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <Typography.Title level={4}>逾期领取处理</Typography.Title>
      <OperationsQueueTable
        rowKey="orderId"
        loadPage={api.pickupWindowsPage} refreshToken={values} statuses={["EXPIRED_PENDING", "REFUND_PENDING", "ACTIVE", "EXTENDED", "LOSS_RECORDED", "CLOSED"]}
        locale={{ emptyText: "暂无需要运营处理的领取窗口" }}
        columns={[
          { title: "订单", render: (_, value) => value.orderNo ?? value.orderId },
          {
            title: "自提点",
            render: (_, value) => value.pickupPointName ?? value.pickupPointId ?? "—",
          },
          { title: "截止时间", render: (_, value) => dateTime(value.deadlineAt) },
          { title: "状态", render: (_, value) => <Status value={value.status} /> },
          {
            title: "下一责任",
            render: (_, value) =>
              value.nextResponsibility
                ? displayLabel(value.nextResponsibility)
                : "—",
          },
          {
            title: "操作",
            render: (_, value) =>
              value.status === "EXPIRED_PENDING" ? (
                <Space wrap>
                  <Button onClick={() => setAction({ window: value, type: "extend" })}>
                    一次延期
                  </Button>
                  <Button onClick={() => setAction({ window: value, type: "refund" })}>
                    登记退款
                  </Button>
                  <Button danger onClick={() => setAction({ window: value, type: "loss" })}>
                    登记报损
                  </Button>
                </Space>
              ) : (
                "当前无需运营处理"
              ),
          },
        ]}
      />
      <Modal
        open={!!action}
        title={
          action?.type === "extend"
            ? "确认一次延期领取"
            : action?.type === "refund"
              ? "确认登记逾期退款"
              : "确认登记逾期报损"
        }
        footer={null}
        onCancel={() => !submitting && setAction(null)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(value) => void submit(value)}>
          {action?.type === "extend" && (
            <Form.Item
              name="deadlineAt"
              label="新的领取截止时间"
              rules={[{ required: true, message: "请选择新的领取截止时间" }]}
            >
              <DatePicker showTime disabled={submitting} />
            </Form.Item>
          )}
          <Form.Item
            name="note"
            label="处理原因"
            rules={[{ required: true, min: 2, message: "请填写处理原因" }]}
          >
            <Input.TextArea rows={3} disabled={submitting} />
          </Form.Item>
          <Button type="primary" danger={action?.type === "loss"} htmlType="submit" loading={submitting}>
            二次确认并提交
          </Button>
        </Form>
      </Modal>
    </>
  );
}

function Service({
  view,
  quality,
  cancellations,
  exceptions,
  pickupWindows,
  roles,
  reload,
  loading,
  error,
}: {
  view: AdminPage;
  quality: Awaited<ReturnType<typeof api.quality>>;
  cancellations: Awaited<ReturnType<typeof api.cancellations>>;
  exceptions: FulfillmentException[];
  pickupWindows: PickupWindow[];
  roles: string[];
  reload: () => Promise<void>;
  loading: boolean;
  error: string | null;
}) {
  const { message } = AntApp.useApp();
  const canAcceptQuality =
    roles.includes("CUSTOMER_SERVICE") || roles.includes("SUPER_ADMIN");
  const canDecideQuality =
    roles.includes("OPERATOR") || roles.includes("SUPER_ADMIN");
  const canReviewCancellation =
    roles.includes("OPERATOR") || roles.includes("SUPER_ADMIN");
  const [qualityAction, setQualityAction] = useState<{
    value: Awaited<ReturnType<typeof api.quality>>[number];
    type: "accept" | "approve" | "reject";
    note?: string;
  } | null>(null);
  const [cancellationAction, setCancellationAction] = useState<{
    value: Awaited<ReturnType<typeof api.cancellations>>[number];
    approved: boolean;
    note?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitQuality = async () => {
    if (!qualityAction?.note) return;
    setSubmitting(true);
    try {
      if (qualityAction.type === "accept")
        await api.acceptQuality(qualityAction.value.id, qualityAction.note);
      else
        await api.decideQuality(
          qualityAction.value.id,
          qualityAction.type === "approve",
          qualityAction.note,
        );
      setQualityAction(null);
      await refreshAfterMutation(reload, message, "品质售后已更新");
    } catch (caught) {
      void message.error(mutationErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  };
  const submitCancellation = async () => {
    if (!cancellationAction?.note) return;
    setSubmitting(true);
    try {
      await api.reviewCancellation(
        cancellationAction.value.orderId,
        cancellationAction.approved,
        cancellationAction.note,
      );
      setCancellationAction(null);
      await refreshAfterMutation(reload, message, "取消申请已更新");
    } catch (caught) {
      void message.error(mutationErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  };
  const qualityActionLabel = (type: NonNullable<typeof qualityAction>["type"]) =>
    type === "accept" ? "受理" : type === "approve" ? "批准退款" : "拒绝申请";
  return (
    <>
      <PageTitle
        title={view === "cancellations" ? "取消申请" : "售后与异常"}
        subtitle="客服受理、运营决定、财务退款，职责分离"
      />
      {loading && <Alert type="info" showIcon message="正在刷新售后队列" />}
      {error && (
        <Alert
          type="error"
          showIcon
          message="售后队列加载失败"
          description={error}
          action={<Button size="small" onClick={() => void reload().catch(() => undefined)}>重试</Button>}
        />
      )}
      {view !== "cancellations" && <>
      <Typography.Title level={4}>品质售后</Typography.Title>
      <OperationsQueueTable
        rowKey="id"
        loadPage={api.qualityPage} refreshToken={quality} statuses={["REGISTERED", "ACCEPTED", "REFUNDING", "REJECTED", "RESOLVED"]}
        columns={[
          { title: "订单", render: (_, value) => value.orderNo ?? value.orderId },
          {
            title: "商品/数量/问题",
            render: (_, value) =>
              value.items
                .map(
                  (item) =>
                    `${item.name} × ${item.quantity}：${item.description}`,
                )
                .join("；"),
          },
          { title: "申报时间", render: (_, value) => dateTime(value.registeredAt) },
          { title: "受理说明", render: (_, value) => value.acceptanceNote ?? "—" },
          { title: "决定说明", render: (_, value) => value.decisionNote ?? "—" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, v) => (
              <Space>
                {canAcceptQuality && v.status === "REGISTERED" && (
                  <Button
                    onClick={() => setQualityAction({ value: v, type: "accept" })}
                  >
                    受理
                  </Button>
                )}
                {canDecideQuality && v.status === "ACCEPTED" && (
                  <>
                    <Button
                      type="primary"
                      onClick={() => setQualityAction({ value: v, type: "approve" })}
                    >
                      批准退款
                    </Button>
                    <Button
                      danger
                      onClick={() => setQualityAction({ value: v, type: "reject" })}
                    >
                      拒绝
                    </Button>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />
      </>}
      {view === "cancellations" && <>
      <Typography.Title level={4}>取消申请</Typography.Title>
      <OperationsQueueTable
        rowKey="id"
        loadPage={api.cancellationsPage} refreshToken={cancellations} statuses={["PENDING_REVIEW", "APPROVED_WAITING_FINANCE", "DIRECT_REFUNDING", "REFUNDING", "REFUNDED", "REJECTED"]}
        columns={[
          { title: "订单", render: (_, value) => value.orderNo ?? value.orderId },
          { title: "原因", dataIndex: "reason" },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, v) => (
              <Space>
                {canReviewCancellation && v.status === "PENDING_REVIEW" && (
                  <>
                    <Button
                      type="primary"
                      onClick={() => setCancellationAction({ value: v, approved: true })}
                    >
                      批准
                    </Button>
                    <Button
                      danger
                      onClick={() => setCancellationAction({ value: v, approved: false })}
                    >
                      拒绝
                    </Button>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />
      </>}
      {view !== "cancellations" && <>
      <Typography.Title level={4}>履约差异</Typography.Title>
      <OperationsQueueTable
        rowKey="id"
        loadPage={api.exceptionsPage} refreshToken={exceptions} statuses={["REGISTERED", "REFUND_CONFIRMED", "REFUND_PROCESSING", "RESOLVED"]}
        columns={[
          { title: "订单", render: (_, value) => value.orderNo ?? value.orderId ?? "—" },
          { title: "自提点", render: (_, value) => value.pickupPointName ?? value.pickupPointId ?? "—" },
          { title: "异常类型", render: (_, value) => value.items.map((item) => displayLabel(item.reason)).join("、") },
          {
            title: "逐商品数量",
            render: (_, value) =>
              value.items
                .map((item) => `${item.name} × ${item.affectedQuantity}`)
                .join("；"),
          },
          { title: "预计退款", render: (_, value) => value.refundAmountCents === null ? (value.financialFactsError ?? "金额不可计算") : money(value.refundAmountCents) },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          { title: "运营确认说明", dataIndex: "resolutionNote" },
        ]}
      />
      <PickupWindowQueue values={pickupWindows} roles={roles} reload={reload} />
      </>}
      <Modal
        open={Boolean(qualityAction && !qualityAction.note)}
        title={qualityAction ? `填写${qualityActionLabel(qualityAction.type)}说明` : ""}
        footer={null}
        destroyOnHidden
        onCancel={() => !submitting && setQualityAction(null)}
      >
        <Form
          layout="vertical"
          onFinish={(value: { note: string }) =>
            qualityAction &&
            setQualityAction({ ...qualityAction, note: value.note.trim() })
          }
        >
          <Form.Item name="note" label="处理说明" rules={[{ required: true, min: 2, message: "必须填写处理说明" }]}>
            <Input.TextArea rows={3} disabled={submitting} />
          </Form.Item>
          <Button type="primary" htmlType="submit">继续复核</Button>
        </Form>
      </Modal>
      <Modal
        open={Boolean(qualityAction?.note)}
        title="二次确认品质售后处理"
        okText="确认提交"
        cancelText="返回修改"
        confirmLoading={submitting}
        onOk={() => void submitQuality()}
        onCancel={() => !submitting && setQualityAction(null)}
      >
        确认{qualityAction ? qualityActionLabel(qualityAction.type) : ""}该品质售后？
      </Modal>
      <Modal
        open={Boolean(cancellationAction && !cancellationAction.note)}
        title={cancellationAction?.approved ? "填写取消批准理由" : "填写取消拒绝理由"}
        footer={null}
        destroyOnHidden
        onCancel={() => !submitting && setCancellationAction(null)}
      >
        <Form
          layout="vertical"
          onFinish={(value: { note: string }) =>
            cancellationAction &&
            setCancellationAction({ ...cancellationAction, note: value.note.trim() })
          }
        >
          <Form.Item name="note" label="审核理由" rules={[{ required: true, min: 2, message: "必须填写审核理由" }]}>
            <Input.TextArea rows={3} disabled={submitting} />
          </Form.Item>
          <Button type="primary" htmlType="submit">继续复核</Button>
        </Form>
      </Modal>
      <Modal
        open={Boolean(cancellationAction?.note)}
        title="二次确认取消申请审核"
        okText="确认提交"
        cancelText="返回修改"
        confirmLoading={submitting}
        onOk={() => void submitCancellation()}
        onCancel={() => !submitting && setCancellationAction(null)}
      >
        确认{cancellationAction?.approved ? "批准" : "拒绝"}该截单后取消申请？
      </Modal>
    </>
  );
}

function Finance({
  view,
  refunds,
  ledger,
  quality,
  cancellations,
  exceptions,
  pickupWindows,
  roles,
  reload,
  onQualityRefunded,
  onCancellationRefunded,
  loading,
  error,
}: {
  view: AdminPage;
  refunds: Awaited<ReturnType<typeof api.finance>> | null;
  ledger: Awaited<ReturnType<typeof api.ledger>>;
  quality: Awaited<ReturnType<typeof api.quality>>;
  cancellations: Awaited<ReturnType<typeof api.cancellations>>;
  exceptions: FulfillmentException[];
  pickupWindows: PickupWindow[];
  roles: string[];
  reload: () => Promise<void>;
  onQualityRefunded: (
    result: Pick<
      Awaited<ReturnType<typeof api.quality>>[number],
      "id" | "status" | "financeRefundStatus"
    >,
  ) => void;
  onCancellationRefunded: (
    result: Pick<
      Awaited<ReturnType<typeof api.cancellations>>[number],
      "id" | "orderId" | "status"
    >,
  ) => void;
  loading: boolean;
  error: string | null;
}) {
  const { message } = AntApp.useApp();
  const canExecuteRefund =
    roles.includes("FINANCE") || roles.includes("SUPER_ADMIN");
  const [refundTarget, setRefundTarget] = useState<FulfillmentException | null>(null);
  const [refundDraft, setRefundDraft] = useState<{
    exception: FulfillmentException;
    note: string;
  } | null>(null);
  const [pickupRefundTarget, setPickupRefundTarget] = useState<PickupWindow | null>(null);
  const [qualityRefundTarget, setQualityRefundTarget] = useState<
    Awaited<ReturnType<typeof api.quality>>[number] | null
  >(null);
  const [cancellationRefundTarget, setCancellationRefundTarget] = useState<
    Awaited<ReturnType<typeof api.cancellations>>[number] | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const qualityRefundExecutionLabel = (status: string) => {
    if (status === "SUCCEEDED") return "退款已完成";
    if (status === "MANUAL_HOLD") return "退款已挂起，等待人工处理";
    if (status === "RETRYABLE_FAILURE") return "退款恢复中";
    if (status === "SUBMISSION_UNKNOWN") return "退款结果核验中";
    return "退款处理中";
  };
  const executeExceptionRefund = async () => {
    if (!refundDraft || refundDraft.exception.financialFactsError || refundDraft.exception.refundAmountCents === null) return;
    setSubmitting(true);
    try {
      await api.refundException(refundDraft.exception.id, refundDraft.note);
      setRefundDraft(null);
      setRefundTarget(null);
      await refreshAfterMutation(reload, message, "差异退款已提交，已刷新退款与账本状态");
    } catch (caught) {
      void message.error(mutationErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  };
  const executePickupRefund = async () => {
    if (!pickupRefundTarget) return;
    setSubmitting(true);
    try {
      await api.executePickupRefund(pickupRefundTarget.orderId);
      setPickupRefundTarget(null);
      await refreshAfterMutation(reload, message, "逾期领取退款已提交，已刷新退款与账本状态");
    } catch (caught) {
      void message.error(mutationErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  };
  const executeQualityRefund = async () => {
    if (!qualityRefundTarget) return;
    setSubmitting(true);
    try {
      const result = await api.refundQuality(qualityRefundTarget.id);
      // The mutation is authoritative.  Keep its terminal fact in the visible
      // queue before the follow-up read starts, so a transient or delayed read
      // cannot leave a stale financial action available for the same case.
      onQualityRefunded(result);
      setQualityRefundTarget(null);
      await refreshAfterMutation(
        reload,
        message,
        result.status === "RESOLVED"
          ? "品质退款已完成，退款与账本状态已收敛"
          : "品质退款已提交，系统正在同步退款与账本状态",
      );
    } catch (caught) {
      void message.error(mutationErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  };
  const executeCancellationRefund = async () => {
    if (!cancellationRefundTarget) return;
    setSubmitting(true);
    try {
      const result = await api.refundCancellation(
        cancellationRefundTarget.orderId,
      );
      onCancellationRefunded(result);
      setCancellationRefundTarget(null);
      await refreshAfterMutation(
        reload,
        message,
        result.status === "REFUNDED"
          ? "取消退款已完成，退款与账本状态已收敛"
          : "取消退款已提交，系统正在同步退款与账本状态",
      );
    } catch (caught) {
      void message.error(mutationErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <PageTitle title={view === "finance-records" ? "退款记录" : view === "finance-ledger" ? "账务流水" : "退款待办"} subtitle="查看退款进度与账务明细，按权限处理待办" />
      {loading && <Alert type="info" showIcon message="正在刷新财务数据" />}
      {error && (
        <Alert
          type="error"
          showIcon
          message="财务数据加载失败"
          description={error}
          action={<Button size="small" onClick={() => void reload().catch(() => undefined)}>重试</Button>}
        />
      )}
      {view === "finance-records" && <Table
        rowKey="id"
        dataSource={refundHistory(refunds)}
        columns={[
          { title: "退款单", dataIndex: "providerRefundNo" },
          { title: "退款类型", dataIndex: "refundType" },
          { title: "退款时间", render: (_, v) => dateTime(v.createdAt) },
          { title: "订单", dataIndex: "orderId" },
          { title: "金额", render: (_, v) => money(v.amountCents) },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
        ]}
      />
      }
      {view === "finance" && <>
      <section aria-label="品质售后退款">
        <Typography.Title level={4}>品质售后退款</Typography.Title>
        <OperationsQueueTable
          rowKey="id"
          loadPage={api.qualityPage} refreshToken={quality} fixedStatus="REFUNDING"
          locale={{ emptyText: "暂无待执行的品质退款" }}
          columns={[
            { title: "订单", render: (_, value) => value.orderNo ?? value.orderId },
            {
              title: "商品/数量",
              render: (_, value) =>
                value.items.map((item) => `${item.name} × ${item.quantity}`).join("；"),
            },
            { title: "决定说明", render: (_, value) => value.decisionNote ?? "—" },
            {
              title: "操作",
              render: (_, value) =>
                !canExecuteRefund ? (
                  "当前账号无财务执行权限"
                ) : value.financeRefundStatus ? (
                  <Typography.Text type="secondary">
                    {qualityRefundExecutionLabel(value.financeRefundStatus)}
                  </Typography.Text>
                ) : (
                  <Button type="primary" onClick={() => setQualityRefundTarget(value)}>
                    执行退款
                  </Button>
                ),
            },
          ]}
        />
      </section>
      <section aria-label="截单后取消退款">
        <Typography.Title level={4}>截单后取消退款</Typography.Title>
        <OperationsQueueTable
          rowKey="id"
          loadPage={api.cancellationsPage} refreshToken={cancellations} fixedStatus="APPROVED_WAITING_FINANCE"
          locale={{ emptyText: "暂无待执行的截单后取消退款" }}
          columns={[
            { title: "订单", render: (_, value) => value.orderNo ?? value.orderId },
            { title: "取消原因", dataIndex: "reason" },
            { title: "运营审核理由", render: (_, value) => value.reviewNote ?? "—" },
            {
              title: "操作",
              render: (_, value) =>
                canExecuteRefund ? (
                  <Button type="primary" onClick={() => setCancellationRefundTarget(value)}>
                    执行退款
                  </Button>
                ) : (
                  "当前账号无财务执行权限"
                ),
            },
          ]}
        />
      </section>
      <section aria-label="到货差异退款">
        <Typography.Title level={4}>到货差异退款</Typography.Title>
        <OperationsQueueTable
          rowKey="id"
          loadPage={api.exceptionsPage} refreshToken={exceptions} statuses={["REGISTERED", "REFUND_CONFIRMED", "REFUND_PROCESSING", "RESOLVED"]}
          locale={{ emptyText: "暂无履约差异退款" }}
          columns={[
          { title: "订单", render: (_, value) => value.orderNo ?? value.orderId ?? "—" },
          { title: "自提点", render: (_, value) => value.pickupPointName ?? value.pickupPointId ?? "—" },
          { title: "异常类型", render: (_, value) => value.items.map((item) => displayLabel(item.reason)).join("、") },
          { title: "逐商品数量", render: (_, value) => value.items.map((item) => `${item.name} × ${item.affectedQuantity}`).join("；") },
          { title: "退款金额", render: (_, value) => value.refundAmountCents === null ? (value.financialFactsError ?? "金额不可计算") : money(value.refundAmountCents) },
          { title: "运营确认说明", dataIndex: "resolutionNote" },
          { title: "状态", render: (_, value) => <Status value={value.status} /> },
          {
            title: "操作",
            render: (_, value) =>
              canExecuteRefund && value.status === "REFUND_CONFIRMED" ? (
                <Button type="primary" disabled={Boolean(value.financialFactsError) || value.refundAmountCents === null} title={value.financialFactsError ?? undefined} onClick={() => setRefundTarget(value)}>
                  执行退款
                </Button>
              ) : (
                "等待可执行状态"
              ),
          },
          ]}
        />
      </section>
      <section aria-label="逾期领取退款">
        <Typography.Title level={4}>逾期领取退款</Typography.Title>
        <OperationsQueueTable
          rowKey="orderId"
          loadPage={api.pickupWindowsPage} refreshToken={pickupWindows} fixedStatus="REFUND_PENDING"
          locale={{ emptyText: "暂无待执行的逾期领取退款" }}
          columns={[
          { title: "订单", render: (_, value) => value.orderNo ?? value.orderId },
          { title: "自提点", render: (_, value) => value.pickupPointName ?? value.pickupPointId ?? "—" },
          { title: "截止时间", render: (_, value) => dateTime(value.deadlineAt) },
          { title: "状态", render: (_, value) => <Status value={value.status} /> },
          { title: "下一责任", render: (_, value) => value.nextResponsibility ? displayLabel(value.nextResponsibility) : "—" },
          {
            title: "操作",
            render: (_, value) => canExecuteRefund ? (
              <Button type="primary" onClick={() => setPickupRefundTarget(value)}>
                执行退款
              </Button>
            ) : "当前账号无财务执行权限",
          },
          ]}
        />
      </section>
      </>}
      {view === "finance-ledger" && <section aria-label="财务流水">
        <Typography.Title level={4}>财务流水</Typography.Title>
        <Table
          rowKey="id"
          dataSource={newestFirst(ledger)}
          columns={[
          { title: "事件", render: (_, value) => displayLabel(value.eventType) },
          { title: "关联单据", dataIndex: "referenceId" },
          {
            title: "借/贷明细",
            render: (_, value) =>
              value.lines.map((line) => `${line.direction === "DEBIT" ? "借" : "贷"} ${line.accountCode} ${money(line.amountCents)}`).join("；"),
          },
          { title: "借方合计", render: (_, value) => money(value.debitCents) },
          { title: "贷方合计", render: (_, value) => money(value.creditCents) },
          {
            title: "平衡",
            render: (_, value) =>
              value.isBalanced ? (
                <Tag color="green">已平衡</Tag>
              ) : (
                <Alert type="error" showIcon message="借贷不平衡" />
              ),
          },
          { title: "时间", render: (_, value) => dateTime(value.createdAt) },
          ]}
        />
      </section>}
      <Modal
        open={!!refundTarget && !refundDraft}
        title="填写差异退款确认说明"
        footer={null}
        onCancel={() => setRefundTarget(null)}
        destroyOnHidden
      >
        <Form
          layout="vertical"
          onFinish={(value: { confirmationNote: string }) =>
            refundTarget &&
            setRefundDraft({ exception: refundTarget, note: value.confirmationNote.trim() })
          }
        >
          <Form.Item
            name="confirmationNote"
            label="退款确认说明"
            rules={[{ required: true, min: 2, message: "必须填写退款确认说明" }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit">继续复核</Button>
        </Form>
      </Modal>
      <Modal
        open={!!refundDraft}
        title="二次确认执行差异退款"
        okText="确认执行退款"
        cancelText="返回修改"
        confirmLoading={submitting}
        onOk={() => void executeExceptionRefund()}
        onCancel={() => !submitting && setRefundDraft(null)}
      >
        <Typography.Paragraph>
          将对订单 {refundDraft?.exception.orderNo ?? refundDraft?.exception.orderId} 执行
          {refundDraft?.exception.refundAmountCents == null ? "金额不可计算" : money(refundDraft.exception.refundAmountCents)} 的差异退款。
        </Typography.Paragraph>
        <Typography.Paragraph>确认说明：{refundDraft?.note}</Typography.Paragraph>
      </Modal>
      <Modal
        open={!!pickupRefundTarget}
        title="二次确认执行逾期领取退款"
        okText="确认执行退款"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void executePickupRefund()}
        onCancel={() => !submitting && setPickupRefundTarget(null)}
      >
        确认对订单 {pickupRefundTarget?.orderNo ?? pickupRefundTarget?.orderId} 执行已登记的逾期退款？
      </Modal>
      <Modal
        open={Boolean(qualityRefundTarget)}
        title="二次确认执行品质退款"
        okText="确认执行退款"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void executeQualityRefund()}
        onCancel={() => !submitting && setQualityRefundTarget(null)}
      >
        确认对订单 {qualityRefundTarget?.orderNo ?? qualityRefundTarget?.orderId} 执行已批准的品质退款？
      </Modal>
      <Modal
        open={Boolean(cancellationRefundTarget)}
        title="二次确认执行取消退款"
        okText="确认执行退款"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void executeCancellationRefund()}
        onCancel={() => !submitting && setCancellationRefundTarget(null)}
      >
        确认对订单 {cancellationRefundTarget?.orderNo ?? cancellationRefundTarget?.orderId} 执行运营已批准的取消退款？
      </Modal>
    </>
  );
}

function Settings({
  staff,
  points,
  reload,
  currentUserId,
}: {
  staff: InternalStaff[];
  points: PickupPoint[];
  reload: () => Promise<void>;
  currentUserId: string | null;
}) {
  const [query,setQuery] = useState("");
  const [filterStatus,setFilterStatus] = useState("ALL");
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InternalStaff | null>(null);
  const [sensitive, setSensitive] = useState<{
    staff: InternalStaff;
    kind: "suspend" | "restore" | "reset";
  } | null>(null);
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const create = async (value: {
    displayName: string;
    username: string;
    phone: string;
    role: InternalStaff["role"];
    pickupPointIds?: string[];
  }) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await api.createStaff({
        ...value,
        pickupPointIds: value.pickupPointIds ?? [],
      });
      setOpen(false);
      setCredential(result.temporaryPassword);
      await refreshAfterMutation(reload, message, "员工已创建，临时密码仅显示一次");
    } catch (error) {
      message.error(mutationErrorText(error));
    } finally {
      setSubmitting(false);
    }
  };
  const update = async (value: {
    displayName: string;
    phone?: string;
    role: InternalStaff["role"];
    pickupPointIds?: string[];
    reason?: string;
  }) => {
    if (!editing) return;
    if (submitting) return;
    const currentPointIds = [...editing.pickupPointIds].sort();
    const nextPointIds = [
      ...(value.role === "PICKUP_MANAGER" ? value.pickupPointIds ?? [] : []),
    ].sort();
    const scopeChanged =
      JSON.stringify(currentPointIds) !== JSON.stringify(nextPointIds);
    const patch: {
      displayName?: string;
      phone?: string;
      role?: InternalStaff["role"];
      pickupPointIds?: string[];
      reason?: string;
    } = {};
    if (value.displayName.trim() !== editing.displayName) {
      patch.displayName = value.displayName.trim();
    }
    if (value.phone?.trim() && value.phone.trim() !== editing.phone) {
      patch.phone = value.phone.trim();
    }
    if (value.role !== editing.role) patch.role = value.role;
    if (scopeChanged) patch.pickupPointIds = nextPointIds;
    if ((patch.role || patch.pickupPointIds) && value.reason?.trim()) {
      patch.reason = value.reason.trim();
    }
    if (!Object.keys(patch).length) {
      setEditing(null);
      return;
    }
    setSubmitting(true);
    try {
      await api.updateStaff(editing.userId, patch);
      setEditing(null);
      await refreshAfterMutation(reload, message, "员工权限已更新");
    } catch (error) {
      message.error(mutationErrorText(error));
    } finally {
      setSubmitting(false);
    }
  };
  const runSensitive = async (value: { reason: string }) => {
    if (!sensitive) return;
    if (sensitive.staff.userId === currentUserId) {
      message.error("不能停用自己或给自己发放临时密码");
      setSensitive(null);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      if (sensitive.kind === "reset") {
        const result = await api.resetStaffCredential(
          sensitive.staff.userId,
          value.reason,
        );
        setCredential(result.temporaryPassword);
      } else {
        await api.updateStaff(sensitive.staff.userId, {
          status: sensitive.kind === "suspend" ? "SUSPENDED" : "ACTIVE",
          reason: value.reason,
        });
      }
      setSensitive(null);
      await refreshAfterMutation(
        reload,
        message,
        sensitive.kind === "reset"
          ? "临时密码已重置"
          : sensitive.kind === "suspend"
            ? "员工已停用"
            : "员工已恢复",
      );
    } catch (error) {
      message.error(mutationErrorText(error));
    } finally {
      setSubmitting(false);
    }
  };
  const pointOptions = points
    .filter((v) => v.status === "ACTIVE")
    .map((v) => ({ value: v.id, label: v.name }));
  return (
    <>
      <PageTitle
        title="人员与权限"
        subtitle="管理员工账号、角色与点位权限；停用或变更后会话立即失效"
        action={
          <Button type="primary" onClick={() => setOpen(true)}>
            新增员工
          </Button>
        }
      />
      <ListFilters label="员工" query={query} onQuery={setQuery} status={filterStatus} onStatus={setFilterStatus} statuses={["ACTIVE","SUSPENDED","PASSWORD_SETUP_REQUIRED"].map(value=>({value,label:displayLabel(value)}))} />
      <Table
        rowKey="userId"
        dataSource={staff.filter(v => (filterStatus === "ALL" || v.status === filterStatus) && matchesKeyword(query,...[v.displayName,v.staffNo,v.phone]))}
        columns={[
          {
            title: "员工",
            render: (_, v) => (
              <>
                <b>{v.displayName}</b>
                <div>员工编号：{v.staffNo}</div>
                {v.userId === currentUserId ? <Tag color="blue">当前账号</Tag> : null}
              </>
            ),
          },
          { title: "电话", dataIndex: "phone" },
          { title: "角色", render: (_, v) => displayLabel(v.role) },
          {
            title: "管理自提点",
            render: (_, v) => v.role === "SUPER_ADMIN" ? "全部" : v.role === "PICKUP_MANAGER" ? `${v.pickupPointIds.length}个` : "不适用",
          },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, value: InternalStaff) => (
              <Space wrap>
                <Button type="link" onClick={() => setEditing(value)}>
                  编辑
                </Button>
                {value.status === "SUSPENDED" ? (
                  <Button
                    type="link"
                    onClick={() => setSensitive({ staff: value, kind: "restore" })}
                  >
                    恢复
                  </Button>
                ) : value.userId !== currentUserId ? (
                  <Button
                    danger
                    type="link"
                    onClick={() => setSensitive({ staff: value, kind: "suspend" })}
                  >
                    停用
                  </Button>
                ) : null}
                {value.userId !== currentUserId && (
                  <Button
                    type="link"
                    onClick={() => setSensitive({ staff: value, kind: "reset" })}
                  >
                    重置密码
                  </Button>
                )}
              </Space>
            ),
          },
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
              getPopupContainer={(node) => node.parentElement ?? document.body}
              options={[...STAFF_ROLE_OPTIONS]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue("role") === "PICKUP_MANAGER" ? (
                <Form.Item
                  name="pickupPointIds"
                  label="授权自提点"
                  extra="授权后，该负责人的姓名和手机号会作为自提点联系方式，供消费者拨打"
                  rules={[{ required: true }]}
                >
                  <Select
                    mode="multiple"
                    getPopupContainer={(node) => node.parentElement ?? document.body}
                    optionFilterProp="label"
                  options={pointOptions}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting}>
            创建账号
          </Button>
        </Form>
      </Modal>
      <Modal
        open={Boolean(editing)}
        title="编辑员工权限"
        footer={null}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          message="角色或授权点位变更会立即使该员工旧会话失效"
          description="涉及角色、点位的变更必须填写原因；新的权限在员工重新登录后生效。"
        />
        <Form
          layout="vertical"
          initialValues={editing ? { ...editing, phone: "" } : {}}
          onFinish={(value) => void update(value)}
        >
          <Form.Item name="displayName" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="更新手机号（留空不变）" rules={[{ pattern: /^$|^1[3-9]\d{9}$/ }]}>
            <Input placeholder="输入新的大陆手机号" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              getPopupContainer={(node) => node.parentElement ?? document.body}
              options={[...STAFF_ROLE_OPTIONS]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => getFieldValue("role") === "PICKUP_MANAGER" ? (
              <Form.Item
                name="pickupPointIds"
                label="授权自提点"
                extra="授权后，该负责人的姓名和手机号会作为自提点联系方式，供消费者拨打"
                rules={[{ required: true }]}
              >
                <Select
                  mode="multiple"
                  getPopupContainer={(node) => node.parentElement ?? document.body}
                  optionFilterProp="label"
                  options={pointOptions}
                />
              </Form.Item>
            ) : null}
          </Form.Item>
          <Form.Item name="reason" label="变更原因">
            <Input.TextArea rows={2} placeholder="角色或点位变更时必填" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting}>保存并使旧会话失效</Button>
        </Form>
      </Modal>
      <Modal
        open={Boolean(sensitive)}
        title={sensitive?.kind === "reset" ? "重置密码" : sensitive?.kind === "suspend" ? "确认停用员工" : "确认恢复员工"}
        footer={null}
        onCancel={() => setSensitive(null)}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          message="这是敏感操作"
          description={sensitive?.kind === "reset"
            ? `目标：${sensitive.staff.displayName}（${sensitive.staff.phone}）。旧密码和旧会话将立即失效，员工下次登录必须修改密码。请填写原因后确认。`
            : "请填写原因后确认。操作执行时将再次核验当前管理员权限，并立即撤销目标员工的旧会话。"}
        />
        <Form layout="vertical" onFinish={(value) => void runSensitive(value)}>
          <Form.Item name="reason" label="操作原因" rules={[{ required: true, min: 2 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button danger={sensitive?.kind === "suspend"} type="primary" htmlType="submit" loading={submitting}>
            确认执行
          </Button>
        </Form>
      </Modal>
      <Modal
        open={Boolean(credential)}
        title="临时密码（仅显示一次）"
        footer={<Button type="primary" onClick={() => setCredential("")}>我已安全交付给员工</Button>}
        closable={false}
        maskClosable={false}
      >
        <Alert type="warning" showIcon message="关闭后无法再次查看，请使用“重置密码”重新生成。" />
        <Typography.Paragraph>
          <Typography.Text copyable code>{credential}</Typography.Text>
        </Typography.Paragraph>
      </Modal>
    </>
  );
}

export function App() {
  useEffect(() => {
    document.title = entryBranding.title;
  }, []);
  // Every login/logout receives a new epoch.  Responses started for a former
  // identity are ignored, so a new account cannot briefly render the former
  // employee's cached point, order, finance, or service facts.
  const identityEpoch = useRef(0);
  // Requests within one identity can still finish out of order. Every reload
  // therefore receives a strictly newer generation; only its own response may
  // commit page data, loading, or an error state.
  const reloadGeneration = useRef(0);
  const storedRoles = auth.roles();
  const [authenticated, setAuthenticated] = useState(() => {
    if (!requiresLogin) return true;
    const token = auth.token();
    const hasIdentity = hasValidAdminSession(
      requiresLogin,
      token,
      storedRoles,
      auth.userId(),
      auth.username(),
    );
    if (token && !hasIdentity) auth.clear();
    return hasIdentity;
  });
  const roles = requiresLogin
    ? storedRoles
    : storedRoles.length
      ? storedRoles
      : ["SUPER_ADMIN"];
  const defaultPage = getDefaultAdminPage(roles);
  const [page, setPage] = useState<AdminPage>(
    () => defaultPage ?? "settings",
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [areas, setAreas] = useState<ServiceArea[]>([]),
    [points, setPoints] = useState<PickupPoint[]>([]),
    [skus, setSkus] = useState<CatalogSku[]>([]),
    [categories, setCategories] = useState<ProductCategory[]>([]),
    [campaigns, setCampaigns] = useState<Campaign[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [plans, setPlans] = useState<DeliveryPlan[]>([]),
    [batches, setBatches] = useState<
      Array<{ id: string; campaignId: string; status: string }>
    >([]),
    [deliveries, setDeliveries] = useState<CommunityDelivery[]>([]),
    [staff, setStaff] = useState<InternalStaff[]>([]),
    [quality, setQuality] = useState<Awaited<ReturnType<typeof api.quality>>>(
      [],
    ),
    [cancellations, setCancellations] = useState<
      Awaited<ReturnType<typeof api.cancellations>>
    >([]),
    [exceptions, setExceptions] = useState<
      Awaited<ReturnType<typeof api.exceptions>>
    >([]),
    [pickupWindows, setPickupWindows] = useState<
      Awaited<ReturnType<typeof api.pickupWindows>>
    >([]),
    [refunds, setRefunds] = useState<
      Awaited<ReturnType<typeof api.finance>> | null
    >(null),
    [ledger, setLedger] = useState<Awaited<ReturnType<typeof api.ledger>>>(
      [],
    ),
    [notifications, setNotifications] = useState<
      Awaited<ReturnType<typeof api.manualNotifications>>
    >([]),
    [interests, setInterests] = useState<
      Awaited<ReturnType<typeof api.serviceAreaInterests>>
    >([]),
    [audits, setAudits] = useState<Awaited<ReturnType<typeof api.audits>>>(
      [],
    );
  const navigation = useMemo(
    () => getAdminNavigation(roles),
    [roles.join(",")],
  );
  const currentView: AdminPage = isAllowedAdminPage(roles, page)
    ? page
    : defaultPage ?? "settings";
  const currentPage = getAdminPageModule(currentView);
  useEffect(() => {
    if (!authenticated) return;
    const frame = window.requestAnimationFrame(() => {
      const menu = document.querySelector<HTMLElement>(".app-sider > .ant-layout-sider-children > .ant-menu");
      const selected = menu?.querySelector<HTMLElement>(".ant-menu-item-selected");
      if (!menu || !selected) return;
      const bounds = menu.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (item.bottom > bounds.bottom) menu.scrollTop += Math.ceil(item.bottom - bounds.bottom);
      else if (item.top < bounds.top) menu.scrollTop -= Math.ceil(bounds.top - item.top);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [authenticated, currentView]);
  const clearWorkspace = useCallback((nextPage: AdminPage = "settings") => {
    identityEpoch.current += 1;
    reloadGeneration.current += 1;
    setAreas([]);
    setPoints([]);
    setSkus([]);
    setCategories([]);
    setCampaigns([]);
    setOrders([]);
    setPlans([]);
    setBatches([]);
    setDeliveries([]);
    setStaff([]);
    setQuality([]);
    setCancellations([]);
    setExceptions([]);
    setPickupWindows([]);
    setRefunds(null);
    setLedger([]);
    setNotifications([]);
    setInterests([]);
    setAudits([]);
    setLoadError(null);
    setLoginNotice(null);
    setLoading(false);
    setPage(nextPage);
  }, []);
  const establishSession = useCallback(() => {
    const nextRoles = auth.roles();
    const nextDefault = getDefaultAdminPage(nextRoles);
    if (requiresLogin && !nextDefault) {
      auth.clear();
      clearWorkspace();
      setAuthenticated(false);
      return;
    }
    clearWorkspace(nextDefault ?? "settings");
    setAuthenticated(true);
  }, [clearWorkspace]);
  const reload = async (initial = false) => {
    const epoch = identityEpoch.current;
    const generation = ++reloadGeneration.current;
    const isCurrentReload = () =>
      identityEpoch.current === epoch && reloadGeneration.current === generation;
    const commit = <T,>(setter: (value: T) => void) => (value: T) => {
      if (isCurrentReload()) setter(value);
    };
    if (isCurrentReload()) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const work: Array<Promise<unknown>> = [];
      if (currentPage === "dashboard")
        work.push(
          api.areas().then(commit(setAreas)),
          api.points().then(commit(setPoints)),
          api.campaigns().then(commit(setCampaigns)),
          api.orders().then(commit(setOrders)),
        );
      if (currentPage === "products")
        work.push(
          api.skus().then(commit(setSkus)),
          api.categories(true).then(commit(setCategories)),
        );
      if (currentPage === "campaigns")
        work.push(
          api.areas().then(commit(setAreas)),
          api.points().then(commit(setPoints)),
          api.skus().then(commit(setSkus)),
          api.campaigns().then(commit(setCampaigns)),
        );
      if (currentPage === "orders")
        work.push(
          api.orders().then(commit(setOrders)),
          api.campaigns().then(commit(setCampaigns)),
        );
      if (currentPage === "logistics")
        work.push(
          api.plans().then(commit(setPlans)),
          api.batches().then(commit(setBatches)),
          api.deliveries().then(commit(setDeliveries)),
          api.campaigns().then(commit(setCampaigns)),
          api.orders().then(commit(setOrders)),
        );
      if (currentPage === "pickup-points")
        work.push(api.areas().then(commit(setAreas)), api.points().then(commit(setPoints)));
      if (currentPage === "point-workbench")
        work.push(api.deliveries().then(commit(setDeliveries)));
      if (currentPage === "settings")
        work.push(api.staff().then(commit(setStaff)), api.points().then(commit(setPoints)));
      // Paged queues own their requests. Only explicit refreshes invalidate them;
      // initial page mounting performs one request per queue.
      if (!initial && isCurrentReload()) {
        if (currentPage === "service" || currentPage === "finance") {
          setQuality(value => [...value]);
          setCancellations(value => [...value]);
          setExceptions(value => [...value]);
          setPickupWindows(value => [...value]);
        }
        if (currentPage === "governance") setNotifications(value => [...value]);
      }
      if (currentView === "interests")
        work.push(api.serviceAreaInterests().then(commit(setInterests)));
      if (currentPage === "finance")
        work.push(
          Promise.allSettled([api.finance(), api.ledger()]).then(([nextRefunds, nextLedger]) => {
            if (nextRefunds.status === "fulfilled") commit(setRefunds)(nextRefunds.value);
            if (nextLedger.status === "fulfilled") commit(setLedger)(nextLedger.value);
            const failed = [nextRefunds, nextLedger].find((result): result is PromiseRejectedResult => result.status === "rejected");
            if (failed) throw failed.reason;
          }),
        );
      if (currentPage === "audit")
        work.push(
          api.audits().then(commit(setAudits)),
          api.staff().then(commit(setStaff)),
        );
      await Promise.all(work);
    } catch (caught) {
      if (isCurrentReload()) setLoadError(adminLoadErrorText(caught));
      throw caught;
    } finally {
      if (isCurrentReload()) setLoading(false);
    }
  };
  useEffect(() => {
    const expired = () => {
      auth.clear();
      clearWorkspace();
      setLoginNotice("登录状态已失效，请重新登录。");
      setAuthenticated(false);
    };
    window.addEventListener("admin-auth-expired", expired);
    if (!authenticated) return () => window.removeEventListener("admin-auth-expired", expired);
    if (!defaultPage) {
      auth.clear();
      clearWorkspace();
      setAuthenticated(false);
      return () => window.removeEventListener("admin-auth-expired", expired);
    }
    if (!isAllowedAdminPage(roles, page)) {
      setPage(defaultPage);
      return () => window.removeEventListener("admin-auth-expired", expired);
    }
    void reload(true).catch(() => undefined);
    return () => window.removeEventListener("admin-auth-expired", expired);
  }, [authenticated, page, roles.join(","), clearWorkspace]);
  if (!authenticated)
    return (
      <AntApp>
        <Login done={establishSession} notice={loginNotice} />
      </AntApp>
    );
  const mainPageLoadFailed =
    Boolean(loadError) &&
    ["dashboard", "products", "campaigns", "orders", "pickup-points", "settings"].includes(
      currentPage,
    );
  const pageContent = mainPageLoadFailed ? (
    <PageLoadError page={currentPage} reload={reload} />
  ) : currentPage === "dashboard" ? (
      <Dashboard {...{ areas, points, campaigns, orders }} onNavigate={setPage} />
    ) : currentPage === "products" ? (
      <Products key={currentView} view={currentView} values={skus} categories={categories} reload={reload} />
    ) : currentPage === "campaigns" ? (
      <Campaigns values={campaigns} {...{ areas, points, skus, reload }} />
    ) : currentPage === "orders" ? (
      <Orders
        values={orders}
        campaigns={campaigns}
        roles={roles}
        reload={reload}
        onNavigate={setPage}
      />
    ) : currentPage === "logistics" ? (
      <Logistics view={currentView}
        {...{
          plans,
          batches,
          deliveries,
          campaigns,
          orders,
          roles,
          loading,
          error: loadError,
          reload,
          onNavigate: setPage,
        }}
      />
    ) : currentPage === "pickup-points" ? (
      <Areas view={currentView} {...{ areas, points, reload }} />
    ) : currentPage === "point-workbench" ? (
      <PointWorkbench view={currentView}
        {...{ deliveries, roles, loading, error: loadError, reload }}
      />
    ) : currentPage === "consumers" ? (
      <Consumers loadPage={api.consumers} loadDetail={api.consumerDetail} />
    ) : currentPage === "service" ? (
      <Service view={currentView}
        {...{
          quality,
          cancellations,
          exceptions,
          pickupWindows,
          roles,
          reload,
          loading,
          error: loadError,
        }}
      />
    ) : currentPage === "governance" ? (
      <GovernancePage
        {...{
          notifications,
          interests,
          loading,
          error: loadError,
          reload,
          canHandleNotifications:
            currentView === "governance" && (roles.includes("CUSTOMER_SERVICE") || roles.includes("SUPER_ADMIN")),
          canHandleInterests:
            currentView === "interests" && (roles.includes("OPERATOR") || roles.includes("SUPER_ADMIN")),
        }}
      />
    ) : currentPage === "finance" ? (
      <Finance view={currentView}
        {...{
          refunds,
          ledger,
          quality,
          cancellations,
          exceptions,
          pickupWindows,
          roles,
          reload,
          onQualityRefunded: (result) =>
            setQuality((current) =>
              current.map((value) =>
                value.id === result.id
                  ? {
                      ...value,
                      status: result.status,
                      financeRefundStatus: result.financeRefundStatus,
                    }
                  : value,
              ),
            ),
          onCancellationRefunded: (result) =>
            setCancellations((current) =>
              current.map((value) =>
                value.id === result.id || value.orderId === result.orderId
                  ? { ...value, status: result.status }
                  : value,
              ),
            ),
          loading,
          error: loadError,
        }}
      />
    ) : currentPage === "audit" ? (
      <AuditPage audits={audits} staff={staff} loading={loading} error={loadError} reload={reload} />
    ) : (
      <Settings {...{ staff, points, reload }} currentUserId={auth.userId()} />
    );
  const content = (
    <>
      {loading && (
        <Alert
          type="info"
          showIcon
          icon={<ReloadOutlined spin />}
          message="正在加载数据…"
        />
      )}
      {pageContent}
    </>
  );
  const navigationPath = getAdminNavigationPath(roles, currentView);
  return (
    <AntApp>
      <Layout className="app-shell">
        <Sider
          className="app-sider"
          width={232}
          theme="light"
          breakpoint="md"
          collapsedWidth={0}
          collapsible
        >
          <div className="brand">
            <i className="brand-symbol" aria-hidden="true">乡</i>
            <div><strong>乡味集</strong><span>{entryBranding.loginSection}</span></div>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[currentView]}
            defaultOpenKeys={navigation.map((group) => `section:${group.key}`)}
            onClick={({ key }) => setPage(key as AdminPage)}
            items={navigation.map((group) => group.items.length === 1 && !["products", "orders", "fulfillment", "sites", "finance", "access-audit", "point-workbench"].includes(group.key) ? ({
              key: group.items[0]!.key, icon: navigationGroupIcon(group.key), label: group.items[0]!.label,
            }) : ({
              key: `section:${group.key}`,
              icon: navigationGroupIcon(group.key),
              label: group.label,
              children: group.items.map((item) => ({
                key: item.key,
                label: item.label,
              })),
            }))}
          />
          {requiresLogin && (
            <div className="app-sider__account">
              <AccountMenu
                displayName={staff.find((value) => value.userId === auth.userId())?.displayName}
                username={auth.username()}
                role={roles[0]}
                onLogout={() =>
                  void api.logout().finally(() => {
                    auth.clear();
                    clearWorkspace();
                    setAuthenticated(false);
                  })
                }
              />
            </div>
          )}
        </Sider>
        <Layout>
          <Header className="topbar">
            <div className="topbar__context">
              <Breadcrumb
                aria-label="当前位置"
                items={[
                  { title: navigationPath?.groupLabel ?? "运营后台" },
                  { title: navigationPath?.pageLabel ?? "当前页面" },
                ]}
              />
            </div>
            <Space className="topbar__actions" size={12}>
              <Button
                className="topbar__refresh"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void reload().catch(() => undefined)}
              >
                刷新
              </Button>
              {requiresLogin && (
                <div className="account-menu--mobile">
                  <AccountMenu
                    displayName={staff.find((value) => value.userId === auth.userId())?.displayName}
                    username={auth.username()}
                    role={roles[0]}
                    onLogout={() =>
                      void api.logout().finally(() => {
                        auth.clear();
                        clearWorkspace();
                        setAuthenticated(false);
                      })
                    }
                  />
                </div>
              )}
            </Space>
          </Header>
          <Content className="content" data-page={currentPage} data-view={currentView}>{content}</Content>
        </Layout>
      </Layout>
    </AntApp>
  );
}
