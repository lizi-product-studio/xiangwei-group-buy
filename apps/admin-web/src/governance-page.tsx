import { OperationsQueueTable } from "./operations-queue-table.tsx";
import { useState } from "react";
import dayjs from "dayjs";
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  api,
  type Notification,
  type ServiceAreaInterest,
} from "./api.ts";
import { adminErrorNotice } from "./request-error.tsx";
import { displayLabel } from "./labels.ts";

const NotificationStatus = ({ value }: { value: string }) => (
  <Tag
    color={
      value === "MANUAL_COMPLETED" || value === "WECHAT_SENT"
        ? "green"
        : value === "SUBMISSION_UNKNOWN"
          ? "volcano"
          : "gold"
    }
  >
    {displayLabel(value)}
  </Tag>
);

const InterestStatus = ({ value }: { value: string }) => (
  <Tag color={value === "CLOSED" ? "green" : value === "NEW" ? "gold" : "blue"}>
    {displayLabel(value)}
  </Tag>
);
const displayDateTime = (value: string | null | undefined) =>
  value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—";
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

type PendingNotificationAction =
  | { notification: Notification; stage: "retry-confirm" }
  | { notification: Notification; stage: "form" }
  | {
      notification: Notification;
      stage: "confirm";
      note: string;
      channel: "WECHAT_CUSTOMER_SERVICE" | "EXTERNAL_CRM" | "OTHER_APPROVED_CHANNEL";
      externalReference: string;
      result: "REACHED" | "USER_ACKNOWLEDGED" | "RESOLVED";
    };
type PendingInterestAction =
  | { interest: ServiceAreaInterest; status: "CONTACTED" | "CLOSED"; stage: "form" }
  | {
      interest: ServiceAreaInterest;
      status: "CONTACTED" | "CLOSED";
      stage: "confirm";
      note: string;
    };

