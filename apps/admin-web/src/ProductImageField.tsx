import { useEffect, useRef, useState } from "react";
import { Alert, Button, Space } from "antd";
import { api, auth, adminErrorText } from "./api.ts";

export function ProductPicture({ src, size = 64 }: { src: string | null; size?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return <div style={{ width: size, height: size, flex: "none", borderRadius: 8, overflow: "hidden", background: "#f1f2ee", display: "grid", placeItems: "center", color: "#818780", fontSize: 12 }}>
    {src && failedSrc !== src
      ? <img src={src} alt="商品主图" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={() => setFailedSrc(src)} />
      : <span>暂无图片</span>}
  </div>;
}

export function ProductImageField({ value, onChange, onBusyChange, disabled, purpose = "商品主图", required = false }: {
  value: string | null;
  onChange: (imageUrl: string | null) => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
  purpose?: "商品主图" | "轮播图";
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
    <ProductPicture src={value} size={136} />
    <input ref={input} style={{ display: "none" }} type="file" aria-label={`上传${purpose}`} accept="image/jpeg,image/png,image/webp" disabled={busy || disabled}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    <Button disabled={disabled} loading={busy} onClick={() => input.current?.click()}>{busy ? "正在上传" : value ? `更换${purpose}` : `上传${purpose}`}</Button>
    <span style={{ color: "#818780", fontSize: 12 }}>{purpose}公开展示。上传后会自动旋转、压缩并转为 WebP，小程序会完整显示图片；建议使用 1:1 或 4:3 构图。支持 JPG、PNG、WebP，不超过 5 MB；{required ? "必须上传。" : "可不上传。"}</span>
    {busy && <span role="status">正在上传处理，请稍候…</span>}
    {error && <Alert type="error" title={error} showIcon />}
    {value && <Button disabled={busy || disabled} onClick={() => { setError(""); onChange(null); }}>移除{purpose}</Button>}
  </Space>;
}
