import { Alert, Button, Descriptions, Spin, Tooltip, Typography } from "antd";
import { AdminTable as Table } from "./admin-table.tsx";
import type { AuditLog, InternalStaff } from "./api.ts";
import { formatAuditTime, resolveAuditActor, shortAuditId } from "./audit-display.ts";
import { displayLabel } from "./labels.ts";

function renderSnapshot(value: unknown) {
  if (value === null || value === undefined) return "—";
  return (
    <pre className="audit-snapshot">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function AuditPage({
  audits,
  staff,
  loading,
  error,
  reload,
}: {
  audits: AuditLog[];
  staff: InternalStaff[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}) {
  return (
    <>
      <header className="section-header">
        <div>
          <Typography.Title level={2}>审计记录</Typography.Title>
          <Typography.Paragraph type="secondary">
            仅显示经过安全处理的变更快照，可按 requestId 追溯操作。
          </Typography.Paragraph>
        </div>
        <Button loading={loading} onClick={() => void reload().catch(() => undefined)}>
          刷新记录
        </Button>
      </header>
      {loading && <div className="neutral-loading-strip" role="status" aria-label="正在刷新审计记录"><Spin size="small" /></div>}
      {error && (
        <Alert
          type="error"
          showIcon
          message="审计记录加载失败"
          description={error}
          action={<Button size="small" onClick={() => void reload().catch(() => undefined)}>重试</Button>}
        />
      )}
      <Table
        className="audit-table"
        rowKey="id"
        dataSource={audits}
        locale={{ emptyText: "暂无审计记录" }}
        scroll={{ x: 1040 }}
        pagination={{ showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
        expandable={{
          expandedRowRender: (value) => (
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="变更前">
                {renderSnapshot(value.beforeData)}
              </Descriptions.Item>
              <Descriptions.Item label="变更后">
                {renderSnapshot(value.afterData)}
              </Descriptions.Item>
            </Descriptions>
          ),
        }}
        columns={[
          {
            title: "操作者",
            width: 190,
            render: (_, value) => {
              const actor = resolveAuditActor(value.actorId, staff);
              return (
                <div className="audit-primary-cell">
                  <strong>{actor.name}</strong>
                  <span>{actor.secondary}</span>
                </div>
              );
            },
          },
          {
            title: "操作内容",
            width: 190,
            render: (_, value) => {
              const label = displayLabel(value.action);
              return label === value.action ? (
                <div className="audit-primary-cell">
                  <strong>系统操作</strong>
                  <span className="audit-technical-code">{value.action}</span>
                </div>
              ) : label;
            },
          },
          {
            title: "操作对象",
            width: 220,
            render: (_, value) => (
              <div className="audit-primary-cell">
                <strong>{displayLabel(value.resourceType)}</strong>
                <Tooltip title={value.resourceId}>
                  <span className="audit-ellipsized-id">{value.resourceId}</span>
                </Tooltip>
              </div>
            ),
          },
          {
            title: "追踪编号",
            width: 190,
            render: (_, value) => (
              <Typography.Text
                className="audit-copy-id"
                copyable={{ text: value.requestId, tooltips: ["复制完整编号", "已复制"] }}
                ellipsis={{ tooltip: value.requestId }}
              >
                {shortAuditId(value.requestId)}
              </Typography.Text>
            ),
          },
          {
            title: "操作时间",
            width: 180,
            render: (_, value) => <span className="audit-time">{formatAuditTime(value.createdAt)}</span>,
          },
        ]}
      />
    </>
  );
}
