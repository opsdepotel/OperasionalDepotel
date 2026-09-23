import React from 'react';
import { BudgetRequest, ItemReviewHistory, UsageReportItem, UserProfile, Role, RequestStatus, ItemStatus } from '../types';
import { getFinanceApprovedAmount } from '../App';

export interface OP_TimeLineProps {
  request: BudgetRequest;
  histories?: ItemReviewHistory[];
  usageItems?: UsageReportItem[];
  profiles?: UserProfile[];
  theme?: 'light' | 'dark';
  title?: string;
  className?: string;
}

export const OP_TimeLine: React.FC<OP_TimeLineProps> = ({
  request,
  histories = [],
  usageItems = [],
  profiles = [],
  theme = 'light',
  title = 'TIMELINE PROSES PENGAJUAN',
  className = ''
}) => {
  const formatIDR = (num: any) => {
    const val = Number(num) || 0;
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  };

  const parseTimeToMs = (rawTime: any): number => {
    if (!rawTime || rawTime === '-') return 0;
    if (typeof rawTime === 'number') return rawTime;
    if (rawTime instanceof Date) return rawTime.getTime();

    if (typeof rawTime === 'string') {
      const trimmed = rawTime.trim();
      if (!trimmed || trimmed === '-') return 0;

      const isoClean = trimmed.replace(' ', 'T');
      const parsedIso = new Date(isoClean);
      if (!isNaN(parsedIso.getTime())) return parsedIso.getTime();

      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) return parsed.getTime();

      // Indonesian locale string: "DD/MM/YYYY, HH.mm.ss" or "DD/MM/YYYY HH:mm:ss"
      const cleanStr = trimmed.replace(',', '');
      const parts = cleanStr.split(/\s+/);
      if (parts.length >= 2) {
        const dateParts = parts[0].split(/[\/\-]/);
        const timeParts = parts[1].replace(/\./g, ':').split(':');
        if (dateParts.length === 3 && timeParts.length >= 2) {
          let day: number, month: number, year: number;
          if (dateParts[0].length === 4) {
            year = parseInt(dateParts[0], 10);
            month = parseInt(dateParts[1], 10) - 1;
            day = parseInt(dateParts[2], 10);
          } else {
            day = parseInt(dateParts[0], 10);
            month = parseInt(dateParts[1], 10) - 1;
            year = parseInt(dateParts[2], 10);
          }
          const hours = parseInt(timeParts[0], 10) || 0;
          const minutes = parseInt(timeParts[1], 10) || 0;
          const seconds = parseInt(timeParts[2], 10) || 0;
          const customDate = new Date(year, month, day, hours, minutes, seconds);
          if (!isNaN(customDate.getTime())) return customDate.getTime();
        }
      }
    }
    return 0;
  };

  const formatTimestamp = (rawTime: any): string => {
    if (!rawTime || rawTime === '-') return '-';
    let d: Date | null = null;

    const ms = parseTimeToMs(rawTime);
    if (ms > 0) {
      d = new Date(ms);
    }

    if (!d || isNaN(d.getTime())) return String(rawTime);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  };

  // Hierarchy supervisor check (DIREKTUR for MANAGER & FINANCE, otherwise Manager)
  const requesterProfile = profiles.find(
    p => p.email.trim().toLowerCase() === (request.userEmail || '').trim().toLowerCase()
  );
  const isRequesterManagerOrFinance =
    requesterProfile?.role === Role.MANAGER || requesterProfile?.role === Role.FINANCE;
  const supervisorTitle = isRequesterManagerOrFinance ? 'Direktur' : 'Manager';

  // Jenis Permintaan
  const isAdjustment = request.id.startsWith('ADJ-') || request.siteId === 'ADJUSTMENT' || (request as any).isAdjustment;
  const isTalangan = !isAdjustment && (
    request.id.startsWith('OPT-') ||
    request.id.startsWith('BBMDS') ||
    request.id.startsWith('BBM_DurenSawit') ||
    request.tipePengajuan === 'DANA_TALANGAN' ||
    request.keterangan.startsWith('[DANA TALANGAN]')
  );
  const isRegularOP = !isAdjustment && !isTalangan;

  // Item Laporan Penggunaan
  const reqUsageItems = usageItems.filter(item => item.requestId === request.id);
  const totalItems = reqUsageItems.length;
  const usageItemIds = new Set(reqUsageItems.map(i => i.id));

  // Pemisahan Log Riwayat:
  // 1. Log Level Request (Pengajuan Anggaran Utama / Siklus 1)
  const reqLevelHistories = (histories || []).filter(h =>
    (h.requestUid === request.id || h.itemUid === request.id) &&
    (!h.itemUid || h.itemUid === request.id || h.itemUid === h.requestUid || !usageItemIds.has(h.itemUid))
  );

  // 2. Seluruh Log yang Relevan (Termasuk item laporan)
  const allReqHistories = (histories || []).filter(h =>
    h.requestUid === request.id || h.itemUid === request.id || (h.itemUid && usageItemIds.has(h.itemUid))
  );

  // =========================================================================
  // SIKLUS 1: SIKLUS PENGAJUAN & REALISASI PENCAIRAN (Disbursement Phase)
  // Khusus untuk pengajuan operasional biasa (OP-)
  // =========================================================================

  // Cek apakah Siklus 1 sudah mencapai tahap transfer / pencairan (atau tahap selanjutnya)
  const isDisbursedOrLater = isRegularOP && (
    [
      RequestStatus.TRANSFERRED,
      RequestStatus.TRANSFER_BERTAHAP,
      RequestStatus.REPORTING,
      RequestStatus.REVIEW_MANAGER,
      RequestStatus.REVIEW_ADMIN,
      RequestStatus.CLOSED
    ].includes(request.status) ||
    (request.adminActionAmount > 0 && Boolean(request.adminActionTime && request.adminActionTime !== '-'))
  );

  // Evaluasi Siklus Pengajuan (Hanya jika belum masuk tahap transfer)
  const pengajuanInitialSubmitTime = request.createdAt || request.timestamp || request.date || null;
  const pengajuanInitialSubmitMs = parseTimeToMs(pengajuanInitialSubmitTime);

  // Log revisi khusus pengajuan
  const pengajuanRevisionLogs = reqLevelHistories.filter(h => {
    const act = (h.actionType || '').toString().toUpperCase();
    const st = (h.status || '').toString().toUpperCase();
    const cat = (h.catatan || '').toLowerCase();
    return (
      act === 'PENGAJUAN_REVISED' ||
      st === 'PENGAJUAN REVISI' ||
      cat.includes('revisi pengajuan') ||
      cat.includes('dikirim ulang oleh pemohon')
    );
  });

  let latestPengajuanRevisionLog: ItemReviewHistory | null = null;
  let latestPengajuanRevisionMs = 0;
  pengajuanRevisionLogs.forEach(h => {
    const ms = parseTimeToMs(h.timestamp);
    if (ms >= latestPengajuanRevisionMs) {
      latestPengajuanRevisionMs = ms;
      latestPengajuanRevisionLog = h;
    }
  });

  // Log penolakan khusus pengajuan anggaran
  const pengajuanRejectionLogs = reqLevelHistories.filter(h => {
    const act = (h.actionType || '').toString().toUpperCase();
    const st = (h.status || '').toString().toUpperCase();
    return (
      (act.includes('REVISI') || act.includes('REJECT') || st === 'REVISI' || st === 'REJECTED') &&
      !act.includes('ITEM')
    );
  });

  let latestPengajuanRejectionLog: ItemReviewHistory | null = null;
  let latestPengajuanRejectionMs = 0;
  pengajuanRejectionLogs.forEach(h => {
    const ms = parseTimeToMs(h.timestamp);
    if (ms >= latestPengajuanRejectionMs) {
      latestPengajuanRejectionMs = ms;
      latestPengajuanRejectionLog = h;
    }
  });

  // Siklus pengajuan di-reset HANYA jika terjadi revisi pengajuan sebelum dana cair
  const isPengajuanRevisedCycle = !isDisbursedOrLater && Boolean(
    latestPengajuanRevisionLog && (
      (latestPengajuanRejectionMs > 0 && latestPengajuanRevisionMs >= latestPengajuanRejectionMs - 2000) ||
      (latestPengajuanRevisionMs > pengajuanInitialSubmitMs)
    )
  );

  const pengajuanStartTime = isPengajuanRevisedCycle ? latestPengajuanRevisionLog!.timestamp : pengajuanInitialSubmitTime;
  const pengajuanStartTimeMs = isPengajuanRevisedCycle ? latestPengajuanRevisionMs : pengajuanInitialSubmitMs;

  const pengajuanSubmitAmount = isPengajuanRevisedCycle && latestPengajuanRevisionLog?.nominal
    ? latestPengajuanRevisionLog.nominal
    : (request.jumlahPengajuan || request.nominal || 0);

  // Filter riwayat yang hanya berlaku di siklus pengajuan aktif (sebelum transfer)
  const currentPengajuanHistories = reqLevelHistories.filter(h => {
    if (isDisbursedOrLater) return true; // Bila sudah cair, semua data historis sah
    if (!pengajuanStartTimeMs) return true;
    return parseTimeToMs(h.timestamp) >= (pengajuanStartTimeMs - 2000);
  });

  // Evaluasi Penolakan Pengajuan (Hanya berlaku bila pengajuan belum pernah cair)
  const isPengajuanRejected = !isDisbursedOrLater && request.status === RequestStatus.REJECTED;
  let pengajuanRejectedByRole: 'MANAGER' | 'DIREKTUR' | 'FINANCE' | null = null;
  if (isPengajuanRejected) {
    if (latestPengajuanRejectionLog) {
      const act = (latestPengajuanRejectionLog.actionType || '').toString().toUpperCase();
      const role = (latestPengajuanRejectionLog.actorRole || '').toString().toUpperCase();
      if (act === 'REVISI_FINANCE' || role === 'FINANCE') {
        pengajuanRejectedByRole = 'FINANCE';
      } else if (act === 'REVISI_DIREKTUR' || role === 'DIREKTUR' || supervisorTitle === 'Direktur') {
        pengajuanRejectedByRole = 'DIREKTUR';
      } else {
        pengajuanRejectedByRole = 'MANAGER';
      }
    } else {
      pengajuanRejectedByRole = request.adminComment && !request.managerComment
        ? 'FINANCE'
        : (supervisorTitle === 'Direktur' ? 'DIREKTUR' : 'MANAGER');
    }
  }

  const pengajuanRejectionTime = latestPengajuanRejectionLog?.timestamp || (
    pengajuanRejectedByRole === 'FINANCE' ? request.adminActionTime : request.managerActionTime
  ) || null;

  // Step 2: Approved Manager / Direktur (Siklus 1)
  const getApprovedManagerInfo = () => {
    let supervisor = supervisorTitle;
    let time: string | null = null;
    let amount = 0;

    // Jika pengajuan saat ini berstatus REJECTED sebelum transfer
    if (isPengajuanRejected && (pengajuanRejectedByRole === 'MANAGER' || pengajuanRejectedByRole === 'DIREKTUR')) {
      return {
        supervisor: pengajuanRejectedByRole === 'DIREKTUR' ? 'Direktur' : 'Manager',
        time: null,
        amount: 0,
        isRejected: true,
        rejectTime: pengajuanRejectionTime
      };
    }

    const mgrApprovalLogs = currentPengajuanHistories.filter(h =>
      (h.actionType === 'APPROVAL_MANAGER' || h.actionType === 'APPROVAL_DIREKTUR' ||
       ((h.actionType as string) === 'APPROVAL' && (h.status || '').toString().toUpperCase() === 'APPROVED'))
    );

    if (mgrApprovalLogs.length > 0) {
      let latestMs = 0;
      let latestLog: ItemReviewHistory | null = null;
      mgrApprovalLogs.forEach(h => {
        const ms = parseTimeToMs(h.timestamp);
        if (ms >= latestMs) {
          latestMs = ms;
          latestLog = h;
        }
      });
      if (latestLog) {
        time = latestLog.timestamp;
        amount = latestLog.nominal || request.managerActionAmount || 0;
        if (latestLog.actionType === 'APPROVAL_DIREKTUR' || latestLog.actorRole === Role.DIREKTUR) {
          supervisor = 'Direktur';
        }
      }
    }

    // Fallback jika sudah masuk tahap transfer atau lebih lanjut
    if (!time && (isDisbursedOrLater || (!isPengajuanRejected && !isPengajuanRevisedCycle))) {
      if (request.managerActionAmount > 0) {
        amount = request.managerActionAmount;
        time = (request as any).managerApprovedAt || (request as any).managerActionTime || request.createdAt || null;
      }
    }

    return { supervisor, time, amount, isRejected: false, rejectTime: null };
  };

  // Step 3: Approved Finance (Siklus 1)
  const getApprovedFinanceInfo = () => {
    let time: string | null = null;
    let amount = 0;

    // Jika pengajuan saat ini berstatus REJECTED oleh Finance sebelum transfer
    if (isPengajuanRejected && pengajuanRejectedByRole === 'FINANCE') {
      return {
        time: null,
        amount: 0,
        isRejected: true,
        rejectTime: pengajuanRejectionTime
      };
    }

    if (isPengajuanRejected) {
      return { time: null, amount: 0, isRejected: false, rejectTime: null };
    }

    const finApprovalLogs = currentPengajuanHistories.filter(h =>
      (h.actionType === 'APPROVAL_FINANCE') &&
      ((h.status || '').toString().toUpperCase() === 'APPROVED' || (h.status || '').toString().toUpperCase() === 'DISETUJUI')
    );

    if (finApprovalLogs.length > 0) {
      let latestMs = 0;
      let latestLog: ItemReviewHistory | null = null;
      finApprovalLogs.forEach(h => {
        const ms = parseTimeToMs(h.timestamp);
        if (ms >= latestMs) {
          latestMs = ms;
          latestLog = h;
        }
      });
      if (latestLog) {
        time = latestLog.timestamp;
        amount = latestLog.nominal || 0;
      }
    }

    if (!amount) {
      amount = getFinanceApprovedAmount(request, currentPengajuanHistories, usageItems);
    }

    // Fallback jika sudah ditransfer
    if (!time && (isDisbursedOrLater || (!isPengajuanRejected && !isPengajuanRevisedCycle))) {
      const transferLogs = currentPengajuanHistories.filter(h =>
        ((h.status || '').toString().toUpperCase() === 'TRANSFERRED' ||
         (h.status || '').toString().toUpperCase() === 'TRANSFER_BERTAHAP' ||
         (h.actionType || '').toString().toUpperCase().includes('TRANSFER'))
      );
      if (transferLogs.length > 0) {
        time = transferLogs[transferLogs.length - 1].timestamp;
      }
      if (!time && request.adminActionTime && request.adminActionTime !== '-') {
        time = request.adminActionTime;
      }
    }

    if (!amount && request.adminActionAmount > 0) {
      amount = request.adminActionAmount;
    }

    return { amount, time, isRejected: false, rejectTime: null };
  };

  // Step 4: Transferred (Siklus 1 untuk OP-, atau Step Akhir untuk OPT-)
  let transferTime: string | null = null;
  let transferAmount = 0;

  const isTransferEligible = isTalangan
    ? [RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP, RequestStatus.CLOSED].includes(request.status)
    : isDisbursedOrLater;

  if (isTransferEligible) {
    const transferLogs = allReqHistories.filter(h =>
      ((h.status || '').toString().toUpperCase() === 'TRANSFERRED' ||
       (h.status || '').toString().toUpperCase() === 'TRANSFER_BERTAHAP' ||
       (h.actionType || '').toString().toUpperCase().includes('TRANSFER'))
    );
    if (transferLogs.length > 0) {
      transferTime = transferLogs[transferLogs.length - 1].timestamp;
    }
    if (!transferTime && request.adminActionTime && request.adminActionTime !== '-') {
      transferTime = request.adminActionTime;
    }
    transferAmount = request.adminActionAmount || 0;
  }

  // =========================================================================
  // SIKLUS 2: SIKLUS LAPORAN PENGGUNAAN & DANA TALANGAN PRIBADI (Accountability)
  // Untuk OP- (Step 5 & 6) dan untuk OPT- (Seluruh siklus talangan)
  // Penolakan di siklus ini TIDAK PERNAH mereset Siklus 1 Pengajuan & Transfer!
  // =========================================================================

  // Step 5 / Step 2 (OPT-): Review Manager Laporan
  const getReviewManagerTimestamp = () => {
    if (totalItems === 0) {
      return { totalItems: 0, approvedCount: 0, approvedNominal: 0, time: null, isRejected: false, rejectTime: null, rejectCount: 0 };
    }

    let rejectCount = 0;
    let latestRejectTime: string | null = null;
    let maxRejectMs = 0;

    const approvedItemIds = new Set<string>();
    let latestApprovedTime: string | null = null;
    let maxApprovedMs = 0;

    reqUsageItems.forEach(item => {
      const itemLogs = allReqHistories.filter(h => h.itemUid === item.id);

      let itemMgrRejectLog: ItemReviewHistory | null = null;
      let itemMgrRejectMs = 0;
      let itemFinRejectMs = 0;
      let itemUserRepairMs = 0;

      itemLogs.forEach(h => {
        const ms = parseTimeToMs(h.timestamp);
        const act = (h.actionType || '').toString().toUpperCase();
        const st = (h.status || '').toString().toUpperCase();
        const cat = (h.catatan || '').toLowerCase();

        if (act === 'REVISI_MANAGER' || act === 'REVISI_DIREKTUR' || (st === 'REVISI' && (h.actorRole === Role.MANAGER || h.actorRole === Role.DIREKTUR))) {
          if (ms >= itemMgrRejectMs) {
            itemMgrRejectMs = ms;
            itemMgrRejectLog = h;
          }
        }
        if (act === 'REVISI_FINANCE' || (st === 'REVISI' && h.actorRole === Role.FINANCE)) {
          if (ms >= itemFinRejectMs) {
            itemFinRejectMs = ms;
          }
        }
        if (act === 'PERBAIKAN_USER' || st === 'PERBAIKAN' || st === 'PERBAIKAN SUBMITTED' || cat.includes('perbaikan')) {
          if (ms >= itemUserRepairMs) {
            itemUserRepairMs = ms;
          }
        }
      });

      const itemUpdatedMs = parseTimeToMs(item.updatedAt);
      const effectiveRepairMs = Math.max(itemUserRepairMs, itemUpdatedMs);
      const maxAnyRejectMs = Math.max(itemMgrRejectMs, itemFinRejectMs);

      // Cek apakah item sudah diperbaiki oleh user setelah penolakan terakhir
      const isRepairedByUser = maxAnyRejectMs > 0 && (
        (effectiveRepairMs >= maxAnyRejectMs - 2000) ||
        (item.statusManager === ItemStatus.PENDING && item.statusAdmin === ItemStatus.PENDING)
      );

      // Cek apakah saat ini item sedang berstatus REJECTED oleh Manager
      const isCurrentlyRejectedByManager = !isRepairedByUser && (
        item.statusManager === ItemStatus.REJECTED ||
        (itemMgrRejectMs > 0 && item.statusManager !== ItemStatus.APPROVED && !isRepairedByUser)
      );

      if (isCurrentlyRejectedByManager) {
        rejectCount++;
        const rTime = itemMgrRejectLog?.timestamp || null;
        if (itemMgrRejectMs >= maxRejectMs) {
          maxRejectMs = itemMgrRejectMs;
          latestRejectTime = rTime;
        }
        return; // Item ini tidak disetujui
      }

      // Kapan item sah disetujui oleh Manager?
      const isApprovedInItem = item.statusManager === ItemStatus.APPROVED || (item.statusManager || '').toString().toUpperCase() === 'APPROVED';

      if (!isApprovedInItem) {
        return; // Belum disetujui Manager di siklus ini
      }

      // Jika pernah ada penolakan atau perbaikan user, approval Manager harus terjadi SETELAH perbaikan/penolakan
      if (isRepairedByUser || maxAnyRejectMs > 0) {
        const thresholdMs = Math.max(effectiveRepairMs, maxAnyRejectMs) - 2000;
        const approvalAfterRepair = itemLogs.some(h => {
          const act = (h.actionType || '').toString().toUpperCase();
          const st = (h.status || '').toString().toUpperCase();
          const isMgr = act.includes('MANAGER') || act.includes('DIREKTUR') || (h.actorRole === Role.MANAGER || h.actorRole === Role.DIREKTUR);
          const isAppr = act.includes('APPROVAL') || st === 'APPROVED' || st === 'DISETUJUI';
          return isMgr && isAppr && parseTimeToMs(h.timestamp) > thresholdMs;
        });

        if (!approvalAfterRepair) {
          return;
        }
      }

      // Item sah disetujui Manager
      approvedItemIds.add(item.id);

      const mgrApprLogs = itemLogs.filter(h => {
        const act = (h.actionType || '').toString().toUpperCase();
        const st = (h.status || '').toString().toUpperCase();
        const isMgr = act.includes('MANAGER') || act.includes('DIREKTUR') || (h.actorRole === Role.MANAGER || h.actorRole === Role.DIREKTUR);
        const isAppr = act.includes('APPROVAL') || st === 'APPROVED' || st === 'DISETUJUI';
        return isMgr && isAppr;
      });

      mgrApprLogs.forEach(h => {
        const ms = parseTimeToMs(h.timestamp);
        if (ms >= maxApprovedMs) {
          maxApprovedMs = ms;
          latestApprovedTime = h.timestamp;
        }
      });
    });

    const approvedCount = approvedItemIds.size;
    const approvedNominal = reqUsageItems.reduce((sum, item) => {
      if (approvedItemIds.has(item.id)) {
        return sum + (Number(item.nominal) || 0);
      }
      return sum;
    }, 0);

    return {
      totalItems,
      approvedCount,
      approvedNominal,
      time: approvedCount > 0 ? latestApprovedTime : null,
      isRejected: rejectCount > 0,
      rejectTime: latestRejectTime,
      rejectCount
    };
  };

  // Step 6 / Step 3 (OPT-): Review Finance Laporan
  const getReviewFinanceTimestamp = () => {
    if (totalItems === 0) {
      return { totalItems: 0, approvedCount: 0, approvedNominal: 0, time: null, isRejected: false, rejectTime: null, rejectCount: 0 };
    }

    let rejectCount = 0;
    let latestRejectTime: string | null = null;
    let maxRejectMs = 0;

    const approvedItemIds = new Set<string>();
    let latestApprovedTime: string | null = null;
    let maxApprovedMs = 0;

    reqUsageItems.forEach(item => {
      const itemLogs = allReqHistories.filter(h => h.itemUid === item.id);

      let itemMgrRejectMs = 0;
      let itemFinRejectLog: ItemReviewHistory | null = null;
      let itemFinRejectMs = 0;
      let itemUserRepairMs = 0;

      itemLogs.forEach(h => {
        const ms = parseTimeToMs(h.timestamp);
        const act = (h.actionType || '').toString().toUpperCase();
        const st = (h.status || '').toString().toUpperCase();
        const cat = (h.catatan || '').toLowerCase();

        if (act === 'REVISI_MANAGER' || act === 'REVISI_DIREKTUR' || (st === 'REVISI' && (h.actorRole === Role.MANAGER || h.actorRole === Role.DIREKTUR))) {
          if (ms >= itemMgrRejectMs) itemMgrRejectMs = ms;
        }
        if (act === 'REVISI_FINANCE' || (st === 'REVISI' && h.actorRole === Role.FINANCE)) {
          if (ms >= itemFinRejectMs) {
            itemFinRejectMs = ms;
            itemFinRejectLog = h;
          }
        }
        if (act === 'PERBAIKAN_USER' || st === 'PERBAIKAN' || st === 'PERBAIKAN SUBMITTED' || cat.includes('perbaikan')) {
          if (ms >= itemUserRepairMs) {
            itemUserRepairMs = ms;
          }
        }
      });

      const itemUpdatedMs = parseTimeToMs(item.updatedAt);
      const effectiveRepairMs = Math.max(itemUserRepairMs, itemUpdatedMs);
      const maxAnyRejectMs = Math.max(itemMgrRejectMs, itemFinRejectMs);

      const isRepairedByUser = maxAnyRejectMs > 0 && (
        (effectiveRepairMs >= maxAnyRejectMs - 2000) ||
        (item.statusManager === ItemStatus.PENDING && item.statusAdmin === ItemStatus.PENDING)
      );

      const isCurrentlyRejectedByFinance = !isRepairedByUser && (
        item.statusAdmin === ItemStatus.REJECTED ||
        (itemFinRejectMs > 0 && item.statusAdmin !== ItemStatus.APPROVED && !isRepairedByUser)
      );

      if (isCurrentlyRejectedByFinance) {
        rejectCount++;
        const rTime = itemFinRejectLog?.timestamp || null;
        if (itemFinRejectMs >= maxRejectMs) {
          maxRejectMs = itemFinRejectMs;
          latestRejectTime = rTime;
        }
        return;
      }

      const isApprovedInItem = item.statusAdmin === ItemStatus.APPROVED || (item.statusAdmin || '').toString().toUpperCase() === 'APPROVED';

      if (!isApprovedInItem) {
        return;
      }

      if (isRepairedByUser || maxAnyRejectMs > 0) {
        const thresholdMs = Math.max(effectiveRepairMs, maxAnyRejectMs) - 2000;
        const approvalAfterRepair = itemLogs.some(h => {
          const act = (h.actionType || '').toString().toUpperCase();
          const st = (h.status || '').toString().toUpperCase();
          const isFin = act.includes('FINANCE') || h.actorRole === Role.FINANCE;
          const isAppr = act.includes('APPROVAL') || st === 'APPROVED' || st === 'DISETUJUI';
          return isFin && isAppr && parseTimeToMs(h.timestamp) > thresholdMs;
        });

        if (!approvalAfterRepair) {
          return;
        }
      }

      approvedItemIds.add(item.id);

      const finApprLogs = itemLogs.filter(h => {
        const act = (h.actionType || '').toString().toUpperCase();
        const st = (h.status || '').toString().toUpperCase();
        const isFin = act.includes('FINANCE') || h.actorRole === Role.FINANCE;
        const isAppr = act.includes('APPROVAL') || st === 'APPROVED' || st === 'DISETUJUI';
        return isFin && isAppr;
      });

      finApprLogs.forEach(h => {
        const ms = parseTimeToMs(h.timestamp);
        if (ms >= maxApprovedMs) {
          maxApprovedMs = ms;
          latestApprovedTime = h.timestamp;
        }
      });
    });

    const approvedCount = approvedItemIds.size;
    const approvedNominal = reqUsageItems.reduce((sum, item) => {
      if (approvedItemIds.has(item.id)) {
        return sum + (Number(item.nominal) || 0);
      }
      return sum;
    }, 0);

    return {
      totalItems,
      approvedCount,
      approvedNominal,
      time: approvedCount > 0 ? latestApprovedTime : null,
      isRejected: rejectCount > 0,
      rejectTime: latestRejectTime,
      rejectCount
    };
  };

  const approvedManagerInfo = getApprovedManagerInfo();
  const approvedFinanceInfo = getApprovedFinanceInfo();
  const reviewManagerInfo = getReviewManagerTimestamp();
  const reviewFinanceInfo = getReviewFinanceTimestamp();

  const hasSubmitTime = Boolean(pengajuanStartTime && pengajuanStartTime !== '-');
  const hasApprovedManagerTime = Boolean(approvedManagerInfo?.time && approvedManagerInfo.time !== '-');
  const hasApprovedFinanceTime = Boolean(approvedFinanceInfo?.time && approvedFinanceInfo.time !== '-');
  const hasTransferTime = Boolean(transferTime && transferTime !== '-');
  const hasReviewManagerTime = Boolean(reviewManagerInfo?.time && reviewManagerInfo.time !== '-');
  const hasReviewFinanceTime = Boolean(reviewFinanceInfo?.time && reviewFinanceInfo.time !== '-');

  const isDark = theme === 'dark';

  const adjTransferTime = (request.adminActionTime && request.adminActionTime !== '-') ? request.adminActionTime : (request.createdAt || request.timestamp || null);
  const hasAdjTransferTime = Boolean(adjTransferTime && adjTransferTime !== '-');
  const adjTransferAmount = request.adminActionAmount > 0 ? request.adminActionAmount : (request.jumlahPengajuan || request.nominal || 0);

  // Total nominal talangan diajukan
  const talanganSubmitAmount = request.jumlahPengajuan || request.nominal || reqUsageItems.reduce((s, i) => s + (Number(i.nominal) || 0), 0);

  return (
    <div className={`${isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-slate-50/90 border-slate-200/90'} border rounded-xl p-3 my-1 text-left space-y-2.5 transition-all ${className}`}>
      {title && (
        <div className={`border-b pb-1.5 ${isDark ? 'border-slate-800' : 'border-slate-200/60'}`}>
          <span className={`text-[9px] font-bold uppercase tracking-wider block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {title}
          </span>
        </div>
      )}

      <div className={`relative pl-4 space-y-3.5 border-l-2 ml-1.5 my-1 ${isDark ? 'border-indigo-500/40' : 'border-indigo-200/80'}`}>
        {isAdjustment ? (
          <>
            {/* Step: Sudah Ditransfer (Hanya menampilkan proses Transfer untuk Alur Adjustment) */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasAdjTransferTime ? (isDark ? 'bg-emerald-500 ring-4 ring-emerald-950' : 'bg-emerald-600 ring-4 ring-emerald-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Sudah Ditransfer</span>
                {adjTransferAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatIDR(adjTransferAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasAdjTransferTime ? formatTimestamp(adjTransferTime) : '-'}
              </div>
            </div>
          </>
        ) : isTalangan ? (
          /* =========================================================================
             ALUR DANA TALANGAN PRIBADI (OPT-)
             Hanya Siklus Tunggal: Review Manager -> Review Finance -> Sudah Ditransfer
             TANPA PEMISAH VISUAL
             ========================================================================= */
          <>
            {/* Step 1: User Submit Pengajuan Talangan */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 ring-4 ${isDark ? 'ring-blue-950' : 'ring-blue-50'}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>User Submit</span>
                {talanganSubmitAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{formatIDR(talanganSubmitAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {formatTimestamp(request.createdAt || request.timestamp || request.date)}
              </div>
            </div>

            {/* Step 2: Review Manager / Direktur */}
            <div className="relative text-left">
              {reviewManagerInfo.isRejected ? (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-4 ${isDark ? 'ring-rose-950' : 'ring-rose-50'}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
                    <span>Diminta Revisi {supervisorTitle} ({reviewManagerInfo.rejectCount}/{reviewManagerInfo.totalItems})</span>
                  </div>
                  <div className="text-[9px] font-mono text-rose-500">
                    {formatTimestamp(reviewManagerInfo.rejectTime)}
                  </div>
                </>
              ) : (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReviewManagerTime ? (isDark ? 'bg-sky-500 ring-4 ring-sky-950' : 'bg-sky-600 ring-4 ring-sky-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                    <span>Review {supervisorTitle} ({reviewManagerInfo.approvedCount}/{reviewManagerInfo.totalItems})</span>
                    {hasReviewManagerTime && reviewManagerInfo.approvedNominal > 0 && (
                      <span className={`font-mono font-bold ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>{formatIDR(reviewManagerInfo.approvedNominal)}</span>
                    )}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">
                    {hasReviewManagerTime ? formatTimestamp(reviewManagerInfo.time) : '-'}
                  </div>
                </>
              )}
            </div>

            {/* Step 3: Review Finance */}
            <div className="relative text-left">
              {reviewFinanceInfo.isRejected ? (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-4 ${isDark ? 'ring-rose-950' : 'ring-rose-50'}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
                    <span>Diminta Revisi Finance ({reviewFinanceInfo.rejectCount}/{reviewFinanceInfo.totalItems})</span>
                  </div>
                  <div className="text-[9px] font-mono text-rose-500">
                    {formatTimestamp(reviewFinanceInfo.rejectTime)}
                  </div>
                </>
              ) : (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReviewFinanceTime ? (isDark ? 'bg-purple-500 ring-4 ring-purple-950' : 'bg-purple-600 ring-4 ring-purple-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                    <span>Review Finance ({reviewFinanceInfo.approvedCount}/{reviewFinanceInfo.totalItems})</span>
                    {hasReviewFinanceTime && reviewFinanceInfo.approvedNominal > 0 && (
                      <span className={`font-mono font-bold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>{formatIDR(reviewFinanceInfo.approvedNominal)}</span>
                    )}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">
                    {hasReviewFinanceTime ? formatTimestamp(reviewFinanceInfo.time) : '-'}
                  </div>
                </>
              )}
            </div>

            {/* Step 4: Sudah Ditransfer */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasTransferTime ? (isDark ? 'bg-emerald-500 ring-4 ring-emerald-950' : 'bg-emerald-600 ring-4 ring-emerald-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Sudah Ditransfer</span>
                {hasTransferTime && transferAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatIDR(transferAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasTransferTime ? formatTimestamp(transferTime) : '-'}
              </div>
            </div>
          </>
        ) : (
          /* =========================================================================
             ALUR OPERASIONAL BIASA (OP-)
             Terbagi menjadi 2 Siklus Independen:
             1. SIKLUS 1: Realisasi Pengajuan & Pencairan Dana (Step 1 s/d 4)
             --- PEMISAH VISUAL: Realisasi & Laporan Penggunaan ---
             2. SIKLUS 2: Laporan Penggunaan Anggaran (Step 5 & 6)
             ========================================================================= */
          <>
            {/* Step 1: User Submit (Pengajuan Anggaran) */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 ring-4 ${isDark ? 'ring-blue-950' : 'ring-blue-50'}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>{isPengajuanRevisedCycle ? 'User Submit (Revisi)' : 'User Submit'}</span>
                {hasSubmitTime && pengajuanSubmitAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{formatIDR(pengajuanSubmitAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasSubmitTime ? formatTimestamp(pengajuanStartTime) : '-'}
              </div>
            </div>

            {/* Step 2: Approved Manager / Direktur */}
            <div className="relative text-left">
              {approvedManagerInfo.isRejected ? (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-4 ${isDark ? 'ring-rose-950' : 'ring-rose-50'}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
                    <span>Diminta Revisi {approvedManagerInfo.supervisor}</span>
                  </div>
                  <div className="text-[9px] font-mono text-rose-500">
                    {formatTimestamp(approvedManagerInfo.rejectTime)}
                  </div>
                </>
              ) : (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasApprovedManagerTime ? (isDark ? 'bg-indigo-500 ring-4 ring-indigo-950' : 'bg-indigo-600 ring-4 ring-indigo-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                    <span>Approved {approvedManagerInfo?.supervisor || supervisorTitle}</span>
                    {hasApprovedManagerTime && approvedManagerInfo.amount > 0 && (
                      <span className={`font-mono font-bold ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{formatIDR(approvedManagerInfo.amount)}</span>
                    )}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">
                    {hasApprovedManagerTime ? formatTimestamp(approvedManagerInfo.time) : '-'}
                  </div>
                </>
              )}
            </div>

            {/* Step 3: Approved Finance */}
            <div className="relative text-left">
              {approvedFinanceInfo.isRejected ? (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-4 ${isDark ? 'ring-rose-950' : 'ring-rose-50'}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
                    <span>Diminta Revisi Finance</span>
                  </div>
                  <div className="text-[9px] font-mono text-rose-500">
                    {formatTimestamp(approvedFinanceInfo.rejectTime)}
                  </div>
                </>
              ) : (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasApprovedFinanceTime ? (isDark ? 'bg-purple-500 ring-4 ring-purple-950' : 'bg-purple-600 ring-4 ring-purple-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                    <span>Approved Finance</span>
                    {hasApprovedFinanceTime && approvedFinanceInfo?.amount > 0 && (
                      <span className={`font-mono font-bold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>{formatIDR(approvedFinanceInfo.amount)}</span>
                    )}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">
                    {hasApprovedFinanceTime ? formatTimestamp(approvedFinanceInfo.time) : '-'}
                  </div>
                </>
              )}
            </div>

            {/* Step 4: Sudah Ditransfer */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasTransferTime ? (isDark ? 'bg-emerald-500 ring-4 ring-emerald-950' : 'bg-emerald-600 ring-4 ring-emerald-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Sudah Ditransfer</span>
                {hasTransferTime && transferAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatIDR(transferAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasTransferTime ? formatTimestamp(transferTime) : '-'}
              </div>
            </div>

            {/* =========================================================================
               PEMISAH VISUAL REALISASI DAN LAPORAN (Hanya untuk UID OP-)
               ========================================================================= */}
            <div className="relative my-3 pt-2 pb-1 -ml-4 pl-4">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className={`w-full border-t border-dashed ${isDark ? 'border-slate-700/80' : 'border-slate-300'}`} />
              </div>
              <div className="relative flex justify-start">
                <span className={`text-[9px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md shadow-xs ${
                  isDark 
                    ? 'bg-slate-800 text-slate-300 border border-slate-700' 
                    : 'bg-slate-200/90 text-slate-700 border border-slate-300/70'
                }`}>
                  Realisasi & Laporan Penggunaan
                </span>
              </div>
            </div>

            {/* Step 5: Review Manager (Laporan Penggunaan) */}
            <div className="relative text-left">
              {reviewManagerInfo.isRejected ? (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-4 ${isDark ? 'ring-rose-950' : 'ring-rose-50'}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
                    <span>Diminta Revisi Manager ({reviewManagerInfo.rejectCount}/{reviewManagerInfo.totalItems})</span>
                  </div>
                  <div className="text-[9px] font-mono text-rose-500">
                    {formatTimestamp(reviewManagerInfo.rejectTime)}
                  </div>
                </>
              ) : (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReviewManagerTime ? (isDark ? 'bg-sky-500 ring-4 ring-sky-950' : 'bg-sky-600 ring-4 ring-sky-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                    <span>Review Manager ({reviewManagerInfo.approvedCount}/{reviewManagerInfo.totalItems})</span>
                    {hasReviewManagerTime && reviewManagerInfo.approvedNominal > 0 && (
                      <span className={`font-mono font-bold ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>{formatIDR(reviewManagerInfo.approvedNominal)}</span>
                    )}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">
                    {hasReviewManagerTime ? formatTimestamp(reviewManagerInfo.time) : '-'}
                  </div>
                </>
              )}
            </div>

            {/* Step 6: Review Finance (Laporan Penggunaan) */}
            <div className="relative text-left">
              {reviewFinanceInfo.isRejected ? (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-4 ${isDark ? 'ring-rose-950' : 'ring-rose-50'}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
                    <span>Diminta Revisi Finance ({reviewFinanceInfo.rejectCount}/{reviewFinanceInfo.totalItems})</span>
                  </div>
                  <div className="text-[9px] font-mono text-rose-500">
                    {formatTimestamp(reviewFinanceInfo.rejectTime)}
                  </div>
                </>
              ) : (
                <>
                  <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReviewFinanceTime ? (isDark ? 'bg-emerald-500 ring-4 ring-emerald-950' : 'bg-emerald-600 ring-4 ring-emerald-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
                  <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                    <span>Review Finance ({reviewFinanceInfo.approvedCount}/{reviewFinanceInfo.totalItems})</span>
                    {hasReviewFinanceTime && reviewFinanceInfo.approvedNominal > 0 && (
                      <span className={`font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatIDR(reviewFinanceInfo.approvedNominal)}</span>
                    )}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">
                    {hasReviewFinanceTime ? formatTimestamp(reviewFinanceInfo.time) : '-'}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
