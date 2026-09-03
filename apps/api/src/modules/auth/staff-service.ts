import { randomBytes, randomUUID } from 'node:crypto';
import { BusinessError } from '@hometown/domain';
import { createAdminCredential } from './admin-auth.js';
import type { CommerceStore } from '../core/store.js';
import type { InternalStaff, InternalStaffRole, InternalStaffStatus, StaffPickupPointAssignment } from '../core/types.js';
import type { Actor } from './auth.js';

export interface StaffCreateInput {
  displayName:string;
  username:string;
  phone:string;
  role:InternalStaffRole;
  status:'ACTIVE'|'SUSPENDED';
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
export interface CreatedStaffRecord { staff:StaffRecord; temporaryPassword:string }

const temporaryPassword=():string=>`H${randomBytes(18).toString('base64url')}9`;
const uniqueIds=(ids:string[]):string[]=>[...new Set(ids)];
const normalizedIds=(ids:string[]):string[]=>uniqueIds(ids).sort();
const sameIds=(left:string[],right:string[]):boolean=>JSON.stringify(normalizedIds(left))===JSON.stringify(normalizedIds(right));
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

  /** Re-check the initiating administrator inside the write transaction. */
  private async assertCurrentSuperAdmin(store:CommerceStore,actor:Actor):Promise<void>{
    // Header actors exist only when AUTH_PROVIDER=demo, which is the isolated
    // local/test transport. Production bearer actors always carry a revision.
    if(actor.authorizationVersion===undefined&&actor.roles.includes('SUPER_ADMIN'))return;
    const [user,credential,staff]=await Promise.all([
      store.getUser(actor.userId),
      store.findAdminCredentialByUserId(actor.userId),
      store.getInternalStaff(actor.userId),
    ]);
    const actualVersion=credential?.authorizationVersion??0;
    const isActiveAdministrator=Boolean(
      actor.roles.length===1&&actor.roles[0]==='SUPER_ADMIN'&&
      user?.status==='ACTIVE'&&credential?.roles.length===1&&credential.roles[0]==='SUPER_ADMIN'&&!credential.mustChangePassword&&
      staff?.status==='ACTIVE'&&staff.role==='SUPER_ADMIN'&&staff.authorizationVersion===actualVersion,
    );
    if((actor.authorizationVersion!==undefined&&actor.authorizationVersion!==actualVersion)||!isActiveAdministrator)
      throw new BusinessError('FORBIDDEN','当前管理员权限已变更，请重新登录后再操作',403);
  }

  private requireSensitiveReason(authorizationChanged:boolean,input:StaffUpdateInput):void{
    if(authorizationChanged&&!input.reason?.trim())
      throw new BusinessError('VALIDATION_ERROR','变更角色、授权点位或账号状态必须填写原因',400);
  }

  private async record(store:CommerceStore,staff:InternalStaff):Promise<StaffRecord>{
    const pickupPointIds=(await store.listStaffPickupPointAssignments(staff.userId)).map((item)=>item.pickupPointId);
    return {...staff,pickupPointIds};
  }

  private async replacePointScope(store:CommerceStore,staffUserId:string,pickupPointIds:string[],actorId:string,now:string):Promise<void>{
    const assignments:StaffPickupPointAssignment[]=pickupPointIds.map((pickupPointId)=>({staffUserId,pickupPointId,assignedBy:actorId,createdAt:now,updatedAt:now}));
    await store.replaceStaffPickupPointAssignments(staffUserId,assignments);
  }

  private async syncAssignedPointContacts(store:CommerceStore,role:InternalStaffRole,pickupPointIds:string[],displayName:string,phone:string):Promise<void>{
    if(role!=='PICKUP_MANAGER'||!pickupPointIds.length)return;
    const points=await store.listPickupPoints();
    for(const id of pickupPointIds){
      const point=points.find((item)=>item.id===id);
      if(!point)continue;
      await store.savePickupPoint({...point,contactName:displayName,contactPhone:phone});
    }
  }

