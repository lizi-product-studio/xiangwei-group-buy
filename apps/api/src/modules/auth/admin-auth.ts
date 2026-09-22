import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { adminPasswordSchema } from '@hometown/api-contracts';
import { BusinessError } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { AdminCredential, PasswordChangeToken, Role } from '../core/types.js';
import type { Actor } from './auth.js';

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const DUMMY_SALT = '00000000000000000000000000000000';
const sessionTokenHash = (token:string):string => createHash('sha256').update(token).digest('hex');

/**
 * Bootstrap input is supplied outside the HTTP schema, so validate its human
 * display name before it can become an employee record. The checks are
 * intentionally narrow: they reject values that cannot be a usable name,
 * while allowing ordinary Chinese and international names.
 */
export function validateBootstrapAdminDisplayName(input: string): string {
  const displayName = input.trim().normalize("NFC");
  if (displayName.length < 2 || displayName.length > 80)
    throw new BusinessError("VALIDATION_ERROR", "BOOTSTRAP_ADMIN_DISPLAY_NAME 长度必须为 2–80 个字符", 400);
  if (/^[?？]+$/u.test(displayName))
    throw new BusinessError("VALIDATION_ERROR", "BOOTSTRAP_ADMIN_DISPLAY_NAME 不能仅包含问号", 400);
  if (/[\p{Cc}\p{Cf}]/u.test(displayName))
    throw new BusinessError("VALIDATION_ERROR", "BOOTSTRAP_ADMIN_DISPLAY_NAME 不能包含控制字符", 400);
  // A replacement character, or several adjacent UTF-8-as-Latin-1 fragments,
  // is a strong signal that an operator pasted mojibake rather than a name.
  if (/\uFFFD/u.test(displayName) || /(?:(?:Ã.|Â.|â..|ð..)){2,}/u.test(displayName))
    throw new BusinessError("VALIDATION_ERROR", "BOOTSTRAP_ADMIN_DISPLAY_NAME 包含无法识别的乱码", 400);
  return displayName;
}

function derivePassword(password:string,salt:string):Promise<Buffer>{
  return new Promise((resolve,reject)=>scrypt(password,salt,SCRYPT_KEY_LENGTH,SCRYPT_OPTIONS,(error,key)=>error?reject(error):resolve(key)));
}

export async function createAdminCredential(username:string,userId:string,password:string,roles:Role[]=['SUPER_ADMIN'],mustChangePassword=false,authorizationVersion=1):Promise<AdminCredential>{
  const normalized=username.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized))throw new BusinessError('VALIDATION_ERROR','管理员账号需为 3–64 位字母、数字、点、横线或下划线',400);
  if(!adminPasswordSchema.safeParse(password).success)throw new BusinessError('VALIDATION_ERROR','管理员密码长度需为 8–128 位',400);
  const salt=randomBytes(16).toString('hex');
  const passwordHash=(await derivePassword(password,salt)).toString('hex');
  return{username:normalized,userId,passwordSalt:salt,passwordHash,mustChangePassword,roles,authorizationVersion,legacyDisabled:false,createdAt:new Date().toISOString()};
}

export async function verifyAdminCredentialPassword(credential:AdminCredential,password:string):Promise<boolean>{
  const actual=await derivePassword(password,credential.passwordSalt);
  const expected=Buffer.from(credential.passwordHash,'hex');
  return expected.length===actual.length&&timingSafeEqual(actual,expected);
}

export type AdminLoginResult =
  | { nextAction: "LOGIN"; accessToken: string; expiresAt: string; userId: string; roles: Role[] }
  | { nextAction: "CHANGE_PASSWORD"; passwordChangeToken: string; expiresAt: string; userId: string; roles: Role[] };

const PASSWORD_CHANGE_TTL_SECONDS = 10 * 60;

export class AdminAuthService {
  public constructor(
    private readonly store: CommerceStore,
    private readonly sessionTtlSeconds: number,
  ) {}

