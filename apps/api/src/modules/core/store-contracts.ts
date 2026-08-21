import type { CommunityStore } from '../fulfillment/community-store.js';
import type { CommunityOperationsStore, CommunityQualityStore } from '../fulfillment/community-operations-store.js';
import type { NotificationOrderEnqueueStore } from '../notifications/notification-store.js';
import type { PlatformProcurementStore } from '../platform/platform-procurement-store.js';
import type { LegacyCommerceStore } from './legacy-commerce-store.js';
import type { MysqlStore } from './mysql-store.js';
import type { MemoryStore } from './store.js';

type AssertNever<T extends never> = T;
type AssertAssignable<TExpected, TActual extends TExpected> = TActual;

// Compile-time boundary checks: expanding a service contract with another
// mode's storage facts must be an intentional reviewable change.
type LegacyCannotReadCommunityDraft = AssertNever<Extract<'getCommunityAllocationDraftByDeliveryForUpdate', keyof LegacyCommerceStore>>;
type LegacyCannotReadWarehouse = AssertNever<Extract<'getWarehouse', keyof LegacyCommerceStore>>;
type CommunityCannotReadWarehouse = AssertNever<Extract<'getWarehouse', keyof CommunityStore>>;
type CommunityOperationsCannotReadWarehouse = AssertNever<Extract<'getWarehouse', keyof CommunityOperationsStore>>;
type CommunityOperationsCannotReadMerchants = AssertNever<Extract<'listMerchants', keyof CommunityOperationsStore>>;
type CommunityQualityCannotReadCancellation = AssertNever<Extract<'getCommunityCancellationRequestByOrderForUpdate', keyof CommunityQualityStore>>;
type NotificationEnqueueCannotReadPayments = AssertNever<Extract<'getPaymentByOrderForUpdate', keyof NotificationOrderEnqueueStore>>;
type ProcurementCannotReadCommunityCancellation = AssertNever<Extract<'getCommunityCancellationRequestByOrderForUpdate', keyof PlatformProcurementStore>>;
type MemoryImplementsCommunityOperations = AssertAssignable<CommunityOperationsStore, MemoryStore>;
type MysqlImplementsCommunityOperations = AssertAssignable<CommunityOperationsStore, MysqlStore>;
type MemoryImplementsCommunityQuality = AssertAssignable<CommunityQualityStore, MemoryStore>;
type MysqlImplementsCommunityQuality = AssertAssignable<CommunityQualityStore, MysqlStore>;

export type StoreBoundaryAssertions =
  | LegacyCannotReadCommunityDraft
  | LegacyCannotReadWarehouse
  | CommunityCannotReadWarehouse
  | CommunityOperationsCannotReadWarehouse
  | CommunityOperationsCannotReadMerchants
  | CommunityQualityCannotReadCancellation
  | NotificationEnqueueCannotReadPayments
  | ProcurementCannotReadCommunityCancellation
  | MemoryImplementsCommunityOperations
  | MysqlImplementsCommunityOperations
  | MemoryImplementsCommunityQuality
  | MysqlImplementsCommunityQuality;