  public async create(input:StaffCreateInput,actor:Actor,requestId:string):Promise<CreatedStaffRecord>{
    return this.store.transaction(async(store)=>{
      await this.assertCurrentSuperAdmin(store,actor);
      if(await store.findAdminCredential(input.username))throw new BusinessError('RESOURCE_IN_USE','账号名已被使用',409);
      if((await store.listInternalStaff()).some((item)=>item.phone===input.phone))throw new BusinessError('RESOURCE_IN_USE','手机号已被内部员工使用',409);
      const pointIds=await this.validatePointScope(store,input.role,input.pickupPointIds);
      const now=new Date().toISOString();
      const userId=randomUUID();
      const credential=temporaryPassword();
      const initialStatus:InternalStaffStatus=input.status==='ACTIVE'?'PASSWORD_SETUP_REQUIRED':'SUSPENDED';
      const staff:InternalStaff={
        userId,staffNo:staffNo(),displayName:input.displayName,phone:input.phone,role:input.role,status:initialStatus,
        createdBy:actor.userId,activatedAt:null,suspendedAt:input.status==='SUSPENDED'?now:null,suspensionReason:input.status==='SUSPENDED'?'创建时设为已停用':null,authorizationVersion:1,createdAt:now,updatedAt:now,
      };
      await store.saveUser({id:userId,wechatOpenId:null,status:'ACTIVE',createdAt:now});
      await store.saveInternalStaff(staff);
      await store.replaceUserRoles(userId,[input.role]);
      await store.saveAdminCredential(await createAdminCredential(input.username,userId,credential,[input.role],true,1));
      await this.replacePointScope(store,userId,pointIds,actor.userId,now);
      await this.syncAssignedPointContacts(store,input.role,pointIds,staff.displayName,staff.phone);
      const record=await this.record(store,staff);
      await store.saveAuditLog({id:randomUUID(),actorId:actor.userId,action:'STAFF_CREATED',resourceType:'INTERNAL_STAFF',resourceId:userId,requestId,beforeData:null,afterData:record,createdAt:now});
      return {staff:record,temporaryPassword:credential};
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

  public async update(userId:string,input:StaffUpdateInput,actor:Actor,requestId:string):Promise<StaffRecord>{
    return this.store.transaction(async(store)=>{
      await this.assertCurrentSuperAdmin(store,actor);
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
      if(input.status==='PASSWORD_SETUP_REQUIRED')throw new BusinessError('INVALID_STATE_TRANSITION','账号密码状态只能由系统管理',409);
      const roleChanged=nextRole!==before.role;
      const statusChanged=requestedStatus!==before.status;
      const scopeChanged=!sameIds(pointIds,currentPointIds);
      const authorizationChanged=roleChanged||statusChanged||scopeChanged;
      if(userId===actor.userId&&authorizationChanged)
        throw new BusinessError('INVALID_STATE_TRANSITION','不能修改自己的角色、账号状态或自提点授权，请由其他超级管理员操作',409);
      const isLastActiveSuperAdmin=before.role==='SUPER_ADMIN'&&before.status==='ACTIVE'&&
        (await store.listInternalStaff()).filter((item)=>item.role==='SUPER_ADMIN'&&item.status==='ACTIVE').length===1;
      if(isLastActiveSuperAdmin&&(nextRole!=='SUPER_ADMIN'||requestedStatus==='SUSPENDED'))
        throw new BusinessError('INVALID_STATE_TRANSITION','系统至少需要保留一名启用中的超级管理员',409);
      this.requireSensitiveReason(authorizationChanged,input);
      const now=new Date().toISOString();
      const nextAuthorizationVersion=authorizationChanged?Math.max(before.authorizationVersion,credential.authorizationVersion)+1:before.authorizationVersion;
      const nextStatus=requestedStatus==='ACTIVE'&&credential.mustChangePassword?'PASSWORD_SETUP_REQUIRED':requestedStatus;
      const after:InternalStaff={...before,displayName:input.displayName??before.displayName,phone:input.phone??before.phone,role:nextRole,status:nextStatus,activatedAt:nextStatus==='ACTIVE'?(before.activatedAt??now):before.activatedAt,suspendedAt:nextStatus==='SUSPENDED'?now:null,suspensionReason:nextStatus==='SUSPENDED'?input.reason!.trim():null,authorizationVersion:nextAuthorizationVersion,updatedAt:now};
      if(after.phone!==before.phone&&(await store.listInternalStaff()).some((item)=>item.userId!==userId&&item.phone===after.phone))throw new BusinessError('RESOURCE_IN_USE','手机号已被内部员工使用',409);
      await store.saveInternalStaff(after);
      await store.replaceUserRoles(userId,[nextRole],authorizationChanged?nextAuthorizationVersion:undefined);
      if(scopeChanged)await this.replacePointScope(store,userId,pointIds,actor.userId,now);
      if(nextRole==='PICKUP_MANAGER')await this.syncAssignedPointContacts(store,nextRole,pointIds,after.displayName,after.phone);
      if(authorizationChanged)await store.deleteAuthSessionsByUser(userId);
      const record=await this.record(store,after);
      const action=nextStatus==='SUSPENDED'&&statusChanged?'STAFF_SUSPENDED':requestedStatus==='ACTIVE'&&before.status==='SUSPENDED'?'STAFF_REACTIVATED':roleChanged?'STAFF_ROLE_CHANGED':scopeChanged?'STAFF_PICKUP_SCOPE_CHANGED':'STAFF_UPDATED';
      await store.saveAuditLog({id:randomUUID(),actorId:actor.userId,action,resourceType:'INTERNAL_STAFF',resourceId:userId,requestId,beforeData:{...before,pickupPointIds:currentPointIds},afterData:{...record,reason:input.reason??null},createdAt:now});
      return record;
    });
  }

  public async resetCredential(userId:string,reason:string,actor:Actor,requestId:string):Promise<{staff:StaffRecord;temporaryPassword:string}>{
    return this.store.transaction(async(store)=>{
      await this.assertCurrentSuperAdmin(store,actor);
      if(!reason.trim())throw new BusinessError('VALIDATION_ERROR','重置凭据必须填写原因',400);
      if(userId===actor.userId)
        throw new BusinessError('INVALID_STATE_TRANSITION','不能向自己的账号发放临时密码，请使用“修改我的密码”',409);
      const before=await store.getInternalStaff(userId);
      if(!before)throw new BusinessError('RESOURCE_NOT_FOUND','员工不存在',404);
      const credential=await store.findAdminCredentialByUserId(userId);
      if(!credential)throw new BusinessError('RESOURCE_NOT_FOUND','员工登录凭据不存在',404);
      const now=new Date().toISOString();
      const tempPassword=temporaryPassword();
      const nextVersion=Math.max(before.authorizationVersion,credential.authorizationVersion)+1;
      const after:InternalStaff={...before,status:before.status==='SUSPENDED'?'SUSPENDED':'PASSWORD_SETUP_REQUIRED',authorizationVersion:nextVersion,updatedAt:now};
      await store.saveInternalStaff(after);
      await store.saveAdminCredential(await createAdminCredential(credential.username,userId,tempPassword,[after.role],true,nextVersion));
      await store.deleteAuthSessionsByUser(userId);
      const record=await this.record(store,after);
      await store.saveAuditLog({id:randomUUID(),actorId:actor.userId,action:'STAFF_CREDENTIAL_RESET',resourceType:'INTERNAL_STAFF',resourceId:userId,requestId,beforeData:before,afterData:{...record,reason},createdAt:now});
      return {staff:record,temporaryPassword:tempPassword};
    });
  }

}
