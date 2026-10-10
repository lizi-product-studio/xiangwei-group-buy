import { useRef, useState, type ComponentProps } from "react";
import { App as AntApp, Card, Form, Input, InputNumber, Modal, Radio, Select, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { PermissionButton as Button, useCan } from "./access-context.tsx";
import { AdminTable as Table } from "./admin-table.tsx";
import { api, type CatalogSku, type ProductCategory } from "./api.ts";
import { newestFirst } from "./list-order.ts";
import { centsToYuan, yuanToCents } from "./money-input.ts";
import { adminErrorNotice } from "./request-error.tsx";
import { ProductGalleryField, ProductPicture } from "./ProductImageField.tsx";
import type { AdminPage } from "./navigation.ts";
import { PageTitle, ListFilters, Status, money, matchesKeyword, mutationErrorText, refreshAfterMutation, priceRule } from "./admin-page-support.tsx";

const CATEGORY_ICON_OPTIONS: Array<{ key: ProductCategory["iconKey"]; label: string; src: string }> = [
  { key: "basket", label: "通用", src: new URL("../../miniprogram/src/assets/category-icon-basket.png", import.meta.url).href },
  { key: "leaf", label: "蔬菜", src: new URL("../../miniprogram/src/assets/category-icon-leaf.png", import.meta.url).href },
  { key: "grain", label: "粮谷", src: new URL("../../miniprogram/src/assets/category-icon-grain.png", import.meta.url).href },
  { key: "beans", label: "豆类", src: new URL("../../miniprogram/src/assets/category-icon-beans.png", import.meta.url).href },
  { key: "ready-food", label: "熟食", src: new URL("../../miniprogram/src/assets/category-icon-ready-food.png", import.meta.url).href },
  { key: "seasoning", label: "调味", src: new URL("../../miniprogram/src/assets/category-icon-seasoning.png", import.meta.url).href },
  { key: "fruit", label: "水果", src: new URL("../../miniprogram/src/assets/category-icon-fruit.png", import.meta.url).href },
  { key: "tools", label: "工具", src: new URL("../../miniprogram/src/assets/category-icon-tools.png", import.meta.url).href },
];
function PanelDialog({ inline, children, ...props }: ComponentProps<typeof Modal> & { inline?: boolean }) {
  return inline ? <Card title={props.title}>{children}</Card> : <Modal {...props}>{children}</Modal>;
}

export function Products({
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
  const can = useCan();
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogSku | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [categoryStatusOpen, setCategoryStatusOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [detailImageUrls, setDetailImageUrls] = useState<string[]>([]);
  const imageUrlsRef = useRef<string[]>([]);
  const detailImageUrlsRef = useRef<string[]>([]);
  const [uploadingDetails, setUploadingDetails] = useState(false);
  const detailsBusyRef = useRef(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const uploadBusyRef = useRef(false);
  const updateImage = (value: string[]) => { imageUrlsRef.current = value; setImageUrls(value); };
  const updateDetails = (value: string[]) => { detailImageUrlsRef.current = value; setDetailImageUrls(value); };
  const updateDetailsBusy = (busy: boolean) => { detailsBusyRef.current = busy; setUploadingDetails(busy); };
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
    description?: string;
    retailPriceYuan: string;
    defaultSellableQuantity: number;
    status: "ACTIVE" | "INACTIVE";
  }) => {
    if (saving || uploadBusyRef.current || detailsBusyRef.current) return;
    setSaving(true);
    try {
      const { retailPriceYuan, ...product } = value;
      await api.saveSku({
        ...(editing ? { id: editing.id, productId: editing.productId } : {}),
        ...product,
        retailPriceCents: yuanToCents(retailPriceYuan),
        imageUrl: imageUrlsRef.current[0] ?? null,
        imageUrls: imageUrlsRef.current,
        detailImageUrls: detailImageUrlsRef.current,
      });
      setOpen(false);
      setEditing(null);
      form.resetFields();
      await refreshAfterMutation(reload, message, "商品已保存；历史订单快照不会改变");
    } catch (error) {
      void message.error(adminErrorNotice(error, mutationErrorText(error)));
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
        imageUrls: value.product.imageUrls ?? (value.product.imageUrl ? [value.product.imageUrl] : []),
        detailImageUrls: value.product.detailImageUrls ?? [],
        description: value.product.description ?? "",
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
      void message.error(adminErrorNotice(error, mutationErrorText(error)));
    } finally {
      setSaving(false);
    }
  };
  const editCategory = (value: ProductCategory) => {
    setCategoryStatusOpen(false);
    setEditingCategory(value);
    categoryForm.setFieldsValue({
      name: value.name,
      iconKey: value.iconKey,
      sortOrder: value.sortOrder,
      status: value.status,
    });
    setCategoryEditorOpen(true);
  };
  const addCategory = () => {
    setCategoryStatusOpen(false);
    setEditingCategory(null);
    categoryForm.resetFields();
    categoryForm.setFieldsValue({ iconKey: "basket", sortOrder: 0, status: "ACTIVE" });
    setCategoryEditorOpen(true);
  };
  const requestCategoryDelete = (value: ProductCategory) => {
    Modal.confirm({
      title: "删除分类",
      content: `确定删除分类“${value.name}”吗？只有未被商品引用的分类才能删除。`,
      okText: "确认删除",
      cancelText: "取消",
      onOk: async () => {
        if (savingCategory) return;
        setSavingCategory(true);
        try {
          await api.deleteCategory(value.id);
          await refreshAfterMutation(reload, message, "分类已删除");
        } catch (error) {
          message.error(adminErrorNotice(error, mutationErrorText(error)));
        } finally {
          setSavingCategory(false);
        }
      },
    });
  };
  return (
    <>
      <PageTitle
        title={view === "categories" ? "分类管理" : "商品列表"}
        subtitle={view === "categories" ? "启用的分类会展示在小程序；暂无本期商品时显示空分类" : "维护商品、规格与可售数量"}
        action={view === "categories" ?
          <Button permission="categories.manage" type="primary" icon={<PlusOutlined />} onClick={addCategory}>新增分类</Button> :
          <Space>
          <Button permission="categories.manage" onClick={() => setCategoryOpen(true)}>分类管理</Button>
          <Button permission="products.create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              updateImage([]);
              updateDetails([]);
              updateDetailsBusy(false);
              updateImageBusy(false);
              form.resetFields();
              form.setFieldsValue({ status: "ACTIVE", skuName: "件", description: "", defaultSellableQuantity: 0 });
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
          { title: "累计销量（件）", render: (_, v) => v.product.salesQuantity ?? 0 },
          { title: "状态", render: (_, v) => <Status value={v.status} /> },
          {
            title: "操作",
            render: (_, value: CatalogSku) => (
              <Space>
                <Button permission="products.edit"
                  onClick={() => {
                    setEditing(value);
                    updateImage(value.product.imageUrls ?? (value.product.imageUrl ? [value.product.imageUrl] : []));
                    updateDetails(value.product.detailImageUrls ?? []);
                    updateDetailsBusy(false);
                    updateImageBusy(false);
                    form.setFieldsValue({
                      description: value.product.description ?? "",
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
                <Button permission="products.edit"
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
        width={820}
        footer={null}
        onCancel={() => {
          if (saving || uploadBusyRef.current || detailsBusyRef.current) return;
          setOpen(false);
          setEditing(null);
          updateImageBusy(false);
        }}
      >
        <Form form={form} layout="vertical" onFinish={(v) => void save(v)}>
          <Form.Item label="商品图片 · 最多 5 张">
            {open && <ProductGalleryField key={editing?.id ?? "new"} value={imageUrls} onChange={updateImage} onBusyChange={updateImageBusy} disabled={saving || uploadingDetails} />}
          </Form.Item>
          <Form.Item name="description" label="产品介绍" rules={[{ max: 300, message: "产品介绍最多 300 字" }]}>
            <Input.TextArea rows={4} maxLength={300} showCount placeholder="介绍商品特点、用途或售后说明" />
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
          <details style={{ marginBottom: 20 }}><summary style={{ cursor: "pointer", marginBottom: 12 }}>更多设置 · 计价单位</summary>
            <Form.Item name="skuName" label="计价单位" extra="用于订单和提货数量，原有规格保留" rules={[{ required: true }]}>
              <Input placeholder="例如 件、500克/袋" />
            </Form.Item>
          </details>
          <Form.Item label="商品详情长图 · 最多 10 张">
            {open && <ProductGalleryField key={`detail-${editing?.id ?? "new"}`} detail value={detailImageUrls} onChange={updateDetails} onBusyChange={updateDetailsBusy} disabled={saving || uploadingImage || uploadingDetails} />}
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
          <Button type="primary" htmlType="submit" loading={saving} disabled={saving || uploadingImage || uploadingDetails}>
            保存商品
          </Button>
        </Form>
      </Modal>
      <PanelDialog inline={view === "categories"}
        open={categoryOpen}
        title={view === "categories" ? undefined : "分类管理"}
        footer={null}
        onCancel={() => setCategoryOpen(false)}
      >
        {view !== "categories" && <Button permission="categories.manage" type="primary" icon={<PlusOutlined />} onClick={addCategory} style={{ marginBottom: 16 }}>新增分类</Button>}
        <Table
          rowKey="id"
          pagination={false}
          dataSource={categories}
          locale={{ emptyText: "暂无分类，点击新增分类开始设置" }}
          columns={[
            { title: "分类", render: (_, value) => {
              const icon = CATEGORY_ICON_OPTIONS.find((option) => option.key === value.iconKey) ?? CATEGORY_ICON_OPTIONS[0]!;
              return <Space><img src={icon.src} alt="" width={32} height={32} style={{ objectFit: "contain" }} /><span>{value.name}</span></Space>;
            } },
            { title: "排序", dataIndex: "sortOrder", width: 100 },
            { title: "状态", width: 120, render: (_, value) => <Status value={value.status} /> },
            {
              title: "操作",
              width: 168,
              align: "right",
              className: "table-actions",
              render: (_, value) => (
                <Space size="small" wrap={false}>
                  <Button permission="categories.manage" onClick={() => editCategory(value)}>编辑</Button>
                  <Button permission="categories.delete" danger disabled={savingCategory} onClick={() => requestCategoryDelete(value)}>删除</Button>
                </Space>
              ),
            },
          ]}
        />
      </PanelDialog>
      <Modal
        open={categoryEditorOpen}
        title={editingCategory ? "编辑分类" : "新增分类"}
        onCancel={() => { if (!savingCategory) setCategoryEditorOpen(false); }}
        footer={null}
        destroyOnHidden
      >
        {can("categories.manage") && <Form
          form={categoryForm}
          layout="vertical"
          onFinish={async (value) => {
            if (savingCategory) return;
            if (editingCategory?.status === "ACTIVE" && value.status === "INACTIVE") {
              const confirmed = await new Promise<boolean>((resolve) => {
                Modal.confirm({
                  title: `停用分类“${editingCategory.name}”`,
                  content: "停用后，新建或编辑商品时不能再选择该分类；已有商品和历史数据仍会保留。",
                  okText: "确认停用",
                  cancelText: "取消",
                  onOk: () => resolve(true),
                  onCancel: () => resolve(false),
                });
              });
              if (!confirmed) return;
            }
            setSavingCategory(true);
            try {
              await api.saveCategory({
                ...(editingCategory ? { id: editingCategory.id } : {}),
                ...value,
              });
              categoryForm.resetFields();
              setEditingCategory(null);
              setCategoryEditorOpen(false);
              await refreshAfterMutation(
                reload,
                message,
                editingCategory ? "分类已更新" : "分类已保存",
              );
            } catch (error) {
              message.error(adminErrorNotice(error, mutationErrorText(error)));
            } finally {
              setSavingCategory(false);
            }
          }}
        >
          <Form.Item name="name" label="分类名称" rules={[{ required: true, min: 2, message: "分类名称至少 2 个字" }]}>
            <Input aria-label="分类名称" placeholder="分类名称，例如：蔬菜" />
          </Form.Item>
          <Form.Item name="iconKey" label="分类图标" extra="图标可在编辑分类时更换。" rules={[{ required: true, message: "请选择分类图标" }]}>
            <Radio.Group aria-label="分类图标" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
              {CATEGORY_ICON_OPTIONS.map((option) => <Radio.Button key={option.key} value={option.key} style={{ height: 76, padding: 6, textAlign: "center" }}>
                <span style={{ display: "flex", height: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
                  <img src={option.src} alt="" width={34} height={34} style={{ objectFit: "contain" }} />
                  <span>{option.label}</span>
                </span>
              </Radio.Button>)}
            </Radio.Group>
          </Form.Item>
          <Form.Item name="sortOrder" label="排序" extra="数字越小，展示越靠前" initialValue={0}>
            <InputNumber min={0} max={1_000_000} aria-label="排序" />
          </Form.Item>
          <Form.Item name="status" label="状态" hidden={!editingCategory} initialValue="ACTIVE">
            <Select
              style={{ width: 110 }}
              open={categoryStatusOpen}
              onOpenChange={setCategoryStatusOpen}
              onSelect={() => setCategoryStatusOpen(false)}
              options={[{ value: "ACTIVE", label: "启用" }, { value: "INACTIVE", label: "停用" }]}
            />
          </Form.Item>
          <Space>
            <Button permission="categories.manage" type="primary" htmlType="submit" loading={savingCategory}>{editingCategory ? "保存修改" : "创建分类"}</Button>
            <Button onClick={() => setCategoryEditorOpen(false)} disabled={savingCategory}>取消</Button>
          </Space>
        </Form>}
      </Modal>
    </>
  );
}
