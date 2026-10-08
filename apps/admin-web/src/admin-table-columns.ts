import type { TableProps } from "antd";

export function normalizeAdminTableColumns<T extends object>(
  columns: TableProps<T>["columns"],
): TableProps<T>["columns"] {
  return columns?.map((column) => {
    if ("children" in column && column.children)
      return { ...column, children: normalizeAdminTableColumns(column.children) };
    if (typeof column.title !== "string" || column.title.trim() !== "操作")
      return column;
    return {
      ...column,
      align: "left" as const,
      className: [column.className, "table-actions"].filter(Boolean).join(" "),
    };
  });
}
