import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { BusinessError } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { AdminCredential, Role } from '../core/types.js';
import type { Actor } from './auth.js';

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const DUMMY_SALT = '00000000000000000000000000000000';
const sessionTokenHash = (token:string):string => createHash('sha256').update(token).digest('hex');

function derivePassword(password:string,salt:string):Promise<Buffer>{
  return new Promise((resolve,reject)=>scrypt(password,salt,SCRYPT_KEY_LENGTH,SCRYPT_OPTIONS,(error,key)=>error?reject(error):resolve(key)));
}

export async function createAdminCredential(username:string,userId:string,password:string,roles:Role[]=['SUPER_ADMIN'],mustChangePassword=false,authorizationVersion=1):Promise<AdminCredential>{
  const normalized=username.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized))throw new BusinessError('VALIDATION_ERROR','管理员账号需为 3–64 位字母、数字、点、横线或下划线',400);
  if(password.length<12||password.length>128)throw new BusinessError('VALIDATION_ERROR','管理员密码长度需为 12–128 位',400);
  const salt=randomBytes(16).toString('hex');
  const passwordHash=(await derivePassword(password,salt)).toString('hex');
  return{username:normalized,userId,passwordSalt:salt,passwordHash,mustChangePassword,roles,authorizationVersion,createdAt:new Date().toISOString()};
}

export async function verifyAdminCredentialPassword(credential:AdminCredential,password:string):Promise<boolean>{
  const actual=await derivePassword(password,credential.passwordSalt);
  const expected=Buffer.from(credential.passwordHash,'hex');
  return expected.length===actual.length&&timingSafeEqual(actual,expected);
}

export class AdminAuthService{
  public constructor(private readonly store:CommerceStore,private readonly sessionTtlSeconds:number){}

  public async login(username:string,password:string):Promise<{accessToken:string;expiresAt:string;userId:string;roles:Role[]}>{
    const normalized=username.trim().toLowerCase();
    const credential=await this.store.findAdminCredential(normalized);
    const actual=await derivePassword(password,credential?.passwordSalt??DUMMY_SALT);
    const expected=Buffer.from(credential?.passwordHash??'00'.repeat(SCRYPT_KEY_LENGTH),'hex');
    if(!credential||expected.length!==actual.length||!timingSafeEqual(actual,expected))throw new BusinessError('AUTH_REQUIRED','账号或密码不正确',401);
    const user=await this.store.getUser(credential.userId);
    if(!user||user.status!=='ACTIVE'||credential.roles.length!==1)throw new BusinessError('FORBIDDEN','账号当前不可用',403);
    const staff=await this.store.getInternalStaff(user.id);
    // A bearer administrator is never a free-standing legacy credential.  It
    // must be backed by one active InternalStaff row whose role and revision
    // match the credential used to sign the session.
    if(!staff||staff.status==='SUSPENDED')throw new BusinessError('FORBIDDEN','员工账号当前不可用',403);
    if(credential.mustChangePassword||staff.status==='PENDING_ACTIVATION')throw new BusinessError('ACTIVATION_REQUIRED','请先使用一次性初始凭据设置自己的密码',403);
    if(staff.status!=='ACTIVE'||staff.role!==credential.roles[0]||staff.authorizationVersion!==credential.authorizationVersion)
      throw new BusinessError('FORBIDDEN','员工授权状态不一致，请联系系统管理员处理',403);
    const accessToken=randomBytes(32).toString('base64url');
    const expiresAt=new Date(Date.now()+this.sessionTtlSeconds*1_000).toISOString();
    await this.store.saveAuthSession({tokenHash:sessionTokenHash(accessToken),userId:user.id,roles:credential.roles,authorizationVersion:credential.authorizationVersion??0,expiresAt});
    return{accessToken,expiresAt,userId:user.id,roles:credential.roles};
  }

  public async authenticate(authorization:string|undefined):Promise<Actor|null>{
    if(!authorization?.startsWith('Bearer '))return null;
    const token=authorization.slice(7).trim();
    if(token.length<32||token.length>128)return null;
    const tokenHash=sessionTokenHash(token);
    const session=await this.store.getAuthSession(tokenHash);
    if(!session)return null;
    const [user,credential,staff]=await Promise.all([
      this.store.getUser(session.userId),
      this.store.findAdminCredentialByUserId(session.userId),
      this.store.getInternalStaff(session.userId),
    ]);
    const currentVersion=credential?.authorizationVersion??0;
    const isCurrent=Boolean(
      user?.status==='ACTIVE'&&credential&&!credential.mustChangePassword&&credential.roles.length&&
      session.authorizationVersion===currentVersion&&
      session.roles.length===credential.roles.length&&session.roles.every((role)=>credential.roles.includes(role))&&
      staff?.status==='ACTIVE'&&staff.role===credential.roles[0]&&staff.authorizationVersion===currentVersion,
    );
    if(!isCurrent){await this.store.deleteAuthSession(tokenHash);return null;}
    return{userId:session.userId,roles:credential!.roles,authorizationVersion:currentVersion};
  }

  public async logout(authorization:string|undefined):Promise<void>{
    if(!authorization?.startsWith('Bearer '))return;
    const token=authorization.slice(7).trim();
    if(token)await this.store.deleteAuthSession(sessionTokenHash(token));
  }
}