  private async issueSession(
    userId: string,
    roles: Role[],
    authorizationVersion: number,
  ): Promise<{ accessToken: string; expiresAt: string; userId: string; roles: Role[] }> {
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + this.sessionTtlSeconds * 1_000,
    ).toISOString();
    await this.store.saveAuthSession({
      tokenHash: sessionTokenHash(accessToken),
      userId,
      roles,
      authorizationVersion,
      expiresAt,
    });
    return { accessToken, expiresAt, userId, roles };
  }

  public async login(username: string, password: string): Promise<AdminLoginResult> {
    const normalized = username.trim().toLowerCase();
    const credential = await this.store.findAdminCredential(normalized);
    const actual = await derivePassword(
      password,
      credential?.passwordSalt ?? DUMMY_SALT,
    );
    const expected = Buffer.from(
      credential?.passwordHash ?? "00".repeat(SCRYPT_KEY_LENGTH),
      "hex",
    );
    if (
      !credential ||
      expected.length !== actual.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new BusinessError("INVALID_CREDENTIALS", "账号或密码不正确", 401);
    const user = await this.store.getUser(credential.userId);
    if (
      !user ||
      user.status !== "ACTIVE" ||
      credential.roles.length !== 1
    )
      throw new BusinessError("ACCOUNT_DISABLED", "账号当前不可用", 403);
    const staff = await this.store.getInternalStaff(user.id);
    if (!staff || staff.status === "SUSPENDED")
      throw new BusinessError("ACCOUNT_DISABLED", "账号当前不可用", 403);
    if (staff.role !== "SUPER_ADMIN") {
      const accessRole = await this.store.getAccessRole(staff.accessRoleId ?? staff.role);
      if (!accessRole || accessRole.status !== "ACTIVE") throw new BusinessError("ACCOUNT_DISABLED", "当前岗位已停用，请联系管理员", 403);
    }
    if (credential.legacyDisabled)
      throw new BusinessError(
        "PASSWORD_SETUP_REQUIRED",
        "该账号需要超级管理员重置临时密码",
        403,
      );
    if (
      staff.role !== credential.roles[0] ||
      staff.authorizationVersion !== credential.authorizationVersion
    )
      throw new BusinessError(
        "FORBIDDEN",
        "员工授权状态不一致，请联系系统管理员处理",
        403,
      );
    if (credential.mustChangePassword) {
      if (staff.status !== "PASSWORD_SETUP_REQUIRED")
        throw new BusinessError(
          "PASSWORD_SETUP_REQUIRED",
          "该账号需要超级管理员重置临时密码",
          403,
        );
      const token = randomBytes(32).toString("base64url");
      const createdAt = await this.store.databaseNow();
      const expiresAt = new Date(
        Date.parse(createdAt) + PASSWORD_CHANGE_TTL_SECONDS * 1_000,
      ).toISOString();
      const value: PasswordChangeToken = {
        tokenHash: sessionTokenHash(token),
        userId: user.id,
        authorizationVersion: credential.authorizationVersion,
        expiresAt,
        createdAt,
      };
      await this.store.savePasswordChangeToken(value);
      return {
        nextAction: "CHANGE_PASSWORD",
        passwordChangeToken: token,
        expiresAt,
        userId: user.id,
        roles: credential.roles,
      };
    }
    const session = await this.issueSession(
      user.id,
      credential.roles,
      credential.authorizationVersion,
    );
    return { nextAction: "LOGIN", ...session };
  }

  public async changePasswordWithToken(
    token: string,
    newPassword: string,
    requestId: string,
  ): Promise<AdminLoginResult> {
    let challengeUserId: string | null = null;
    let challengeUsername: string | null = null;
    await this.store.transaction(async (store) => {
      const tokenHash = sessionTokenHash(token.trim());
      const challenge = await store.getPasswordChangeToken(tokenHash);
      if (!challenge)
        throw new BusinessError(
          "PASSWORD_CHANGE_TOKEN_INVALID",
          "密码修改凭据已失效，请重新登录",
          401,
        );
      const [user, staff, credential] = await Promise.all([
        store.getUser(challenge.userId),
        store.getInternalStaff(challenge.userId),
        store.findAdminCredentialByUserId(challenge.userId),
      ]);
      if (
        !user ||
        user.status !== "ACTIVE" ||
        !staff ||
        staff.status !== "PASSWORD_SETUP_REQUIRED" ||
        !credential ||
        credential.userId !== challenge.userId ||
        credential.legacyDisabled === true
      )
        throw new BusinessError("ACCOUNT_DISABLED", "账号当前不可用", 403);
      challengeUserId = challenge.userId;
      challengeUsername = credential.username;
      if (
        challenge.authorizationVersion !== credential.authorizationVersion ||
        challenge.authorizationVersion !== staff.authorizationVersion ||
        credential.roles.length !== 1 ||
        credential.roles[0] === "USER" ||
        staff.role !== credential.roles[0]
      )
        throw new BusinessError(
          "PASSWORD_CHANGE_TOKEN_INVALID",
          "密码修改凭据已失效，请重新登录",
          401,
        );
      if (!credential.mustChangePassword)
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "该账号无需修改密码，请返回登录",
          409,
        );
      const nextVersion = Math.max(
        staff.authorizationVersion,
        credential.authorizationVersion,
      ) + 1;
      const now = await store.databaseNow();
      const nextStaff = {
        ...staff,
        status: "ACTIVE" as const,
        activatedAt: staff.activatedAt ?? now,
        authorizationVersion: nextVersion,
        updatedAt: now,
      };
      await store.saveInternalStaff(nextStaff);
      const nextCredential = await createAdminCredential(
        credential.username,
        credential.userId,
        newPassword,
        credential.roles,
        false,
        nextVersion,
      );
      await store.saveAdminCredential(nextCredential);
      await store.deletePasswordChangeToken(tokenHash);
      await store.deleteAuthSessionsByUser(staff.userId);
      await store.saveAuditLog({
        id: randomBytes(16).toString("hex"),
        actorId: staff.userId,
        action: "STAFF_PASSWORD_CHANGED",
        resourceType: "INTERNAL_STAFF",
        resourceId: staff.userId,
        requestId,
        beforeData: { authorizationVersion: staff.authorizationVersion },
        afterData: { authorizationVersion: nextVersion },
        createdAt: now,
      });
    });
    if (!challengeUserId || !challengeUsername)
      throw new BusinessError("PASSWORD_CHANGE_TOKEN_INVALID", "密码修改凭据已失效，请重新登录", 401);
    return this.login(challengeUsername, newPassword);
  }

  public async authenticate(authorization: string | undefined): Promise<Actor | null> {
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = authorization.slice(7).trim();
    if (token.length < 32 || token.length > 128) return null;
    const tokenHash = sessionTokenHash(token);
    const session = await this.store.getActiveAuthSession(tokenHash);
    if (!session) return null;
    // Consumer and employee tokens share storage. Leave consumer sessions for
    // the WeChat authenticator instead of revoking them as invalid employees.
    if (session.roles.length === 1 && session.roles[0] === "USER") return null;
    const [user, credential, staff] = await Promise.all([
      this.store.getUser(session.userId),
      this.store.findAdminCredentialByUserId(session.userId),
      this.store.getInternalStaff(session.userId),
    ]);
    const currentVersion = credential?.authorizationVersion ?? 0;
    const isCurrent = Boolean(
      user?.status === "ACTIVE" &&
        credential &&
        credential.legacyDisabled !== true &&
        !credential.mustChangePassword &&
        credential.roles.length === 1 &&
        session.authorizationVersion === currentVersion &&
        session.roles.length === 1 &&
        session.roles[0] === credential.roles[0] &&
        staff?.status === "ACTIVE" &&
        staff.role === credential.roles[0] &&
        staff.authorizationVersion === currentVersion,
    );
    if (!isCurrent) {
      await this.store.deleteAuthSession(tokenHash);
      return null;
    }
    return {
      userId: session.userId,
      roles: credential!.roles,
      authorizationVersion: currentVersion,
    };
  }

  public async changePassword(
    actor: Actor,
    currentPassword: string,
    newPassword: string,
    requestId: string,
  ): Promise<AdminLoginResult> {
    const credential = await this.store.findAdminCredentialByUserId(actor.userId);
    const staff = await this.store.getInternalStaff(actor.userId);
    if (!credential || !staff || staff.status !== "ACTIVE")
      throw new BusinessError("FORBIDDEN", "账号当前不可用", 403);
    if (
      actor.authorizationVersion !== undefined &&
      actor.authorizationVersion !== credential.authorizationVersion
    )
      throw new BusinessError("AUTH_REQUIRED", "登录状态已失效，请重新登录", 401);
    if (!(await verifyAdminCredentialPassword(credential, currentPassword)))
      throw new BusinessError("INVALID_CREDENTIALS", "账号或密码不正确", 401);
    return this.store.transaction(async (store) => {
      const current = await store.findAdminCredentialByUserId(actor.userId);
      const currentStaff = await store.getInternalStaff(actor.userId);
      if (
        !current ||
        !currentStaff ||
        (actor.authorizationVersion !== undefined &&
          currentStaff.authorizationVersion !== actor.authorizationVersion)
      )
        throw new BusinessError("AUTH_REQUIRED", "登录状态已失效，请重新登录", 401);
      const nextVersion = Math.max(current.authorizationVersion, currentStaff.authorizationVersion) + 1;
      const now = await store.databaseNow();
      await store.saveInternalStaff({ ...currentStaff, authorizationVersion: nextVersion, updatedAt: now });
      await store.saveAdminCredential(await createAdminCredential(current.username, current.userId, newPassword, current.roles, false, nextVersion));
      await store.deleteAuthSessionsByUser(actor.userId);
      await store.saveAuditLog({
        id: randomBytes(16).toString("hex"),
        actorId: actor.userId,
        action: "STAFF_PASSWORD_CHANGED",
        resourceType: "INTERNAL_STAFF",
        resourceId: actor.userId,
        requestId,
        beforeData: { authorizationVersion: currentStaff.authorizationVersion },
        afterData: { authorizationVersion: nextVersion },
        createdAt: now,
      });
      // Issue the replacement session in the same authorized transaction.
      // A subsequent login/read would still carry this request's old version
      // and be rejected by MysqlStore after the password change committed.
      const session = await this.issueSession(current.userId, current.roles, nextVersion);
      return { nextAction: "LOGIN" as const, ...session };
    });
  }

  public async logout(authorization: string | undefined): Promise<void> {
    if (!authorization?.startsWith("Bearer ")) return;
    const token = authorization.slice(7).trim();
    if (token) await this.store.deleteAuthSession(sessionTokenHash(token));
  }
}
