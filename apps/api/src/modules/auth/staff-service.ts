import { randomBytes, randomUUID } from 'node:crypto';
import { BusinessError } from '@hometown/domain';
import { createAdminCredential, verifyAdminCredentialPassword } from './admin-auth.js';
import type { CommerceStore } from '../core/store.js';
import type { InternalStaff, InternalStaffRole, InternalStaffStatus, StaffPickupPointAssignment } from '../core/types.js';

export interface StaffCreateInput {
  displayName:string;
  username:string;
  phone:string;
  role:InternalStaffRole;
  status:'PENDING_ACTIVATION'|'SUSPENDED';
  pickupPointIds:string[];
}

export interface StaffUpdateInput {
  displayName?:string|undefined;
  phone?:string|undefined;
  role?:InternalStaffRole|undefined;
  status?:InternalStaffStatus|undefined;
  pickupPointIds?:string[]|undefined;
  reason?:string|undefined;
}

export interface StaffRecord extends InternalStaff { pickupPointIds:string[] }
export interface CreatedStaffRecord { staff:StaffRecord; initialCredential:string }

const oneTimeCredential=():string=>`H${randomBytes(18).toString('base64url')}9`;
const uniqueIds=(ids:string[]):string[]=>[...new Set(ids)];
const staffNo=():string=>`STF-${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}-${randomBytes(3).toString('hex').toUpperCase()}`;

export class StaffService {
  public constructor(private readonly store:CommerceStore) {}

  private async validatePointScope(store:CommerceStore,role:InternalStaffRole,pickupPointIds:string[]):Promise<string[]> {
    const ids=uniqueIds(pickupPointIds);
    if(role!=='PICKUP_MANAGER'){
      if(ids.length)throw new BusinessError('VALIDATION_ERROR','只有自提点负责人可以绑定自提点',400);
      return [];
    }
    if(!ids.length)throw new BusinessError('VALIDATION_ERROR','自提点负责人至少需要绑定一个启用自提点',400);
    const points=await store.listPickupPoints();
    for(const id of ids){
      const point=points.find((item)=>item.id===id);
      if(!point)throw new BusinessError('RESOURCE_NOT_FOUND','选择的自提点不存在',404);
      if(point.status!=='ACTIVE')throw new BusinessError('INVALID_STATE_TRANSITION','只能绑定启用中的自提点',409);
    }
    return ids;
  }

  private async record(store:CommerceStore,staff:InternalStaff):Promise<StaffRecord>{
    const pickupPointIds=(await store.listStaffPickupPointAssignments(staff.userId)).map((item)=>item.pickupPointId);
    return {...staff,pickupPointIds};
  }

  private async replacePointScope(store:CommerceStore,staffUserId:string,pickupPointIds:string[],actorId:string,now:string):Promise<void>{
    const assignments:StaffPickupPointAssignment[]=pickupPointIds.map((pickupPointId)=>({staffUserId,pickupPointId,assignedBy:actorId,createdAt:now,updatedAt:now}));
    await store.replaceStaffPickupPointAssignments(staffUserId,assignments);
  }

  public async create(input:StaffCreateInput,actorId:string,requestId:string):Promise<CreatedStaffRecord>{
    return this.store.transaction(async(store)=>{
      if(await store.findAdminCredential(input.username))throw new BusinessError('RESOURCE_IN_USE','账号名已被使用',409);
      if((await store.listInternalStaff()).some((item)=>item.phone===input.phone))throw new BusinessError('RESOURCE_IN_USE','手机号已被内部员工使用',409);
      const pointIds=await this.validatePointScope(store,input.role,input.pickupPointIds);
      const now=new Date().toISOString();
      const userId=randomUUID();
      const credential=oneTimeCredential();
      const staff:InternalStaff={
        userId,staffNo:staffNo(),displayName:input.displayName,phone:input.phone,role:input.role,status:input.status,
        createdBy:actorId,activatedAt:null,suspendedAt:input.status==='SUSPENDED'?now:null,suspensionReason:input.status==='SUSPENDED'?'创建时设为已停用':null,createdAt:now,updatedAt:now,
      };
      await store.saveUser({id:userId,wechatOpenId:null,status:'ACTIVE',createdAt:now});
      await store.saveInternalStaff(staff);
      await store.replaceUserRoles(userId,[input.role]);
      await store.saveAdminCredential(await createAdminCredential(input.username,userId,credential,[input.role],true));
      await this.replacePointScope(store,userId,pointIds,actorId,now);
      const record=await this.record(store,staff);
      await store.saveAuditLog({id:randomUUID(),actorId,action:'STAFF_CREATED',resourceType:'INTERNAL_STAFF',resourceId:userId,requestId,beforeData:null,afterData:record,createdAt:now});
      return {staff:record,initialCredential:credential};
    });
  }

  public async list(query?:string):Promise<StaffRecord[]>{
    const [staff,assignments]=await Promise.all([this.store.listInternalStaff(query),this.store.listStaffPickupPointAssignments()]);
    const pointsByStaff=new Map<string,string[]>();for(const assignment of assignments){const values=pointsByStaff.get(assignment.staffUserId)??[];values.push(assignment.pickupPointId);pointsByStaff.set(assignment.staffUserId,values);}
    return staff.map((item)=>({...item,pickupPointIds:pointsByStaff.get(item.userId)??[]}));
  }

  public async get(userId:string):Promise<StaffRecord>{
    const staff=await this.store.getInternalStaff(userId);
    if(!staff)throw new BusinessError('RESOURCE_NOT_FOUND','员工不存在',404);
    return this.record(this.store,staff);
  }

