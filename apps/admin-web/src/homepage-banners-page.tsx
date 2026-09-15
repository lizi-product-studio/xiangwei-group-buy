import { useMemo, useRef, useState } from "react";
import {
  App as AntApp,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { api, adminErrorText, type Campaign, type HomepageBanner, type ProductCategory, type ServiceArea } from "./api.ts";
import { ProductImageField, ProductPicture } from "./ProductImageField.tsx";

type BannerDraft = {
  title: string;
  subtitle: string;
  targetType: HomepageBanner["targetType"];
  targetValue: string | null;
  scope: HomepageBanner["scope"];
  serviceAreaId: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder: number;
  status: HomepageBanner["status"];
};

type Props = {
  values: HomepageBanner[];
  areas: ServiceArea[];
  campaigns: Campaign[];
  categories: ProductCategory[];
  reload: () => Promise<unknown>;
};

const emptyDraft: BannerDraft = {
  title: "",
  subtitle: "",
  targetType: "NONE",
  targetValue: null,
  scope: "ALL",
  serviceAreaId: null,
  startsAt: null,
  endsAt: null,
  sortOrder: 0,
  status: "ACTIVE",
};

function toLocalDateTime(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.toISOString() : null;
}

function targetText(value: HomepageBanner, campaigns: Campaign[], categories: ProductCategory[]) {
  if (value.targetType === "NONE") return "不跳转";
  if (value.targetType === "CAMPAIGN") {
    return campaigns.find((campaign) => campaign.id === value.targetValue)?.title ?? "指定团期";
  }
  return categories.find((category) => category.id === value.targetValue)?.name ?? "指定分类";
}

async function refreshAfterMutation(
  reload: () => Promise<unknown>,
  message: { success: (content: string) => unknown; warning: (content: string) => unknown },
  successText: string,
) {
  try {
    await reload();
    message.success(successText);
  } catch {
    message.warning("已保存，列表刷新失败，请刷新");
  }
}

export function HomepageBannersPage({ values, areas, campaigns, categories, reload }: Props) {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HomepageBanner | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const actionLock = useRef<string | null>(null);
  const [form] = Form.useForm<BannerDraft>();

  const beginAction = (key: string) => {
    if (actionLock.current) return false;
    actionLock.current = key;
    setActionBusy(key);
    return true;
  };
  const finishAction = () => {
    actionLock.current = null;
    setActionBusy(null);
  };

  const activeAreas = useMemo(() => areas.filter((area) => area.status === "ENABLED"), [areas]);
  const openNew = () => {
    setEditing(null);
    setImageUrl(null);
    form.setFieldsValue({ ...emptyDraft, startsAt: null, endsAt: null });
    setOpen(true);
  };
  const openEdit = (value: HomepageBanner) => {
    setEditing(value);
    setImageUrl(value.imageUrl);
    form.setFieldsValue({
      title: value.title,
      subtitle: value.subtitle,
      targetType: value.targetType,
      targetValue: value.targetValue,
      scope: value.scope,
      serviceAreaId: value.serviceAreaId,
      startsAt: toLocalDateTime(value.startsAt) ?? null,
      endsAt: toLocalDateTime(value.endsAt) ?? null,
      sortOrder: value.sortOrder,
      status: value.status,
    });
    setOpen(true);
  };
  const save = async (value: BannerDraft) => {
    if (!imageUrl) {
      message.error("请先上传轮播图片");
      return;
    }
    if (imageBusy || saving) return;
    const body = {
      title: value.title.trim(),
      subtitle: value.subtitle?.trim() ?? "",
      imageUrl,
      targetType: value.targetType,
      targetValue: value.targetType === "NONE" ? null : value.targetValue ?? null,
      scope: value.scope,
      serviceAreaId: value.scope === "SERVICE_AREA" ? value.serviceAreaId ?? null : null,
      startsAt: fromLocalDateTime(value.startsAt),
      endsAt: fromLocalDateTime(value.endsAt),
      sortOrder: Number(value.sortOrder ?? 0),
      status: value.status,
    };
    if (body.startsAt && body.endsAt && body.startsAt >= body.endsAt) {
      message.error("结束时间必须晚于开始时间");
      return;
    }
    setSaving(true);
    try {
      if (editing) await api.updateHomepageBanner(editing.id, { ...body, version: editing.version });
      else await api.createHomepageBanner(body);
      setOpen(false);
      await refreshAfterMutation(reload, message, editing ? "轮播已更新" : "轮播已创建");
    } catch (error) {
      message.error(adminErrorText(error));
    } finally {
      setSaving(false);
    }
  };
  const toggleStatus = async (value: HomepageBanner) => {
    const key = `toggle:${value.id}`;
    if (!beginAction(key)) return;
    try {
      await api.updateHomepageBanner(value.id, {
        version: value.version,
        title: value.title,
        subtitle: value.subtitle,
        imageUrl: value.imageUrl,
        targetType: value.targetType,
        targetValue: value.targetValue,
        scope: value.scope,
        serviceAreaId: value.serviceAreaId,
        startsAt: value.startsAt,
        endsAt: value.endsAt,
        sortOrder: value.sortOrder,
        status: value.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
      await refreshAfterMutation(reload, message, value.status === "ACTIVE" ? "轮播已停用" : "轮播已启用");
    } catch (error) {
      message.error(adminErrorText(error));
    } finally {
      finishAction();
    }
  };
  const remove = (value: HomepageBanner) => {
    const key = `delete:${value.id}`;
    if (!beginAction(key)) return;
    Modal.confirm({
      title: "删除首页轮播",
      content: `确定删除“${value.title}”吗？删除后无法在后台恢复。`,
      okText: "确认删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onCancel: finishAction,
      onOk: async () => {
        try {
          await api.deleteHomepageBanner(value.id, value.version);
          await refreshAfterMutation(reload, message, "轮播已删除");
        } catch (error) {
          message.error(adminErrorText(error));
        } finally {
          finishAction();
        }
      },
    });
  };

  return (
    <>
      <div className="section-header homepage-banners__header">
        <div>
          <h1>首页轮播</h1>
          <p>管理小程序首页展示内容、投放范围和跳转去向。</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>新增轮播</Button>
      </div>
      <div className="homepage-banners__intro">
        <span>启用中的轮播会按排序值从小到大展示；设置投放时间后，未开始或已结束的内容不会展示。</span>
        <Tag color="green">共 {values.filter((value) => value.status === "ACTIVE").length} 个启用</Tag>
      </div>
      <Table
        className="homepage-banners__table"
        rowKey="id"
        dataSource={[...values].sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt))}
        locale={{ emptyText: "暂无轮播，请先新增首页内容" }}
        pagination={{ pageSize: 8, showSizeChanger: false }}
        columns={[
          {
            title: "展示内容",
            render: (_: unknown, value: HomepageBanner) => (
              <div className="homepage-banners__content-cell">
                <ProductPicture src={value.imageUrl} size={88} />
                <div><strong>{value.title}</strong><span>{value.subtitle || "未设置副标题"}</span></div>
              </div>
            ),
          },
          { title: "投放范围", render: (_: unknown, value: HomepageBanner) => value.scope === "ALL" ? "全部服务区" : activeAreas.find((area) => area.id === value.serviceAreaId)?.name ?? "指定服务区" },
          { title: "点击后", render: (_: unknown, value: HomepageBanner) => targetText(value, campaigns, categories) },
          { title: "排序", dataIndex: "sortOrder", width: 80 },
          { title: "状态", render: (_: unknown, value: HomepageBanner) => <Tag color={value.status === "ACTIVE" ? "green" : "default"}>{value.status === "ACTIVE" ? "启用" : "停用"}</Tag>, width: 90 },
          {
            title: "操作",
            width: 230,
            render: (_: unknown, value: HomepageBanner) => (
              <Space wrap size={[4, 4]}>
                <Button type="link" disabled={actionBusy !== null} onClick={() => openEdit(value)}>编辑</Button>
                <Button type="link" disabled={actionBusy !== null} loading={actionBusy === `toggle:${value.id}`} onClick={() => void toggleStatus(value)}>{value.status === "ACTIVE" ? "停用" : "启用"}</Button>
                <Button type="link" danger disabled={actionBusy !== null} onClick={() => remove(value)}>删除</Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={open}
        title={editing ? "编辑首页轮播" : "新增首页轮播"}
        footer={null}
        width={760}
        destroyOnClose
        onCancel={() => { if (!saving) setOpen(false); }}
      >
        <Form form={form} layout="vertical" onFinish={(value) => void save(value)}>
          <Form.Item label="轮播图片" required>
            <ProductImageField value={imageUrl} onChange={setImageUrl} onBusyChange={setImageBusy} disabled={saving} purpose="轮播图" required />
          </Form.Item>
          <div className="form-grid">
            <Form.Item name="title" label="标题" rules={[{ required: true, min: 2, max: 40, message: "请输入 2-40 个字的标题" }]}><Input placeholder="例如：本周新鲜蔬菜到货" maxLength={40} showCount /></Form.Item>
            <Form.Item name="subtitle" label="副标题" rules={[{ max: 80, message: "副标题不能超过 80 个字" }]}><Input placeholder="可选，用一句话补充说明" maxLength={80} showCount /></Form.Item>
          </div>
          <div className="form-grid">
            <Form.Item name="scope" label="投放范围" rules={[{ required: true }]}>
              <Select options={[{ value: "ALL", label: "全部服务区" }, { value: "SERVICE_AREA", label: "指定服务区" }]} onChange={(scope) => { if (scope === "ALL") form.setFieldValue("serviceAreaId", null); }} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(previous, current) => previous.scope !== current.scope}>
              {({ getFieldValue }) => getFieldValue("scope") === "SERVICE_AREA" ? <Form.Item name="serviceAreaId" label="服务区" rules={[{ required: true, message: "请选择服务区" }]}><Select placeholder="请选择服务区" options={activeAreas.map((area) => ({ value: area.id, label: area.name }))} /></Form.Item> : <Form.Item label="服务区"><Input disabled value="全部服务区" /></Form.Item>}
            </Form.Item>
          </div>
          <div className="form-grid">
            <Form.Item name="targetType" label="点击跳转" rules={[{ required: true }]}>
              <Select options={[{ value: "NONE", label: "无跳转" }, { value: "CAMPAIGN", label: "团期详情" }, { value: "CATEGORY", label: "商品分类" }]} onChange={(targetType) => { if (targetType === "NONE") form.setFieldValue("targetValue", null); }} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(previous, current) => previous.targetType !== current.targetType}>
              {({ getFieldValue }) => {
                const targetType = getFieldValue("targetType");
                if (targetType === "NONE") return <Form.Item label="跳转内容"><Input disabled value="不跳转" /></Form.Item>;
                const options = targetType === "CAMPAIGN" ? campaigns.map((campaign) => ({ value: campaign.id, label: campaign.title })) : categories.filter((category) => category.status === "ACTIVE").map((category) => ({ value: category.id, label: category.name }));
                return <Form.Item name="targetValue" label={targetType === "CAMPAIGN" ? "选择团期" : "选择分类"} rules={[{ required: true, message: "请选择跳转内容" }]}><Select showSearch optionFilterProp="label" placeholder="请选择" options={options} /></Form.Item>;
              }}
            </Form.Item>
          </div>
          <div className="form-grid">
            <Form.Item name="startsAt" label="开始展示时间"><Input type="datetime-local" /></Form.Item>
            <Form.Item name="endsAt" label="结束展示时间"><Input type="datetime-local" /></Form.Item>
          </div>
          <div className="form-grid">
            <Form.Item name="sortOrder" label="排序值" extra="数值越小越靠前"><InputNumber min={0} max={9999} precision={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "ACTIVE", label: "启用" }, { value: "INACTIVE", label: "停用" }]} /></Form.Item>
          </div>
          <div className="homepage-banners__form-actions"><Button onClick={() => setOpen(false)} disabled={saving}>取消</Button><Button type="primary" htmlType="submit" loading={saving} disabled={imageBusy}>{editing ? "保存修改" : "创建轮播"}</Button></div>
        </Form>
      </Modal>
    </>
  );
}
