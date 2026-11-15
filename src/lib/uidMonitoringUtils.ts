import { BudgetRequest, UsageReportItem, UserProfile, Role, RequestStatus } from '../types';

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

/**
 * Validates whether a User Murni is blocked from submitting new requests.
 * Rule: If User Murni has > 1 UIDs that are already transferred and not reported at all (maksimal 1 UID), submission is blocked.
 */
export function checkUserMurniSubmissionStatus(
  userProfile: UserProfile | null | undefined,
  requests: BudgetRequest[],
  usageItems: UsageReportItem[]
): { isBlocked: boolean; count: number; unreportedUids: BudgetRequest[] } {
  if (!userProfile) return { isBlocked: false, count: 0, unreportedUids: [] };

  const role = (userProfile.role || '').toUpperCase();
  // Pembatasan secara ketat hanya berlaku bagi Role USER (User Murni)
  if (role !== Role.USER && role !== 'USER') {
    return { isBlocked: false, count: 0, unreportedUids: [] };
  }

  const unreportedUids = getUnreportedTransferredRequests(userProfile.email, requests, usageItems);
  const isBlocked = unreportedUids.length > 1;

  return {
    isBlocked,
    count: unreportedUids.length,
    unreportedUids
  };
}