export function GovernancePage({
  notifications,
  interests,
  loading,
  error,
  reload,
  canHandleNotifications,
  canHandleInterests,
}: {
  notifications: Notification[];
  interests: ServiceAreaInterest[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  canHandleNotifications: boolean;
  canHandleInterests: boolean;
}) {
  const { message } = AntApp.useApp();
  const [notificationAction, setNotificationAction] =
    useState<PendingNotificationAction | null>(null);
  const [interestAction, setInterestAction] =
    useState<PendingInterestAction | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const retry = async () => {
    if (!notificationAction || notificationAction.stage !== "retry-confirm")
      return;
    setSubmitting(true);
    try {
      await api.retryNotification(notificationAction.notification.id);
      setNotificationAction(null);
      await refreshAfterMutation(reload, message, "通知已重新进入系统重试队列");
    } catch (caught) {
      void message.error(adminErrorNotice(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const completeNotification = async () => {
    if (!notificationAction || notificationAction.stage !== "confirm") return;
    setSubmitting(true);
    try {
      await api.completeNotification(
        notificationAction.notification.id,
        {
          note: notificationAction.note,
          channel: notificationAction.channel,
          externalReference: notificationAction.externalReference,
          result: notificationAction.result,
        },
      );
      setNotificationAction(null);
      await refreshAfterMutation(reload, message, "已记录人工处理结果");
    } catch (caught) {
      void message.error(adminErrorNotice(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const updateInterest = async () => {
    if (!interestAction || interestAction.stage !== "confirm") return;
    setSubmitting(true);
    try {
      await api.updateServiceAreaInterest(interestAction.interest.id, {
        status: interestAction.status,
        note: interestAction.note,
      });
      setInterestAction(null);
      await refreshAfterMutation(reload, message, "区域开通意向已更新");
    } catch (caught) {
      void message.error(adminErrorNotice(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <header className="section-header">
        <div>
          <Typography.Title level={2}>
            {canHandleInterests ? "区域开通意向" : "通知处理"}
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            {canHandleInterests
              ? "登记区域开通需求与联系结果；记录意向不代表服务已开通。"
              : "处理未成功送达的订单提醒，并记录可复核的联系结果。"}
          </Typography.Paragraph>
        </div>
        <Button loading={loading} onClick={() => void reload().catch(() => undefined)}>
          刷新队列
        </Button>
      </header>
      {loading && <Alert type="info" showIcon message="正在刷新治理队列" />}
      {error && (
        <Alert
          type="error"
          showIcon
          message="治理队列加载失败"
          description={error}
          action={<Button size="small" onClick={() => void reload().catch(() => undefined)}>重试</Button>}
        />
      )}

      {canHandleNotifications && <section aria-label="通知人工处理队列">
        <Typography.Title level={4}>通知人工处理</Typography.Title>
        <Alert
          type="info"
          showIcon
          message="此队列不展示联系方式"
          description="人工完成只记录已通过既有合规渠道处理的结果，不代表本系统提供联系方式。"
          style={{ marginBottom: 16 }}
        />
        <OperationsQueueTable
          rowKey="id"
          loadPage={api.manualNotificationsPage} refreshToken={notifications} statuses={["MANUAL_REQUIRED", "SUBMISSION_UNKNOWN", "PENDING_DELIVERY"]}
          locale={{ emptyText: "暂无需要人工处理或重试的通知" }}
          columns={[
            { title: "通知类型", render: (_, value: Notification) => displayLabel(value.type) },
            { title: "订单", render: (_, value: Notification) => value.orderNo ?? value.orderId },
            { title: "用户标识", dataIndex: "userDisplay" },
            { title: "失败原因", render: (_, value: Notification) => value.lastDeliveryError ?? "—" },
            { title: "尝试次数", dataIndex: "deliveryAttempts" },
            { title: "最近时间", render: (_, value: Notification) => displayDateTime(value.lastActivityAt) },
            { title: "状态", render: (_, value: Notification) => <NotificationStatus value={value.status} /> },
            {
              title: "操作",
              render: (_, value: Notification) =>
                value.status === "MANUAL_COMPLETED" ? (
                  <Typography.Text type="secondary">已人工完成</Typography.Text>
                ) : (
                  <Space wrap>
                    {value.status === "MANUAL_REQUIRED" && (
                      <Button
                        disabled={submitting}
                        onClick={() =>
                          setNotificationAction({
                            notification: value,
                            stage: "retry-confirm",
                          })
                        }
                      >
                        系统重试
                      </Button>
                    )}
                    {value.status === "SUBMISSION_UNKNOWN" && (
                      <Typography.Text type="warning">
                        微信可能已送达，请勿再次系统发送
                      </Typography.Text>
                    )}
                    <Button
                      type="primary"
                      disabled={submitting}
                      onClick={() =>
                        setNotificationAction({ notification: value, stage: "form" })
                      }
                    >
                      人工完成
                    </Button>
                  </Space>
                ),
            },
          ]}
        />
      </section>}

      <Modal
        open={notificationAction?.stage === "retry-confirm"}
        title="二次确认系统重试"
        okText="确认重新投递"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void retry()}
        onCancel={() => !submitting && setNotificationAction(null)}
      >
        <Typography.Paragraph>
          将重新投递通知“
          {notificationAction?.stage === "retry-confirm"
            ? notificationAction.notification.type
            : ""}
          ”；关联订单：
          {notificationAction?.stage === "retry-confirm"
            ? notificationAction.notification.orderNo ??
              notificationAction.notification.orderId
            : ""}
          。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          仅重新进入既有系统投递流程，不展示或新增消费者联系方式。
        </Typography.Paragraph>
      </Modal>

      {canHandleInterests && <section aria-label="区域开通意向">
        <Typography.Title level={4}>区域开通意向</Typography.Title>
        <Table
          rowKey="id"
          dataSource={interests}
          locale={{ emptyText: "暂无区域开通意向" }}
          columns={[
            { title: "区域", dataIndex: "regionText" },
            { title: "联系人", dataIndex: "contactName" },
            { title: "联系电话", dataIndex: "maskedContactPhone" },
            { title: "隐私同意时间", render: (_, value: ServiceAreaInterest) => displayDateTime(value.privacyConsentedAt) },
            { title: "状态", render: (_, value: ServiceAreaInterest) => <InterestStatus value={value.status} /> },
            { title: "处理说明", render: (_, value: ServiceAreaInterest) => value.statusNote ?? "—" },
            { title: "最近处理", render: (_, value: ServiceAreaInterest) => displayDateTime(value.statusChangedAt ?? value.createdAt) },
            {
              title: "操作",
              render: (_, value: ServiceAreaInterest) => {
                const next = value.status === "NEW" ? "CONTACTED" : value.status === "CONTACTED" ? "CLOSED" : null;
                return next ? (
                  <Button
                    type="primary"
                    disabled={submitting}
                    onClick={() => setInterestAction({ interest: value, status: next, stage: "form" })}
                  >
                    {next === "CONTACTED" ? "登记已联系" : "关闭意向"}
                  </Button>
                ) : (
                  <Typography.Text type="secondary">已关闭</Typography.Text>
                );
              },
            },
          ]}
        />
      </section>}

      <Modal
        open={notificationAction?.stage === "form"}
        title="填写人工处理说明"
        footer={null}
        destroyOnHidden
        onCancel={() => !submitting && setNotificationAction(null)}
      >
        <Form
          layout="vertical"
          onFinish={(value: {
            note: string;
            channel: "WECHAT_CUSTOMER_SERVICE" | "EXTERNAL_CRM" | "OTHER_APPROVED_CHANNEL";
            externalReference: string;
            result: "REACHED" | "USER_ACKNOWLEDGED" | "RESOLVED";
          }) => {
            if (!notificationAction || notificationAction.stage !== "form") return;
            setNotificationAction({
              notification: notificationAction.notification,
              stage: "confirm",
              note: value.note.trim(),
              channel: value.channel,
              externalReference: value.externalReference.trim(),
              result: value.result,
            });
          }}
        >
          <Form.Item
            name="channel"
            label="联系渠道"
            rules={[{ required: true, message: "必须选择已批准的联系渠道" }]}
          >
            <Select
              options={[
                { value: "WECHAT_CUSTOMER_SERVICE", label: "微信客服" },
                { value: "EXTERNAL_CRM", label: "外部客服工单" },
                { value: "OTHER_APPROVED_CHANNEL", label: "其他已批准渠道" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="externalReference"
            label="外部会话或工单编号"
            rules={[{ required: true, min: 4, message: "必须填写可复核的外部引用" }]}
          >
            <Input placeholder="例如微信客服会话号或 CRM 工单号" />
          </Form.Item>
          <Form.Item
            name="result"
            label="联系结果"
            rules={[{ required: true, message: "必须选择联系结果" }]}
          >
            <Select
              options={[
                { value: "REACHED", label: "已联系到用户" },
                { value: "USER_ACKNOWLEDGED", label: "用户已知悉" },
                { value: "RESOLVED", label: "问题已解决" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="note"
            label="处理说明"
            rules={[{ required: true, min: 2, message: "必须填写处理说明" }]}
          >
            <Input.TextArea rows={3} placeholder="仅记录既有合规渠道的处理结果" />
          </Form.Item>
          <Button type="primary" htmlType="submit">继续复核</Button>
        </Form>
      </Modal>
      <Modal
        open={notificationAction?.stage === "confirm"}
        title="二次确认人工完成"
        okText="确认人工完成"
        cancelText="返回修改"
        confirmLoading={submitting}
        onOk={() => void completeNotification()}
        onCancel={() => !submitting && setNotificationAction(null)}
      >
        <Typography.Paragraph>该操作不会发送或展示消费者联系方式。</Typography.Paragraph>
        <Typography.Paragraph>
          渠道：{notificationAction?.stage === "confirm" ? notificationAction.channel : "—"}；
          外部引用：{notificationAction?.stage === "confirm" ? notificationAction.externalReference : "—"}；
          结果：{notificationAction?.stage === "confirm" ? notificationAction.result : "—"}。
        </Typography.Paragraph>
        <Typography.Paragraph>处理说明：{notificationAction?.stage === "confirm" ? notificationAction.note : ""}</Typography.Paragraph>
      </Modal>

      {canHandleInterests && <Modal
        open={interestAction?.stage === "form"}
        title={interestAction?.status === "CONTACTED" ? "登记已联系" : "关闭区域意向"}
        footer={null}
        destroyOnHidden
        onCancel={() => !submitting && setInterestAction(null)}
      >
        <Form
          layout="vertical"
          onFinish={(value: { note: string }) => {
            if (!interestAction || interestAction.stage !== "form") return;
            setInterestAction({ ...interestAction, stage: "confirm", note: value.note.trim() });
          }}
        >
          <Form.Item name="note" label="状态变更说明" rules={[{ required: true, min: 2, message: "必须填写状态变更说明" }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit">继续复核</Button>
        </Form>
      </Modal>}
      {canHandleInterests && <Modal
        open={interestAction?.stage === "confirm"}
        title="二次确认意向状态"
        okText="确认更新"
        cancelText="返回修改"
        confirmLoading={submitting}
        onOk={() => void updateInterest()}
        onCancel={() => !submitting && setInterestAction(null)}
      >
        确认将“{interestAction?.interest.regionText}”更新为 {interestAction?.status}？
      </Modal>}
    </>
  );
}
