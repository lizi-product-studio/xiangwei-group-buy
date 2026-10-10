import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Form, Input, Modal } from "antd";
import { adminErrorText, api, setReauthenticationHandler } from "./api.ts";

export function Reauthentication({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm<{ password: string }>();
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  useEffect(() => {
    setReauthenticationHandler(() => new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject }; setError(""); form.resetFields(); setOpen(true);
    }));
    const cancel = () => { pending.current?.reject(new Error("验证已取消")); pending.current = null; setOpen(false); form.resetFields(); };
    window.addEventListener("admin-auth-expired", cancel);
    return () => { setReauthenticationHandler(null); window.removeEventListener("admin-auth-expired", cancel); pending.current?.reject(new Error("验证已取消")); };
  }, [form]);
  const submit = async ({ password }: { password: string }) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await api.reauthenticate(password);
      setOpen(false); form.resetFields(); pending.current?.resolve(); pending.current = null;
    } catch (value) { setError(adminErrorText(value)); form.resetFields(); }
    finally { setBusy(false); }
  };
  return <>{children}<Modal zIndex={2000} title="验证登录密码" open={open} confirmLoading={busy} okText="验证并继续" cancelText="取消" onOk={() => form.submit()} onCancel={() => {
    pending.current?.reject(new Error("操作已取消")); pending.current = null; setOpen(false); form.resetFields();
  }} destroyOnHidden>
    <p>此操作涉及权限、资金或敏感资料，请再次输入当前账号密码。验证后两分钟内无需重复输入。</p>
    {error && <Alert type="error" showIcon message={error} />}
    <Form form={form} layout="vertical" onFinish={submit}><Form.Item label="当前登录密码" name="password" rules={[{ required: true, message: "请输入当前登录密码" }]}><Input.Password autoComplete="current-password" autoFocus disabled={busy} /></Form.Item></Form>
  </Modal></>;
}
