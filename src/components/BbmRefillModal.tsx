/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { BudgetRequest, UsageReportItem, RequestStatus, ItemStatus, SiteInfo } from '../types';
import { Fuel, Calendar, MapPin, Coins, FileText, Camera, RefreshCw, CheckCircle2, AlertCircle, X, ExternalLink } from 'lucide-react';

interface BbmRefillModalProps {
  userEmail: string;
  managerEmail: string;
  defaultSiteId?: string;
  sites?: SiteInfo[];
  onSubmit: (req: BudgetRequest, reportItem: UsageReportItem) => Promise<void>;
  onClose: () => void;
}

export const BbmRefillModal: React.FC<BbmRefillModalProps> = ({
  userEmail,
  managerEmail,
  defaultSiteId = '',
  sites = [],
  onSubmit,
  onClose
}) => {
  // System date calculation
  const todayDate = new Date();
  const tanggal = todayDate.toISOString().split('T')[0];

  // Helper to format date string "2026-07-22" -> "22 Jul 2026"
  const formatDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const formattedSystemDate = formatDateDisplay(tanggal);

  const [siteId, setSiteId] = useState('');
  const [nominal, setNominal] = useState<string>('');
  const [keterangan, setKeterangan] = useState('Pengisian BBM Duren Sawit');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Parse Site ID and match database (samakan dengan BudgetRequestForm)
  const siteIdRegex = /[A-Za-z]{3}\d{3}/g;
  const regexMatches = siteId.match(siteIdRegex) || [];
  const splitTokens = siteId
    .split(/[,;\s]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  const combinedTokens = Array.from(new Set([...regexMatches.map(m => m.toUpperCase()), ...splitTokens]));
  const parsedIds = combinedTokens.length > 0 ? combinedTokens : (siteId.trim() ? [siteId.trim().toUpperCase()] : []);
  const isMultiple = parsedIds.length > 1;

  const siteResults = parsedIds.map(id => {
    const found = sites.find(s => s.siteId.toUpperCase().trim() === id);
    if (found) {
      return { id, found: true, siteName: found.siteName, coordinates: found.coordinates };
    }
    if (id === 'DUREN-SAWIT') {
      return { id, found: true, siteName: 'Depot / Pos Utama', coordinates: null };
    }
    return { id, found: false, siteName: null, coordinates: null };
  });

  const someFound = siteResults.some(r => r.found);

  // Start Live Camera
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsCameraActive(true);
    } catch (err: any) {
      console.warn('Camera access error:', err);
      setCameraError('Gagal mengakses kamera secara langsung. Silakan gunakan tombol pengambil foto kamera bawaan HP/device.');
      setIsCameraActive(false);
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Capture Photo from Video Stream
  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setPhotoDataUrl(dataUrl);
      stopCamera();
    }
  };

  // Handle camera input file fallback (with capture="environment")
  const handleFileCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setPhotoDataUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Switch camera
  const toggleFacingMode = () => {
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
    if (isCameraActive) {
      stopCamera();
      setTimeout(() => startCamera(), 200);
    }
  };

  // Generate BBM_DurenSawit UID
  const generateBbmUid = () => {
    const todayStr = tanggal.replace(/-/g, '');
    const randomHex = Math.floor(1000 + Math.random() * 9000);
    return `BBM_DurenSawit-${todayStr}-${randomHex}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amount = Number(nominal);
    if (isNaN(amount) || amount <= 0) {
      setError('Nominal pengisian BBM harus lebih besar dari Rp 0.');
      return;
    }

    if (!siteId.trim()) {
      setError('Site ID / Lokasi wajib diisi.');
      return;
    }

    if (!keterangan.trim()) {
      setError('Keterangan pengisian BBM wajib diisi.');
      return;
    }

    if (!photoDataUrl) {
      setError('Foto Nota BBM wajib diambil menggunakan kamera!');
      return;
    }

    setIsSubmitting(true);
    try {
      const uid = generateBbmUid();
      const nowIso = new Date().toISOString();

      // 1. BudgetRequest (Pengajuan) -> Closed status directly
      const req: BudgetRequest = {
        id: uid,
        userEmail,
        managerEmail: managerEmail || userEmail,
        tanggalPemakaian: tanggal,
        siteId: siteId.trim().toUpperCase(),
        jumlahPengajuan: amount,
        keterangan: `[Pengisian BBM Duren Sawit] ${keterangan.trim()}`,
        status: RequestStatus.CLOSED,
        managerActionAmount: amount,
        managerComment: 'Otomatis disetujui & closed oleh sistem BBM Duren Sawit.',
        adminActionAmount: amount,
        createdAt: nowIso
      };

      // 2. UsageReportItem (Laporan) -> Approved directly
      const reportItem: UsageReportItem = {
        id: `REP_BBM_${Date.now()}`,
        requestId: uid,
        tanggalPenggunaan: tanggal,
        nominal: amount,
        keterangan: keterangan.trim(),
        buktiUrl: photoDataUrl,
        buktiFileId: `BBM_NOTA_${Date.now()}`,
        statusManager: ItemStatus.APPROVED,
        managerComment: 'Otomatis terverifikasi sistem BBM Duren Sawit',
        statusAdmin: ItemStatus.APPROVED,
        adminComment: 'Otomatis terverifikasi sistem BBM Duren Sawit',
        updatedAt: nowIso
      };

      await onSubmit(req, reportItem);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan transaksi BBM Duren Sawit.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 my-8 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-md shadow-amber-200">
              <Fuel className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-slate-800 text-base">
                Pengisian BBM
              </h2>
              <p className="text-[11px] text-slate-400 font-medium">
                Duren Sawit
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2.5 text-xs text-red-700 font-medium">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          
          {/* Display Tanggal Pengisian (Sesuai tanggal sistem) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-600 shrink-0" />
              <span className="text-xs font-bold text-slate-800">
                Tanggal Pengisian : <span className="text-indigo-600">{formattedSystemDate}</span>
              </span>
            </div>
          </div>

          {/* Rencana Site ID / Lokasi (Multi-site ID support) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Rencana Site ID / Lokasi
            </label>
            <div className="relative">
              <input
                type="text"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value.toUpperCase())}
                placeholder="SITE-A atau JAB001, JAB002..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none font-bold text-slate-800"
                required
              />
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>

            {/* Site ID Detail Match Info */}
            {parsedIds.length > 0 && (
              isMultiple ? (
                someFound ? (
                  <div className="mt-1.5 p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1.5 animate-slide-up">
                    <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-800">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                      <span>Site Terverifikasi (Multiple)</span>
                    </div>
                    <div className="space-y-1 ml-2.5">
                      {siteResults.map((res, idx) => (
                        <div key={idx} className="text-[10px] flex flex-wrap gap-x-1 items-baseline">
                          <span className="font-mono font-bold text-slate-600">{res.id}:</span>
                          {res.found ? (
                            <span className="text-emerald-700 font-medium">{res.siteName}</span>
                          ) : (
                            <span className="text-rose-500 italic text-[9px] font-semibold">Tidak ditemukan/tidak terdaftar</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-rose-500 font-semibold mt-1.5 ml-1 animate-pulse">
                    * Site ID tidak ditemukan/tidak terdaftar
                  </p>
                )
              ) : (
                siteResults[0]?.found ? (
                  <div className="mt-1.5 p-2 bg-emerald-50 border border-emerald-100 rounded-xl space-y-0.5 animate-slide-up">
                    <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-800">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                      <span>Site Terverifikasi</span>
                    </div>
                    <p className="text-[10px] font-semibold text-slate-700 ml-2.5">
                      Nama: <span className="text-emerald-700">{siteResults[0].siteName}</span>
                    </p>
                    {siteResults[0].coordinates && (
                      <p className="text-[9px] text-slate-500 font-mono ml-2.5 flex items-center gap-1">
                        Koord:{" "}
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteResults[0].coordinates.trim())}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-0.5 transition-colors"
                          title="Buka di Google Maps"
                        >
                          <span>{siteResults[0].coordinates}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-rose-500 font-semibold mt-1.5 ml-1 animate-pulse">
                    * Site ID tidak ditemukan/tidak terdaftar
                  </p>
                )
              )
            )}
          </div>

          {/* Nominal */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-amber-600" />
              <span>Nominal Pengisian (Rp)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                Rp
              </span>
              <input
                type="number"
                min="1000"
                step="1000"
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                placeholder="0"
                required
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
              />
            </div>
            {nominal && Number(nominal) > 0 && (
              <p className="text-[10px] text-indigo-600 font-bold mt-1">
                Total Nominal: Rp {Number(nominal).toLocaleString('id-ID')}
              </p>
            )}
          </div>

          {/* Keterangan */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Keterangan Pengisian BBM</span>
            </label>
            <input
              type="text"
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder="Keterangan pengisian BBM Duren Sawit..."
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
            />
          </div>

          {/* Photo Nota BBM (Kamera) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-amber-600" />
                <span>Photo Nota BBM (Hanya Kamera)</span>
              </span>
              {photoDataUrl && (
                <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Foto Terverifikasi
                </span>
              )}
            </label>

            {/* Hidden native input with capture="environment" for direct mobile camera access */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileCapture}
              className="hidden"
            />

            {/* Photo Captured Preview */}
            {photoDataUrl ? (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 group">
                <img
                  src={photoDataUrl}
                  alt="Nota BBM"
                  className="w-full h-48 object-cover"
                />
                <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoDataUrl(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="px-3.5 py-1.5 bg-white/90 hover:bg-white text-slate-800 font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                    Ambil Foto Ulang
                  </button>
                </div>
              </div>
            ) : isCameraActive ? (
              /* Live Camera Stream Container */
              <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-52 object-cover"
                />
                
                {/* Camera Overlay Controls */}
                <div className="absolute bottom-3 inset-x-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={toggleFacingMode}
                    className="p-2 bg-slate-900/80 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all backdrop-blur-xs border border-white/10"
                    title="Ganti Kamera"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    Ambil Foto Nota
                  </button>

                  <button
                    type="button"
                    onClick={stopCamera}
                    className="p-2 bg-slate-900/80 hover:bg-slate-900 text-red-400 rounded-xl text-xs font-bold transition-all backdrop-blur-xs border border-white/10"
                    title="Tutup Kamera"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              /* Initial Camera Trigger Options - Clickable Card */
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-amber-300/80 hover:border-amber-500 bg-amber-50/50 hover:bg-amber-50/90 rounded-2xl p-6 text-center cursor-pointer transition-all active:scale-[0.99] group"
              >
                <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 mx-auto flex items-center justify-center mb-2.5 shadow-xs group-hover:scale-105 group-hover:bg-amber-500 group-hover:text-white transition-all">
                  <Camera className="w-6 h-6" />
                </div>
                <p className="text-xs font-bold text-slate-800 group-hover:text-amber-900 transition-colors">
                  Ambil Foto Nota BBM
                </p>

                {cameraError && (
                  <p className="text-[10px] text-amber-700 font-medium mt-2 leading-relaxed">
                    {cameraError}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !photoDataUrl}
              className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-xs rounded-xl shadow-md shadow-amber-200/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Memproses Transaksi...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Simpan Transaksi BBM</span>
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
