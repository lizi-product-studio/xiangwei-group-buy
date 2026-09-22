import { useEffect, useState } from "react";
import { Alert, App, Button, Checkbox, Dropdown, Empty, Form, Input, Modal, Radio, Select, Space, Table, Tag, Typography } from "antd";
import { ACCESS_PAGE_LABELS, normalizePermissions, type AccessRole, type PermissionDefinition } from "@hometown/api-contracts";
import { api, adminErrorText } from "./api.ts";
type RoleRow = AccessRole & {staffCount: number};
export function StaffRoleField({roles}: {roles: RoleRow[]}) {
  const form = Form.useFormInstance();
  return <><Form.Item name="role" hidden><Input /></Form.Item><Form.Item name="accessRoleId" label="角色" rules={[{required:true, message:"请选择角色"}]}>
    <Select getPopupContainer={node=>node.parentElement??document.body} options={[{value:"SUPER_ADMIN", label:"超级管理员"}, ...roles.map(role => ({value:role.id, label: `${role.name}${role.status === "INACTIVE" ? "（已停用）" : ""}`, disabled:role.status !== "ACTIVE"}))]}
      onChange={(id:string) => {const role=roles.find(r=>r.id===id); form.setFieldValue("role", id === "SUPER_ADMIN" ? "SUPER_ADMIN" : role?.scope === "PICKUP" ? "PICKUP_MANAGER" : ["OPERATOR","CUSTOMER_SERVICE","FINANCE"].includes(id) ? id : "OPERATOR");}} />
  </Form.Item></>;
}
export function AccessManagement({view}: {view:"roles"|"permissions"}) {
  const {message, modal} = App.useApp();
  const [roles,setRoles]=useState<RoleRow[]>([]);
  const [catalog,setCatalog]=useState<PermissionDefinition[]>([]);
  const [loading,setLoading]=useState(true), [error,setError]=useState("");
  const [editing,setEditing]=useState<AccessRole|null>(null), [open,setOpen]=useState(false), [saving,setSaving]=useState(false);
  const [form]=Form.useForm();
  const scope=Form.useWatch("scope",form) ?? "PLATFORM";
  const selected:string[]=Form.useWatch("permissions",form) ?? [];
  const load=async()=>{setLoading(true);setError("");try{const [r,p]=await Promise.all([api.accessRoles(),api.permissionCatalog()]);setRoles(r);setCatalog(p);}catch(e){setError(adminErrorText(e));}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const edit=(role?:AccessRole,copy=false)=>{setEditing(copy?null:role??null); form.setFieldsValue({name:copy?`${role?.name}副本`:role?.name??"",description:role?.description??"",scope:role?.scope??"PLATFORM",status:role?.status??"ACTIVE",permissions:role?.permissions??[]});setOpen(true);};
  const save=async()=>{const values=await form.validateFields();const perform=async()=>{setSaving(true);try{await api.saveAccessRole(editing?.id??null,{...values,version:editing?.version});setOpen(false);message.success("角色已保存");await load();}catch(e){message.error(adminErrorText(e));}finally{setSaving(false);}}; if(editing && (roles.find(r=>r.id===editing.id)?.staffCount??0)>0){modal.confirm({title:"保存角色配置",content:"关联员工需重新登录，新权限随后生效。",okText:"保存",cancelText:"取消",onOk:perform});}else await perform();};
  const remove=(role:RoleRow)=>modal.confirm({title:`删除角色“${role.name}”？`,content:"已分配给员工的角色无法删除，请先更换员工角色。",okText:"删除",okButtonProps:{danger:true},cancelText:"取消",onOk:async()=>{try{await api.deleteAccessRole(role.id);await load();}catch(e){message.error(adminErrorText(e));throw e;}}});
  const groups=[...new Set(catalog.map(p=>p.group))];
  return <><Space style={{display:"flex",justifyContent:"space-between",marginBottom:24}}><div><Typography.Title level={2}>{view==="roles"?"角色管理":"权限管理"}</Typography.Title><Typography.Text type="secondary">{view==="roles"?"按岗位配置可见菜单和可执行操作，再到员工管理分配角色":"查看系统已支持的功能权限，在角色管理中分配；新增业务功能时同步注册权限"}</Typography.Text></div>{view==="roles"&&<Button type="primary" onClick={()=>edit()}>新增角色</Button>}</Space>
    <Alert type="info" showIcon style={{marginBottom:16}} message="超级管理员保留完整权限；员工、角色和权限配置仅由超级管理员管理。点位角色始终只能操作其授权自提点。" />
    {error?<Alert type="error" message={error} action={<Button onClick={()=>void load()}>重试</Button>} />:view==="roles"?<Table loading={loading} rowKey="id" dataSource={roles} columns={[
      {title:"角色",render:(_,r:RoleRow)=><><strong>{r.name}</strong>{r.builtIn&&<Tag style={{marginLeft:8}}>预置</Tag>}<div>{r.description}</div></>},
      {title:"使用范围",render:(_,r:RoleRow)=>r.scope==="PICKUP"?"授权自提点":"平台"}, {title:"员工数",dataIndex:"staffCount",width:100}, {title:"状态",render:(_,r:RoleRow)=><Tag color={r.status==="ACTIVE"?"green":"default"}>{r.status==="ACTIVE"?"启用":"停用"}</Tag>,width:100},
      {title:"操作",width:184,align:"right",render:(_,r:RoleRow)=><Space wrap={false}><Button onClick={()=>edit(r)}>编辑</Button><Dropdown trigger={["click"]} menu={{items:[{key:"copy",label:"复制角色"},...(!r.builtIn?[{key:"delete",label:"删除角色",danger:true}]:[])],onClick:({key})=>key==="copy"?edit(r,true):remove(r)}}><Button>更多</Button></Dropdown></Space>}
    ]}/>:<Table loading={loading} rowKey="code" dataSource={catalog} pagination={{pageSize:15}} columns={[{title:"菜单分组",dataIndex:"group"},{title:"功能页面",render:(_,p:PermissionDefinition)=>ACCESS_PAGE_LABELS[p.page]},{title:"权限",dataIndex:"label"},{title:"使用范围",render:(_,p:PermissionDefinition)=>p.scope==="PICKUP"?"授权自提点":"平台"}]} />}
    <Modal centered styles={{body:{maxHeight:"65vh",overflowY:"auto"}}} width={780} title={editing?"编辑角色":"新增角色"} open={open} onCancel={()=>!saving&&setOpen(false)} footer={<Space><Button disabled={saving} onClick={()=>setOpen(false)}>取消</Button><Button type="primary" loading={saving} onClick={()=>void save()}>保存</Button></Space>}>
      <Form form={form} layout="vertical"><Form.Item name="name" label="角色名称" rules={[{required:true,min:2,max:40}]}><Input maxLength={40}/></Form.Item><Form.Item name="description" label="用途说明"><Input maxLength={200}/></Form.Item><Space align="start"><Form.Item name="scope" label="使用范围"><Radio.Group disabled={Boolean(editing)} onChange={()=>form.setFieldValue("permissions",[])} options={[{value:"PLATFORM",label:"平台岗位"},{value:"PICKUP",label:"点位岗位"}]}/></Form.Item><Form.Item name="status" label="状态"><Radio.Group options={[{value:"ACTIVE",label:"启用"},{value:"INACTIVE",label:"停用"}]}/></Form.Item></Space>
      <Form.Item name="permissions" hidden><Select mode="multiple"/></Form.Item>
      <Typography.Paragraph type="secondary">勾选操作会同时获得该页面的查看权限；取消查看会移除该页面全部操作。</Typography.Paragraph>
      {groups.map(group=>{const entries=catalog.filter(p=>p.group===group&&p.scope===scope);return entries.length?<section key={group} style={{padding:"12px 0",borderTop:"1px solid #eee"}}><Typography.Title level={5}>{group}</Typography.Title>{[...new Set(entries.map(p=>p.page))].map(page=><div key={page} style={{marginBottom:12}}><strong style={{display:"block",marginBottom:6}}>{ACCESS_PAGE_LABELS[page]}</strong><Space wrap>{entries.filter(p=>p.page===page).map(p=><Checkbox key={p.code} checked={selected.includes(p.code)} onChange={e=>{const next=e.target.checked?normalizePermissions([...selected,p.code]):selected.filter(code=>p.code.endsWith(".view")?!code.startsWith(`${page}.`):code!==p.code && !({"service.intake":["service.accept"],"service.progress":["service.decision"],"service.pickup-view":["service.pickup"]} as Record<string,string[]>)[p.code]?.includes(code));form.setFieldValue("permissions",next);}}>{p.label}</Checkbox>)}</Space></div>)}</section>:null;})}
      {!catalog.length&&<Empty description="权限目录尚未加载"/>}</Form>
    </Modal></>;
}
