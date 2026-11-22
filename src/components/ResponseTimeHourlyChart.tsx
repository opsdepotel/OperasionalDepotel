import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  Clock,
  Download,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react';
import type { ResponseTimeRow } from './AdminResponseTimeModal';

interface ResponseTimeHourlyChartProps {
  rows: ResponseTimeRow[];
  filterSummary: {
    divisi: string;
    subDivisi: string;
    monthLabel: string;
    year: string;
  };
}

type SeriesKey = 'userSubmit' | 'approvedManager' | 'approvedFinance' | 'transfer';

interface SeriesConfig {
  key: SeriesKey;
  label: string;
  shortLabel: string;
  color: string;
  softFill: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  dotClass: string;
}

const SERIES_LIST: SeriesConfig[] = [
  {
    key: 'userSubmit',
    label: 'User Submit',
    shortLabel: 'Submit',
    color: '#2563eb',
    softFill: 'rgba(37, 99, 235, 0.10)',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    badgeBorder: 'border-blue-200',
    dotClass: 'bg-blue-600'
  },
  {
    key: 'approvedManager',
    label: 'Approved Manager',
    shortLabel: 'App. Manager',
    color: '#d97706',
    softFill: 'rgba(217, 119, 6, 0.10)',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    badgeBorder: 'border-amber-200',
    dotClass: 'bg-amber-600'
  },
  {
    key: 'approvedFinance',
    label: 'Approved Finance',
    shortLabel: 'App. Finance',
    color: '#9333ea',
    softFill: 'rgba(147, 51, 234, 0.10)',
    badgeBg: 'bg-purple-50',
    badgeText: 'text-purple-700',
    badgeBorder: 'border-purple-200',
    dotClass: 'bg-purple-600'
  },
  {
    key: 'transfer',
    label: 'Transfer',
    shortLabel: 'Transfer',
    color: '#059669',
    softFill: 'rgba(5, 150, 105, 0.10)',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    badgeBorder: 'border-emerald-200',
    dotClass: 'bg-emerald-600'
  }
];

interface HourlyBucket {
  hour: number;
  label: string;
  rangeLabel: string;
  userSubmit: number;
  approvedManager: number;
  approvedFinance: number;
  transfer: number;
}

