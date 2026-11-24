import { BudgetRequest, UsageReportItem, UserProfile, Role, RequestStatus } from '../types';

export const USER_MURNI_MAX_UNREPORTED_UIDS = 1;
export const USER_MURNI_MAX_UNREPORTED_TRANSFER_AMOUNT = 300000;

export const isBbmRequest = (r: BudgetRequest): boolean => {
  const reqId = (r.id || '').toUpperCase();
  const siteId = (r.siteId || '').toUpperCase();
  const siteName = ((r as any).siteName || '').toUpperCase();
  const ket = (r.keterangan || '').toUpperCase();
  return (
    reqId.startsWith('BBMDS') ||
    reqId.startsWith('BBM_DURENSAWIT') ||
    reqId.startsWith('TFDS') ||
    siteId === 'OPT-DUREN SAWIT' ||
    siteId === 'BBM DUREN SAWIT' ||
    siteName.includes('DUREN SAWIT') ||
    ket.includes('DUREN SAWIT')
  );
};

/**
 * Returns the transferred amount of a request (falls back to jumlahPengajuan if adminActionAmount is 0).
 */
export function getRequestTransferredAmount(r: BudgetRequest): number {
  const adminAmt = Number(r.adminActionAmount) || 0;
  if (adminAmt > 0) return adminAmt;
  return Number(r.jumlahPengajuan) || 0;
}

/**
 * Sums total transferred amount across a list of unreported UIDs.
 */
export function getUnreportedTransferredTotal(unreportedUids: BudgetRequest[]): number {
  return unreportedUids.reduce((sum, r) => sum + getRequestTransferredAmount(r), 0);
}

/**
 * Returns list of requests for a user that:
 * - Already transferred (TRANSFERRED, TRANSFER_BERTAHAP, or adminActionAmount > 0)
 * - Not cancelled, not rejected, not closed, not BBM Duren Sawit
 * - NOT reported yet (0 items in usageItems)
 */
export function getUnreportedTransferredRequests(
  userEmail: string,
  requests: BudgetRequest[],
  usageItems: UsageReportItem[]
): BudgetRequest[] {
  const emailLower = (userEmail || '').trim().toLowerCase();
  if (!emailLower) return [];

  return requests.filter(r => {
    if ((r.userEmail || '').trim().toLowerCase() !== emailLower) return false;
    if (isBbmRequest(r)) return false;
    if (r.status === RequestStatus.CLOSED || r.status === RequestStatus.CANCELLED || r.status === RequestStatus.REJECTED) return false;

    const isTransferred =
      r.status === RequestStatus.TRANSFERRED ||
      r.status === RequestStatus.TRANSFER_BERTAHAP ||
      (typeof r.adminActionAmount === 'number' && r.adminActionAmount > 0);

    if (!isTransferred) return false;

    const reqIdUpper = (r.id || '').trim().toUpperCase();
    const hasReportItem = usageItems.some(i => (i.requestId || '').trim().toUpperCase() === reqIdUpper);
    return !hasReportItem;
  });
}

/**
 * Returns list of requests for a user that:
 * - Already reported (at least 1 item in usageItems)
 * - Not closed, not cancelled, not rejected, not BBM Duren Sawit
 */
export function getReportedUnclosedRequests(
  userEmail: string,
  requests: BudgetRequest[],
  usageItems: UsageReportItem[]
): BudgetRequest[] {
  const emailLower = (userEmail || '').trim().toLowerCase();
  if (!emailLower) return [];

  return requests.filter(r => {
    if ((r.userEmail || '').trim().toLowerCase() !== emailLower) return false;
    if (isBbmRequest(r)) return false;
    if (r.status === RequestStatus.CLOSED || r.status === RequestStatus.CANCELLED || r.status === RequestStatus.REJECTED) return false;

    const reqIdUpper = (r.id || '').trim().toUpperCase();
    const hasReportItem = usageItems.some(i => (i.requestId || '').trim().toUpperCase() === reqIdUpper);
    return hasReportItem;
  });
}

export interface UserMurniBlockEvaluation {
  isBlocked: boolean;
  isBlockedByCount: boolean;
  isBlockedByAmount: boolean;
  count: number;
  totalTransferredAmount: number;
  blockReasonShort: string;
}

/**
 * Evaluates blocking thresholds for User Murni:
 * Blocked strictly if unreported UIDs > 1 (total transfer amount threshold > Rp 300.000 is disabled).
 */
export function evaluateUserMurniBlocking(unreportedUids: BudgetRequest[]): UserMurniBlockEvaluation {
  const count = unreportedUids.length;
  const totalTransferredAmount = getUnreportedTransferredTotal(unreportedUids);
  const isBlockedByCount = count > USER_MURNI_MAX_UNREPORTED_UIDS;
  const isBlockedByAmount = false;
  const isBlocked = isBlockedByCount;

  const blockReasonShort = isBlockedByCount ? '> 1 UID' : '';

  return {
    isBlocked,
    isBlockedByCount,
    isBlockedByAmount,
    count,
    totalTransferredAmount,
    blockReasonShort
  };
}

/**
 * Validates whether a User Murni is blocked from submitting new requests.
 * Rule: Blocked if User Murni has > 1 unreported transferred UID.
 */
export function checkUserMurniSubmissionStatus(
  userProfile: UserProfile | null | undefined,
  requests: BudgetRequest[],
  usageItems: UsageReportItem[]
): UserMurniBlockEvaluation & { unreportedUids: BudgetRequest[] } {
  if (!userProfile) {
    return {
      isBlocked: false,
      isBlockedByCount: false,
      isBlockedByAmount: false,
      count: 0,
      totalTransferredAmount: 0,
      blockReasonShort: '',
      unreportedUids: []
    };
  }

  const role = (userProfile.role || '').toUpperCase();
  // Pembatasan secara ketat hanya berlaku bagi Role USER (User Murni)
  if (role !== Role.USER && role !== 'USER') {
    return {
      isBlocked: false,
      isBlockedByCount: false,
      isBlockedByAmount: false,
      count: 0,
      totalTransferredAmount: 0,
      blockReasonShort: '',
      unreportedUids: []
    };
  }

  const unreportedUids = getUnreportedTransferredRequests(userProfile.email, requests, usageItems);
  const evaluation = evaluateUserMurniBlocking(unreportedUids);

  return {
    ...evaluation,
    unreportedUids
  };
}
