import { useEffect, useRef, useState } from "react";
import { Alert, Button, Space } from "antd";
import { api, auth, adminErrorText } from "./api.ts";

export function ProductPicture({ src, size = 64, label = "商品主图" }: { src: string | null; size?: number; label?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return <div style={{ width: size, height: size, flex: "none", borderRadius: 8, overflow: "hidden", background: "#f1f2ee", display: "grid", placeItems: "center", color: "#818780", fontSize: 12 }}>
    {src && failedSrc !== src
      ? <img src={src} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={() => setFailedSrc(src)} />
      : <span>暂无图片</span>}
  </div>;
}

export function ProductImageField({ value, onChange, onBusyChange, disabled, purpose = "商品主图", required = false }: {
  value: string | null;
  onChange: (imageUrl: string | null) => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
  purpose?: "商品主图" | "轮播图" | "自提点照片";
  required?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { sequence.current += 1; controller.current?.abort(); }, []);
  async function upload(file: File) {
    if (busy || disabled) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("请选择 JPG、PNG 或 WebP 图片；原有主图已保留"); return; }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) { setError("图片不能为空，且不能超过 5 MB；原有主图已保留"); return; }
    const attempt = ++sequence.current;
    const token = auth.token();
    controller.current = new AbortController();
    setBusy(true); onBusyChange(true); setError("");
    try {
      const result = await api.uploadProductImage(file, controller.current.signal);
      if (sequence.current !== attempt || auth.token() !== token) return;
      onChange(result.imageUrl);
    } catch (reason) {
      if (sequence.current === attempt && auth.token() === token)
        setError(`${adminErrorText(reason)}；原有主图已保留`);
    } finally {
      if (sequence.current === attempt) { setBusy(false); onBusyChange(false); }
    }
  }
  return <Space direction="vertical" style={{ width: "100%" }} size={12}>
    <ProductPicture src={value} size={136} label={purpose} />
    <input ref={input} style={{ display: "none" }} type="file" aria-label={`上传${purpose}`} accept="image/jpeg,image/png,image/webp" disabled={busy || disabled}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    <Button disabled={disabled} loading={busy} onClick={() => input.current?.click()}>{busy ? "正在上传" : value ? `更换${purpose}` : `上传${purpose}`}</Button>
    <span style={{ color: "#818780", fontSize: 12 }}>{purpose}公开展示。上传后会自动旋转、压缩并转为 WebP，小程序会完整显示图片；建议使用 1:1 或 4:3 构图。支持 JPG、PNG、WebP，不超过 5 MB；{required ? "必须上传。" : "可不上传。"}</span>
    {busy && <span role="status">正在上传处理，请稍候…</span>}
    {error && <Alert type="error" title={error} showIcon />}
    {value && <Button disabled={busy || disabled} onClick={() => { setError(""); onChange(null); }}>移除{purpose}</Button>}
  </Space>;
}

/** Upload sequentially so selecting a gallery never creates a burst of image decoding. */
export function ProductGalleryField({ value, onChange, onBusyChange, disabled, detail = false }: {
  value: string[]; onChange: (urls: string[]) => void; onBusyChange: (busy: boolean) => void;
  disabled: boolean; detail?: boolean;
}) {
  const limit = detail ? 10 : 5;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const urlsRef = useRef(value);
  urlsRef.current = value;
  useEffect(() => () => { active.current?.abort(); }, []);
  const change = (urls: string[]) => { urlsRef.current = urls; onChange(urls); };
  async function upload(files: File[]) {
    if (active.current || disabled || !files.length) return;
    if (files.length + urlsRef.current.length > limit) { setError(`最多上传 ${limit} 张，请减少选择的图片`); return; }
    const maxMb = detail ? 10 : 5;
    if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > maxMb * 1024 * 1024)) {
      setError(`请选择 JPG、PNG 或 WebP 图片，单张不超过 ${maxMb} MB`); return;
    }
    const controller = new AbortController();
    active.current = controller;
    const token = auth.token();
    setBusy(true); onBusyChange(true); setError("");
    try {
      for (let index = 0; index < files.length; index += 1) {
        setProgress(`正在上传 ${index + 1} / ${files.length}`);
        const result = await (detail ? api.uploadProductDetailImage : api.uploadProductImage)(files[index]!, controller.signal);
        if (controller.signal.aborted || token !== auth.token()) return;
        change([...urlsRef.current, result.imageUrl]);
      }
    } catch (reason) {
      if (!controller.signal.aborted && token === auth.token()) setError(`${adminErrorText(reason)}；已上传的图片保留，可继续补充`);
    } finally {
      active.current = null;
      if (!controller.signal.aborted) { setBusy(false); onBusyChange(false); setProgress(""); }
    }
  }
  function move(index: number, direction: number) {
    const next = [...urlsRef.current];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    change(next);
  }
  return <Space direction="vertical" size={12} style={{ width: "100%" }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {value.map((url, index) => <div key={`${url}-${index}`} style={{ width: 136 }}>
        <ProductPicture src={url} size={136} />
        <div style={{ margin: "6px 0", fontSize: 12 }}>{detail ? `详情图 ${index + 1}` : index === 0 ? "封面图" : `商品图 ${index + 1}`}</div>
        <Space size={2}>
          <Button size="small" aria-label={`前移第${index + 1}张`} disabled={disabled || busy || index === 0} onClick={() => move(index, -1)}>←</Button>
          <Button size="small" aria-label={`后移第${index + 1}张`} disabled={disabled || busy || index === value.length - 1} onClick={() => move(index, 1)}>→</Button>
          <Button size="small" danger disabled={disabled || busy} onClick={() => change(value.filter((_, i) => i !== index))}>移除</Button>
        </Space>
      </div>)}
    </div>
    <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label={detail ? "上传详情长图" : "上传商品图片"} style={{ display: "none" }} disabled={disabled || busy}
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(files); }} />
    <Button loading={busy} disabled={disabled || value.length >= limit} onClick={() => input.current?.click()}>{busy ? progress : `添加${detail ? "详情长图" : "商品图片"}（${value.length}/${limit}）`}</Button>
    <span style={{ color: "#818780", fontSize: 12 }}>{detail ? "按顺序展示在商品详情底部，保持图片比例。单张不超过 10 MB。" : "第一张为封面，可用箭头调整顺序。单张不超过 5 MB。"}支持 JPG、PNG、WebP，上传后自动压缩。图片公开展示，请勿包含个人隐私信息。</span>
    {error && <Alert type="error" title={error} showIcon />}
  </Space>;
}
