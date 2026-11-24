/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BudgetRequest,
  RequestStatus,
  UsageReportItem,
  UserActivity,
  UserProfile,
  formatTimestamp
} from '../types';
import { useBackHandler } from '../hooks/useBackHandler';
import { ZoomableImage } from './ZoomableImage';
import {
  fetchBbmUsageItemsByPlate,
  getAllCachedClosedUsageItems,
  parseNumericValue
} from '../lib/googleApi';
import {
  Calendar,
  Car,
  ClipboardList,
  Clock,
  Compass,
  Eye,
  Fuel,
  Loader2,
  MapPin,
  User,
  X
} from 'lucide-react';

interface ReviewBbmActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: UsageReportItem | null;
  request: BudgetRequest;
  allUsageItems: UsageReportItem[];
  allRequests?: BudgetRequest[];
  activities: UserActivity[];
  profiles?: UserProfile[];
  onPreviewPhoto?: (photo: { url: string; fileId?: string; title: string }) => void;
}

function normalizePlat(value?: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function extractYmd(value?: string): string {
  const str = String(value || '').trim();
  if (!str) return '';

  const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    const y = dmyMatch[3];
    return `${y}-${m}-${d}`;
  }

  const parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    const dt = new Date(parsed);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return '';
}

function parseFlexibleMs(value?: string): number {
  const str = String(value || '').trim();
  if (!str) return NaN;

  if (/^\d{4}-\d{2}-\d{2}T.*(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(str)) {
    const iso = Date.parse(str);
    if (!isNaN(iso)) return iso;
  }

  const dmyMatch = str.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/
  );
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
    const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    const dt = new Date(year, month, day, hour, min, sec);
    if (!isNaN(dt.getTime())) return dt.getTime();
  }

  const ymdMatch = str.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/
  );
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const hour = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
    const min = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
    const sec = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
    const dt = new Date(year, month, day, hour, min, sec);
    if (!isNaN(dt.getTime())) return dt.getTime();
  }

  const parsed = Date.parse(str);
  return isNaN(parsed) ? NaN : parsed;
}

function formatYmdIndo(ymd?: string): string {
  const clean = extractYmd(ymd);
  if (!clean) return '-';
  const [y, m, d] = clean.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (isNaN(dt.getTime())) return clean;
  return dt.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function parseCoords(coordStr: string): { lat: number; lng: number } | null {
  if (!coordStr) return null;
  const clean = coordStr.replace(/[()\[\]]/g, '').trim();
  const parts = clean.split(/[\s,]+/);
  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }
  return null;
}

