/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import {
  BudgetRequest,
  ItemStatus,
  RequestStatus,
  UsageReportItem,
  UserActivity,
  UserProfile,
  formatTimestamp
} from '../types';
import { useBackHandler } from '../hooks/useBackHandler';
import { ZoomableImage } from './ZoomableImage';
import {
  SPREADSHEET_ID,
  fetchAllBbmUsageItems,
  getAllCachedClosedUsageItems,
  getCachedAllBbmUsageItems,
  parseNumericValue
} from '../lib/googleApi';
import { sanitizePlatNomor } from '../lib/platNomorUtils';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Car,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Fuel,
  Image as ImageIcon,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  X
} from 'lucide-react';

interface AdminVehicleFuelAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  activities: UserActivity[];
  profiles: UserProfile[];
  spreadsheetId?: string | null;
  onPreviewDocument?: (doc: { url: string; fileId?: string; title: string }) => void;
}

interface ParsedActivityEntry {
  activity: UserActivity;
  ymd: string;
  ms: number;
}

interface ActivityStep {
  activity: UserActivity;
  userName: string;
  ymd: string;
}

interface ExpandedActivityDisplay {
  step: ActivityStep;
  timeStr: string;
  mapsUrl: string;
  distanceToSiteMeters: number | null;
}

interface FuelRefillCycle {
  cycleIndex: number; // 1-based chronological index for the vehicle
  item: UsageReportItem;
  request?: BudgetRequest;
  requesterName: string;
  requesterEmail: string;
  requesterDivisi: string;
  startYmd: string;
  nextPurchase: UsageReportItem | null;
  nextYmd: string;
  intervalDays: number | null;
  isLatestCycle: boolean;
  nominal: number;
  approvalStatusText: string;
  approvalTone: 'approved' | 'rejected' | 'pending';
  activities: ActivityStep[];
  uniqueSiteCount: number;
  fakeGpsCount: number;
  searchBlob: string;
}

interface BaseVehicleFuelRecord {
  platNomor: string;
  isMissingPlat: boolean;
  inferredVehicleTypes: string[];
  allCycles: FuelRefillCycle[];
}

interface VehicleFuelSummary {
  platNomor: string;
  platLower: string;
  isMissingPlat: boolean;
  vehicleTypes: string[];
  drivers: string[];
  allCycles: FuelRefillCycle[];
  filteredCycles: FuelRefillCycle[];
  totalRefills: number;
  totalNominal: number;
  avgNominal: number;
  avgIntervalDays: number | null;
  totalActivities: number;
  avgActivitiesPerRefill: number;
  emptyActivityCycleCount: number;
  fakeGpsActivityCount: number;
  latestRefillYmd: string;
  earliestRefillYmd: string;
  headerSearchBlob: string;
}

type FuelAnalysisTab = 'NON_BACKUP' | 'BACKUP';
type DatePreset = 'ALL' | '30D' | '90D' | 'MONTH' | 'CUSTOM';
type SortKey = 'NOMINAL_DESC' | 'REFILLS_DESC' | 'LATEST_DESC' | 'PLAT_ASC';
type ConditionFilter = 'ALL' | 'ZERO_ACTIVITY_CYCLES';

const NO_PLAT_KEY = '__TANPA_PLAT__';

// Hoisted singleton formatters & lightweight memo caches to avoid per-render Intl instantiation
const IDR_FORMATTER = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});

const shortDateCache = new Map<string, string>();

function isBbmDurenSawitRecord(item: UsageReportItem, req?: BudgetRequest): boolean {
  const reqId = String(item.requestId || '').trim().toUpperCase();
  if (
    reqId.startsWith('BBMDS') ||
    reqId.startsWith('BBM_DURENSAWIT') ||
    reqId.startsWith('TFDS')
  ) {
    return true;
  }
  if (req) {
    const rId = String(req.id || '').trim().toUpperCase();
    const siteId = String(req.siteId || '').trim().toUpperCase();
    const siteName = String((req as any).siteName || '').trim().toUpperCase();
    const ket = String(req.keterangan || '').trim().toUpperCase();
    if (
      rId.startsWith('BBMDS') ||
      rId.startsWith('BBM_DURENSAWIT') ||
      rId.startsWith('TFDS') ||
      siteId === 'OPT-DUREN SAWIT' ||
      siteId === 'BBM DUREN SAWIT' ||
      siteName.includes('DUREN SAWIT') ||
      ket.includes('DUREN SAWIT')
    ) {
      return true;
    }
  }
  return false;
}

function extractYmd(value?: string): string {
  const str = String(value || '').trim();
  if (!str) return '';

  // Fast path for standard ISO YYYY-MM-DD prefix
  if (
    str.length >= 10 &&
    str.charCodeAt(4) === 45 &&
    str.charCodeAt(7) === 45 &&
    str.charCodeAt(0) >= 48 &&
    str.charCodeAt(0) <= 57
  ) {
    return str.substring(0, 10);
  }

  const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }

  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  const parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    const dt = new Date(parsed);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
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
    const dt = new Date(
      parseInt(dmyMatch[3], 10),
      parseInt(dmyMatch[2], 10) - 1,
      parseInt(dmyMatch[1], 10),
      dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0,
      dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0,
      dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0
    );
    if (!isNaN(dt.getTime())) return dt.getTime();
  }

  const ymdMatch = str.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/
  );
  if (ymdMatch) {
    const dt = new Date(
      parseInt(ymdMatch[1], 10),
      parseInt(ymdMatch[2], 10) - 1,
      parseInt(ymdMatch[3], 10),
      ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0,
      ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0,
      ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0
    );
    if (!isNaN(dt.getTime())) return dt.getTime();
  }

  const parsed = Date.parse(str);
  return isNaN(parsed) ? NaN : parsed;
}

function diffDaysYmd(startYmd: string, endYmd: string): number | null {
  if (!startYmd || !endYmd) return null;
  const [y1, m1, d1] = startYmd.split('-').map(Number);
  const [y2, m2, d2] = endYmd.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return null;
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.max(0, Math.round((utc2 - utc1) / 86400000));
}

function formatYmdShort(ymd?: string): string {
  const clean = extractYmd(ymd);
  if (!clean) return '-';
  const cached = shortDateCache.get(clean);
  if (cached) return cached;
  const [y, m, d] = clean.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (isNaN(dt.getTime())) return clean;
  const formatted = SHORT_DATE_FORMATTER.format(dt);
  if (shortDateCache.size > 1500) {
    shortDateCache.clear();
  }
  shortDateCache.set(clean, formatted);
  return formatted;
}

function formatIDR(amount: number): string {
  return IDR_FORMATTER.format(amount || 0);
}

function getTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDaysYmd(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonthStartYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function parseCoords(coordStr?: string): { lat: number; lng: number } | null {
  if (!coordStr) return null;
  const clean = coordStr.replace(/[()\[\]]/g, '').trim();
  const parts = clean.split(/[\s,]+/);
  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function getDistanceMeters(coordStr1?: string, coordStr2?: string): number | null {
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

function getImageSrc(url?: string, fileId?: string): string {
  const rawUrl = String(url || '').trim();
  const rawFileId = String(fileId || '').trim();
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return rawUrl;
  if (rawFileId) {
    return `https://drive.google.com/thumbnail?id=${rawFileId}&sz=w1600`;
  }
  if (!rawUrl) return '';
  const match = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1600`;
  }
  return rawUrl;
}

function getApprovalMeta(item: UsageReportItem): { text: string; tone: 'approved' | 'rejected' | 'pending' } {
  if (item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED) {
    return { text: 'Disetujui penuh', tone: 'approved' };
  }
  if (item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED) {
    return { text: 'Perlu revisi', tone: 'rejected' };
  }
  if (item.statusManager === ItemStatus.APPROVED) {
    return { text: 'Menunggu Finance', tone: 'pending' };
  }
  return { text: 'Menunggu review', tone: 'pending' };
}

function extractTimeStr(value?: string): string {
  const formatted = formatTimestamp(value);
  if (!formatted) return '-';
  const parts = formatted.split(' ');
  return parts.length >= 2 ? parts[1].substring(0, 5) : '-';
}

function summarizeByDateRange(
  baseList: BaseVehicleFuelRecord[],
  dateFrom: string,
  dateTo: string
): VehicleFuelSummary[] {
  const summaries: VehicleFuelSummary[] = [];
  const hasDateFilter = Boolean(dateFrom || dateTo);

  for (let i = 0; i < baseList.length; i++) {
    const base = baseList[i];
    const filteredCycles = hasDateFilter
      ? base.allCycles.filter((c) => {
          if (dateFrom && c.startYmd && c.startYmd < dateFrom) return false;
          if (dateTo && c.startYmd && c.startYmd > dateTo) return false;
          return true;
        })
      : base.allCycles;

    if (filteredCycles.length === 0) continue;

    const driverSet = new Set<string>();
    const vehicleTypeSet = new Set<string>();
    let totalNominal = 0;
    let totalActivities = 0;
    let emptyActivityCycleCount = 0;
    let fakeGpsActivityCount = 0;
    let closedIntervalSum = 0;
    let closedIntervalCount = 0;

    for (let j = 0; j < filteredCycles.length; j++) {
      const c = filteredCycles[j];
      totalNominal += c.nominal;
      const actCount = c.activities.length;
      totalActivities += actCount;
      fakeGpsActivityCount += c.fakeGpsCount;
      if (actCount === 0) emptyActivityCycleCount++;
      if (c.requesterName && c.requesterName !== 'Tidak diketahui') {
        driverSet.add(c.requesterName);
      }
      if (!c.isLatestCycle && c.intervalDays !== null) {
        closedIntervalSum += c.intervalDays;
        closedIntervalCount++;
      }
      for (let k = 0; k < actCount; k++) {
        const step = c.activities[k];
        if (step.userName && step.userName !== '-') driverSet.add(step.userName);
        if (step.activity.jenisKendaraan) vehicleTypeSet.add(step.activity.jenisKendaraan.trim());
      }
    }

    if (vehicleTypeSet.size === 0 && base.inferredVehicleTypes.length > 0) {
      for (let t = 0; t < base.inferredVehicleTypes.length; t++) {
        vehicleTypeSet.add(base.inferredVehicleTypes[t]);
      }
    }

    const vehicleTypes = Array.from(vehicleTypeSet);
    const drivers = Array.from(driverSet);
    const avgIntervalDays = closedIntervalCount > 0 ? closedIntervalSum / closedIntervalCount : null;
    const platLower = base.platNomor.toLowerCase();
    const headerSearchBlob = `${platLower}\n${drivers.join(' ').toLowerCase()}\n${vehicleTypes.join(' ').toLowerCase()}`;

    summaries.push({
      platNomor: base.platNomor,
      platLower,
      isMissingPlat: base.isMissingPlat,
      vehicleTypes,
      drivers,
      allCycles: base.allCycles,
      filteredCycles,
      totalRefills: filteredCycles.length,
      totalNominal,
      avgNominal: filteredCycles.length > 0 ? totalNominal / filteredCycles.length : 0,
      avgIntervalDays,
      totalActivities,
      avgActivitiesPerRefill: filteredCycles.length > 0 ? totalActivities / filteredCycles.length : 0,
      emptyActivityCycleCount,
      fakeGpsActivityCount,
      latestRefillYmd: filteredCycles[filteredCycles.length - 1]?.startYmd || '',
      earliestRefillYmd: filteredCycles[0]?.startYmd || '',
      headerSearchBlob
    });
  }

  return summaries;
}

interface VehicleListItemProps {
  vehicle: VehicleFuelSummary;
  isSelected: boolean;
  onSelect: (plat: string) => void;
}

const VehicleListItem = React.memo<VehicleListItemProps>(({ vehicle: v, isSelected, onSelect }) => {
  return (
    <button
      type="button"
      onClick={() => onSelect(v.platNomor)}
      className={`w-full text-left px-4 py-3 transition-colors cursor-pointer flex items-start justify-between gap-3 [content-visibility:auto] [contain-intrinsic-size:auto_76px] ${
        isSelected ? 'bg-white ring-1 ring-inset ring-slate-900/10' : 'hover:bg-white/80'
      }`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-sm font-bold tracking-wide ${
              v.isMissingPlat
                ? 'text-slate-500 italic'
                : isSelected
                  ? 'text-indigo-700'
                  : 'text-slate-900'
            }`}
          >
            {v.platNomor}
          </span>
          {v.vehicleTypes.length > 0 && (
            <span className="text-xs text-slate-500 truncate">· {v.vehicleTypes[0]}</span>
          )}
        </div>

        <div className="text-xs text-slate-500 font-mono tabular-nums flex items-center gap-1.5 flex-wrap">
          <span>{v.totalRefills}x isi</span>
          <span aria-hidden="true">·</span>
          <span>{v.totalActivities} aktivitas</span>
          {v.avgIntervalDays !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span>~{v.avgIntervalDays.toFixed(1)} hr/isi</span>
            </>
          )}
        </div>

        <div className="text-[11px] text-slate-500 truncate">
          Terakhir isi {formatYmdShort(v.latestRefillYmd)}
          {v.drivers.length > 0 &&
            ` · ${v.drivers.slice(0, 2).join(', ')}${v.drivers.length > 2 ? ` +${v.drivers.length - 2}` : ''}`}
        </div>

        {v.emptyActivityCycleCount > 0 && (
          <p className="text-[11px] font-medium text-amber-700">
            {v.emptyActivityCycleCount} siklus tanpa aktivitas lapangan
          </p>
        )}
      </div>

      <div className="text-right shrink-0 flex flex-col items-end gap-1">
        <span className="text-xs font-bold font-mono tabular-nums text-slate-900">
          {formatIDR(v.totalNominal)}
        </span>
        <ChevronRight
          className={`w-4 h-4 transition-transform ${
            isSelected ? 'text-indigo-600 translate-x-0.5' : 'text-slate-300'
          }`}
        />
      </div>
    </button>
  );
});

VehicleListItem.displayName = 'VehicleListItem';

interface CycleCardProps {
  cycle: FuelRefillCycle;
  platNomor: string;
  isMissingPlat: boolean;
  activeTab: FuelAnalysisTab;
  isExpanded: boolean;
  onToggle: (itemId: string) => void;
  onOpenPhoto: (rawUrl: string, rawFileId: string | undefined, title: string) => void;
}

