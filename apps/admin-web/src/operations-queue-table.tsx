import { useEffect, useRef, useState } from "react";
import { Alert, Button, Select, Table, type TableProps } from "antd";
import { adminErrorText, type QueuePage, type QueueQuery } from "./api.ts";
import { adminErrorNoticeFromText } from "./request-error.tsx";
import { displayLabel } from "./labels.ts";

export function OperationsQueueTable<T extends object>({loadPage, refreshToken, statuses, fixedStatus, defaultStatus, allowAllStatuses = true, ...props}: Omit<TableProps<T>, "dataSource" | "pagination" | "onChange"> & {
  loadPage: (query: QueueQuery) => Promise<QueuePage<T>>;
  refreshToken: unknown;
  statuses?: string[];
  fixedStatus?: string;
  defaultStatus?: string;
  allowAllStatuses?: boolean;
}) {
  const [query, setQuery] = useState<QueueQuery>({page: 1, pageSize: 20, ...(defaultStatus ? {status: defaultStatus} : {})});
  const [result, setResult] = useState<QueuePage<T>>({data: [], pagination: {page: 1, pageSize: 20, total: 0}});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setError(null);
    // Remove stale actionable rows while a different page/filter is loading.
    setResult(previous => ({...previous, data: []}));
    // React StrictMode cleans up its first mount effect before this microtask.
    // Do not dispatch a request whose owner has already been superseded.
    void Promise.resolve().then(() => {
      if (generation.current !== version) return null;
      return loadPage({...query, ...(fixedStatus ? {status: fixedStatus} : {})});
    }).then(value => {
      if (!value || generation.current !== version) return;
      if (query.page > 1 && !value.data.length && value.pagination.total <= (query.page - 1) * query.pageSize) {
        setQuery(previous => ({...previous, page: Math.max(1, Math.ceil(value.pagination.total / previous.pageSize))}));
      } else setResult(value);
    }).catch(caught => {
      if (generation.current === version) setError(adminErrorText(caught));
    }).finally(() => { if (generation.current === version) setLoading(false); });
    return () => { generation.current++; };
  }, [loadPage, query, fixedStatus, refreshToken, retry]);
  return <div>
    {statuses && <Select aria-label="待办状态筛选" style={{minWidth: 180, marginBottom: 12}} value={query.status ?? ""}
      options={[...(allowAllStatuses ? [{value: "", label: "全部可见状态"}] : []), ...statuses.map(value => ({value, label: displayLabel(value)}))]}
      onChange={(status: string) => setQuery({page: 1, pageSize: query.pageSize, ...(status ? {status} : {})})} />}
    {error && <Alert type="error" showIcon message="待办加载失败" description={adminErrorNoticeFromText(error)} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
    <Table<T> {...props} loading={loading} dataSource={result.data} pagination={{current: query.page, pageSize: query.pageSize, total: result.pagination.total, showSizeChanger: true, showTotal: total => `共 ${total} 条`, onChange: (page, pageSize) => setQuery(previous => ({...previous, page, pageSize}))}} />
  </div>;
}