function getDistanceInMeters(coordStr1: string, coordStr2: string): number | null {
  const c1 = parseCoords(coordStr1);
  const c2 = parseCoords(coordStr2);
  if (!c1 || !c2) return null;

  const R = 6371e3;
  const phi1 = (c1.lat * Math.PI) / 180;
  const phi2 = (c2.lat * Math.PI) / 180;
  const deltaPhi = ((c2.lat - c1.lat) * Math.PI) / 180;
  const deltaLambda = ((c2.lng - c1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export const ReviewBbmActivityModal: React.FC<ReviewBbmActivityModalProps> = ({
  isOpen,
  onClose,
  item,
  request,
  allUsageItems,
  allRequests = [],
  activities,
  profiles = [],
  onPreviewPhoto
}) => {
  const [serverBbmItems, setServerBbmItems] = useState<UsageReportItem[]>([]);
  const [isSyncingServer, setIsSyncingServer] = useState(false);
  const [localPhotoPreview, setLocalPhotoPreview] = useState<{
    url: string;
    fileId?: string;
    title: string;
  } | null>(null);

  useBackHandler(!!localPhotoPreview, () => setLocalPhotoPreview(null), 'reviewBbmActivity_photoPreview');
  useBackHandler(isOpen && !localPhotoPreview, onClose, 'reviewBbmActivity_modal');

  const targetPlat = useMemo(() => normalizePlat(item?.platNomorKendaraan), [item?.platNomorKendaraan]);

  // Fetch all BBM items for this plate from server cache (ensures closed reports not yet in client cache are also included)
  useEffect(() => {
    if (!isOpen || !targetPlat) {
      setServerBbmItems([]);
      setIsSyncingServer(false);
      return;
    }

    let cancelled = false;
    setIsSyncingServer(true);

    fetchBbmUsageItemsByPlate(targetPlat)
      .then((rows) => {
        if (!cancelled) {
          setServerBbmItems(rows);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSyncingServer(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, targetPlat]);

  const requestMap = useMemo(() => {
    const map = new Map<string, BudgetRequest>();
    for (const r of allRequests) {
      if (r.id) map.set(r.id.toUpperCase().trim(), r);
    }
    if (request?.id) {
      map.set(request.id.toUpperCase().trim(), request);
    }
    return map;
  }, [allRequests, request]);

  const profileMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const p of profiles) {
      if (p.email) map.set(p.email.toLowerCase().trim(), p);
    }
    return map;
  }, [profiles]);

  const {
    startYmd,
    nextPurchase,
    nextYmd,
    matchedActivities,
    totalPurchasesForPlate
  } = useMemo(() => {
    if (!item || !targetPlat) {
      return {
        startYmd: '',
        nextPurchase: null as UsageReportItem | null,
        nextYmd: '',
        matchedActivities: [] as UserActivity[],
        totalPurchasesForPlate: 0
      };
    }

    const cancelledReqIds = new Set<string>();
    for (const r of allRequests) {
      if (r.status === RequestStatus.CANCELLED && r.id) {
        cancelledReqIds.add(r.id.toUpperCase().trim());
      }
    }

    // Merge active items, cached closed items, server plate items, and current item
    const combinedMap = new Map<string, UsageReportItem>();
    const pushItem = (candidate: UsageReportItem) => {
      if (!candidate || !candidate.id || candidate.id.startsWith('summary_')) return;
      if (!candidate.isBBM) return;
      if (normalizePlat(candidate.platNomorKendaraan) !== targetPlat) return;
      const reqIdKey = String(candidate.requestId || '').toUpperCase().trim();
      if (reqIdKey && cancelledReqIds.has(reqIdKey) && candidate.id !== item.id) return;
      combinedMap.set(candidate.id, candidate);
    };

    for (const u of getAllCachedClosedUsageItems()) pushItem(u);
    for (const u of allUsageItems || []) pushItem(u);
    for (const u of serverBbmItems) pushItem(u);
    pushItem(item);

    // Sort all BBM purchases for this vehicle chronologically
    const sortedPurchases = Array.from(combinedMap.values()).sort((a, b) => {
      const ymdA = extractYmd(a.tanggalPenggunaan) || extractYmd(a.timestamp || a.updatedAt) || '9999-99-99';
      const ymdB = extractYmd(b.tanggalPenggunaan) || extractYmd(b.timestamp || b.updatedAt) || '9999-99-99';
      if (ymdA !== ymdB) return ymdA.localeCompare(ymdB);

      const msA = parseFlexibleMs(a.timestamp || a.updatedAt);
      const msB = parseFlexibleMs(b.timestamp || b.updatedAt);
      if (!isNaN(msA) && !isNaN(msB) && msA !== msB) return msA - msB;

      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const currentIdx = sortedPurchases.findIndex((p) => p.id === item.id);
    const prevPurchase = currentIdx > 0 ? sortedPurchases[currentIdx - 1] : null;
    const foundNext = currentIdx >= 0 && currentIdx + 1 < sortedPurchases.length
      ? sortedPurchases[currentIdx + 1]
      : null;

    const curStartYmd =
      extractYmd(item.tanggalPenggunaan) || extractYmd(item.timestamp || item.updatedAt);
    const prevStartYmd = prevPurchase
      ? extractYmd(prevPurchase.tanggalPenggunaan) || extractYmd(prevPurchase.timestamp || prevPurchase.updatedAt)
      : '';
    const foundNextYmd = foundNext
      ? extractYmd(foundNext.tanggalPenggunaan) || extractYmd(foundNext.timestamp || foundNext.updatedAt)
      : '';

    const curMs = parseFlexibleMs(item.timestamp || item.updatedAt);
    const nextMs = foundNext ? parseFlexibleMs(foundNext.timestamp || foundNext.updatedAt) : NaN;
    const sameDayWithPrev = Boolean(prevStartYmd && curStartYmd && prevStartYmd === curStartYmd);
    const sameDayWithNext = Boolean(foundNextYmd && curStartYmd && foundNextYmd === curStartYmd);

    const filtered = (activities || [])
      .filter((act) => {
        if (normalizePlat(act.platNomor) !== targetPlat) return false;
        const actYmd = extractYmd(act.tanggal) || extractYmd(act.createdAt || act.timestamp);
        if (!actYmd || !curStartYmd) return false;

        // Start boundary: from this BBM purchase onwards
        if (actYmd < curStartYmd) return false;
        if (actYmd === curStartYmd && sameDayWithPrev && !isNaN(curMs)) {
          const actMs = parseFlexibleMs(act.createdAt || act.timestamp);
          if (!isNaN(actMs) && actMs < curMs) return false;
        }

        // End boundary: strictly before the next BBM purchase for the same plate
        if (foundNextYmd) {
          if (sameDayWithNext) {
            if (actYmd > foundNextYmd) return false;
            if (!isNaN(nextMs)) {
              const actMs = parseFlexibleMs(act.createdAt || act.timestamp);
              if (!isNaN(actMs) && actMs >= nextMs) return false;
            }
          } else {
            if (actYmd >= foundNextYmd) return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const ymdA = extractYmd(a.tanggal) || extractYmd(a.createdAt || a.timestamp);
        const ymdB = extractYmd(b.tanggal) || extractYmd(b.createdAt || b.timestamp);
        if (ymdA !== ymdB) return ymdA.localeCompare(ymdB);

        const msA = parseFlexibleMs(a.createdAt || a.timestamp);
        const msB = parseFlexibleMs(b.createdAt || b.timestamp);
        if (!isNaN(msA) && !isNaN(msB) && msA !== msB) return msA - msB;

        return String(a.id || '').localeCompare(String(b.id || ''));
      });

    return {
      startYmd: curStartYmd,
      nextPurchase: foundNext,
      nextYmd: foundNextYmd,
      matchedActivities: filtered,
      totalPurchasesForPlate: sortedPurchases.length
    };
  }, [item, targetPlat, allUsageItems, allRequests, serverBbmItems, activities]);

  if (!isOpen || !item) return null;

  const nextPurchaseReq = nextPurchase
    ? requestMap.get(String(nextPurchase.requestId || '').toUpperCase().trim())
    : undefined;
  const nextPurchaseUserName = nextPurchaseReq
    ? profileMap.get(nextPurchaseReq.userEmail.toLowerCase().trim())?.nama || nextPurchaseReq.userEmail
    : '';
  const currentRequesterName =
    profileMap.get(request.userEmail.toLowerCase().trim())?.nama || request.userEmail;

  const handleOpenPhoto = (act: UserActivity) => {
    const payload = {
      url: act.buktiUrl,
      fileId: act.buktiFileId,
      title: `Foto Aktivitas ${act.platNomor || targetPlat} — Site ${act.siteId} (${act.siteName})`
    };
    if (onPreviewPhoto) {
      onPreviewPhoto(payload);
    } else {
      setLocalPhotoPreview(payload);
    }
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs z-[100005] flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[88vh] animate-scale-up my-auto overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 bg-gradient-to-r from-amber-50 via-orange-50/70 to-white border-b border-amber-200/80 flex items-start justify-between gap-3 shrink-0">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-sm shrink-0">
                <Fuel className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-bold text-slate-900 text-sm sm:text-base">
                    Review BBM Kendaraan
                  </h3>
                  {targetPlat && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-slate-900 text-amber-300 font-mono text-xs font-extrabold tracking-wider shadow-xs">
                      <Car className="w-3.5 h-3.5 text-amber-400" />
                      {targetPlat}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                  Pemohon: <span className="font-bold text-slate-700">{currentRequesterName}</span> •{' '}
                  <span className="font-mono text-slate-600">{request.id}</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              aria-label="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Summary Strip: Current BBM Purchase & Next BBM Purchase */}
          <div className="px-5 py-3.5 bg-slate-50/80 border-b border-slate-100 space-y-2.5 shrink-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Current Purchase */}
              <div className="bg-white rounded-2xl p-3 border border-amber-200/80 shadow-xs">
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-amber-700 block mb-1">
                  Pembelian BBM Ini (Mulai)
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    {formatYmdIndo(startYmd)}
                  </span>
                  <span className="text-xs font-extrabold text-amber-700">
                    Rp {parseNumericValue(item.nominal).toLocaleString('id-ID')}
                  </span>
                </div>
                {item.keterangan && (
                  <p className="text-[10px] text-slate-500 mt-1 line-clamp-1" title={item.keterangan}>
                    {item.keterangan}
                  </p>
                )}
              </div>

              {/* Next Purchase */}
              <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs">
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-indigo-700 block mb-1">
                  Pembelian BBM Berikutnya (Batas Akhir)
                </span>
                {nextPurchase ? (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        {formatYmdIndo(nextYmd)}
                      </span>
                      <span className="text-xs font-extrabold text-indigo-700">
                        Rp {parseNumericValue(nextPurchase.nominal).toLocaleString('id-ID')}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 truncate">
                      {nextPurchaseUserName ? `${nextPurchaseUserName} • ` : ''}
                      <span className="font-mono">{nextPurchase.requestId}</span>
                    </p>
                  </>
                ) : (
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-slate-600">Belum ada pembelian berikutnya</p>
                    <p className="text-[10px] text-slate-400">
                      Menampilkan aktivitas hingga hari ini
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Period Info + Count */}
            <div className="flex items-center justify-between flex-wrap gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>
                  Periode:{' '}
                  <strong className="text-slate-800">{formatYmdIndo(startYmd)}</strong>
                  {' s/d '}
                  <strong className="text-slate-800">
                    {nextPurchase ? `Sebelum ${formatYmdIndo(nextYmd)}` : 'Hari Ini'}
                  </strong>
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isSyncingServer && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Memeriksa riwayat BBM...
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                  {matchedActivities.length} Aktivitas Ditemukan
                </span>
              </div>
            </div>
          </div>

          {/* Body: Activity List */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
            {!targetPlat ? (
              <div className="text-center py-10 text-slate-400 space-y-2">
                <Car className="w-10 h-10 mx-auto text-slate-300" />
                <p className="text-xs font-bold text-slate-600">
                  Plat Nomor Kendaraan belum tercantum pada item BBM ini.
                </p>
                <p className="text-[11px] text-slate-400">
                  Pemohon perlu melengkapi Plat Nomor Kendaraan agar aktivitas operasional kendaraan dapat ditelusuri.
                </p>
              </div>
            ) : matchedActivities.length === 0 ? (
              <div className="text-center py-10 text-slate-400 space-y-2">
                <ClipboardList className="w-10 h-10 mx-auto text-slate-300" />
                <p className="text-xs font-bold text-slate-600">
                  Tidak ada aktivitas dengan plat nomor <span className="font-mono text-slate-800">{targetPlat}</span> pada periode ini.
                </p>
                <p className="text-[11px] text-slate-400 max-w-md mx-auto">
                  Rentang pemeriksaan: mulai {formatYmdIndo(startYmd)}{' '}
                  {nextPurchase
                    ? `sampai sebelum pembelian berikutnya (${formatYmdIndo(nextYmd)})`
                    : 'sampai hari ini'}
                  {totalPurchasesForPlate > 1 ? ` • Total ${totalPurchasesForPlate} catatan pengisian BBM untuk plat ini.` : '.'}
                </p>
              </div>
            ) : (
              matchedActivities.map((act, idx) => {
                const driverProfile = profileMap.get((act.userEmail || '').toLowerCase().trim());
                const driverName = driverProfile?.nama || act.userEmail || '-';
                const dist = getDistanceInMeters(act.coordinatesDb, act.coordinatesActual);
                const isDistWarning = dist !== null && dist > 500;
                const gmapsUrl =
                  act.coordinatesDb && act.coordinatesActual
                    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
                        act.coordinatesDb.trim()
                      )}&destination=${encodeURIComponent(act.coordinatesActual.trim())}`
                    : act.coordinatesActual
                    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        act.coordinatesActual.trim()
                      )}`
                    : act.coordinatesDb
                    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        act.coordinatesDb.trim()
                      )}`
                    : '';

                return (
                  <div
                    key={act.id || `${act.tanggal}_${idx}`}
                    className="border border-slate-200/90 rounded-2xl p-4 bg-slate-50/50 space-y-3 shadow-xs hover:border-amber-200 transition-colors"
                  >
                    {/* Top Row: Index + Date/Time + Photo Button */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-slate-800 text-white text-[9px] font-bold">
                            #{idx + 1}
                          </span>
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-lg">
                            <Calendar className="w-3 h-3 text-amber-600" />
                            {formatYmdIndo(act.tanggal || act.createdAt)}
                          </span>
                          {(act.createdAt || act.timestamp) && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              {formatTimestamp(act.createdAt || act.timestamp)}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                          <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                            SITE: {act.siteId || '-'}
                          </span>
                          {act.jenisKendaraan && (
                            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                              <Car className="w-3 h-3 text-slate-500" />
                              {act.jenisKendaraan}
                            </span>
                          )}
                          {act.platNomor && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-900 text-amber-300 font-mono text-[10px] font-bold tracking-wide">
                              {normalizePlat(act.platNomor)}
                            </span>
                          )}
                        </div>

                        <h4 className="text-xs font-bold text-slate-800 leading-snug pt-0.5">
                          {act.siteName || '-'}
                        </h4>

                        <p className="text-[11px] text-slate-500 flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-semibold text-slate-700">{driverName}</span>
                        </p>
                      </div>

                      {act.buktiUrl && (
                        <button
                          type="button"
                          onClick={() => handleOpenPhoto(act)}
                          className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer shrink-0 shadow-xs"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Lihat Foto</span>
                        </button>
                      )}
                    </div>

                    {/* Description */}
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                        KETERANGAN KEGIATAN
                      </span>
                      <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap bg-white p-2.5 rounded-xl border border-slate-100">
                        {act.keterangan || '-'}
                      </p>
                    </div>

                    {/* Coordinates */}
                    {(act.coordinatesActual || act.coordinatesDb) && (
                      <div className="space-y-1 text-[10px] text-slate-500 font-mono bg-indigo-50/40 p-2.5 rounded-xl border border-indigo-100/40">
                        {act.coordinatesActual && (
                          <div className="flex items-center gap-1.5">
                            <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            <span className="font-bold text-slate-700 font-sans">Aktual:</span>
                            <a
                              href={gmapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:underline font-bold truncate"
                            >
                              {act.coordinatesActual}
                            </a>
                          </div>
                        )}
                        {act.coordinatesDb && (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="font-bold text-slate-700 font-sans">
                              {act.siteId || 'SiteID'}:
                            </span>
                            <a
                              href={gmapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:underline font-bold truncate"
                            >
                              {act.coordinatesDb}
                            </a>
                          </div>
                        )}
                        {dist !== null && (
                          <div className="flex items-center gap-1.5 pt-1 border-t border-indigo-100/50 font-sans">
                            <span
                              className={`inline-block w-2 h-2 rounded-full ${
                                isDistWarning ? 'bg-rose-500' : 'bg-emerald-500'
                              }`}
                            />
                            <span className="font-bold text-slate-700">Jarak ke DB:</span>
                            <span
                              className={`font-bold ${
                                isDistWarning ? 'text-rose-600' : 'text-emerald-700'
                              }`}
                            >
                              {dist >= 1000
                                ? `${(dist / 1000).toFixed(2)} km`
                                : `${Math.round(dist)} m`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 border-t border-slate-100 bg-white shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>

      {/* Local Photo Preview Modal */}
      {localPhotoPreview && (
        <div
          className="fixed inset-0 bg-slate-950/90 z-[100020] flex flex-col items-center justify-center p-3 sm:p-6 animate-fade-in"
          onClick={() => setLocalPhotoPreview(null)}
        >
          <div
            className="w-full max-w-4xl bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 gap-2">
              <h4 className="text-xs sm:text-sm font-bold text-white truncate pr-2">
                {localPhotoPreview.title}
              </h4>
              <div className="flex items-center gap-2 shrink-0">
                {localPhotoPreview.url && !localPhotoPreview.url.startsWith('data:') && (
                  <a
                    href={localPhotoPreview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg transition-colors"
                  >
                    Buka Foto Asli
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setLocalPhotoPreview(null)}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-[300px] relative bg-black flex items-center justify-center overflow-hidden p-2">
              {(() => {
                const rawUrl = localPhotoPreview.url || '';
                const extractedId =
                  localPhotoPreview.fileId ||
                  rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
                  rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1] ||
                  '';
                const displaySrc = rawUrl.startsWith('data:')
                  ? rawUrl
                  : extractedId
                  ? `https://drive.google.com/thumbnail?sz=w1000&id=${extractedId}`
                  : rawUrl;
                if (!displaySrc) return null;
                return (
                  <ZoomableImage
                    src={displaySrc}
                    alt={localPhotoPreview.title}
                    darkTheme={true}
                    maxHeightClass="max-h-[70vh]"
                  />
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
};