function formatAverageMinutes(totalMinutes: number, count: number): string {
  if (count <= 0) return '-';
  const avg = Math.round(totalMinutes / count);
  const h = Math.floor(avg / 60) % 24;
  const m = avg % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function computeNiceMax(rawMax: number): { maxVal: number; ticks: number[] } {
  if (rawMax <= 0) {
    return { maxVal: 4, ticks: [0, 1, 2, 3, 4] };
  }
  const stepCount = 4;
  const roughStep = rawMax / stepCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;
  let niceStep: number;
  if (residual <= 1) niceStep = 1 * magnitude;
  else if (residual <= 2) niceStep = 2 * magnitude;
  else if (residual <= 2.5) niceStep = 2.5 * magnitude;
  else if (residual <= 5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  niceStep = Math.max(1, Math.ceil(niceStep));
  const maxVal = niceStep * stepCount;
  const ticks = [0, niceStep, niceStep * 2, niceStep * 3, maxVal];
  return { maxVal, ticks };
}

export const ResponseTimeHourlyChart: React.FC<ResponseTimeHourlyChartProps> = ({
  rows,
  filterSummary
}) => {
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  const [hourRangeMode, setHourRangeMode] = useState<'full24' | 'active'>('full24');
  const [visibleSeries, setVisibleSeries] = useState<Record<SeriesKey, boolean>>({
    userSubmit: true,
    approvedManager: true,
    approvedFinance: true,
    transfer: true
  });
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [showBreakdownTable, setShowBreakdownTable] = useState<boolean>(true);

  const toggleSeries = (key: SeriesKey) => {
    setVisibleSeries((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Prevent turning off all 4 series simultaneously
      if (!Object.values(next).some(Boolean)) {
        return prev;
      }
      return next;
    });
  };

  // Aggregate all 24 hourly buckets (00:00 - 23:00) + summary stats per series
  const { hourlyBuckets, seriesStats, hasAnyData } = useMemo(() => {
    const buckets: HourlyBucket[] = Array.from({ length: 24 }, (_, hour) => {
      const hh = String(hour).padStart(2, '0');
      return {
        hour,
        label: `${hh}:00`,
        rangeLabel: `${hh}:00 - ${hh}:59`,
        userSubmit: 0,
        approvedManager: 0,
        approvedFinance: 0,
        transfer: 0
      };
    });

    const totals: Record<SeriesKey, number> = {
      userSubmit: 0,
      approvedManager: 0,
      approvedFinance: 0,
      transfer: 0
    };
    const totalMinutes: Record<SeriesKey, number> = {
      userSubmit: 0,
      approvedManager: 0,
      approvedFinance: 0,
      transfer: 0
    };

    rows.forEach((row) => {
      if (row.diajukanDate) {
        const h = row.diajukanDate.getHours();
        buckets[h].userSubmit += 1;
        totals.userSubmit += 1;
        totalMinutes.userSubmit += h * 60 + row.diajukanDate.getMinutes();
      }
      if (row.approvedManagerDate) {
        const h = row.approvedManagerDate.getHours();
        buckets[h].approvedManager += 1;
        totals.approvedManager += 1;
        totalMinutes.approvedManager += h * 60 + row.approvedManagerDate.getMinutes();
      }
      if (row.approvedFinanceDate) {
        const h = row.approvedFinanceDate.getHours();
        buckets[h].approvedFinance += 1;
        totals.approvedFinance += 1;
        totalMinutes.approvedFinance += h * 60 + row.approvedFinanceDate.getMinutes();
      }
      if (row.transferDate) {
        const h = row.transferDate.getHours();
        buckets[h].transfer += 1;
        totals.transfer += 1;
        totalMinutes.transfer += h * 60 + row.transferDate.getMinutes();
      }
    });

    const stats: Record<
      SeriesKey,
      { total: number; peakHour: number | null; peakCount: number; avgTime: string }
    > = {
      userSubmit: { total: 0, peakHour: null, peakCount: 0, avgTime: '-' },
      approvedManager: { total: 0, peakHour: null, peakCount: 0, avgTime: '-' },
      approvedFinance: { total: 0, peakHour: null, peakCount: 0, avgTime: '-' },
      transfer: { total: 0, peakHour: null, peakCount: 0, avgTime: '-' }
    };

    (Object.keys(stats) as SeriesKey[]).forEach((key) => {
      let peakHour: number | null = null;
      let peakCount = 0;
      buckets.forEach((b) => {
        if (b[key] > peakCount) {
          peakCount = b[key];
          peakHour = b.hour;
        }
      });
      stats[key] = {
        total: totals[key],
        peakHour,
        peakCount,
        avgTime: formatAverageMinutes(totalMinutes[key], totals[key])
      };
    });

    const anyData =
      totals.userSubmit > 0 ||
      totals.approvedManager > 0 ||
      totals.approvedFinance > 0 ||
      totals.transfer > 0;

    return {
      hourlyBuckets: buckets,
      seriesStats: stats,
      hasAnyData: anyData
    };
  }, [rows]);

  // Visible buckets based on 24-hour vs Active Hours toggle
  const displayedBuckets = useMemo(() => {
    if (hourRangeMode === 'full24' || !hasAnyData) {
      return hourlyBuckets;
    }
    let firstIdx = 23;
    let lastIdx = 0;
    hourlyBuckets.forEach((b, idx) => {
      const sum = b.userSubmit + b.approvedManager + b.approvedFinance + b.transfer;
      if (sum > 0) {
        if (idx < firstIdx) firstIdx = idx;
        if (idx > lastIdx) lastIdx = idx;
      }
    });
    if (firstIdx > lastIdx) return hourlyBuckets;
    const start = Math.max(0, firstIdx - 1);
    const end = Math.min(23, lastIdx + 1);
    return hourlyBuckets.slice(start, end + 1);
  }, [hourlyBuckets, hourRangeMode, hasAnyData]);

  const activeSeriesList = useMemo(
    () => SERIES_LIST.filter((s) => visibleSeries[s.key]),
    [visibleSeries]
  );

  // Y-axis scaling across visible series
  const { maxVal, ticks } = useMemo(() => {
    let rawMax = 0;
    displayedBuckets.forEach((b) => {
      activeSeriesList.forEach((s) => {
        if (b[s.key] > rawMax) rawMax = b[s.key];
      });
    });
    return computeNiceMax(rawMax);
  }, [displayedBuckets, activeSeriesList]);

  // SVG layout dimensions
  const svgWidth = 960;
  const svgHeight = 350;
  const padLeft = 48;
  const padRight = 22;
  const padTop = 20;
  const padBottom = 46;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const bucketCount = displayedBuckets.length;
  const slotW = plotW / Math.max(1, bucketCount);

  const getCenterX = (idx: number) => padLeft + slotW * idx + slotW / 2;
  const getY = (val: number) => padTop + plotH - (val / Math.max(1, maxVal)) * plotH;

  const hoveredBucketIndex = useMemo(() => {
    if (hoveredHour === null) return -1;
    return displayedBuckets.findIndex((b) => b.hour === hoveredHour);
  }, [hoveredHour, displayedBuckets]);

  const hoveredBucket = hoveredBucketIndex >= 0 ? displayedBuckets[hoveredBucketIndex] : null;

  // Export CSV for hourly summary
  const handleExportHourlyCsv = () => {
    const headers = [
      'Rentang Jam',
      'User Submit',
      'Approved Manager',
      'Approved Finance',
      'Transfer',
      'Total Aktivitas'
    ];

    const csvRows = hourlyBuckets.map((b) => {
      const total = b.userSubmit + b.approvedManager + b.approvedFinance + b.transfer;
      return [
        `"${b.rangeLabel}"`,
        b.userSubmit,
        b.approvedManager,
        b.approvedFinance,
        b.transfer,
        total
      ].join(',');
    });

    const csvString = '\uFEFF' + [headers.join(','), ...csvRows].join('\r\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    const safePeriod = `${filterSummary.monthLabel}_${filterSummary.year}`.replace(/\s+/g, '_');
    link.setAttribute('href', url);
    link.setAttribute('download', `Grafik_Response_Per_Jam_${safePeriod}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* 4 KPI Cards (Interactive Series Toggles + Peak Hour Summary) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {SERIES_LIST.map((series) => {
          const stat = seriesStats[series.key];
          const isVisible = visibleSeries[series.key];
          const peakLabel =
            stat.peakHour !== null
              ? `${String(stat.peakHour).padStart(2, '0')}:00–${String(stat.peakHour).padStart(2, '0')}:59`
              : '-';

          return (
            <button
              key={series.key}
              type="button"
              onClick={() => toggleSeries(series.key)}
              className={`text-left p-3.5 rounded-2xl border transition-all cursor-pointer shadow-2xs ${
                isVisible
                  ? `bg-white ${series.badgeBorder} hover:shadow-md`
                  : 'bg-slate-50 border-slate-200 opacity-55 hover:opacity-80'
              }`}
              title={`Klik untuk ${isVisible ? 'menyembunyikan' : 'menampilkan'} series ${series.label}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${series.dotClass}`}
                  />
                  <span className="text-xs font-bold text-slate-800 truncate">
                    {series.label}
                  </span>
                </div>
                <span className="text-slate-400 shrink-0">
                  {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </span>
              </div>

              <div className="mt-2.5 flex items-baseline justify-between gap-2">
                <span className="text-xl font-black font-mono text-slate-900">
                  {stat.total.toLocaleString('id-ID')}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${series.badgeBg} ${series.badgeText} ${series.badgeBorder}`}
                >
                  Rata-rata: {stat.avgTime}
                </span>
              </div>

              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                <span>Jam Puncak:</span>
                <span className="font-mono font-bold text-slate-700">
                  {peakLabel} {stat.peakCount > 0 ? `(${stat.peakCount})` : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Chart Card */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Chart Card Header & Controls */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
              <span>Distribusi Aktivitas Per-Jam (00:00 – 23:00)</span>
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Divisi: <strong className="text-slate-700">{filterSummary.divisi}</strong> &bull; Sub Divisi:{' '}
              <strong className="text-slate-700">{filterSummary.subDivisi}</strong> &bull; Periode:{' '}
              <strong className="text-slate-700">
                {filterSummary.monthLabel}, {filterSummary.year}
              </strong>
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Hour Range Mode */}
            <div className="inline-flex bg-slate-100 p-0.5 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setHourRangeMode('full24')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  hourRangeMode === 'full24'
                    ? 'bg-white text-indigo-700 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                24 Jam
              </button>
              <button
                type="button"
                onClick={() => setHourRangeMode('active')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  hourRangeMode === 'active'
                    ? 'bg-white text-indigo-700 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Jam Aktif
              </button>
            </div>

            {/* Chart Type Mode */}
            <div className="inline-flex bg-slate-100 p-0.5 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setChartType('line')}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  chartType === 'line'
                    ? 'bg-white text-indigo-700 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Garis</span>
              </button>
              <button
                type="button"
                onClick={() => setChartType('bar')}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  chartType === 'bar'
                    ? 'bg-white text-indigo-700 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Batang</span>
              </button>
            </div>
          </div>
        </div>

        {/* SVG Chart Canvas */}
        <div className="p-4">
          {!hasAnyData ? (
            <div className="py-16 text-center text-slate-400">
              <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-600 text-sm">
                Tidak ada data waktu pengajuan (OP-) untuk filter yang dipilih.
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Silakan ubah filter Divisi, Sub Divisi, Bulan, atau Tahun untuk melihat grafik per-jam.
              </p>
            </div>
          ) : (
            <div className="relative overflow-x-auto pb-1">
              <div className="min-w-[680px] relative">
                <svg
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  className="w-full h-auto select-none overflow-visible"
                  role="img"
                  aria-label="Grafik distribusi waktu per jam untuk User Submit, Approved Manager, Approved Finance, dan Transfer"
                  onMouseLeave={() => setHoveredHour(null)}
                >
                  {/* Horizontal Gridlines & Y-Axis Ticks */}
                  {ticks.map((tickVal) => {
                    const y = getY(tickVal);
                    return (
                      <g key={`tick-${tickVal}`}>
                        <line
                          x1={padLeft}
                          x2={svgWidth - padRight}
                          y1={y}
                          y2={y}
                          stroke={tickVal === 0 ? '#cbd5e1' : '#e2e8f0'}
                          strokeWidth={tickVal === 0 ? 1.2 : 1}
                          strokeDasharray={tickVal === 0 ? undefined : '4 4'}
                        />
                        <text
                          x={padLeft - 10}
                          y={y + 3.5}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono font-semibold"
                        >
                          {tickVal}
                        </text>
                      </g>
                    );
                  })}

                  {/* Hover Column Highlight */}
                  {hoveredBucketIndex >= 0 && (
                    <rect
                      x={padLeft + hoveredBucketIndex * slotW}
                      y={padTop}
                      width={slotW}
                      height={plotH}
                      fill="#f1f5f9"
                      rx={4}
                    />
                  )}

                  {/* Line Mode */}
                  {chartType === 'line' && (
                    <>
                      {/* Soft Area Fill */}
                      {activeSeriesList.map((series) => {
                        if (displayedBuckets.length < 2) return null;
                        const pts = displayedBuckets.map(
                          (b, idx) => `${getCenterX(idx)},${getY(b[series.key])}`
                        );
                        const firstX = getCenterX(0);
                        const lastX = getCenterX(displayedBuckets.length - 1);
                        const baseY = getY(0);
                        const areaPath = `M ${firstX},${baseY} L ${pts.join(' L ')} L ${lastX},${baseY} Z`;
                        return (
                          <path
                            key={`area-${series.key}`}
                            d={areaPath}
                            fill={series.softFill}
                          />
                        );
                      })}

                      {/* Lines */}
                      {activeSeriesList.map((series) => {
                        const polylinePoints = displayedBuckets
                          .map((b, idx) => `${getCenterX(idx)},${getY(b[series.key])}`)
                          .join(' ');
                        return (
                          <polyline
                            key={`line-${series.key}`}
                            fill="none"
                            stroke={series.color}
                            strokeWidth={2.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={polylinePoints}
                          />
                        );
                      })}

                      {/* Vertical Hover Guide Line */}
                      {hoveredBucketIndex >= 0 && (
                        <line
                          x1={getCenterX(hoveredBucketIndex)}
                          x2={getCenterX(hoveredBucketIndex)}
                          y1={padTop}
                          y2={padTop + plotH}
                          stroke="#94a3b8"
                          strokeWidth={1}
                          strokeDasharray="3 3"
                        />
                      )}

                      {/* Data Point Dots */}
                      {activeSeriesList.map((series) =>
                        displayedBuckets.map((b, idx) => {
                          const val = b[series.key];
                          const isHovered = hoveredHour === b.hour;
                          if (val === 0 && !isHovered) return null;
                          return (
                            <circle
                              key={`dot-${series.key}-${b.hour}`}
                              cx={getCenterX(idx)}
                              cy={getY(val)}
                              r={isHovered ? 5 : 3.2}
                              fill="#ffffff"
                              stroke={series.color}
                              strokeWidth={isHovered ? 2.8 : 2}
                            />
                          );
                        })
                      )}
                    </>
                  )}

                  {/* Grouped Bar Mode */}
                  {chartType === 'bar' && (
                    <>
                      {displayedBuckets.map((b, idx) => {
                        const groupPad = Math.max(4, slotW * 0.14);
                        const usableW = Math.max(8, slotW - groupPad * 2);
                        const barGap = activeSeriesList.length > 1 ? 2 : 0;
                        const barW = Math.max(
                          3,
                          (usableW - barGap * (activeSeriesList.length - 1)) /
                            Math.max(1, activeSeriesList.length)
                        );
                        const groupStartX = padLeft + idx * slotW + groupPad;
                        const baseY = getY(0);

                        return (
                          <g key={`bar-group-${b.hour}`}>
                            {activeSeriesList.map((series, sIdx) => {
                              const val = b[series.key];
                              const y = getY(val);
                              const h = Math.max(0, baseY - y);
                              const x = groupStartX + sIdx * (barW + barGap);
                              const isHovered = hoveredHour === b.hour;
                              return (
                                <rect
                                  key={`bar-${series.key}-${b.hour}`}
                                  x={x}
                                  y={y}
                                  width={barW}
                                  height={h}
                                  rx={Math.min(3, barW / 2)}
                                  fill={series.color}
                                  opacity={hoveredHour === null || isHovered ? 0.92 : 0.45}
                                />
                              );
                            })}
                          </g>
                        );
                      })}
                    </>
                  )}

                  {/* X-Axis Hour Labels */}
                  {displayedBuckets.map((b, idx) => {
                    const isHovered = hoveredHour === b.hour;
                    return (
                      <text
                        key={`xlabel-${b.hour}`}
                        x={getCenterX(idx)}
                        y={padTop + plotH + 20}
                        textAnchor="middle"
                        className={`text-[10px] font-mono ${
                          isHovered ? 'fill-indigo-700 font-black' : 'fill-slate-500 font-semibold'
                        }`}
                      >
                        {String(b.hour).padStart(2, '0')}
                      </text>
                    );
                  })}

                  {/* X-Axis Unit Caption */}
                  <text
                    x={padLeft + plotW / 2}
                    y={svgHeight - 6}
                    textAnchor="middle"
                    className="fill-slate-400 text-[10px] font-semibold"
                  >
                    Jam (00:00 – 23:00 WIB)
                  </text>

                  {/* Transparent Interactive Hover Hitboxes */}
                  {displayedBuckets.map((b, idx) => (
                    <rect
                      key={`hit-${b.hour}`}
                      x={padLeft + idx * slotW}
                      y={padTop}
                      width={slotW}
                      height={plotH + 28}
                      fill="transparent"
                      className="cursor-crosshair"
                      onMouseEnter={() => setHoveredHour(b.hour)}
                      onClick={() =>
                        setHoveredHour((prev) => (prev === b.hour ? null : b.hour))
                      }
                    />
                  ))}
                </svg>

                {/* Floating Interactive Tooltip */}
                {hoveredBucket && hoveredBucketIndex >= 0 && (
                  <div
                    className="pointer-events-none absolute top-3 z-20 bg-slate-900/95 text-white rounded-xl p-3 shadow-xl border border-slate-700/80 min-w-[205px]"
                    style={{
                      left:
                        hoveredBucketIndex > displayedBuckets.length / 2
                          ? `${Math.max(2, ((padLeft + hoveredBucketIndex * slotW) / svgWidth) * 100 - 25)}%`
                          : `${Math.min(72, ((padLeft + (hoveredBucketIndex + 1) * slotW) / svgWidth) * 100 + 1)}%`
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-slate-700">
                      <span className="text-[11px] font-mono font-bold text-indigo-300 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {hoveredBucket.rangeLabel}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Total:{' '}
                        {activeSeriesList.reduce((acc, s) => acc + hoveredBucket[s.key], 0)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {activeSeriesList.map((series) => {
                        const count = hoveredBucket[series.key];
                        const totalForSeries = seriesStats[series.key].total;
                        const pct =
                          totalForSeries > 0
                            ? ((count / totalForSeries) * 100).toFixed(1)
                            : '0.0';
                        return (
                          <div
                            key={`tip-${series.key}`}
                            className="flex items-center justify-between gap-3 text-[11px]"
                          >
                            <span className="flex items-center gap-1.5 text-slate-200">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${series.dotClass}`}
                              />
                              <span>{series.label}</span>
                            </span>
                            <span className="font-mono font-bold text-white">
                              {count}{' '}
                              <span className="text-[10px] font-normal text-slate-400">
                                ({pct}%)
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Legend Strip */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 text-[11px]">
            <div className="flex items-center gap-3 flex-wrap">
              {SERIES_LIST.map((series) => {
                const isVisible = visibleSeries[series.key];
                return (
                  <button
                    key={`legend-${series.key}`}
                    type="button"
                    onClick={() => toggleSeries(series.key)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer ${
                      isVisible
                        ? `${series.badgeBg} ${series.badgeText} ${series.badgeBorder}`
                        : 'bg-slate-50 text-slate-400 border-slate-200 line-through'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${isVisible ? series.dotClass : 'bg-slate-300'}`}
                    />
                    <span>{series.label}</span>
                  </button>
                );
              })}
            </div>
            <span className="text-[10px] text-slate-400">
              Arahkan kursor / ketuk jam pada grafik untuk melihat rincian
            </span>
          </div>
        </div>
      </div>

      {/* Hourly Breakdown Summary Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-3.5 px-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowBreakdownTable((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-indigo-600 transition-colors cursor-pointer"
          >
            {showBreakdownTable ? (
              <ChevronUp className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            )}
            <span>Rekap Angka Distribusi Per-Jam (00:00 – 23:59)</span>
          </button>

          <button
            type="button"
            onClick={handleExportHourlyCsv}
            disabled={!hasAnyData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:pointer-events-none text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV Per-Jam</span>
          </button>
        </div>

        {showBreakdownTable && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs min-w-[600px]">
              <thead className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4">Rentang Jam</th>
                  <th className="py-2.5 px-4 text-right text-blue-700">User Submit</th>
                  <th className="py-2.5 px-4 text-right text-amber-700">Approved Manager</th>
                  <th className="py-2.5 px-4 text-right text-purple-700">Approved Finance</th>
                  <th className="py-2.5 px-4 text-right text-emerald-700">Transfer</th>
                  <th className="py-2.5 px-4 text-right text-slate-700">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {displayedBuckets.map((b) => {
                  const rowTotal =
                    b.userSubmit + b.approvedManager + b.approvedFinance + b.transfer;
                  const isSubmitPeak =
                    seriesStats.userSubmit.peakCount > 0 &&
                    b.hour === seriesStats.userSubmit.peakHour;
                  const isMgrPeak =
                    seriesStats.approvedManager.peakCount > 0 &&
                    b.hour === seriesStats.approvedManager.peakHour;
                  const isFinPeak =
                    seriesStats.approvedFinance.peakCount > 0 &&
                    b.hour === seriesStats.approvedFinance.peakHour;
                  const isTfPeak =
                    seriesStats.transfer.peakCount > 0 &&
                    b.hour === seriesStats.transfer.peakHour;

                  return (
                    <tr
                      key={`tbl-hour-${b.hour}`}
                      onMouseEnter={() => setHoveredHour(b.hour)}
                      onMouseLeave={() => setHoveredHour(null)}
                      className={`transition-colors ${
                        hoveredHour === b.hour ? 'bg-indigo-50/50' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="py-2 px-4 font-semibold text-slate-700">{b.rangeLabel}</td>
                      <td
                        className={`py-2 px-4 text-right ${
                          isSubmitPeak
                            ? 'font-black text-blue-700 bg-blue-50/70'
                            : b.userSubmit > 0
                            ? 'text-slate-800 font-semibold'
                            : 'text-slate-300'
                        }`}
                      >
                        {b.userSubmit}
                      </td>
                      <td
                        className={`py-2 px-4 text-right ${
                          isMgrPeak
                            ? 'font-black text-amber-700 bg-amber-50/70'
                            : b.approvedManager > 0
                            ? 'text-slate-800 font-semibold'
                            : 'text-slate-300'
                        }`}
                      >
                        {b.approvedManager}
                      </td>
                      <td
                        className={`py-2 px-4 text-right ${
                          isFinPeak
                            ? 'font-black text-purple-700 bg-purple-50/70'
                            : b.approvedFinance > 0
                            ? 'text-slate-800 font-semibold'
                            : 'text-slate-300'
                        }`}
                      >
                        {b.approvedFinance}
                      </td>
                      <td
                        className={`py-2 px-4 text-right ${
                          isTfPeak
                            ? 'font-black text-emerald-700 bg-emerald-50/70'
                            : b.transfer > 0
                            ? 'text-slate-800 font-semibold'
                            : 'text-slate-300'
                        }`}
                      >
                        {b.transfer}
                      </td>
                      <td className="py-2 px-4 text-right font-bold text-slate-700">
                        {rowTotal}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-100 border-t-2 border-slate-200 font-mono font-black text-slate-800">
                <tr>
                  <td className="py-2.5 px-4 font-sans uppercase text-[11px]">Total Keseluruhan</td>
                  <td className="py-2.5 px-4 text-right text-blue-700">
                    {seriesStats.userSubmit.total}
                  </td>
                  <td className="py-2.5 px-4 text-right text-amber-700">
                    {seriesStats.approvedManager.total}
                  </td>
                  <td className="py-2.5 px-4 text-right text-purple-700">
                    {seriesStats.approvedFinance.total}
                  </td>
                  <td className="py-2.5 px-4 text-right text-emerald-700">
                    {seriesStats.transfer.total}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {seriesStats.userSubmit.total +
                      seriesStats.approvedManager.total +
                      seriesStats.approvedFinance.total +
                      seriesStats.transfer.total}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
