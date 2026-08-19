import React from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  AlertTriangle, 
  Sparkles, 
  Loader2, 
  X, 
  ExternalLink, 
  RefreshCw, 
  Monitor, 
  CheckCircle2, 
  XCircle, 
  Camera, 
  User, 
  MapPin, 
  Calendar,
  Layers,
  SearchCheck
} from 'lucide-react';
import { UserActivity, UserProfile } from '../types';

export interface AiRecaptureResult {
  isRecapture: boolean;
  confidence: number;
  verdict: 'AUTHENTIC' | 'SCREEN_RECAPTURE_DETECTED' | 'SUSPICIOUS' | string;
  summary: string;
  indicators: string[];
  reasons?: string;
  recommendation: string;
  checkedAt?: string;
}

interface AiScreenRecaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  activity: UserActivity | null;
  photoUrl: string | null;
  photoFileId?: string | null;
  result: AiRecaptureResult | null;
  isLoading: boolean;
  error: string | null;
  onReanalyze: () => void;
  profiles?: UserProfile[];
}

export const AiScreenRecaptureModal: React.FC<AiScreenRecaptureModalProps> = ({
  isOpen,
  onClose,
  activity,
  photoUrl,
  photoFileId,
  result,
  isLoading,
  error,
  onReanalyze,
  profiles = [],
}) => {
  if (!isOpen || !activity) return null;

  const userProf = profiles?.find(
    (p) => p.email.trim().toLowerCase() === (activity.userEmail || '').trim().toLowerCase()
  );
  const username = userProf?.userId || userProf?.nama || (activity.userEmail ? activity.userEmail.split('@')[0] : 'User');

  const getVerdictStyle = () => {
    if (!result) return { bg: 'bg-slate-50', text: 'text-slate-800', border: 'border-slate-200' };
    const vUpper = String(result.verdict || '').toUpperCase().replace(/[\s_-]+/g, '');
    const isRecapture = result.isRecapture ||
      vUpper.includes('RECAPTURE') ||
      vUpper.includes('FOTOLAYAR') ||
      vUpper.includes('LAYAR') ||
      vUpper.includes('SCREEN') ||
      vUpper.includes('SPOOF') ||
      vUpper.includes('PALSU') ||
      vUpper.includes('FAKE') ||
      vUpper === 'TRUE' ||
      vUpper === '1';

    if (isRecapture) {
      return {
        bg: 'bg-rose-50',
        text: 'text-rose-800',
        border: 'border-rose-300',
        badgeBg: 'bg-rose-600',
        badgeText: 'text-white',
        icon: <ShieldAlert className="w-6 h-6 text-rose-600" />,
        title: 'TERINDIKASI FOTO DARI LAYAR (SCREEN RECAPTURE)',
        desc: 'AI mendeteksi kemungkinan besar foto ini diambil dengan memotret layar monitor, laptop, atau smartphone.',
      };
    }
    if (vUpper.includes('SUSPICIOUS') || vUpper.includes('MENCURIGAKAN') || vUpper.includes('RAGU')) {
      return {
        bg: 'bg-amber-50',
        text: 'text-amber-800',
        border: 'border-amber-300',
        badgeBg: 'bg-amber-600',
        badgeText: 'text-white',
        icon: <AlertTriangle className="w-6 h-6 text-amber-600" />,
        title: 'MEMERLUKAN VERIFIKASI MANUAL (SUSPICIOUS)',
        desc: 'Terdapat anomali visual atau kualitas gambar yang memerlukan konfirmasi visual oleh Administrator.',
      };
    }
    return {
      bg: 'bg-emerald-50',
      text: 'text-emerald-800',
      border: 'border-emerald-300',
      badgeBg: 'bg-emerald-600',
      badgeText: 'text-white',
      icon: <ShieldCheck className="w-6 h-6 text-emerald-600" />,
      title: 'FOTO DIAMBIL LANGSUNG (AUTHENTIC / DIRECT CAPTURE)',
      desc: 'Foto teridentifikasi asli diambil langsung pada objek fisik di lokasi lapangan.',
    };
  };

  const style = getVerdictStyle();

  return (
    <div 
      className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-[1000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="relative max-w-2xl w-full bg-white rounded-3xl overflow-hidden shadow-2xl border border-slate-200 my-auto flex flex-col max-h-[92vh] animate-scale-up"
        onClick={(e) => e.stopPropagation()}
        id="ai-screen-recapture-modal"
      >
        {/* Header Modal */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0 pr-2">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0 shadow-inner">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-display font-bold text-white tracking-tight">
                  AI Screen Recapture / Spoofing
                </h3>
                <span className="text-[9px] font-bold bg-indigo-500/30 text-indigo-200 px-2 py-0.5 rounded-full border border-indigo-400/30 uppercase tracking-wider hidden sm:inline">
                  Forensik Foto
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate mt-0.5">
                Pemeriksaan bukti foto langsung vs foto dari layar monitor / HP
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-xl transition-colors cursor-pointer shrink-0"
            title="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-slate-800">
          {/* Activity Metadata Banner */}
          <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/80 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-4 h-4 text-indigo-600 shrink-0" />
              <div className="truncate">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Site ID</span>
                <span className="font-bold text-slate-800 truncate">{activity.siteId} - {activity.siteName}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <User className="w-4 h-4 text-indigo-600 shrink-0" />
              <div className="truncate">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">User</span>
                <span className="font-bold text-slate-800 truncate block">{username}</span>
                {activity.userEmail && (
                  <span className="text-[10px] text-slate-400 font-mono truncate block">{activity.userEmail}</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <Calendar className="w-4 h-4 text-indigo-600 shrink-0" />
              <div className="truncate">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Tanggal</span>
                <span className="font-semibold text-slate-700">{activity.tanggal}</span>
              </div>
            </div>
          </div>

          {/* Photo & Scan Visualizer Section */}
          <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center min-h-[220px] max-h-[300px]">
            {photoUrl ? (
              <img 
                src={photoUrl} 
                alt="Foto Bukti Kegiatan" 
                className="w-full h-full object-contain max-h-[280px]"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-slate-400 text-xs">
                <Camera className="w-8 h-8 mb-2 opacity-50" />
                <span>Foto bukti tidak tersedia</span>
              </div>
            )}

            {/* Radar Scanning Overlay during Loading */}
            {isLoading && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center z-10 space-y-3">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-2 border-indigo-500/30 flex items-center justify-center animate-ping" />
                  <div className="w-16 h-16 rounded-full border-2 border-indigo-400 flex items-center justify-center absolute inset-0">
                    <SearchCheck className="w-8 h-8 text-indigo-300 animate-pulse" />
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    Sedang Memeriksa Foto Bukti...
                  </h4>
                  <p className="text-[11px] text-slate-300 max-w-xs mt-1 leading-relaxed">
                    AI menganalisis pola garis Moiré, pantulan backlight layar, struktur pixel, dan bingkai perangkat.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && !isLoading && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-xs text-rose-800">
              <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="font-bold block text-rose-900">Gagal Melakukan Analisis AI</span>
                <p className="mt-0.5 text-rose-700 whitespace-pre-line leading-relaxed">{error}</p>
                <button
                  type="button"
                  onClick={onReanalyze}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Coba Lagi</span>
                </button>
              </div>
            </div>
          )}

          {/* Analysis Results Display */}
          {result && !isLoading && (
            <div className="space-y-4">
              {/* Main Verdict Card */}
              <div className={`p-4 sm:p-5 rounded-2xl border ${style.border} ${style.bg} transition-all`}>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-white/80 border border-slate-200/50 shadow-xs shrink-0">
                    {style.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Hasil Analisis Forensik AI
                        </span>
                        {(result.checkedAt || activity.aiRecaptureCheckedAt) && (
                          <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100/90 border border-emerald-300/80 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                            Tersimpan di Database ({result.checkedAt || activity.aiRecaptureCheckedAt})
                          </span>
                        )}
                      </div>
                      <span className={`text-xs font-black px-2.5 py-0.5 rounded-full ${style.badgeBg} ${style.badgeText} shadow-xs`}>
                        {result.confidence}% Keyakinan AI
                      </span>
                    </div>

                    <h4 className="text-sm sm:text-base font-display font-bold text-slate-900 leading-tight">
                      {style.title}
                    </h4>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      {result.summary}
                    </p>
                  </div>
                </div>

                {/* Progress bar confidence */}
                <div className="mt-3.5 pt-3 border-t border-slate-200/60">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 mb-1">
                    <span>Tingkat Kepastian Analisis</span>
                    <span>{result.confidence}%</span>
                  </div>
                  <div className="w-full bg-slate-200/80 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-700 ${
                        result.isRecapture ? 'bg-rose-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.max(10, Math.min(100, result.confidence))}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Forensic Indicators Observed */}
              {result.indicators && result.indicators.length > 0 && (
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <Layers className="w-4 h-4 text-indigo-600" />
                    <span>Indikator Forensik Visual yang Teramati:</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.indicators.map((ind, idx) => (
                      <span 
                        key={idx}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl border ${
                          result.isRecapture 
                            ? 'bg-rose-100/70 border-rose-200 text-rose-900' 
                            : 'bg-emerald-100/70 border-emerald-200 text-emerald-900'
                        }`}
                      >
                        {result.isRecapture ? (
                          <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        )}
                        <span>{ind}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Detailed Reasons & Recommendation */}
              {result.reasons && (
                <div className="p-3.5 bg-white rounded-2xl border border-slate-200 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ulasan Visual AI</span>
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{result.reasons}</p>
                </div>
              )}

              {result.recommendation && (
                <div className="p-3.5 bg-indigo-50/70 rounded-2xl border border-indigo-100 text-xs text-indigo-900 space-y-1">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">Rekomendasi untuk Administrator</span>
                  <p className="font-medium leading-relaxed">{result.recommendation}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onReanalyze}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition-all shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-600 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Sedang Analisis...' : 'Analisis Ulang Foto'}</span>
          </button>

          <div className="flex items-center gap-2">
            {activity.buktiUrl && (
              <a
                href={activity.buktiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer hidden sm:inline-flex"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Foto Asli Drive</span>
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-xs active:scale-95"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
