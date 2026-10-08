import { Table as AntTable, type TableProps } from "antd";
import { normalizeAdminTableColumns } from "./admin-table-columns.ts";

export function AdminTable<T extends object>(props: TableProps<T>) {
  if (props.columns === undefined) return <AntTable<T> {...props} />;
  return <AntTable<T> {...props} columns={normalizeAdminTableColumns(props.columns)!} />;
}
