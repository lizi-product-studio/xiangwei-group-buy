import { Alert, Button, Descriptions, Table, Typography } from "antd";
import type { AuditLog } from "./api.ts";
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
  loading,
  error,
  reload,
}: {
  audits: AuditLog[];
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
            仅显示安全脱敏后的变更快照，可按 requestId 追溯操作。
          </Typography.Paragraph>
        </div>
        <Button loading={loading} onClick={() => void reload()}>
          刷新记录
        </Button>
      </header>
      {loading && <Alert type="info" showIcon message="正在刷新审计记录" />}
      {error && (
        <Alert
          type="error"
          showIcon
          message="审计记录加载失败"
          description={error}
          action={<Button size="small" onClick={() => void reload()}>重试</Button>}
        />
      )}
      <Table
        rowKey="id"
        dataSource={audits}
        locale={{ emptyText: "暂无审计记录" }}
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
          { title: "操作者", dataIndex: "actorId" },
          { title: "动作", render: (_, value) => displayLabel(value.action) },
          { title: "资源", render: (_, value) => `${displayLabel(value.resourceType)} / ${value.resourceId}` },
          { title: "请求 ID", dataIndex: "requestId" },
          { title: "时间", dataIndex: "createdAt" },
        ]}
      />
    </>
  );
}