const CycleCard = React.memo<CycleCardProps>(
  ({ cycle, platNomor, isMissingPlat, activeTab, isExpanded, onToggle, onOpenPhoto }) => {
    const hasNotaPhoto = Boolean(cycle.item.buktiUrl || cycle.item.buktiFileId);
    const approvalColor =
      cycle.approvalTone === 'approved'
        ? 'text-emerald-700'
        : cycle.approvalTone === 'rejected'
          ? 'text-rose-700'
          : 'text-amber-700';

    // Lazily compute per-row timestamp, Maps URL, and Haversine site deviation ONLY when this cycle is expanded
    const expandedRows = useMemo<ExpandedActivityDisplay[]>(() => {
      if (!isExpanded || cycle.activities.length === 0) return [];
      return cycle.activities.map((step) => {
        const act = step.activity;
        let mapsUrl = '';
        if (act.coordinatesActual) {
          const parsedCoord = parseCoords(act.coordinatesActual);
          const mapsQuery = parsedCoord
            ? `${parsedCoord.lat},${parsedCoord.lng}`
            : act.coordinatesActual.trim();
          mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(mapsQuery)}`;
        }
        const distanceToSiteMeters =
          act.coordinatesDb && act.coordinatesActual
            ? getDistanceMeters(act.coordinatesDb, act.coordinatesActual)
            : null;

        return {
          step,
          timeStr: extractTimeStr(act.createdAt || act.timestamp),
          mapsUrl,
          distanceToSiteMeters
        };
      });
    }, [isExpanded, cycle.activities]);

    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden [content-visibility:auto] [contain-intrinsic-size:auto_124px]">
        {/* Cycle Header (Clickable Accordion Row) */}
        <div className="p-4 flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => onToggle(cycle.item.id)}
            className="flex items-start gap-2.5 text-left flex-1 min-w-0 cursor-pointer group"
          >
            <span className="mt-0.5 text-slate-400 group-hover:text-slate-700 transition-colors shrink-0">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-mono font-bold text-slate-500">
                  Siklus #{cycle.cycleIndex}
                </span>
                <span className="text-sm font-bold text-slate-900 font-mono tabular-nums">
                  {formatYmdShort(cycle.startYmd)}
                </span>
                <span className="text-slate-300" aria-hidden="true">
                  →
                </span>
                <span className="text-xs text-slate-600 font-mono tabular-nums">
                  {cycle.nextYmd ? `sebelum ${formatYmdShort(cycle.nextYmd)}` : 'hingga saat ini'}
                </span>
                {cycle.intervalDays !== null && (
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    ({cycle.intervalDays} hari{cycle.isLatestCycle ? ' berjalan' : ''})
                  </span>
                )}
              </div>

              <div className="text-xs text-slate-600 flex items-center gap-1.5 flex-wrap">
                <span className="font-mono font-semibold text-slate-700">{cycle.item.requestId}</span>
                <span aria-hidden="true">·</span>
                <span>{cycle.requesterName}</span>
                {cycle.requesterDivisi && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-500">{cycle.requesterDivisi}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className={`font-medium ${approvalColor}`}>{cycle.approvalStatusText}</span>
              </div>

              {cycle.item.keterangan && (
                <p className="text-xs text-slate-600 line-clamp-2">{cycle.item.keterangan}</p>
              )}

              <div className="text-xs pt-0.5 flex items-center gap-2 flex-wrap font-mono tabular-nums">
                <span
                  className={
                    cycle.activities.length === 0
                      ? 'text-amber-700 font-semibold'
                      : 'text-slate-700 font-semibold'
                  }
                >
                  {cycle.activities.length} aktivitas setelah pengisian
                </span>
                {cycle.uniqueSiteCount > 0 && (
                  <>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-500">{cycle.uniqueSiteCount} site unik</span>
                  </>
                )}
                {cycle.fakeGpsCount > 0 && (
                  <>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-rose-600 font-semibold">
                      {cycle.fakeGpsCount} indikasi GPS anomali
                    </span>
                  </>
                )}
              </div>
            </div>
          </button>

          <div className="text-right shrink-0 flex flex-col items-end gap-2">
            <span className="text-sm sm:text-base font-display font-bold font-mono tabular-nums text-amber-700">
              {formatIDR(cycle.nominal)}
            </span>
            {hasNotaPhoto && (
              <button
                type="button"
                onClick={() =>
                  onOpenPhoto(
                    cycle.item.buktiUrl,
                    cycle.item.buktiFileId,
                    `Nota BBM ${platNomor} — ${formatYmdShort(cycle.startYmd)} (${cycle.item.requestId})`
                  )
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <ImageIcon className="w-3.5 h-3.5 text-amber-600" />
                <span>Nota BBM</span>
              </button>
            )}
          </div>
        </div>

        {/* Expanded Activities Table / Trace */}
        {isExpanded && (
          <div className="border-t border-slate-200 bg-slate-50/60">
            {cycle.activities.length === 0 ? (
              <div className="px-4 py-4 flex items-start gap-2.5 text-xs text-amber-800 bg-amber-50/50">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Tidak ada aktivitas lapangan tercatat pada rentang siklus ini.
                  </p>
                  <p className="text-amber-700/90 mt-0.5">
                    {isMissingPlat
                      ? 'Item laporan BBM ini belum memiliki plat nomor kendaraan sehingga tidak dapat dicocokkan dengan log aktivitas.'
                      : activeTab === 'BACKUP'
                        ? cycle.nextYmd
                          ? `Tidak ditemukan Activity Log Backup (IsBackup = TRUE) berplat ${platNomor} sejak ${formatYmdShort(cycle.startYmd)} hingga sebelum pengisian berikutnya pada ${formatYmdShort(cycle.nextYmd)}.`
                          : `Belum ada Activity Log Backup (IsBackup = TRUE) berplat ${platNomor} tercatat sejak pengisian pada ${formatYmdShort(cycle.startYmd)}.`
                        : cycle.nextYmd
                          ? `Tidak ditemukan Activity Log berplat ${platNomor} sejak ${formatYmdShort(cycle.startYmd)} hingga sebelum pengisian berikutnya pada ${formatYmdShort(cycle.nextYmd)}.`
                          : `Belum ada Activity Log berplat ${platNomor} tercatat sejak pengisian pada ${formatYmdShort(cycle.startYmd)}.`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-100/70">
                      <th className="py-2 pl-4 pr-3 font-semibold whitespace-nowrap">Waktu</th>
                      <th className="py-2 px-3 font-semibold whitespace-nowrap">Site / Lokasi</th>
                      <th className="py-2 px-3 font-semibold">Petugas &amp; Keterangan</th>
                      <th className="py-2 pl-3 pr-4 font-semibold text-right whitespace-nowrap">Bukti</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 bg-white">
                    {expandedRows.map(({ step, timeStr, mapsUrl, distanceToSiteMeters }, idx) => (
                      <tr
                        key={step.activity.id}
                        className="hover:bg-slate-50/90 transition-colors align-top"
                      >
                        <td className="py-2.5 pl-4 pr-3 whitespace-nowrap font-mono tabular-nums text-slate-700">
                          <div className="font-semibold text-slate-900">{formatYmdShort(step.ymd)}</div>
                          <div className="text-[11px] text-slate-500">
                            #{idx + 1} · {timeStr}
                          </div>
                        </td>

                        <td className="py-2.5 px-3 min-w-[140px]">
                          <div className="font-semibold text-slate-900">
                            {step.activity.siteId || '-'}
                          </div>
                          {step.activity.siteName && (
                            <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                              {step.activity.siteName}
                            </div>
                          )}
                          {step.activity.indikasiFake && (
                            <div className="text-[11px] font-semibold text-rose-600 mt-0.5">
                              Indikasi GPS anomali
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 px-3 min-w-[180px]">
                          <div className="leading-snug">
                            <span className="font-medium text-slate-800">{step.userName}</span>
                            <span className="text-slate-400"> - </span>
                            <span className="text-slate-600">{step.activity.keterangan || '-'}</span>
                          </div>
                          {step.activity.coordinatesActual && (
                            <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1 flex items-center gap-1 flex-wrap">
                              <a
                                href={mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Buka titik lokasi di Google Maps"
                                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline transition-colors cursor-pointer"
                              >
                                <MapPin className="w-3 h-3 shrink-0" />
                                <span>{step.activity.coordinatesActual}</span>
                              </a>
                              {distanceToSiteMeters !== null && (
                                <span>
                                  · deviasi{' '}
                                  {distanceToSiteMeters >= 1000
                                    ? `${(distanceToSiteMeters / 1000).toFixed(1)} km`
                                    : `${Math.round(distanceToSiteMeters)} m`}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">
                          {step.activity.buktiUrl || step.activity.buktiFileId ? (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenPhoto(
                                  step.activity.buktiUrl,
                                  step.activity.buktiFileId,
                                  `Aktivitas ${platNomor} — ${step.activity.siteId} (${formatYmdShort(step.ymd)})`
                                )
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 rounded-md transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Foto</span>
                            </button>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

CycleCard.displayName = 'CycleCard';

const AdminVehicleFuelAnalysisModalInner: React.FC<AdminVehicleFuelAnalysisModalProps> = ({
  isOpen,
  onClose,
  requests,
  usageItems,
  activities,
  profiles,
  spreadsheetId,
  onPreviewDocument
}) => {
  const effectiveSpreadsheetId = spreadsheetId || SPREADSHEET_ID;

  // Hydrate immediately from 5-minute client memory cache on reopen (0ms flicker/network)
  const [serverBbmItems, setServerBbmItems] = useState<UsageReportItem[]>(
    () => getCachedAllBbmUsageItems(effectiveSpreadsheetId) || []
  );
  const [isSyncingServer, setIsSyncingServer] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Filters & view state
  const [activeTab, setActiveTab] = useState<FuelAnalysisTab>('NON_BACKUP');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('NOMINAL_DESC');
  const [selectedPlat, setSelectedPlat] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'LIST' | 'DETAIL'>('LIST');
  const [cycleOrder, setCycleOrder] = useState<'DESC' | 'ASC'>('DESC');
  const [expandedCycleIds, setExpandedCycleIds] = useState<Record<string, boolean>>({});
  const [localPhotoPreview, setLocalPhotoPreview] = useState<{
    url: string;
    fileId?: string;
    title: string;
  } | null>(null);
  const [previewImgFailed, setPreviewImgFailed] = useState(false);
  const [, startTransition] = useTransition();

  useBackHandler(!!localPhotoPreview, () => setLocalPhotoPreview(null), 'adminFuelAnalysis_photo');
  useBackHandler(
    isOpen && !localPhotoPreview && mobilePane === 'DETAIL',
    () => setMobilePane('LIST'),
    'adminFuelAnalysis_mobileDetail'
  );
  useBackHandler(
    isOpen && !localPhotoPreview && mobilePane === 'LIST',
    onClose,
    'adminFuelAnalysis_modal'
  );

  const loadServerBbmItems = useCallback(
    async (forceRefresh = false) => {
      if (!forceRefresh) {
        const cached = getCachedAllBbmUsageItems(effectiveSpreadsheetId);
        if (cached) {
          setServerBbmItems(cached);
          return;
        }
      }
      setIsSyncingServer(true);
      setSyncError(null);
      try {
        const rows = await fetchAllBbmUsageItems(effectiveSpreadsheetId, forceRefresh);
        setServerBbmItems(rows);
      } catch (err: any) {
        setSyncError(err?.message || 'Gagal menyinkronkan data historis BBM dari server.');
      } finally {
        setIsSyncingServer(false);
      }
    },
    [effectiveSpreadsheetId]
  );

  useEffect(() => {
    if (!isOpen) return;
    void loadServerBbmItems(false);
  }, [isOpen, loadServerBbmItems]);

  const applyDatePreset = useCallback((preset: DatePreset) => {
    setDatePreset(preset);
    const today = getTodayYmd();
    startTransition(() => {
      if (preset === 'ALL') {
        setDateFrom('');
        setDateTo('');
      } else if (preset === '30D') {
        setDateFrom(shiftDaysYmd(30));
        setDateTo(today);
      } else if (preset === '90D') {
        setDateFrom(shiftDaysYmd(90));
        setDateTo(today);
      } else if (preset === 'MONTH') {
        setDateFrom(getMonthStartYmd());
        setDateTo(today);
      }
    });
  }, []);

  const requestMap = useMemo(() => {
    const map = new Map<string, BudgetRequest>();
    for (let i = 0; i < (requests?.length || 0); i++) {
      const r = requests[i];
      if (r.id) map.set(r.id.toUpperCase().trim(), r);
    }
    return map;
  }, [requests]);

  const profileMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (let i = 0; i < (profiles?.length || 0); i++) {
      const p = profiles[i];
      if (p.email) map.set(p.email.toLowerCase().trim(), p);
    }
    return map;
  }, [profiles]);

  // Pre-parse activity ymd & ms ONCE per activity to eliminate redundant regex/date parsing during sort & matching
  const { activitiesByPlatNonBackup, activitiesByPlatBackup } = useMemo(() => {
    const nonBackupMap = new Map<string, ParsedActivityEntry[]>();
    const backupMap = new Map<string, ParsedActivityEntry[]>();

    for (let i = 0; i < (activities?.length || 0); i++) {
      const act = activities[i];
      const jenisLower = String(act.jenisKendaraan || '').trim().toLowerCase();
      if (jenisLower === 'gabung kendaraan' || jenisLower.includes('gabung kendaraan')) {
        continue;
      }
      const plat = sanitizePlatNomor(act.platNomor || '');
      if (!plat) continue;

      const ymd = extractYmd(act.tanggal) || extractYmd(act.createdAt || act.timestamp);
      const ms = parseFlexibleMs(act.createdAt || act.timestamp);
      const entry: ParsedActivityEntry = { activity: act, ymd, ms };

      let listAll = nonBackupMap.get(plat);
      if (!listAll) {
        listAll = [];
        nonBackupMap.set(plat, listAll);
      }
      listAll.push(entry);

      if (act.isBackup === true) {
        let listBackup = backupMap.get(plat);
        if (!listBackup) {
          listBackup = [];
          backupMap.set(plat, listBackup);
        }
        listBackup.push(entry);
      }
    }

    const comparator = (a: ParsedActivityEntry, b: ParsedActivityEntry) => {
      if (a.ymd !== b.ymd) return a.ymd < b.ymd ? -1 : 1;
      if (!isNaN(a.ms) && !isNaN(b.ms) && a.ms !== b.ms) return a.ms - b.ms;
      return String(a.activity.id || '').localeCompare(String(b.activity.id || ''));
    };

    for (const list of nonBackupMap.values()) {
      if (list.length > 1) list.sort(comparator);
    }
    for (const list of backupMap.values()) {
      if (list.length > 1) list.sort(comparator);
    }

    return {
      activitiesByPlatNonBackup: nonBackupMap,
      activitiesByPlatBackup: backupMap
    };
  }, [activities]);

  // Layer 1: Build full chronological refill cycles per vehicle ONCE when raw data changes
  // Uses O(R + M) monotonic cursor scan instead of O(R * M) nested filtering
  const baseVehiclesByTab = useMemo(() => {
    const todayYmd = getTodayYmd();
    const cancelledReqIds = new Set<string>();
    for (let i = 0; i < (requests?.length || 0); i++) {
      const r = requests[i];
      if (r.status === RequestStatus.CANCELLED && r.id) {
        cancelledReqIds.add(r.id.toUpperCase().trim());
      }
    }

    // Merge all sources (cached closed + server historical + active state) deduplicated by item.id
    const combinedById = new Map<string, UsageReportItem>();
    const pushItem = (candidate: UsageReportItem) => {
      if (!candidate || !candidate.id || candidate.id.startsWith('summary_')) return;
      if (!candidate.isBBM) return;
      const reqKey = String(candidate.requestId || '').toUpperCase().trim();
      if (reqKey && cancelledReqIds.has(reqKey)) return;
      const linkedReq = reqKey ? requestMap.get(reqKey) : undefined;
      if (isBbmDurenSawitRecord(candidate, linkedReq)) return;
      combinedById.set(candidate.id, candidate);
    };

    const cachedClosed = getAllCachedClosedUsageItems();
    for (let i = 0; i < cachedClosed.length; i++) pushItem(cachedClosed[i]);
    for (let i = 0; i < (serverBbmItems?.length || 0); i++) pushItem(serverBbmItems[i]);
    for (let i = 0; i < (usageItems?.length || 0); i++) pushItem(usageItems[i]);

    const nonBackupItems: UsageReportItem[] = [];
    const backupItems: UsageReportItem[] = [];
    for (const item of combinedById.values()) {
      if (item.isGenset === true) {
        backupItems.push(item);
      } else {
        nonBackupItems.push(item);
      }
    }

    const buildBaseRecords = (
      sourceItems: UsageReportItem[],
      activityMap: Map<string, ParsedActivityEntry[]>
    ): BaseVehicleFuelRecord[] => {
      const byPlat = new Map<
        string,
        Array<{ item: UsageReportItem; ymd: string; sortYmd: string; ms: number }>
      >();

      for (let i = 0; i < sourceItems.length; i++) {
        const item = sourceItems[i];
        const cleanPlat = sanitizePlatNomor(item.platNomorKendaraan || '');
        const key = cleanPlat || NO_PLAT_KEY;
        const ymd = extractYmd(item.tanggalPenggunaan) || extractYmd(item.timestamp || item.updatedAt);
        const ms = parseFlexibleMs(item.timestamp || item.updatedAt);

        let arr = byPlat.get(key);
        if (!arr) {
          arr = [];
          byPlat.set(key, arr);
        }
        arr.push({ item, ymd, sortYmd: ymd || '9999-99-99', ms });
      }

      const records: BaseVehicleFuelRecord[] = [];

      for (const [platKey, entries] of byPlat.entries()) {
        const isMissingPlat = platKey === NO_PLAT_KEY;
        if (entries.length > 1) {
          entries.sort((a, b) => {
            if (a.sortYmd !== b.sortYmd) return a.sortYmd < b.sortYmd ? -1 : 1;
            if (!isNaN(a.ms) && !isNaN(b.ms) && a.ms !== b.ms) return a.ms - b.ms;
            return String(a.item.id || '').localeCompare(String(b.item.id || ''));
          });
        }

        const platActivities = isMissingPlat ? [] : activityMap.get(platKey) || [];
        const actLen = platActivities.length;
        const allCycles: FuelRefillCycle[] = [];

        // Monotonic cursor: skips all activities with ymd < curStartYmd in O(1) amortized time
        let dayCursor = 0;

        for (let i = 0; i < entries.length; i++) {
          const cur = entries[i];
          const prev = i > 0 ? entries[i - 1] : null;
          const next = i + 1 < entries.length ? entries[i + 1] : null;

          const curStartYmd = cur.ymd;
          const prevStartYmd = prev ? prev.ymd : '';
          const nextStartYmd = next ? next.ymd : '';

          const curMs = cur.ms;
          const nextMs = next ? next.ms : NaN;
          const sameDayWithPrev = Boolean(prevStartYmd && curStartYmd && prevStartYmd === curStartYmd);
          const sameDayWithNext = Boolean(nextStartYmd && curStartYmd && nextStartYmd === curStartYmd);

          const activitySteps: ActivityStep[] = [];
          let fakeGpsCount = 0;
          const uniqueSites = new Set<string>();
          const searchParts: string[] = [];

          if (curStartYmd && actLen > 0) {
            while (dayCursor < actLen && (!platActivities[dayCursor].ymd || platActivities[dayCursor].ymd < curStartYmd)) {
              dayCursor++;
            }

            for (let k = dayCursor; k < actLen; k++) {
              const pAct = platActivities[k];
              const actYmd = pAct.ymd;
              if (!actYmd) continue;

              // End boundary check (early exit since platActivities is sorted by ymd ASC)
              if (nextStartYmd) {
                if (sameDayWithNext) {
                  if (actYmd > nextStartYmd) break;
                  if (!isNaN(nextMs) && !isNaN(pAct.ms) && pAct.ms >= nextMs) {
                    continue;
                  }
                } else {
                  if (actYmd >= nextStartYmd) break;
                }
              }

              // Same-day start timestamp boundary when multiple refills happen on the same date
              if (actYmd === curStartYmd && sameDayWithPrev && !isNaN(curMs)) {
                if (!isNaN(pAct.ms) && pAct.ms < curMs) continue;
              }

              const act = pAct.activity;
              const emailKey = String(act.userEmail || '').toLowerCase().trim();
              const prof = profileMap.get(emailKey);
              const userName = prof?.nama || act.userEmail || '-';

              if (act.siteId) uniqueSites.add(act.siteId.trim().toUpperCase());
              if (act.indikasiFake) fakeGpsCount++;

              if (act.siteId) searchParts.push(act.siteId);
              if (act.siteName) searchParts.push(act.siteName);
              if (act.keterangan) searchParts.push(act.keterangan);

              activitySteps.push({
                activity: act,
                userName,
                ymd: actYmd
              });
            }
          }

          const linkedReq = requestMap.get(String(cur.item.requestId || '').toUpperCase().trim());
          const reqEmail = linkedReq?.userEmail || '';
          const reqProf = reqEmail ? profileMap.get(reqEmail.toLowerCase().trim()) : undefined;
          const requesterName = reqProf?.nama || reqEmail || 'Tidak diketahui';
          const approval = getApprovalMeta(cur.item);

          const intervalDays = nextStartYmd
            ? diffDaysYmd(curStartYmd, nextStartYmd)
            : diffDaysYmd(curStartYmd, todayYmd);

          const searchBlob = [
            cur.item.requestId,
            cur.item.keterangan,
            reqEmail,
            requesterName,
            ...searchParts
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          allCycles.push({
            cycleIndex: i + 1,
            item: cur.item,
            request: linkedReq,
            requesterName,
            requesterEmail: reqEmail,
            requesterDivisi: reqProf?.divisi || '',
            startYmd: curStartYmd,
            nextPurchase: next ? next.item : null,
            nextYmd: nextStartYmd,
            intervalDays,
            isLatestCycle: !next,
            nominal: parseNumericValue(cur.item.nominal),
            approvalStatusText: approval.text,
            approvalTone: approval.tone,
            activities: activitySteps,
            uniqueSiteCount: uniqueSites.size,
            fakeGpsCount,
            searchBlob
          });
        }

        const inferredTypesSet = new Set<string>();
        for (let k = 0; k < actLen; k++) {
          const j = platActivities[k].activity.jenisKendaraan;
          if (j) inferredTypesSet.add(j.trim());
        }

        records.push({
          platNomor: isMissingPlat ? 'TANPA PLAT' : platKey,
          isMissingPlat,
          inferredVehicleTypes: Array.from(inferredTypesSet),
          allCycles
        });
      }

      return records;
    };

    return {
      nonBackup: buildBaseRecords(nonBackupItems, activitiesByPlatNonBackup),
      backup: buildBaseRecords(backupItems, activitiesByPlatBackup)
    };
  }, [
    requests,
    usageItems,
    serverBbmItems,
    activitiesByPlatNonBackup,
    activitiesByPlatBackup,
    requestMap,
    profileMap
  ]);

  // Layer 2: Fast date-range slicing over pre-built cycles (microseconds on preset/date change)
  const { nonBackupVehicles, backupVehicles } = useMemo(() => {
    return {
      nonBackupVehicles: summarizeByDateRange(baseVehiclesByTab.nonBackup, dateFrom, dateTo),
      backupVehicles: summarizeByDateRange(baseVehiclesByTab.backup, dateFrom, dateTo)
    };
  }, [baseVehiclesByTab, dateFrom, dateTo]);

  const allVehicles = activeTab === 'NON_BACKUP' ? nonBackupVehicles : backupVehicles;
  const tabCounts = {
    nonBackup: nonBackupVehicles.length,
    backup: backupVehicles.length
  };

  const handleSwitchTab = useCallback((tab: FuelAnalysisTab) => {
    setActiveTab((prev) => {
      if (prev === tab) return prev;
      startTransition(() => {
        setSelectedPlat(null);
        setMobilePane('LIST');
      });
      return tab;
    });
  }, []);

  // Layer 3: Deferred search + condition filter + sort using precomputed lowercase search blobs
  const filteredVehicles = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const qCleanPlat = q ? sanitizePlatNomor(deferredSearchQuery) : '';

    const list = allVehicles.filter((v) => {
      if (conditionFilter === 'ZERO_ACTIVITY_CYCLES' && v.emptyActivityCycleCount === 0) {
        return false;
      }
      if (!q) return true;

      if (v.headerSearchBlob.includes(q)) return true;
      if (qCleanPlat && v.platNomor.includes(qCleanPlat)) return true;

      for (let i = 0; i < v.filteredCycles.length; i++) {
        if (v.filteredCycles[i].searchBlob.includes(q)) return true;
      }
      return false;
    });

    list.sort((a, b) => {
      if (a.isMissingPlat !== b.isMissingPlat) return a.isMissingPlat ? 1 : -1;
      if (sortBy === 'NOMINAL_DESC') return b.totalNominal - a.totalNominal;
      if (sortBy === 'REFILLS_DESC') return b.totalRefills - a.totalRefills || b.totalNominal - a.totalNominal;
      if (sortBy === 'LATEST_DESC') return b.latestRefillYmd.localeCompare(a.latestRefillYmd);
      return a.platNomor.localeCompare(b.platNomor);
    });

    return list;
  }, [allVehicles, deferredSearchQuery, conditionFilter, sortBy]);

  // Keep selected vehicle valid when filters change
  useEffect(() => {
    if (!isOpen) return;
    if (filteredVehicles.length === 0) {
      setSelectedPlat(null);
      return;
    }
    const stillExists = selectedPlat && filteredVehicles.some((v) => v.platNomor === selectedPlat);
    if (!stillExists) {
      setSelectedPlat(filteredVehicles[0].platNomor);
    }
  }, [isOpen, filteredVehicles, selectedPlat]);

  const selectedVehicle = useMemo(
    () => filteredVehicles.find((v) => v.platNomor === selectedPlat) || null,
    [filteredVehicles, selectedPlat]
  );

  // Auto-expand the first 2 visible cycles when switching vehicle/tab so initial DOM stays light and trace is immediately readable
  useEffect(() => {
    if (!selectedVehicle) return;
    const ordered =
      cycleOrder === 'DESC'
        ? [...selectedVehicle.filteredCycles].reverse()
        : selectedVehicle.filteredCycles;
    const nextExpanded: Record<string, boolean> = {};
    ordered.slice(0, 2).forEach((c) => {
      nextExpanded[c.item.id] = true;
    });
    setExpandedCycleIds(nextExpanded);
  }, [selectedVehicle?.platNomor, cycleOrder, activeTab]);

  const missingPlatCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < filteredVehicles.length; i++) {
      if (filteredVehicles[i].isMissingPlat) {
        count += filteredVehicles[i].totalRefills;
      }
    }
    return count;
  }, [filteredVehicles]);

  const handleSelectVehicle = useCallback((plat: string) => {
    startTransition(() => {
      setSelectedPlat(plat);
      setMobilePane('DETAIL');
    });
  }, []);

  const toggleCycle = useCallback((itemId: string) => {
    setExpandedCycleIds((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }, []);

  const setAllCyclesExpanded = useCallback(
    (expand: boolean) => {
      if (!selectedVehicle) return;
      const map: Record<string, boolean> = {};
      selectedVehicle.filteredCycles.forEach((c) => {
        map[c.item.id] = expand;
      });
      setExpandedCycleIds(map);
    },
    [selectedVehicle]
  );

  const handleOpenPhoto = useCallback(
    (rawUrl: string, rawFileId: string | undefined, title: string) => {
      let url = String(rawUrl || '').split('||')[0].trim();
      let fileId = String(rawFileId || '').split('||')[0].trim();

      const isHttpOrData = (v: string) =>
        /^https?:\/\//i.test(v) || /^data:/i.test(v) || /^blob:/i.test(v);
      const extractDriveId = (v: string) => {
        const m =
          v.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
          v.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
          v.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        return m && m[1] ? m[1] : '';
      };

      if (!isHttpOrData(url) && isHttpOrData(fileId)) {
        const tmp = url;
        url = fileId;
        fileId = tmp;
      }

      if (isHttpOrData(fileId)) {
        const extracted = extractDriveId(fileId);
        if (!url) url = fileId;
        fileId = extracted;
      }

      const isDriveUrl = Boolean(url && /drive\.google\.com|googleusercontent\.com/i.test(url));
      if (isDriveUrl) {
        const extracted = extractDriveId(url);
        if (extracted) fileId = extracted;
      } else if (isHttpOrData(url)) {
        fileId = '';
      } else if (fileId && !fileId.startsWith('BBM_NOTA_') && /^[a-zA-Z0-9_-]{15,}$/.test(fileId)) {
        url = `https://drive.google.com/file/d/${fileId}/view`;
      } else if (fileId.startsWith('BBM_NOTA_')) {
        fileId = '';
      }

      const payload = {
        url,
        fileId: fileId || undefined,
        title
      };

      if (onPreviewDocument) {
        onPreviewDocument(payload);
      } else {
        setPreviewImgFailed(false);
        setLocalPhotoPreview(payload);
      }
    },
    [onPreviewDocument]
  );

  const handleExportCsv = useCallback(() => {
    if (filteredVehicles.length === 0) return;

    const escapeCsv = (val: string | number | null | undefined) => {
      const s = String(val ?? '');
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const categoryLabel = activeTab === 'BACKUP' ? 'BBM Backup' : 'BBM Non Backup';
    const headers = [
      'Kategori BBM',
      'Plat Nomor',
      'Jenis Kendaraan',
      'Siklus Ke',
      'Tanggal Pengisian BBM',
      'Tanggal Pengisian Berikutnya',
      'Interval Hari',
      'UID Pengajuan',
      'Pengisi',
      'Email Pengisi',
      'Nominal BBM (Rp)',
      'Status Approval',
      'Keterangan Nota',
      'Jumlah Aktivitas Setelah Isi',
      'Jumlah Site Unik',
      'Daftar Site Dikunjungi'
    ];

    const rows: string[][] = [];
    for (const v of filteredVehicles) {
      const vType = v.vehicleTypes.join(' / ') || '-';
      for (const c of v.filteredCycles) {
        const sitesStr = Array.from(
          new Set(
            c.activities
              .map((a) =>
                a.activity.siteId
                  ? `${a.activity.siteId}${a.activity.siteName ? ` (${a.activity.siteName})` : ''}`
                  : ''
              )
              .filter(Boolean)
          )
        ).join('; ');

        rows.push([
          categoryLabel,
          v.platNomor,
          vType,
          String(c.cycleIndex),
          c.startYmd || '-',
          c.nextYmd || 'Belum ada pengisian berikutnya',
          c.intervalDays !== null ? String(c.intervalDays) : '-',
          c.item.requestId,
          c.requesterName,
          c.requesterEmail,
          String(c.nominal),
          c.approvalStatusText,
          c.item.keterangan || '-',
          String(c.activities.length),
          String(c.uniqueSiteCount),
          sitesStr || '-'
        ]);
      }
    }

    const csvContent =
      '\uFEFF' +
      [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download =
      activeTab === 'BACKUP'
        ? `analisis-bbm-backup-${getTodayYmd()}.csv`
        : `analisis-bbm-non-backup-${getTodayYmd()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredVehicles, activeTab]);

  const displayedCycles = useMemo(() => {
    if (!selectedVehicle) return [];
    return cycleOrder === 'DESC'
      ? [...selectedVehicle.filteredCycles].reverse()
      : selectedVehicle.filteredCycles;
  }, [selectedVehicle, cycleOrder]);

  const allDisplayedExpanded = useMemo(
    () => displayedCycles.length > 0 && displayedCycles.every((c) => expandedCycleIds[c.item.id]),
    [displayedCycles, expandedCycleIds]
  );

  if (!isOpen) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[100000] bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-1.5 sm:p-3 animate-fade-in"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl h-[96vh] max-h-[96vh] flex flex-col overflow-hidden animate-scale-up"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top Bar */}
          <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-white flex items-center justify-between gap-4 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-amber-400 flex items-center justify-center shrink-0">
                  <Fuel className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-slate-900 text-sm sm:text-base tracking-tight truncate">
                    Analisis Pemakaian BBM Kendaraan &amp; Backup Genset
                  </h2>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void loadServerBbmItems(true)}
                disabled={isSyncingServer}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                title="Muat ulang data historis BBM dari server"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isSyncingServer ? 'animate-spin text-indigo-600' : 'text-slate-500'}`}
                />
                <span className="hidden sm:inline">
                  {isSyncingServer ? 'Menyinkronkan...' : 'Sinkronkan'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredVehicles.length === 0}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                title="Unduh rekap siklus BBM & aktivitas dalam format CSV"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 2-Tab Navigation Bar: BBM Non Backup vs BBM Backup */}
          <div
            role="tablist"
            aria-label="Kategori Analisis BBM"
            className="px-4 sm:px-6 border-b border-slate-200 bg-white flex items-center gap-6 overflow-x-auto shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'NON_BACKUP'}
              onClick={() => handleSwitchTab('NON_BACKUP')}
              className={`py-2.5 text-xs sm:text-sm border-b-2 transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'NON_BACKUP'
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
              }`}
            >
              <span>BBM Non Backup</span>
              <span
                className={`font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded-md ${
                  activeTab === 'NON_BACKUP'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {tabCounts.nonBackup}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'BACKUP'}
              onClick={() => handleSwitchTab('BACKUP')}
              className={`py-2.5 text-xs sm:text-sm border-b-2 transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'BACKUP'
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
              }`}
            >
              <span>BBM Backup</span>
              <span
                className={`font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded-md ${
                  activeTab === 'BACKUP'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {tabCounts.backup}
              </span>
            </button>
          </div>

          {/* Filter Toolbar */}
          <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari plat nomor, petugas, site, UID..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none transition-colors"
              />
            </div>

            {/* Date Presets */}
            <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg shrink-0">
              {(
                [
                  { id: 'ALL', label: 'Semua' },
                  { id: 'MONTH', label: 'Bulan Ini' },
                  { id: '30D', label: '30 Hari' },
                  { id: '90D', label: '90 Hari' }
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyDatePreset(preset.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    datePreset === preset.id
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Custom Date Inputs */}
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  const val = e.target.value;
                  setDatePreset('CUSTOM');
                  startTransition(() => setDateFrom(val));
                }}
                aria-label="Dari tanggal"
                className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono tabular-nums text-slate-700 focus:border-slate-900 focus:outline-none"
              />
              <span className="text-xs text-slate-400">–</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  const val = e.target.value;
                  setDatePreset('CUSTOM');
                  startTransition(() => setDateTo(val));
                }}
                aria-label="Sampai tanggal"
                className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono tabular-nums text-slate-700 focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* Condition Filter */}
            <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => startTransition(() => setConditionFilter('ALL'))}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  conditionFilter === 'ALL'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Semua Plat
              </button>
              <button
                type="button"
                onClick={() => startTransition(() => setConditionFilter('ZERO_ACTIVITY_CYCLES'))}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  conditionFilter === 'ZERO_ACTIVITY_CYCLES'
                    ? 'bg-white text-amber-800 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Ada Siklus 0 Aktivitas
              </button>
            </div>

            {/* Sort Select */}
            <select
              value={sortBy}
              onChange={(e) => {
                const val = e.target.value as SortKey;
                startTransition(() => setSortBy(val));
              }}
              aria-label="Urutkan kendaraan"
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:border-slate-900 focus:outline-none cursor-pointer shrink-0"
            >
              <option value="NOMINAL_DESC">Urut: Nominal Tertinggi</option>
              <option value="REFILLS_DESC">Urut: Pengisian Terbanyak</option>
              <option value="LATEST_DESC">Urut: Pengisian Terbaru</option>
              <option value="PLAT_ASC">Urut: Plat Nomor A–Z</option>
            </select>
          </div>

          {/* Sync Warning if any */}
          {syncError && (
            <div className="px-4 sm:px-6 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-700 flex items-center justify-between gap-2 shrink-0">
              <span>{syncError} (Menampilkan data lokal yang tersedia.)</span>
              <button
                type="button"
                onClick={() => setSyncError(null)}
                className="text-rose-700 hover:text-rose-900 font-semibold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          )}

          {/* Master-Detail Split Workspace */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
            {/* Left Pane: Vehicle List */}
            <div
              className={`lg:col-span-4 border-r border-slate-200 bg-slate-50/40 flex flex-col min-h-0 overflow-hidden ${
                mobilePane === 'DETAIL' ? 'hidden lg:flex' : 'flex'
              }`}
            >
              <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600 shrink-0">
                <span className="font-semibold text-slate-700">
                  Daftar Plat Nomor ({filteredVehicles.length})
                </span>
                {isSyncingServer && (
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Memuat...
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-200/80">
                {filteredVehicles.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <Car className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-sm font-semibold text-slate-700">
                      {activeTab === 'BACKUP' ? 'Tidak ada data BBM Backup' : 'Tidak ada data BBM kendaraan'}
                    </p>
                    <p className="text-xs text-slate-500 max-w-xs mx-auto">
                      {activeTab === 'BACKUP'
                        ? 'Belum ditemukan laporan penggunaan BBM non-Duren Sawit dengan IsGenset = TRUE yang cocok dengan filter saat ini.'
                        : 'Belum ditemukan laporan penggunaan BBM non-Duren Sawit dengan IsGenset selain TRUE yang cocok dengan filter saat ini.'}
                    </p>
                    {(searchQuery || dateFrom || dateTo || conditionFilter !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          applyDatePreset('ALL');
                          setConditionFilter('ALL');
                        }}
                        className="mt-2 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                      >
                        Reset Filter
                      </button>
                    )}
                  </div>
                ) : (
                  filteredVehicles.map((v) => (
                    <VehicleListItem
                      key={v.platNomor}
                      vehicle={v}
                      isSelected={selectedVehicle?.platNomor === v.platNomor}
                      onSelect={handleSelectVehicle}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Right Pane: Detailed Fuel Cycle & Activity Trace */}
            <div
              className={`lg:col-span-8 bg-white flex flex-col min-h-0 overflow-hidden ${
                mobilePane === 'LIST' ? 'hidden lg:flex' : 'flex'
              }`}
            >
              {!selectedVehicle ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-2">
                  <Fuel className="w-10 h-10 text-slate-200" />
                  <p className="text-sm font-semibold text-slate-600">Pilih plat nomor di sebelah kiri</p>
                  <p className="text-xs text-slate-500 max-w-sm">
                    Klik salah satu kendaraan untuk menelusuri riwayat pengisian BBM dan seluruh aktivitas operasional sebelum pengisian BBM berikutnya.
                  </p>
                </div>
              ) : (
                <>
                  {/* Selected Vehicle Header & Stats */}
                  <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-white space-y-3 shrink-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setMobilePane('LIST')}
                            className="lg:hidden inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 pr-2 border-r border-slate-200 cursor-pointer"
                          >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            <span>Daftar</span>
                          </button>
                          <h3 className="font-mono font-bold text-lg text-slate-900 tracking-wide">
                            {selectedVehicle.platNomor}
                          </h3>
                          {selectedVehicle.vehicleTypes.length > 0 && (
                            <span className="text-xs text-slate-500">
                              · {selectedVehicle.vehicleTypes.join(' / ')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Periode data: {formatYmdShort(selectedVehicle.earliestRefillYmd)} –{' '}
                          {formatYmdShort(selectedVehicle.latestRefillYmd)}
                          {selectedVehicle.drivers.length > 0 && (
                            <> · Petugas: {selectedVehicle.drivers.join(', ')}</>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg">
                          <button
                            type="button"
                            onClick={() => setCycleOrder('DESC')}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                              cycleOrder === 'DESC'
                                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            Terbaru
                          </button>
                          <button
                            type="button"
                            onClick={() => setCycleOrder('ASC')}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                              cycleOrder === 'ASC'
                                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            Kronologis
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => setAllCyclesExpanded(!allDisplayedExpanded)}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {allDisplayedExpanded ? 'Tutup Semua' : 'Buka Semua'}
                        </button>
                      </div>
                    </div>

                    {/* Vehicle Inline Metric Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2.5 border-t border-slate-100 text-xs">
                      <div>
                        <span className="text-slate-500 block">
                          Total BBM ({selectedVehicle.totalRefills}x)
                        </span>
                        <span className="font-mono font-bold text-slate-900 tabular-nums text-sm mt-0.5 block">
                          {formatIDR(selectedVehicle.totalNominal)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Rata-rata / Isi</span>
                        <span className="font-mono font-bold text-slate-900 tabular-nums text-sm mt-0.5 block">
                          {formatIDR(Math.round(selectedVehicle.avgNominal))}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Rata-rata Interval</span>
                        <span className="font-mono font-bold text-slate-900 tabular-nums text-sm mt-0.5 block">
                          {selectedVehicle.avgIntervalDays !== null
                            ? `${selectedVehicle.avgIntervalDays.toFixed(1)} hari`
                            : 'Baru 1x isi'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Aktivitas</span>
                        <span className="font-mono font-bold text-slate-900 tabular-nums text-sm mt-0.5 block">
                          {selectedVehicle.totalActivities} log
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cycles Timeline Scrollable Area */}
                  <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-50/50 space-y-3">
                    {displayedCycles.map((cycle) => (
                      <CycleCard
                        key={cycle.item.id}
                        cycle={cycle}
                        platNomor={selectedVehicle.platNomor}
                        isMissingPlat={selectedVehicle.isMissingPlat}
                        activeTab={activeTab}
                        isExpanded={Boolean(expandedCycleIds[cycle.item.id])}
                        onToggle={toggleCycle}
                        onOpenPhoto={handleOpenPhoto}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-4 sm:px-6 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 text-xs text-slate-500 shrink-0">
            <span className="truncate">
              {activeTab === 'BACKUP'
                ? 'Filter aktif: BBM Backup · IsBBM = TRUE · Non-Duren Sawit · IsGenset = TRUE · Activity IsBackup = TRUE · Kecuali Gabung Kendaraan'
                : 'Filter aktif: BBM Non Backup · IsBBM = TRUE · Non-Duren Sawit · IsGenset ≠ TRUE · Kecuali Gabung Kendaraan'}
              {missingPlatCount > 0 && <> · {missingPlatCount} item BBM belum diisi plat nomor</>}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg text-xs transition-colors cursor-pointer shrink-0"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>

      {/* Fallback Local Zoomable Photo Viewer (used if parent does not supply onPreviewDocument) */}
      {localPhotoPreview && (
        <div
          className="fixed inset-0 z-[100020] bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setLocalPhotoPreview(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                <h4 className="text-xs sm:text-sm font-semibold text-slate-900 truncate">
                  {localPhotoPreview.title}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setLocalPhotoPreview(null)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex-1 overflow-auto flex items-center justify-center min-h-[260px]">
              {!previewImgFailed && getImageSrc(localPhotoPreview.url, localPhotoPreview.fileId) ? (
                <ZoomableImage
                  src={getImageSrc(localPhotoPreview.url, localPhotoPreview.fileId)}
                  alt={localPhotoPreview.title}
                  maxHeightClass="max-h-[70vh]"
                  darkTheme
                  referrerPolicy="no-referrer"
                  onError={() => setPreviewImgFailed(true)}
                />
              ) : (
                <div className="text-center text-slate-300 space-y-2 py-8">
                  <ImageIcon className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-xs font-medium">Gambar tidak dapat dimuat secara langsung.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
};

export const AdminVehicleFuelAnalysisModal = React.memo(AdminVehicleFuelAnalysisModalInner);
