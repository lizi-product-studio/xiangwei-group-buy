import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, message } from 'antd';
import { api, type InternalStaff, type InternalStaffRole, type PickupPoint } from '../../api.ts';

export type { InternalStaffRole } from '../../api.ts';

export const staffRoleOptions: Array<{ value: InternalStaffRole; label: string }> = [
  { value: 'SUPER_ADMIN', label: '平台负责人' },
  { value: 'OPERATOR', label: '运营' },
  { value: 'CUSTOMER_SERVICE', label: '客服' },
  { value: 'FINANCE', label: '财务' },
  { value: 'PICKUP_MANAGER', label: '自提点负责人' },
];

export function StaffCreateModal({ open, close, pickupPoints, saved }: { open:boolean; close:()=>void; pickupPoints:PickupPoint[]; saved:()=>Promise<unknown> }) {
  const [form] = Form.useForm<{displayName:string; username:string; phone:string; role:InternalStaffRole; pickupPointIds:string[]; status:'PENDING_ACTIVATION'|'SUSPENDED'}>();
  const [saving, setSaving] = useState(false);
  const role = Form.useWatch('role', form);
  const submit = async (value: {displayName:string; username:string; phone:string; role:InternalStaffRole; pickupPointIds:string[]; status:'PENDING_ACTIVATION'|'SUSPENDED'}) => {
    setSaving(true);
    try {
      const result = await api.createInternalStaff(value);
      Modal.success({ title:'员工已创建，请安全转交一次性初始凭据', content:<div><p>{result.staff.displayName}（{result.staff.staffNo}）创建完成。此凭据仅显示一次，员工首次登录必须修改密码。</p><Input value={result.initialCredential} readOnly onFocus={(event)=>event.currentTarget.select()} /></div>, okText:'我已记录并安全转交' });
      form.resetFields(); await saved(); close();
    } catch (error) { message.error(error instanceof Error ? error.message : '创建员工失败'); } finally { setSaving(false); }
  };
  return <Modal open={open} onCancel={close} footer={null} destroyOnHidden title="新增内部员工"><Alert type="info" showIcon message="员工账号与消费者账号隔离" description="创建后生成一次性初始凭据，明文不会在目录或后续页面再次显示。" style={{marginBottom:16}}/><Form form={form} layout="vertical" initialValues={{role:'PICKUP_MANAGER',pickupPointIds:[],status:'PENDING_ACTIVATION'}} onFinish={(value)=>void submit(value)}><div className="form-grid"><Form.Item label="员工姓名" name="displayName" rules={[{required:true,min:2}]}><Input /></Form.Item><Form.Item label="登录账号" name="username" rules={[{required:true,min:3,pattern:/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/}]}><Input autoComplete="off" /></Form.Item></div><Form.Item label="联系手机号" name="phone" rules={[{required:true,pattern:/^1[3-9]\d{9}$/}]}><Input inputMode="numeric" /></Form.Item><div className="form-grid"><Form.Item label="角色" name="role" rules={[{required:true}]}><Select options={staffRoleOptions}/></Form.Item><Form.Item label="创建状态" name="status" rules={[{required:true}]}><Select options={[{value:'PENDING_ACTIVATION',label:'待激活'},{value:'SUSPENDED',label:'已停用'}]}/></Form.Item></div>{role==='PICKUP_MANAGER'&&<Form.Item label="负责自提点" name="pickupPointIds" rules={[{required:true,message:'自提点负责人至少绑定一个启用点位'}]}><Select mode="multiple" options={pickupPoints.filter((point)=>point.status==='ACTIVE').map((point)=>({value:point.id,label:`${point.name} · ${point.address}`}))}/></Form.Item>}<Button type="primary" htmlType="submit" loading={saving}>创建并生成初始凭据</Button></Form></Modal>;
}

export function StaffScopeModal({ open, close, staff, pickupPoints, saved }: { open:boolean; close:()=>void; staff:InternalStaff|null; pickupPoints:PickupPoint[]; saved:()=>Promise<unknown> }) {
  const [form] = Form.useForm<{role:InternalStaffRole; status:'PENDING_ACTIVATION'|'ACTIVE'|'SUSPENDED'; pickupPointIds:string[]; reason?:string}>();
  const [saving, setSaving] = useState(false);
  const role = Form.useWatch('role', form);
  const status = Form.useWatch('status', form);
  useEffect(() => { if (role !== 'PICKUP_MANAGER') form.setFieldValue('pickupPointIds', []); }, [role, form]);
  const submit = async (value: {role:InternalStaffRole; status:'PENDING_ACTIVATION'|'ACTIVE'|'SUSPENDED'; pickupPointIds:string[]; reason?:string}) => {
    if (!staff) return;
    setSaving(true);
    try {
      const reason = value.reason?.trim();
      await api.updateInternalStaff(staff.userId, { role:value.role, status:value.status, pickupPointIds:value.role==='PICKUP_MANAGER' ? value.pickupPointIds : [], ...(reason ? {reason} : {}) });
      await saved(); message.success('员工角色与点位范围已更新，原会话已回收'); close();
    } catch (error) { message.error(error instanceof Error ? error.message : '更新员工失败'); } finally { setSaving(false); }
  };
  return <Modal open={open} onCancel={close} footer={null} destroyOnHidden title="调整员工角色与点位"><Form key={staff?.userId??'none'} form={form} layout="vertical" initialValues={staff?{role:staff.role,status:staff.status,pickupPointIds:staff.pickupPointIds}:{}} onFinish={(value)=>void submit(value)}><Alert type="warning" showIcon message="变更会立即回收该员工已登录会话" description="自提点负责人必须保留至少一个启用点位；停用时必须记录原因。" style={{marginBottom:16}}/><Form.Item label="员工"><Input value={staff?`${staff.displayName} · ${staff.staffNo}`:''} disabled /></Form.Item><div className="form-grid"><Form.Item label="角色" name="role" rules={[{required:true}]}><Select options={staffRoleOptions}/></Form.Item><Form.Item label="状态" name="status" rules={[{required:true}]}><Select options={[{value:'PENDING_ACTIVATION',label:'待激活'},{value:'ACTIVE',label:'启用'},{value:'SUSPENDED',label:'已停用'}]}/></Form.Item></div>{role==='PICKUP_MANAGER'&&<Form.Item label="负责自提点" name="pickupPointIds" rules={[{required:true,message:'至少选择一个启用自提点'}]}><Select mode="multiple" options={pickupPoints.filter((point)=>point.status==='ACTIVE').map((point)=>({value:point.id,label:point.name}))}/></Form.Item>}{status==='SUSPENDED'&&<Form.Item label="停用原因" name="reason" rules={[{required:true,min:2}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item>}<Button type="primary" htmlType="submit" loading={saving}>保存并回收会话</Button></Form></Modal>;
}