  public async update(userId:string,input:StaffUpdateInput,actorId:string,requestId:string):Promise<StaffRecord>{
    return this.store.transaction(async(store)=>{
      const before=await store.getInternalStaff(userId);
      if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','员工不存在',404);
      const currentPointIds=(await store.listStaffPickupPointAssignments(userId)).map((item)=>item.pickupPointId);
      const nextRole=input.role??before.role;
      const requestedStatus=input.status??before.status;
      // Point scope belongs exclusively to a pickup manager. A hidden form
      // value from a previous role must never survive a role change.
      const pointIds=await this.validatePointScope(store,nextRole,nextRole==='PICKUP_MANAGER'?(input.pickupPointIds??currentPointIds):[]);
      const credential=await store.findAdminCredentialByUserId(userId);
      if(!credential)throw new BusinessError('RESOURCE_NOT_FOUND','员工登录凭据不存在',404);
      if(requestedStatus==='ACTIVE'&&credential.mustChangePassword)throw new BusinessError('INVALID_STATE_TRANSITION','员工必须先使用一次性凭据完成激活',409);
      if(requestedStatus==='SUSPENDED'&&!input.reason?.trim())throw new BusinessError('VALIDATION_ERROR','停用员工必须填写原因',400);
      if(requestedStatus==='PENDING_ACTIVATION'&&!credential.mustChangePassword)throw new BusinessError('INVALID_STATE_TRANSITION','已激活员工请使用停用或恢复，不可回退为待激活',409);
      const now=new Date().toISOString();
      const after:InternalStaff={...before,displayName:input.displayName??before.displayName,phone:input.phone??before.phone,role:nextRole,status:requestedStatus,activatedAt:requestedStatus==='ACTIVE'?(before.activatedAt??now):before.activatedAt,suspendedAt:requestedStatus==='SUSPENDED'?now:null,suspensionReason:requestedStatus==='SUSPENDED'?input.reason!.trim():null,updatedAt:now};
      if(after.phone!==before.phone&&(await store.listInternalStaff()).some((item)=>item.userId!==userId&&item.phone===after.phone))throw new BusinessError('RESOURCE_IN_USE','手机号已被内部员工使用',409);
      await store.saveInternalStaff(after);
      await store.replaceUserRoles(userId,[nextRole]);
      await this.replacePointScope(store,userId,pointIds,actorId,now);
      const changed=JSON.stringify({...before,pickupPointIds:currentPointIds})!==JSON.stringify({...after,pickupPointIds:pointIds});
      if(changed)await store.deleteAuthSessionsByUser(userId);
      const record=await this.record(store,after);
      await store.saveAuditLog({id:randomUUID(),actorId,action:requestedStatus==='SUSPENDED'&&before.status!=='SUSPENDED'?'STAFF_SUSPENDED':'STAFF_UPDATED',resourceType:'INTERNAL_STAFF',resourceId:userId,requestId,beforeData:{...before,pickupPointIds:currentPointIds},afterData:{...record,reason:input.reason??null},createdAt:now});
      return record;
    });
  }

  public async resetCredential(userId:string,reason:string,actorId:string,requestId:string):Promise<{staff:StaffRecord;initialCredential:string}>{
    return this.store.transaction(async(store)=>{
      const before=await store.getInternalStaff(userId);
      if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','员工不存在',404);
      const credential=await store.findAdminCredentialByUserId(userId);
      if(!credential)throw new BusinessError('RESOURCE_NOT_FOUND','员工登录凭据不存在',404);
      const now=new Date().toISOString();
      const initialCredential=oneTimeCredential();
      await store.saveAdminCredential(await createAdminCredential(credential.username,userId,initialCredential,credential.roles,true));
      const after:InternalStaff={...before,status:before.status==='SUSPENDED'?'SUSPENDED':'PENDING_ACTIVATION',updatedAt:now};
      await store.saveInternalStaff(after);
      await store.deleteAuthSessionsByUser(userId);
      const record=await this.record(store,after);
      await store.saveAuditLog({id:randomUUID(),actorId,action:'STAFF_CREDENTIAL_RESET',resourceType:'INTERNAL_STAFF',resourceId:userId,requestId,beforeData:before,afterData:{...record,reason},createdAt:now});
      return {staff:record,initialCredential};
    });
  }

  public async activate(username:string,initialCredential:string,newPassword:string,requestId:string):Promise<InternalStaff>{
    return this.store.transaction(async(store)=>{
      const credential=await store.findAdminCredential(username);
      if(!credential||!(await verifyAdminCredentialPassword(credential,initialCredential)))throw new BusinessError('AUTH_REQUIRED','账号或一次性凭据不正确',401);
      const before=await store.getInternalStaff(credential.userId);
      if(!before||before.status==='SUSPENDED')throw new BusinessError('FORBIDDEN','员工账号当前不可激活',403);
      if(!credential.mustChangePassword||before.status!=='PENDING_ACTIVATION')throw new BusinessError('INVALID_STATE_TRANSITION','该账号无需重复激活',409);
      const now=new Date().toISOString();
      const after:InternalStaff={...before,status:'ACTIVE',activatedAt:now,suspendedAt:null,suspensionReason:null,updatedAt:now};
      await store.saveAdminCredential(await createAdminCredential(credential.username,credential.userId,newPassword,credential.roles,false));
      await store.saveInternalStaff(after);
      await store.deleteAuthSessionsByUser(after.userId);
      await store.saveAuditLog({id:randomUUID(),actorId:after.userId,action:'STAFF_ACTIVATED',resourceType:'INTERNAL_STAFF',resourceId:after.userId,requestId,beforeData:before,afterData:after,createdAt:now});
      return after;
    });
  }
}
