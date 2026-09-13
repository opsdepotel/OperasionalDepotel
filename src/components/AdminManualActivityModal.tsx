import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { UserProfile, SiteInfo, Role } from '../types';
import { useBackHandler } from '../hooks/useBackHandler';
import { formatDivisiSubDivisi } from '../lib/googleApi';
import {
  X,
  Calendar,
  Clock,
  MapPin,
  User,
  Camera,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  ShieldCheck,
  Search,
  Sparkles,
  Info
} from 'lucide-react';

export interface ManualActivitySubmitData {
  userEmail: string;
  targetUserNama: string;
  tanggal: string; // YYYY-MM-DD
  jam: string;     // HH:mm
  siteId: string;
  siteName: string;
  coordinatesDb: string;
  coordinatesActual: string;
  keterangan: string;
  alasanSusulan: string;
}

interface AdminManualActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: UserProfile[];
  sites: SiteInfo[];
  currentAdminEmail: string;
  onSubmitManualActivity: (data: ManualActivitySubmitData, photoFile: File) => Promise<void>;
}

export const AdminManualActivityModal: React.FC<AdminManualActivityModalProps> = ({
  isOpen,
  onClose,
  profiles,
  sites,
  currentAdminEmail,
  onSubmitManualActivity
}) => {
  useBackHandler(isOpen, onClose, 'adminManualActivityModal');

  const getTodayStr = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const getCurrentTimeStr = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${h}:${min}`;
  };

  // Form State
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>('');
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [tanggal, setTanggal] = useState<string>(getTodayStr());
  const [jam, setJam] = useState<string>(getCurrentTimeStr());
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [customSiteName, setCustomSiteName] = useState<string>('');
  const [customCoordinates, setCustomCoordinates] = useState<string>('');
  const [showSiteSuggestions, setShowSiteSuggestions] = useState<boolean>(false);
  const [keterangan, setKeterangan] = useState<string>('');
  const [alasanCategory, setAlasanCategory] = useState<string>('Lupa input pada saat kegiatan');
  const [alasanDetail, setAlasanDetail] = useState<string>('');
  
  // File & Watermark State
  const [rawPhotoFile, setRawPhotoFile] = useState<File | null>(null);
  const [watermarkedFile, setWatermarkedFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [isProcessingWatermark, setIsProcessingWatermark] = useState<boolean>(false);

  // Status State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const siteContainerRef = useRef<HTMLDivElement>(null);
  const lastMatchedSiteIdRef = useRef<string | null>(null);

  // Filtered profiles for searchable picker
  const activeProfiles = useMemo(() => {
    return profiles.filter(p => p.email && p.email.trim().length > 0);
  }, [profiles]);

  const selectedProfile = useMemo(() => {
    return activeProfiles.find(p => p.email.toLowerCase() === selectedUserEmail.toLowerCase()) || null;
  }, [activeProfiles, selectedUserEmail]);

  // Match site from master database based on input LOKASI / Site ID
  const matchedSite = useMemo(() => {
    const trimmed = selectedSiteId.trim().toUpperCase();
    if (!trimmed) return null;
    return sites.find(s => s.siteId.trim().toUpperCase() === trimmed) || null;
  }, [sites, selectedSiteId]);

  // Auto populate site name and coordinates when a matching site is found in database
  useEffect(() => {
    if (matchedSite) {
      if (lastMatchedSiteIdRef.current !== matchedSite.siteId) {
        lastMatchedSiteIdRef.current = matchedSite.siteId;
        setCustomSiteName(matchedSite.siteName || '');
        setCustomCoordinates(matchedSite.coordinates || '');
      }
    } else {
      lastMatchedSiteIdRef.current = null;
    }
  }, [matchedSite]);

  // Live top matching suggestions from master database when typing in Site ID input
  const matchingSuggestions = useMemo(() => {
    const q = selectedSiteId.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    if (matchedSite && matchedSite.siteId.toLowerCase() === q) return [];

    const results: SiteInfo[] = [];
    const seen = new Set<string>();
    for (const s of sites) {
      if (!s.siteId) continue;
      const key = s.siteId.toUpperCase();
      if (seen.has(key)) continue;
      if (s.siteId.toLowerCase().includes(q) || (s.siteName && s.siteName.toLowerCase().includes(q))) {
        seen.add(key);
        results.push(s);
        if (results.length >= 6) break;
      }
    }
    return results;
  }, [sites, selectedSiteId, matchedSite]);

  const handleSiteInputChange = (val: string) => {
    setSelectedSiteId(val);
    setShowSiteSuggestions(true);
    const trimmed = val.trim().toUpperCase();
    if (trimmed) {
      const found = sites.find(s => s.siteId.trim().toUpperCase() === trimmed);
      if (found) {
        setCustomSiteName(found.siteName || '');
        setCustomCoordinates(found.coordinates || '');
      }
    }
  };

  const handleSelectSuggestion = (site: SiteInfo) => {
    setSelectedSiteId(site.siteId);
    setCustomSiteName(site.siteName || '');
    setCustomCoordinates(site.coordinates || '');
    setShowSiteSuggestions(false);
  };

  // Close site suggestions on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (siteContainerRef.current && !siteContainerRef.current.contains(e.target as Node)) {
        setShowSiteSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Canvas Watermark Generator for Manual Admin Entry
  const generateManualWatermark = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(file);
              return;
            }

            // Downscale image if dimensions exceed MAX_DIMENSION (1600px)
            const MAX_DIMENSION = 1600;
            let targetWidth = img.width;
            let targetHeight = img.height;

            if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
              if (targetWidth > targetHeight) {
                targetHeight = Math.round((targetHeight * MAX_DIMENSION) / targetWidth);
                targetWidth = MAX_DIMENSION;
              } else {
                targetWidth = Math.round((targetWidth * MAX_DIMENSION) / targetHeight);
                targetHeight = MAX_DIMENSION;
              }
            }

            canvas.width = targetWidth;
            canvas.height = targetHeight;

            // Draw original image
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

            // Calculate font size
            const minDimension = Math.min(targetWidth, targetHeight);
            const fontSize = Math.max(14, Math.floor(minDimension * 0.034));
            ctx.font = `bold ${fontSize}px sans-serif`;

            // Format date for watermark
            const months = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
            const tglParts = tanggal.split('-');
            let tglFormatted = tanggal;
            if (tglParts.length === 3) {
              const y = tglParts[0];
              const mIdx = parseInt(tglParts[1], 10) - 1;
              const d = parseInt(tglParts[2], 10);
              tglFormatted = `${d} ${months[mIdx] || tglParts[1]} ${y}`;
            }

            const userNameStr = selectedProfile ? `${selectedProfile.nama || selectedProfile.email}` : selectedUserEmail;
            const userDivisiStr = selectedProfile ? formatDivisiSubDivisi(selectedProfile.divisi, selectedProfile.subDivisi) : '-';
            const siteTitle = selectedSiteId ? `${selectedSiteId} - ${customSiteName || selectedSiteId}` : 'SITE TIDAK DITENTUKAN';
            const locationStr = customCoordinates ? `KOORDINAT: ${customCoordinates}` : 'KOORDINAT: Sesuai Master Site';
            const nowTimeStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

            const textLines = [
              '[MANUAL ACTIVITY REPORT - ADMINISTRATOR]',
              `USER: ${userNameStr} (${userDivisiStr})`,
              `SITE: ${siteTitle}`,
              locationStr,
              `WAKTU KEGIATAN: ${jam} - ${tglFormatted}`,
              `INPUT SUSULAN ADMIN: ${currentAdminEmail} (${nowTimeStr})`
            ];

            // Spacing config
            const marginX = fontSize;
            const lineHeight = fontSize * 1.35;
            const totalHeight = textLines.length * lineHeight;
            const marginY = fontSize * 1.2;

            // Calculate width for background box
            let maxLineWidth = 0;
            textLines.forEach(line => {
              const width = ctx.measureText(line).width;
              if (width > maxLineWidth) maxLineWidth = width;
            });

            // Translucent dark box
            ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
            ctx.fillRect(
              marginX - 12,
              marginY,
              maxLineWidth + 28,
              totalHeight + fontSize * 0.5 + 6
            );

            // Indigo-Cyan accent bar
            ctx.fillStyle = '#6366f1'; // Indigo-500
            ctx.fillRect(
              marginX - 12,
              marginY,
              4,
              totalHeight + fontSize * 0.5 + 6
            );

            // Draw text lines
            textLines.forEach((line, index) => {
              const textY = marginY + fontSize + (index * lineHeight);
              if (index === 0) {
                ctx.fillStyle = '#38bdf8'; // Sky-400 for Admin Header
              } else if (index === 1) {
                ctx.fillStyle = '#fde047'; // Yellow-300 for User
              } else if (index === textLines.length - 1) {
                ctx.fillStyle = '#cbd5e1'; // Slate-300 for Admin audit footer
              } else {
                ctx.fillStyle = '#ffffff'; // White for details
              }
              ctx.fillText(line, marginX + 4, textY);
            });

            // Output compressed JPEG
            canvas.toBlob((blob) => {
              if (blob) {
                const finalFile = new File([blob], `manual_act_${Date.now()}.jpg`, { type: 'image/jpeg' });
                resolve(finalFile);
              } else {
                resolve(file);
              }
            }, 'image/jpeg', 0.84);
          } catch (e) {
            console.error('Failed to apply watermark to manual entry image:', e);
            resolve(file);
          }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  // Re-generate watermark when key fields change
  useEffect(() => {
    let isCancelled = false;
    if (!rawPhotoFile) {
      setWatermarkedFile(null);
      setPhotoPreviewUrl(null);
      return;
    }

    const runWatermark = async () => {
      setIsProcessingWatermark(true);
      try {
        const wm = await generateManualWatermark(rawPhotoFile);
        if (!isCancelled) {
          setWatermarkedFile(wm);
          const reader = new FileReader();
          reader.onloadend = () => {
            if (!isCancelled) {
              setPhotoPreviewUrl(reader.result as string);
            }
          };
          reader.readAsDataURL(wm);
        }
      } catch (err) {
        console.error('Error watermarking file:', err);
      } finally {
        if (!isCancelled) {
          setIsProcessingWatermark(false);
        }
      }
    };

    runWatermark();
    return () => {
      isCancelled = true;
    };
  }, [rawPhotoFile, selectedUserEmail, selectedSiteId, customSiteName, customCoordinates, tanggal, jam]);

  // Handle Photo selection
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setRawPhotoFile(file);
      setErrorMsg(null);
    }
  };

  // Handle Drag and Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        setRawPhotoFile(file);
        setErrorMsg(null);
      } else {
        setErrorMsg('File yang diunggah harus berupa gambar (JPG, PNG, WEBP).');
      }
    }
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Validation
    if (!selectedUserEmail.trim()) {
      setErrorMsg('Pilih pengguna (staf pelaksana kegiatan) terlebih dahulu.');
      return;
    }
    if (!tanggal.trim()) {
      setErrorMsg('Tanggal kegiatan wajib ditentukan.');
      return;
    }
    if (!selectedSiteId.trim()) {
      setErrorMsg('Pilih atau masukkan Site ID kegiatan.');
      return;
    }
    if (!keterangan.trim()) {
      setErrorMsg('Uraian keterangan kegiatan wajib diisi.');
      return;
    }
    if (!watermarkedFile && !rawPhotoFile) {
      setErrorMsg('Foto bukti kegiatan wajib diunggah.');
      return;
    }

    const finalAlasan = alasanCategory === 'Lainnya'
      ? (alasanDetail.trim() || 'Input susulan oleh Administrator')
      : (alasanDetail.trim() ? `${alasanCategory}: ${alasanDetail.trim()}` : alasanCategory);

    const fileToUpload = watermarkedFile || rawPhotoFile!;

    setIsSubmitting(true);
    try {
      await onSubmitManualActivity(
        {
          userEmail: selectedUserEmail.trim(),
          targetUserNama: selectedProfile?.nama || selectedUserEmail,
          tanggal,
          jam: jam || '12:00',
          siteId: selectedSiteId.trim().toUpperCase(),
          siteName: (customSiteName || selectedSiteId).trim(),
          coordinatesDb: customCoordinates.trim(),
          coordinatesActual: `[MANUAL ADMIN] ${customCoordinates.trim() || 'Koordinat Master Site'}`,
          keterangan: keterangan.trim(),
          alasanSusulan: finalAlasan
        },
        fileToUpload
      );

      setSuccessMsg(`Manual Activity Report untuk ${selectedProfile?.nama || selectedUserEmail} pada tanggal ${tanggal} berhasil disimpan!`);
      
      // Auto close after brief notice
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      console.error('Failed to submit manual activity:', err);
      setErrorMsg(err.message || 'Gagal menyimpan Manual Activity Report ke server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        id="modal-admin-manual-activity"
        className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-5 flex items-center justify-between shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/30 border border-indigo-400/40 text-indigo-300 flex items-center justify-center shrink-0 shadow-xs">
              <ShieldCheck className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-base sm:text-lg text-white tracking-tight">
                  Manual Activity Report
                </h2>
                <span className="text-[10px] font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/40 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Admin Exclusive
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                Input susulan foto & log kegiatan harian untuk pengguna yang berhalangan atau lupa mengambil data di lapangan.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
            title="Tutup Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
          
          {/* Alerts */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800 animate-fade-in">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-800 animate-fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium leading-relaxed">{successMsg}</div>
            </div>
          )}

          {/* Banner Audit Trail */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 flex items-start gap-3">
            <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-600 leading-relaxed">
              <strong className="text-slate-800 font-semibold block">Prinsip Audit & Transparansi:</strong>
              Laporan yang diinput secara manual oleh Administrator akan secara otomatis diberi tanda watermark khusus dan dicatat dalam audit trail sistem dengan status resmi input susulan.
            </div>
          </div>

          {/* Section 1: Target Pengguna */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
              <User className="w-3.5 h-3.5 text-indigo-600" />
              <span>Pilih Pengguna / Staf Lapangan <span className="text-rose-500">*</span></span>
            </label>
            
            {/* Searchable User Selector */}
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Cari nama atau email pengguna..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                />
              </div>

              <select
                value={selectedUserEmail}
                onChange={(e) => setSelectedUserEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs font-semibold border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                required
                id="manual-user-select"
              >
                <option value="">-- Pilih Staf Pengguna --</option>
                {(() => {
                  const seenEmails = new Set<string>();
                  return activeProfiles
                    .filter(p => {
                      if (!p.email || !p.email.trim()) return false;
                      const cleanEmail = p.email.trim().toLowerCase();
                      if (seenEmails.has(cleanEmail)) return false;
                      seenEmails.add(cleanEmail);
                      if (!userSearchQuery.trim()) return true;
                      const q = userSearchQuery.toLowerCase();
                      return (
                        (p.nama && p.nama.toLowerCase().includes(q)) ||
                        cleanEmail.includes(q) ||
                        (p.divisi && p.divisi.toLowerCase().includes(q))
                      );
                    })
                    .map((p, idx) => {
                      const divStr = formatDivisiSubDivisi(p.divisi, p.subDivisi);
                      return (
                        <option key={`${p.email}_${idx}`} value={p.email}>
                          {p.nama || p.userId || p.email} ({p.email}) - {divStr !== '-' ? divStr : p.role}
                        </option>
                      );
                    });
                })()}
              </select>
            </div>

            {/* Selected User Detail Card */}
            {selectedProfile && (
              <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <span className="font-bold text-slate-900 block truncate">{selectedProfile.nama || selectedProfile.email}</span>
                  <span className="text-[11px] text-slate-500 block truncate">{selectedProfile.email}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-bold text-indigo-700 bg-white border border-indigo-200 px-2 py-0.5 rounded-md">
                    {formatDivisiSubDivisi(selectedProfile.divisi, selectedProfile.subDivisi)}
                  </span>
                  <span className="text-[10px] font-bold text-slate-700 bg-slate-200/80 px-2 py-0.5 rounded-md">
                    {selectedProfile.role}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Tanggal & Waktu Pelaksanaan */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                <span>Tanggal Kegiatan <span className="text-rose-500">*</span></span>
              </label>
              <input
                type="date"
                value={tanggal}
                max={getTodayStr()}
                onChange={(e) => setTanggal(e.target.value)}
                className="w-full px-3.5 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                required
                id="manual-tanggal-input"
              />
              <span className="text-[10px] text-slate-400 block">Dapat memilih tanggal mundur saat kegiatan berlangsung.</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
                <Clock className="w-3.5 h-3.5 text-indigo-600" />
                <span>Waktu / Jam Kegiatan <span className="text-rose-500">*</span></span>
              </label>
              <input
                type="time"
                value={jam}
                onChange={(e) => setJam(e.target.value)}
                className="w-full px-3.5 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                required
                id="manual-jam-input"
              />
              <span className="text-[10px] text-slate-400 block">Perkiraan waktu kegiatan riil di lapangan.</span>
            </div>
          </div>

          {/* Section 3: Lokasi / Site ID */}
          <div className="space-y-2.5" ref={siteContainerRef}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
                <MapPin className="w-3.5 h-3.5 text-indigo-600" />
                <span>LOKASI / Site ID <span className="text-rose-500">*</span></span>
              </label>
              {matchedSite && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-full flex items-center gap-1 animate-fade-in">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  Terverifikasi Master Site
                </span>
              )}
            </div>

            <div className="relative">
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={selectedSiteId}
                  onChange={(e) => handleSiteInputChange(e.target.value)}
                  onFocus={() => {
                    if (matchingSuggestions.length > 0) setShowSiteSuggestions(true);
                  }}
                  placeholder="Ketik LOKASI / Site ID (contoh: TGR609, JKT123, BBM DUREN SAWIT)..."
                  className="w-full pl-10 pr-10 py-2.5 text-xs font-semibold border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs placeholder:text-slate-400 uppercase tracking-wide"
                  required
                  id="manual-site-input"
                  autoComplete="off"
                />
                {selectedSiteId && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSiteId('');
                      setCustomSiteName('');
                      setCustomCoordinates('');
                      setShowSiteSuggestions(false);
                    }}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-md transition-colors"
                    title="Hapus input"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Suggestions dropdown from master sites when typing */}
              {showSiteSuggestions && matchingSuggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-slide-up max-h-56 overflow-y-auto">
                  <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                    <span>Saran Master Site ({matchingSuggestions.length} Teratas)</span>
                    <button
                      type="button"
                      onClick={() => setShowSiteSuggestions(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs font-normal cursor-pointer"
                    >
                      Tutup
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {matchingSuggestions.map((site, idx) => (
                      <button
                        key={`${site.siteId}_${idx}`}
                        type="button"
                        onClick={() => handleSelectSuggestion(site)}
                        className="w-full text-left px-3.5 py-2 hover:bg-indigo-50/80 transition-colors flex items-center justify-between gap-2 text-xs group cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 group-hover:text-indigo-600 font-mono text-xs">
                            {site.siteId}
                          </div>
                          <div className="text-[11px] text-slate-500 group-hover:text-slate-700 truncate">
                            {site.siteName}
                          </div>
                        </div>
                        {site.coordinates && (
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">
                            {site.coordinates}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Match status feedback */}
            {matchedSite ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3 text-xs animate-slide-up shadow-2xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-bold text-emerald-950 text-xs">{matchedSite.siteId}</span>
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100/90 px-2 py-0.5 rounded-full border border-emerald-300/60">
                        Data Ditemukan di Database
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-800 font-medium truncate mt-0.5">
                      Nama: <span className="font-semibold">{matchedSite.siteName}</span>
                      {matchedSite.coordinates ? ` • Koordinat: ${matchedSite.coordinates}` : ' • (Tanpa koordinat master)'}
                    </p>
                  </div>
                </div>
              </div>
            ) : selectedSiteId.trim() ? (
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 text-xs text-slate-600">
                <Info className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-[11px]">
                  Site ID <strong className="text-slate-800 font-mono">"{selectedSiteId.trim().toUpperCase()}"</strong> tidak terdaftar di Master Database. Nama Site dan Koordinat diisi manual di bawah.
                </span>
              </div>
            ) : null}

            {/* Custom / Editable Site Name & Coordinates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center justify-between">
                  <span>Nama Site / Lokasi <span className="text-rose-500">*</span></span>
                  {matchedSite && (
                    <span className="text-[9px] font-bold text-emerald-600">Sesuai Database</span>
                  )}
                </label>
                <input
                  type="text"
                  value={customSiteName}
                  onChange={(e) => setCustomSiteName(e.target.value)}
                  placeholder="Contoh: DUREN SAWIT / BTS CIPETE"
                  className="w-full mt-1 px-3.5 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center justify-between">
                  <span>Koordinat DB</span>
                  {matchedSite && matchedSite.coordinates && (
                    <span className="text-[9px] font-bold text-emerald-600">Sesuai Database</span>
                  )}
                </label>
                <input
                  type="text"
                  value={customCoordinates}
                  onChange={(e) => setCustomCoordinates(e.target.value)}
                  placeholder="Contoh: -6.225514, 106.900412"
                  className="w-full mt-1 px-3.5 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-[11px]"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Keterangan Kegiatan */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Keterangan Kegiatan Harian <span className="text-rose-500">*</span></span>
            </label>
            <textarea
              rows={3}
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder="Deskripsikan secara jelas rincian kegiatan / pekerjaan yang dilakukan staf di lokasi site..."
              className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs leading-relaxed"
              required
              id="manual-keterangan-input"
            />
          </div>

          {/* Section 5: Alasan Input Susulan (Audit Trail) */}
          <div className="space-y-2 p-4 bg-amber-50/70 border border-amber-200 rounded-2xl">
            <label className="text-xs font-bold text-amber-900 flex items-center gap-1.5 uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
              <span>Alasan Input Susulan oleh Admin <span className="text-rose-500">*</span></span>
            </label>
            
            <select
              value={alasanCategory}
              onChange={(e) => setAlasanCategory(e.target.value)}
              className="w-full px-3.5 py-2 text-xs font-semibold border border-amber-300 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              id="manual-alasan-select"
            >
              <option value="Lupa input pada saat kegiatan">Pengguna lupa mengambil data / foto saat kegiatan berlangsung</option>
              <option value="Baterai HP pengguna habis di lapangan">Baterai HP pengguna habis saat kegiatan di lapangan</option>
              <option value="Blank spot / kendala sinyal internet di lokasi">Blank spot / tidak ada sinyal internet di lokasi site</option>
              <option value="Kendala teknis pada aplikasi atau perangkat HP">Kendala teknis pada aplikasi atau perangkat HP pengguna</option>
              <option value="Lainnya">Alasan Lainnya (Tuliskan catatan khusus)</option>
            </select>

            <input
              type="text"
              value={alasanDetail}
              onChange={(e) => setAlasanDetail(e.target.value)}
              placeholder="Catatan tambahan alasan input susulan (opsional / wajib jika pilih Lainnya)..."
              className="w-full px-3 py-1.5 text-xs border border-amber-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Section 6: Upload Foto Bukti Kegiatan & Watermark */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-800 flex items-center justify-between uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-indigo-600" />
                <span>Foto Bukti Kegiatan <span className="text-rose-500">*</span></span>
              </span>
              {isProcessingWatermark && (
                <span className="text-[10px] text-indigo-600 font-semibold flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Menerapkan Watermark...
                </span>
              )}
            </label>

            {/* Drag & Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-2xl p-4 sm:p-6 text-center transition-all bg-slate-50/70 hover:bg-indigo-50/30 cursor-pointer group"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
                id="manual-photo-file-input"
              />

              {!rawPhotoFile ? (
                <div className="flex flex-col items-center justify-center space-y-2 py-2">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 group-hover:scale-105 transition-transform flex items-center justify-center shadow-2xs">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">
                      Klik untuk memilih foto atau seret file ke sini
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                      Mendukung format JPG, PNG, WEBP dari komputer atau galeri HP
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-2 text-xs font-bold text-indigo-700">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>{rawPhotoFile.name} ({(rawPhotoFile.size / 1024).toFixed(1)} KB)</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRawPhotoFile(null);
                        setWatermarkedFile(null);
                        setPhotoPreviewUrl(null);
                      }}
                      className="ml-2 text-rose-600 hover:underline text-[11px]"
                    >
                      Ganti Foto
                    </button>
                  </div>

                  {/* Watermark Preview */}
                  {photoPreviewUrl && (
                    <div className="relative rounded-xl overflow-hidden border border-slate-200 shadow-md max-h-64 mx-auto inline-block">
                      <img
                        src={photoPreviewUrl}
                        alt="Watermark Preview"
                        className="max-h-64 w-auto object-contain rounded-xl"
                      />
                      <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-xs text-white text-[9px] font-bold px-2 py-0.5 rounded-md">
                        Preview Watermarked
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || isProcessingWatermark}
              className="w-full bg-gradient-to-r from-slate-900 via-indigo-900 to-indigo-800 hover:from-slate-800 hover:to-indigo-700 text-white font-display font-bold text-xs sm:text-sm py-3.5 px-5 rounded-2xl shadow-md hover:shadow-indigo-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              id="btn-submit-manual-activity"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-300" />
                  <span>Menyimpan & Mengunggah ke Google Drive...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-indigo-300" />
                  <span>Simpan Manual Activity Report</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
