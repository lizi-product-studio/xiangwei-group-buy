import { describe, expect, it } from "vitest";
import { normalizeAdminTableColumns } from "./admin-table-columns.ts";

describe("admin action table columns", () => {
  it("left-aligns every action column while preserving numeric alignment and existing classes", () => {
    const columns = normalizeAdminTableColumns([
      { title: "商品", dataIndex: "name" },
      { title: "实付金额", align: "right", dataIndex: "amount" },
      { title: "操作", align: "right", className: "table-actions--wide" },
      { title: "详情", children: [{ title: "操作", align: "right" }] },
    ]);
    expect(columns?.[0]).toMatchObject({ title: "商品" });
    expect(columns?.[0]).not.toHaveProperty("align");
    expect(columns?.[1]).toMatchObject({ title: "实付金额", align: "right" });
    expect(columns?.[2]).toMatchObject({ title: "操作", align: "left", className: "table-actions--wide table-actions" });
    expect("children" in columns![3]! && columns![3]!.children?.[0]).toMatchObject({ title: "操作", align: "left", className: "table-actions" });
  });
});
