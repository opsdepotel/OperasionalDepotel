import React, { useMemo, useState } from 'react';
import {
  Timer,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Download,
  ArrowUpDown,
  Search,
  BarChart3,
  Users,
  AlertCircle
} from 'lucide-react';
import type { ResponseTimeRow } from './AdminResponseTimeModal';

interface ResponseTimeTransferToReportViewProps {
  rows: ResponseTimeRow[];
  filterSummary: {
    divisi: string;
    subDivisi: string;
    monthLabel: string;
    year: string;
  };
}

export function formatDurationIndonesian(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined || isNaN(totalMinutes)) return '-';
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins === 0) return '< 1 mnt';
  if (mins < 60) return `${mins} mnt`;

  const totalHours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (totalHours < 24) {
    return remMins > 0 ? `${totalHours} jam ${remMins} mnt` : `${totalHours} jam`;
  }

  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days} hari ${remHours} jam` : `${days} hari`;
}

export function getResponseTimeBadgeTone(minutes: number): string {
  if (minutes <= 1440) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (minutes <= 4320) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

interface DurationBucket {
  id: string;
  label: string;
  subLabel: string;
  count: number;
  barClass: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
}

interface UserResponseSummary {
  email: string;
  nama: string;
  divisi: string;
  subDivisi: string;
  transferredCount: number;
  reportedCount: number;
  waitingCount: number;
  avgMinutes: number | null;
  minMinutes: number | null;
  maxMinutes: number | null;
}

export const ResponseTimeTransferToReportView: React.FC<ResponseTimeTransferToReportViewProps> = ({
  rows,
  filterSummary
}) => {
  const [userSearch, setUserSearch] = useState('');
  const [sortBy, setSortBy] = useState<'slowest' | 'fastest' | 'waiting' | 'volume'>('slowest');

  const analytics = useMemo(() => {
    const transferredRows = rows.filter((r) => r.transferDate !== null);
    const reportedRows = transferredRows.filter(
      (r) => r.transferToFirstReportMinutes !== null && r.firstReportDate !== null
    );
    const waitingRows = transferredRows.filter((r) => r.isWaitingReport);

    const durations = reportedRows
      .map((r) => r.transferToFirstReportMinutes!)
      .sort((a, b) => a - b);

    const totalMinutes = durations.reduce((acc, v) => acc + v, 0);
    const avgMinutes = durations.length > 0 ? Math.round(totalMinutes / durations.length) : null;
    const medianMinutes =
      durations.length > 0
        ? durations.length % 2 === 1
          ? durations[Math.floor(durations.length / 2)]
          : Math.round((durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2)
        : null;

    let fastestRow: ResponseTimeRow | null = null;
    let slowestRow: ResponseTimeRow | null = null;
    reportedRows.forEach((r) => {
      const m = r.transferToFirstReportMinutes!;
      if (!fastestRow || m < fastestRow.transferToFirstReportMinutes!) {
        fastestRow = r;
      }
      if (!slowestRow || m > slowestRow.transferToFirstReportMinutes!) {
        slowestRow = r;
      }
    });

    const buckets: DurationBucket[] = [
      {
        id: 'lt1h',
        label: '< 1 Jam',
        subLabel: 'Sangat Cepat',
        count: 0,
        barClass: 'bg-emerald-500',
        textClass: 'text-emerald-700',
        bgClass: 'bg-emerald-50',
        borderClass: 'border-emerald-200'
      },
      {
        id: '1to6h',
        label: '1 – 6 Jam',
        subLabel: 'Cepat',
        count: 0,
        barClass: 'bg-teal-500',
        textClass: 'text-teal-700',
        bgClass: 'bg-teal-50',
        borderClass: 'border-teal-200'
      },
      {
        id: '6to24h',
        label: '6 – 24 Jam',
        subLabel: 'Hari yang Sama / ≤ 1 Hari',
        count: 0,
        barClass: 'bg-blue-500',
        textClass: 'text-blue-700',
        bgClass: 'bg-blue-50',
        borderClass: 'border-blue-200'
      },
      {
        id: '1to3d',
        label: '1 – 3 Hari',
        subLabel: 'Sedang',
        count: 0,
        barClass: 'bg-amber-500',
        textClass: 'text-amber-700',
        bgClass: 'bg-amber-50',
        borderClass: 'border-amber-200'
      },
      {
        id: '3to7d',
        label: '3 – 7 Hari',
        subLabel: 'Lambat',
        count: 0,
        barClass: 'bg-orange-500',
        textClass: 'text-orange-700',
        bgClass: 'bg-orange-50',
        borderClass: 'border-orange-200'
      },
      {
        id: 'gt7d',
        label: '> 7 Hari',
        subLabel: 'Perlu Perhatian',
        count: 0,
        barClass: 'bg-rose-500',
        textClass: 'text-rose-700',
        bgClass: 'bg-rose-50',
        borderClass: 'border-rose-200'
      }
    ];

    reportedRows.forEach((r) => {
      const m = r.transferToFirstReportMinutes!;
      if (m < 60) buckets[0].count += 1;
      else if (m < 360) buckets[1].count += 1;
      else if (m <= 1440) buckets[2].count += 1;
      else if (m <= 4320) buckets[3].count += 1;
      else if (m <= 10080) buckets[4].count += 1;
      else buckets[5].count += 1;
    });

    const maxBucketCount = Math.max(1, ...buckets.map((b) => b.count));

    // Aggregate per user
    const userMap = new Map<
      string,
      {
        email: string;
        nama: string;
        divisi: string;
        subDivisi: string;
        transferredCount: number;
        waitingCount: number;
        durations: number[];
      }
    >();

    transferredRows.forEach((r) => {
      const key = (r.userEmail || r.pemohonNama || 'unknown').toLowerCase().trim();
      if (!userMap.has(key)) {
        userMap.set(key, {
          email: r.userEmail,
          nama: r.pemohonNama,
          divisi: r.divisi,
          subDivisi: r.subDivisi,
          transferredCount: 0,
          waitingCount: 0,
          durations: []
        });
      }
      const entry = userMap.get(key)!;
      entry.transferredCount += 1;
      if (r.isWaitingReport) {
        entry.waitingCount += 1;
      }
      if (r.transferToFirstReportMinutes !== null && r.firstReportDate !== null) {
        entry.durations.push(r.transferToFirstReportMinutes);
      }
    });

    const userSummaries: UserResponseSummary[] = Array.from(userMap.values()).map((u) => {
      const count = u.durations.length;
      const sum = u.durations.reduce((a, b) => a + b, 0);
      return {
        email: u.email,
        nama: u.nama,
        divisi: u.divisi,
        subDivisi: u.subDivisi,
        transferredCount: u.transferredCount,
        reportedCount: count,
        waitingCount: u.waitingCount,
        avgMinutes: count > 0 ? Math.round(sum / count) : null,
        minMinutes: count > 0 ? Math.min(...u.durations) : null,
        maxMinutes: count > 0 ? Math.max(...u.durations) : null
      };
    });

    const compliancePct =
      transferredRows.length > 0
        ? Math.round((reportedRows.length / transferredRows.length) * 100)
        : 0;

    return {
      transferredCount: transferredRows.length,
      reportedCount: reportedRows.length,
      waitingCount: waitingRows.length,
      compliancePct,
      avgMinutes,
      medianMinutes,
      fastestRow: fastestRow as ResponseTimeRow | null,
      slowestRow: slowestRow as ResponseTimeRow | null,
      buckets,
      maxBucketCount,
      userSummaries
    };
  }, [rows]);

  const sortedUsers = useMemo(() => {
    const q = userSearch.toLowerCase().trim();
    const list = q
      ? analytics.userSummaries.filter(
          (u) =>
            u.nama.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            u.divisi.toLowerCase().includes(q) ||
            u.subDivisi.toLowerCase().includes(q)
        )
      : [...analytics.userSummaries];

    list.sort((a, b) => {
      if (sortBy === 'slowest') {
        const aVal = a.avgMinutes ?? -1;
        const bVal = b.avgMinutes ?? -1;
        if (bVal !== aVal) return bVal - aVal;
        return b.waitingCount - a.waitingCount;
      }
      if (sortBy === 'fastest') {
        const aVal = a.avgMinutes ?? Number.MAX_SAFE_INTEGER;
        const bVal = b.avgMinutes ?? Number.MAX_SAFE_INTEGER;
        if (aVal !== bVal) return aVal - bVal;
        return b.reportedCount - a.reportedCount;
      }
      if (sortBy === 'waiting') {
        if (b.waitingCount !== a.waitingCount) return b.waitingCount - a.waitingCount;
        return (b.avgMinutes ?? -1) - (a.avgMinutes ?? -1);
      }
      return b.transferredCount - a.transferredCount;
    });

    return list;
  }, [analytics.userSummaries, userSearch, sortBy]);

  const handleExportPerUserCsv = () => {
    if (sortedUsers.length === 0) return;

    const headers = [
      'No',
      'Nama Pemohon',
      'Email',
      'Divisi',
      'Sub Divisi',
      'UID Ditransfer',
      'Sudah Lapor',
      'Belum Lapor',
      'Rata-rata Response Time',
      'Rata-rata (Menit)',
      'Tercepat',
      'Terlama'
    ];

    const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;

    const csvRows = sortedUsers.map((u, idx) =>
      [
        idx + 1,
        escapeCsv(u.nama),
        escapeCsv(u.email),
        escapeCsv(u.divisi),
        escapeCsv(u.subDivisi),
        u.transferredCount,
        u.reportedCount,
        u.waitingCount,
        escapeCsv(formatDurationIndonesian(u.avgMinutes)),
        u.avgMinutes ?? '',
        escapeCsv(formatDurationIndonesian(u.minMinutes)),
        escapeCsv(formatDurationIndonesian(u.maxMinutes))
      ].join(',')
    );

    const csvString = '\uFEFF' + [headers.join(','), ...csvRows].join('\r\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    const safePeriod = `${filterSummary.monthLabel}_${filterSummary.year}`.replace(/\s+/g, '_');
    link.setAttribute('href', url);
    link.setAttribute('download', `Response_Time_Transfer_ke_Lapor_${safePeriod}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (analytics.transferredCount === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-14 text-center text-slate-400 shadow-sm">
        <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="font-semibold text-slate-600 text-sm">
          Belum ada UID OP- yang sudah ditransfer pada filter yang dipilih.
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Sesuaikan filter Divisi, Sub Divisi, Bulan, atau Tahun untuk menganalisis Response Time Transfer ke Lapor Pertama User.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-indigo-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">
              Rata-rata Response Time
            </span>
            <Timer className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-xl font-black font-mono text-slate-900">
            {formatDurationIndonesian(analytics.avgMinutes)}
          </div>
          <p className="text-[10px] text-slate-500">
            Dari <strong>{analytics.reportedCount}</strong> UID yang sudah melapor
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-teal-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-teal-700 uppercase tracking-wider">
              Median Response Time
            </span>
            <Zap className="w-4 h-4 text-teal-500" />
          </div>
          <div className="text-xl font-black font-mono text-slate-900">
            {formatDurationIndonesian(analytics.medianMinutes)}
          </div>
          <p className="text-[10px] text-slate-500">
            Nilai tengah (stabil terhadap outlier)
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Tercepat &amp; Terlama
            </span>
            <BarChart3 className="w-4 h-4 text-slate-400" />
          </div>
          <div className="space-y-1 pt-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Tercepat:</span>
              <span
                className="font-mono font-bold text-emerald-700"
                title={analytics.fastestRow ? `${analytics.fastestRow.id} (${analytics.fastestRow.pemohonNama})` : undefined}
              >
                {formatDurationIndonesian(analytics.fastestRow?.transferToFirstReportMinutes)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Terlama:</span>
              <span
                className="font-mono font-bold text-rose-700"
                title={analytics.slowestRow ? `${analytics.slowestRow.id} (${analytics.slowestRow.pemohonNama})` : undefined}
              >
                {formatDurationIndonesian(analytics.slowestRow?.transferToFirstReportMinutes)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
              Kepatuhan Pelaporan
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black font-mono text-slate-900">
              {analytics.compliancePct}%
            </span>
            <span className="text-[11px] font-semibold text-emerald-700">
              ({analytics.reportedCount}/{analytics.transferredCount})
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">Belum Lapor:</span>
            <span
              className={`font-mono font-bold ${
                analytics.waitingCount > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              {analytics.waitingCount} UID
            </span>
          </div>
        </div>
      </div>

      {/* Distribution Bar Chart Card */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Timer className="w-4 h-4 text-indigo-600" />
              <span>Distribusi Response Time: Finance Transfer &rarr; Lapor Pertama User</span>
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Divisi: <strong className="text-slate-700">{filterSummary.divisi}</strong> &bull; Sub Divisi:{' '}
              <strong className="text-slate-700">{filterSummary.subDivisi}</strong> &bull; Periode:{' '}
              <strong className="text-slate-700">
                {filterSummary.monthLabel}, {filterSummary.year}
              </strong>
            </p>
          </div>
          {analytics.waitingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{analytics.waitingCount} UID Ditransfer Belum Lapor</span>
            </span>
          )}
        </div>

        <div className="space-y-3">
          {analytics.buckets.map((bucket) => {
            const pctOfReported =
              analytics.reportedCount > 0
                ? ((bucket.count / analytics.reportedCount) * 100).toFixed(1)
                : '0.0';
            const barWidthPct =
              bucket.count > 0 ? Math.max(3, (bucket.count / analytics.maxBucketCount) * 100) : 0;

            return (
              <div key={bucket.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`font-mono font-bold px-2 py-0.5 rounded-md border text-[11px] shrink-0 ${bucket.bgClass} ${bucket.textClass} ${bucket.borderClass}`}
                    >
                      {bucket.label}
                    </span>
                    <span className="text-[11px] text-slate-500 truncate">{bucket.subLabel}</span>
                  </div>
                  <div className="font-mono font-bold text-slate-800 shrink-0 text-xs">
                    {bucket.count} UID{' '}
                    <span className="text-[10px] font-normal text-slate-400">
                      ({pctOfReported}%)
                    </span>
                  </div>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${bucket.barClass}`}
                    style={{ width: `${barWidthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-User Average Response Time Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-4 h-4 text-indigo-600" />
              <span>Rekap Response Time Per Pemohon (Transfer &rarr; Lapor Pertama)</span>
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Rata-rata jeda waktu mulai dari dana ditransfer Finance hingga user mengunggah item laporan pertamanya.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Cari pemohon..."
                className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-44"
              />
            </div>

            <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
              >
                <option value="slowest">Urut: Rata-rata Terlama</option>
                <option value="fastest">Urut: Rata-rata Tercepat</option>
                <option value="waiting">Urut: Terbanyak Belum Lapor</option>
                <option value="volume">Urut: Terbanyak Ditransfer</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleExportPerUserCsv}
              disabled={sortedUsers.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all cursor-pointer shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs min-w-[780px]">
            <thead className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 w-12 text-center">No</th>
                <th className="py-3 px-4">Pemohon &amp; Divisi</th>
                <th className="py-3 px-4 text-center">Ditransfer</th>
                <th className="py-3 px-4 text-center">Sudah Lapor</th>
                <th className="py-3 px-4 text-center">Belum Lapor</th>
                <th className="py-3 px-4 text-center">Rata-rata Response</th>
                <th className="py-3 px-4 text-center">Tercepat</th>
                <th className="py-3 px-4 text-center">Terlama</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    Tidak ada pemohon yang cocok dengan pencarian.
                  </td>
                </tr>
              ) : (
                sortedUsers.map((u, idx) => (
                  <tr key={u.email || idx} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 text-center font-mono text-slate-400">{idx + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-800">{u.nama}</div>
                      <div className="text-[10px] text-slate-500">
                        <span className="font-semibold text-indigo-600">{u.divisi}</span>
                        {u.subDivisi && u.subDivisi !== '-' && <span> &bull; {u.subDivisi}</span>}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-semibold text-slate-700">
                      {u.transferredCount}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-semibold text-emerald-700">
                      {u.reportedCount}
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                      {u.waitingCount > 0 ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[11px]">
                          {u.waitingCount}
                        </span>
                      ) : (
                        <span className="text-slate-300">0</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {u.avgMinutes !== null ? (
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg border font-mono font-bold text-[11px] ${getResponseTimeBadgeTone(
                            u.avgMinutes
                          )}`}
                        >
                          {formatDurationIndonesian(u.avgMinutes)}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-emerald-700 font-medium">
                      {formatDurationIndonesian(u.minMinutes)}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-rose-700 font-medium">
                      {formatDurationIndonesian(u.maxMinutes)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
