/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useBackHandler } from '../hooks/useBackHandler';
import { UserProfile, SiteInfo, UserActivity, Role } from '../types';
import { Calendar, MapPin, Camera, ChevronLeft, Plus, Image as ImageIcon, Loader2, RefreshCw, Compass, ExternalLink, AlertTriangle, AlertCircle, User, Filter, Building2 } from 'lucide-react';

// Helper to parse coordinate string and calculate Haversine distance
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

  const R = 6371e3; // Earth radius in meters
  const phi1 = (c1.lat * Math.PI) / 180;
  const phi2 = (c2.lat * Math.PI) / 180;
  const deltaPhi = ((c2.lat - c1.lat) * Math.PI) / 180;
  const deltaLambda = ((c2.lng - c1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

interface ActivityLogViewProps {
  activities: UserActivity[];
  sites: SiteInfo[];
  userEmail: string;
  userProfile?: UserProfile;
  profiles?: UserProfile[];
  role?: Role;
  onSaveActivity: (activityData: {
    tanggal: string;
    siteId: string;
    siteName: string;
    coordinatesDb: string;
    coordinatesActual: string;
    keterangan: string;
  }, photoFile?: File) => Promise<void>;
  onBack: () => void;
}

export const ActivityLogView: React.FC<ActivityLogViewProps> = ({
  activities,
  sites,
  userEmail,
  userProfile,
  profiles = [],
  role,
  onSaveActivity,
  onBack
}) => {
  const currentRole = userProfile?.role || Role.USER;
  const isMobileUser = userProfile?.mobile === true ||
    String(userProfile?.mobile).trim().toUpperCase() === 'TRUE' ||
    String(userProfile?.mobile).trim().toUpperCase() === 'YA' ||
    String(userProfile?.mobile).trim() === '1';
  const getTodayStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [dateFilter, setDateFilter] = useState<string>(getTodayStr());
  const [divisiFilter, setDivisiFilter] = useState<string>('ALL');
  const [selectedUserFilter, setSelectedUserFilter] = useState<string>('ALL');
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [selectedOriginalUrl, setSelectedOriginalUrl] = useState<string | null>(null);

  useBackHandler(showAddForm, () => setShowAddForm(false), 'activity_addForm');
  useBackHandler(!!selectedPhotoUrl, () => {
    setSelectedPhotoUrl(null);
    setSelectedOriginalUrl(null);
  }, 'activity_photoModal');

  // Form State
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [coordinatesDb, setCoordinatesDb] = useState('');
  const [coordinatesActual, setCoordinatesActual] = useState('');
  const [gpsAddress, setGpsAddress] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [keterangan, setKeterangan] = useState('');
  const [originalPhotoFile, setOriginalPhotoFile] = useState<File | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isFetchingGps, setIsFetchingGps] = useState(false);

  // Canvas utility to apply watermark to captured photo
  const applyWatermarkToImage = (
    file: File,
    textLines: string[]
  ): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(file);
            return;
          }

          canvas.width = img.width;
          canvas.height = img.height;

          // Draw the original image first
          ctx.drawImage(img, 0, 0);

          // Calculate font size dynamically based on image dimensions
          const minDimension = Math.min(img.width, img.height);
          const fontSize = Math.max(16, Math.floor(minDimension * 0.035)); // 3.5% of min dimension
          ctx.font = `bold ${fontSize}px sans-serif`;

          // Spacing config
          const marginX = fontSize;
          const lineHeight = fontSize * 1.35;
          const totalHeight = textLines.length * lineHeight;
          const marginY = fontSize * 1.2;

          // Determine start y-position (top left)
          const startY = marginY + fontSize;

          // Calculate the maximum width of the text lines for background rect
          let maxLineWidth = 0;
          textLines.forEach(line => {
            const width = ctx.measureText(line).width;
            if (width > maxLineWidth) maxLineWidth = width;
          });

          // Draw translucent dark background for absolute text readability
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
          ctx.fillRect(
            marginX - 12,
            marginY,
            maxLineWidth + 24,
            totalHeight + fontSize * 0.4 + 8
          );

          // Draw orange-yellow left accent bar
          ctx.fillStyle = '#f59e0b'; // Amber-500
          ctx.fillRect(
            marginX - 12,
            marginY,
            4,
            totalHeight + fontSize * 0.4 + 8
          );

          // Reset fill style to white for text drawing
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
          ctx.shadowBlur = 6;

          // Render each line of watermark text
          textLines.forEach((line, index) => {
            ctx.fillText(line, marginX, startY + (index * lineHeight));
          });

          // Convert back to File blob
          canvas.toBlob(
            (blob) => {
              if (blob) {
                const watermarkedFile = new File([blob], file.name, {
                  type: file.type,
                  lastModified: Date.now()
                });
                resolve(watermarkedFile);
              } else {
                resolve(file);
              }
            },
            file.type,
            0.9 // High quality compression
          );
        };
        img.onerror = () => reject(new Error('Gagal memproses gambar.'));
        img.src = event.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      reader.readAsDataURL(file);
    });
  };

  // Automatically watermark the photo whenever parameters or photo change
  useEffect(() => {
    if (!originalPhotoFile) {
      setPhotoFile(null);
      setPhotoPreview(null);
      return;
    }

    let active = true;

    const generateWatermark = async () => {
      try {
        const now = new Date();
        const pad = (num: number) => String(num).padStart(2, '0');
        const hh = pad(now.getHours());
        const mm = pad(now.getMinutes());
        const ss = pad(now.getSeconds());
        const jamStr = `${hh}:${mm}:${ss}`;

        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
        const day = now.getDate();
        const monthStr = months[now.getMonth()];
        const year = now.getFullYear();
        const tglStr = `${day} ${monthStr} ${year}`;
        
        const isVerified = !!matchedSite;
        const siteIdText = isVerified 
          ? (selectedSiteId || 'SITE_BELUM_DIPILIH').trim().toUpperCase() 
          : (selectedSiteId || 'SITE_BELUM_DIPILIH').trim();
        
        let siteInfoLine = siteIdText;
        if (matchedSite) {
          siteInfoLine = `${siteIdText}_${matchedSite.siteName}`;
        } else if (siteName.trim() && siteName.trim().toUpperCase() !== 'BELUM ADA SITE') {
          siteInfoLine = `${siteIdText}_${siteName.trim()}`;
        }

        const coordStr = coordinatesActual || 'GPS Tidak Tersedia';

        const watermarkLines = [
          siteInfoLine,
          coordStr,
          `${jamStr} - ${tglStr}`
        ];

        const watermarked = await applyWatermarkToImage(originalPhotoFile, watermarkLines);
        
        if (active) {
          setPhotoFile(watermarked);
          const reader = new FileReader();
          reader.onloadend = () => {
            if (active) setPhotoPreview(reader.result as string);
          };
          reader.readAsDataURL(watermarked);
        }
      } catch (err) {
        console.error('Failed to generate watermark:', err);
        if (active) {
          setPhotoFile(originalPhotoFile);
          const reader = new FileReader();
          reader.onloadend = () => {
            if (active) setPhotoPreview(reader.result as string);
          };
          reader.readAsDataURL(originalPhotoFile);
        }
      }
    };

    generateWatermark();

    return () => {
      active = false;
    };
  }, [originalPhotoFile, selectedSiteId, siteName, coordinatesDb, coordinatesActual]);

  const matchedSite = selectedSiteId.trim() ? sites.find(s => s.siteId.toUpperCase() === selectedSiteId.trim().toUpperCase()) : null;

  // Auto populate site name and coordinates when selectedSiteId changes
  useEffect(() => {
    const trimmedId = selectedSiteId.trim().toUpperCase();
    if (trimmedId) {
      const site = sites.find(s => s.siteId.toUpperCase() === trimmedId);
      if (site) {
        setSiteName(site.siteName);
        setCoordinatesDb(site.coordinates || '');
      } else {
        setSiteName('');
        setCoordinatesDb('');
      }
    } else {
      setSiteName('');
      setCoordinatesDb('');
    }
  }, [selectedSiteId, sites]);

  // Auto reverse geocode coordinatesActual / coordinatesDb to obtain address
  useEffect(() => {
    const coord = coordinatesActual || coordinatesDb;
    if (!coord) {
      setGpsAddress('');
      return;
    }
    const parts = coord.split(',').map(s => s.trim());
    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
      const lat = parts[0];
      const lon = parts[1];
      setIsGeocoding(true);
      fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`)
        .then(res => res.json())
        .then(data => {
          if (data && data.display_name) {
            setGpsAddress(data.display_name);
          } else {
            setGpsAddress(`Lokasi GPS (${coord})`);
          }
        })
        .catch(() => {
          setGpsAddress(`Lokasi GPS (${coord})`);
        })
        .finally(() => {
          setIsGeocoding(false);
        });
    } else {
      setGpsAddress(coord);
    }
  }, [coordinatesActual, coordinatesDb]);

  // Auto trigger GPS lookup when form is opened
  useEffect(() => {
    if (showAddForm) {
      handleGetGps();
    }
  }, [showAddForm]);

  // Handle Photo input
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedSiteId.trim() || !keterangan.trim()) {
      setErrorMsg('Wajib mengisi SiteID dan Keterangan Kegiatan terlebih dahulu.');
      return;
    }
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setOriginalPhotoFile(file);
    }
  };

  // Get real GPS location
  const handleGetGps = () => {
    if (!navigator.geolocation) {
      console.warn('Perangkat atau browser Anda tidak mendukung pencarian lokasi GPS.');
      return;
    }

    setIsFetchingGps(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lon = position.coords.longitude.toFixed(6);
        setCoordinatesActual(`${lat}, ${lon}`);
        setIsFetchingGps(false);
      },
      (error) => {
        console.error('Error fetching GPS:', error);
        setIsFetchingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedSiteId = selectedSiteId.trim();
    if (!trimmedSiteId) {
      setErrorMsg('SiteID wajib diisi.');
      return;
    }
    if (!keterangan.trim()) {
      setErrorMsg('Keterangan kegiatan wajib diisi.');
      return;
    }
    if (!photoFile) {
      setErrorMsg('Wajib mengambil foto bukti kegiatan langsung.');
      return;
    }

    setIsSubmitting(true);
    try {
      const isVerified = !!matchedSite;
      const finalSiteId = isVerified ? trimmedSiteId.toUpperCase() : trimmedSiteId;
      const finalSiteName = matchedSite ? matchedSite.siteName : (gpsAddress || siteName.trim() || finalSiteId);

      await onSaveActivity({
        tanggal: getTodayStr(), // System date for real-time tracking
        siteId: finalSiteId,
        siteName: finalSiteName,
        coordinatesDb,
        coordinatesActual,
        keterangan: keterangan.trim()
      }, photoFile);

      // Reset form
      setSelectedSiteId('');
      setSiteName('');
      setCoordinatesDb('');
      setCoordinatesActual('');
      setGpsAddress('');
      setKeterangan('');
      setOriginalPhotoFile(null);
      setPhotoFile(null);
      setPhotoPreview(null);
      setShowAddForm(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan kegiatan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Subordinates list for MANAGER role
  const subProfiles = profiles.filter(p => 
    p.managerEmail.toLowerCase() === userEmail.toLowerCase() || 
    p.email.toLowerCase() === userEmail.toLowerCase()
  );
  const subEmails = new Set(subProfiles.map(p => p.email.toLowerCase()));

  // Unique divisions list for DIREKTUR role
  const allDivisions = Array.from(
    new Set(profiles.map(p => p.divisi?.trim()).filter((d): d is string => !!d))
  ).sort();

  // Direktur User Options based on selected divisiFilter
  const direkturUserOptions = profiles.filter(p => {
    if (divisiFilter === 'ALL') return true;
    return (p.divisi?.trim() || '').toLowerCase() === divisiFilter.trim().toLowerCase();
  });

  // Filter activities based on Role & Filter selections
  const filteredActivities = activities.filter(act => {
    const actEmail = act.userEmail.toLowerCase();
    const actProf = profiles.find(p => p.email.toLowerCase() === actEmail);

    // 1. Role Scoping
    if (currentRole === Role.MANAGER) {
      // Manager only views subordinates (or self)
      if (!subEmails.has(actEmail)) return false;
    } else if (currentRole === Role.USER) {
      // User only views self
      if (actEmail !== userEmail.toLowerCase()) return false;
    }
    // DIREKTUR sees all users' activities

    // 2. Filter Divisi (For DIREKTUR)
    if (currentRole === Role.DIREKTUR && divisiFilter !== 'ALL') {
      const userDivisi = (actProf?.divisi?.trim() || '').toLowerCase();
      if (userDivisi !== divisiFilter.trim().toLowerCase()) return false;
    }

    // 3. Filter Nama User (For MANAGER & DIREKTUR)
    if (selectedUserFilter !== 'ALL') {
      if (actEmail !== selectedUserFilter.toLowerCase()) return false;
    }

    // 4. Filter Tanggal Activity
    if (dateFilter) {
      if (act.tanggal !== dateFilter) return false;
    }

    return true;
  });

  // If showAddForm is active, render the Add Form View FULL SCREEN to replace the list view
  if (showAddForm) {
    return (
      <div className="bg-slate-50 min-h-screen pb-12">
        {/* Header Panel for Form View */}
        <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10 flex items-center justify-between">
          <button 
            onClick={() => {
              setShowAddForm(false);
              setErrorMsg(null);
              setSelectedSiteId('');
              setSiteName('');
              setCoordinatesDb('');
              setCoordinatesActual('');
              setKeterangan('');
              setOriginalPhotoFile(null);
              setPhotoFile(null);
              setPhotoPreview(null);
            }}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-600 flex items-center gap-1 text-xs font-semibold"
            id="activity-back-to-list-btn"
          >
            <ChevronLeft className="w-4 h-4" />
            Batal
          </button>
          <h1 className="font-display font-bold text-slate-900 text-sm tracking-tight">Catat Kegiatan Harian</h1>
          <div className="w-16"></div> {/* Spacer for symmetry */}
        </div>

        <div className="max-w-md mx-auto p-4">
          <div className="bg-white rounded-2xl border border-indigo-200 p-5 shadow-lg space-y-4" id="activity-form-panel">
            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-100 text-red-700 text-xs rounded-xl font-medium">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Site ID Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">SITE ID / LOKASI</label>
                <input
                  type="text"
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  placeholder="Tuliskan SiteID / lokasi"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800"
                  id="activity-site-input"
                  required
                />
              </div>

              {/* Site Name Display - Only shown if Site ID is verified */}
              {matchedSite && (
                <div className="space-y-1 bg-slate-50 border border-slate-200/60 p-3 rounded-xl">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                    NAMA SITE
                  </span>
                  <span className="text-xs font-bold text-slate-700 block">
                    <span className="text-indigo-600 font-bold">{matchedSite.siteId}</span> - {matchedSite.siteName}
                  </span>
                </div>
              )}

              {/* Coordinates Display (Hidden from view but kept in background for storage & watermarking) */}
              <div className="hidden">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">KOORDINAT LOKASI</span>
                
                {/* Coordinates from Database */}
                <div className="space-y-0.5">
                  <span className="text-[9px] font-medium text-slate-500 block">Koordinat dari Database:</span>
                  <span className="text-xs font-semibold font-mono text-slate-600 block">
                    {coordinatesDb || (selectedSiteId ? 'Tidak tersedia di database' : '-')}
                  </span>
                </div>

                {/* Actual Coordinates (Real GPS) */}
                <div className="space-y-1 pt-1.5 border-t border-slate-200/50">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-medium text-indigo-600 block font-semibold">Koordinat Aktual Saat Ini:</span>
                    <button
                      type="button"
                      onClick={handleGetGps}
                      disabled={isFetchingGps}
                      className="text-[9px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 disabled:opacity-50"
                    >
                      {isFetchingGps ? (
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      ) : (
                        <Compass className="w-2.5 h-2.5" />
                      )}
                      Ambil Ulang GPS
                    </button>
                  </div>
                  {isFetchingGps ? (
                    <span className="text-xs font-medium text-slate-400 italic block">Mendapatkan lokasi GPS...</span>
                  ) : (
                    <span className="text-xs font-semibold font-mono text-slate-700 block bg-white px-2 py-1 rounded border border-slate-100">
                      {coordinatesActual || 'GPS tidak terdeteksi (Pastikan izin lokasi aktif)'}
                    </span>
                  )}
                </div>
              </div>

              {/* Keterangan */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">KETERANGAN KEGIATAN</label>
                <textarea
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                  placeholder="Deskripsikan pekerjaan atau kegiatan yang Anda lakukan hari ini..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  id="activity-keterangan-input"
                  required
                />
              </div>

              {/* Camera Capture Only input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  AMBIL FOTO BUKTI (KAMERA HP LANGSUNG)
                </label>
                <div className={`flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl p-4 transition-colors relative ${(!photoPreview && (!selectedSiteId.trim() || !keterangan.trim())) ? 'bg-slate-100/50 cursor-not-allowed' : 'bg-slate-50 hover:bg-slate-100'}`}>
                  {photoPreview ? (
                    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-100">
                      <img 
                        src={photoPreview} 
                        alt="Preview Kegiatan" 
                        className="w-full h-full object-cover" 
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setOriginalPhotoFile(null);
                          setPhotoFile(null);
                          setPhotoPreview(null);
                        }}
                        className="absolute bottom-2 right-2 bg-slate-900/80 hover:bg-slate-900 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg"
                      >
                        Ulangi Foto
                      </button>
                    </div>
                  ) : (!selectedSiteId.trim() || !keterangan.trim()) ? (
                    <div className="flex flex-col items-center justify-center py-5 w-full text-slate-400 select-none">
                      <Camera className="w-8 h-8 text-slate-300 mb-2" />
                      <span className="text-xs font-bold text-slate-400">Buka Kamera HP (Terkunci)</span>
                      <span className="text-[10px] text-slate-400 mt-1.5 font-medium text-center px-4 leading-relaxed">
                        Silakan pilih <strong className="text-slate-500 font-bold">Site ID</strong> dan isi <strong className="text-slate-500 font-bold">Keterangan Kegiatan</strong> terlebih dahulu untuk mengaktifkan kamera.
                      </span>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center justify-center py-5 w-full">
                      <Camera className="w-8 h-8 text-indigo-500 mb-2 animate-pulse" />
                      <span className="text-xs font-bold text-slate-700">Buka Kamera HP</span>
                      <span className="text-[10px] text-slate-400 mt-1 font-medium">Klik untuk memotret kegiatan lapangan secara real-time</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handlePhotoChange}
                        className="hidden"
                        id="activity-camera-input"
                        required
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-indigo-600 text-white font-display font-bold text-xs py-3 px-4 rounded-xl shadow-md hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                id="activity-submit-btn"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Menyimpan & Mengunggah...
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4" />
                    Simpan Kegiatan Harian
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-screen pb-12">
      {/* Header Panel */}
      <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10 flex items-center justify-between">
        <button 
          onClick={onBack}
          className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-600 flex items-center gap-1 text-xs font-semibold"
          id="activity-back-btn"
        >
          <ChevronLeft className="w-4 h-4" />
          Dashboard
        </button>
        <h1 className="font-display font-bold text-slate-900 text-sm tracking-tight">Log Kegiatan Harian</h1>
        <div className="w-16"></div> {/* Spacer for symmetry */}
      </div>

      <div className="max-w-md mx-auto p-4 space-y-6">
        
        {/* Filter Panel */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-indigo-600" />
              <h2 className="font-display font-bold text-slate-800 text-xs tracking-wider uppercase">Filter Activity User</h2>
            </div>
            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md uppercase">
              Role: {currentRole}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {/* Divisi Filter - Only for DIREKTUR */}
            {currentRole === Role.DIREKTUR && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Filter Divisi</label>
                <select
                  value={divisiFilter}
                  onChange={(e) => {
                    setDivisiFilter(e.target.value);
                    setSelectedUserFilter('ALL');
                  }}
                  className="w-full px-3 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  id="activity-divisi-filter"
                >
                  <option value="ALL">Semua Divisi ({allDivisions.length})</option>
                  {allDivisions.map(div => (
                    <option key={div} value={div}>{div}</option>
                  ))}
                </select>
              </div>
            )}

            {/* User Filter - For MANAGER & DIREKTUR */}
            {(currentRole === Role.MANAGER || currentRole === Role.DIREKTUR) && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Filter Nama User</label>
                <select
                  value={selectedUserFilter}
                  onChange={(e) => setSelectedUserFilter(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  id="activity-user-filter"
                >
                  {currentRole === Role.MANAGER ? (
                    <>
                      <option value="ALL">Semua Tim Bawahan ({subProfiles.length})</option>
                      {subProfiles.map((p, idx) => (
                        <option key={`${p.email}_${p.userId || idx}`} value={p.email}>
                          {p.nama || p.userId || p.email} ({p.email})
                        </option>
                      ))}
                    </>
                  ) : (
                    <>
                      <option value="ALL">Semua User ({direkturUserOptions.length})</option>
                      {direkturUserOptions.map((p, idx) => (
                        <option key={`${p.email}_${p.userId || idx}`} value={p.email}>
                          {p.nama || p.userId || p.email} {p.divisi ? `- [${p.divisi}]` : ''} ({p.email})
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
            )}

            {/* Tanggal Activity Filter */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Tanggal Activity</label>
                {dateFilter ? (
                  <button
                    type="button"
                    onClick={() => setDateFilter('')}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                  >
                    Tampilkan Semua Tanggal
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDateFilter(getTodayStr())}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                  >
                    Filter Hari Ini
                  </button>
                )}
              </div>
              <div className="relative flex items-center">
                <Calendar className="w-4 h-4 text-indigo-500 absolute left-3 pointer-events-none" />
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  id="activity-date-filter"
                />
              </div>
            </div>
          </div>

          <div className="bg-indigo-50/70 rounded-xl p-3 flex items-center justify-between border border-indigo-100">
            <span className="text-xs text-slate-700 font-medium">
              Total Kegiatan {dateFilter ? `pada ${new Date(dateFilter).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}` : '(Semua Tanggal)'}:
            </span>
            <span className="font-display font-bold text-indigo-700 text-lg">{filteredActivities.length}</span>
          </div>
        </div>

        {/* List of Activities */}
        <div className="space-y-3">
          <h3 className="font-display font-bold text-slate-800 text-xs tracking-wider uppercase px-1">Daftar Kegiatan</h3>
          {filteredActivities.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
              <ImageIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500 font-medium">Belum ada kegiatan yang dicatat untuk kriteria filter ini.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredActivities.map((act) => {
                const actProf = profiles.find(p => p.email.toLowerCase() === act.userEmail.toLowerCase());
                const userName = actProf?.nama || actProf?.userId || act.userEmail;
                const userDivisi = actProf?.divisi;

                return (
                  <div key={act.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" id={`activity-card-${act.id}`}>
                    <div className="p-4 space-y-2.5">
                      {/* User Badge Info Header */}
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-1">
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="text-xs font-bold text-slate-800">{userName}</span>
                          {userDivisi && (
                            <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                              {userDivisi}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium truncate max-w-[120px]">
                          {act.userEmail}
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                            Site: {act.siteId}
                          </span>
                          
                          <div className="flex items-center gap-2">
                            {act.buktiUrl && (
                              <button
                                onClick={() => {
                                  const displayUrl = act.buktiFileId?.trim() 
                                    ? `https://drive.google.com/thumbnail?sz=w1000&id=${act.buktiFileId.trim()}` 
                                    : act.buktiUrl;
                                  setSelectedPhotoUrl(displayUrl);
                                  setSelectedOriginalUrl(act.buktiUrl);
                                }}
                                type="button"
                                className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-1 rounded-lg transition-all"
                                title="Klik untuk melihat foto"
                              >
                                <Camera className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Foto Bukti</span>
                              </button>
                            )}
                            <span className="text-[10px] text-slate-400 font-semibold font-mono">
                              {act.tanggal} {act.createdAt ? act.createdAt.split(',')[1]?.trim() || '' : ''}
                            </span>
                          </div>
                        </div>
                        
                        <h4 className="font-display font-bold text-slate-900 text-xs mt-2">{act.siteName}</h4>
                        <p className="text-xs text-slate-600 mt-1 font-normal whitespace-pre-wrap leading-relaxed">{act.keterangan}</p>
                      </div>

                      {(() => {
                        const matchedSite = sites.find(s => s.siteId.trim().toUpperCase() === act.siteId.trim().toUpperCase());
                        const isSiteVerified = !!matchedSite;
                        const dbCoords = act.coordinatesDb || matchedSite?.coordinates || '';
                        const actualCoords = act.coordinatesActual || '';

                        const distanceMeters = (isSiteVerified && dbCoords && actualCoords)
                          ? getDistanceInMeters(dbCoords, actualCoords)
                          : null;
                        
                        const isAbnormal = isSiteVerified && distanceMeters !== null && distanceMeters > 500;
                        const currentRole = role || userProfile?.role || Role.USER;
                        const isAllowedAbnormalAndDistance = currentRole !== Role.USER;

                        const handleOpenRoute = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          const dbParsed = parseCoords(dbCoords);
                          const actParsed = parseCoords(actualCoords);
                          if (dbParsed && actParsed) {
                            const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${dbParsed.lat},${dbParsed.lng}&destination=${actParsed.lat},${actParsed.lng}`;
                            window.open(mapsUrl, '_blank', 'noopener,noreferrer');
                          }
                        };

                        if (!actualCoords && !dbCoords) return null;

                        return (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono pt-2 border-t border-slate-100 bg-slate-50/50 -mx-4 -mb-4 px-4 py-2">
                            <div className="flex items-center gap-1.5 text-slate-500 flex-wrap">
                              <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span className="text-indigo-900 font-bold">
                                {actualCoords || dbCoords}
                              </span>
                              {distanceMeters !== null && isSiteVerified && isAllowedAbnormalAndDistance && (
                                <span className="text-[9px] text-slate-400 font-normal">
                                  ({Math.round(distanceMeters)}m)
                                </span>
                              )}
                            </div>

                            {isAbnormal && isAllowedAbnormalAndDistance && (
                              <button
                                type="button"
                                onClick={handleOpenRoute}
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 border border-red-300 rounded-md font-sans text-[10px] font-bold transition-all shadow-sm shrink-0"
                                title="Jarak aktual > 500m dari koordinat site. Klik untuk lihat rute di Google Maps"
                              >
                                <AlertTriangle className="w-3 h-3 text-red-600 shrink-0" />
                                <span>Abnormal checkin</span>
                                <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-70" />
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* "Tambah Activity Hari Ini" Button - Only for Role USER */}
        {currentRole === Role.USER && (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full bg-slate-900 text-white font-display font-bold text-xs py-3 px-4 rounded-xl shadow-md hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-4"
            id="activity-add-trigger-btn"
          >
            <Plus className="w-4 h-4" />
            Tambah Activity Hari Ini
          </button>
        )}

      </div>

      {/* Pop Up Photo Modal */}
      {selectedPhotoUrl && (
        <div 
          className="fixed inset-0 bg-slate-900/15 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
          onClick={() => {
            setSelectedPhotoUrl(null);
            setSelectedOriginalUrl(null);
          }}
        >
          <div 
            className="relative max-w-md w-full bg-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <span className="text-xs font-bold text-white tracking-wide">Foto Bukti Kegiatan</span>
              <button 
                onClick={() => {
                  setSelectedPhotoUrl(null);
                  setSelectedOriginalUrl(null);
                }}
                className="text-slate-400 hover:text-white transition-colors p-1"
              >
                <span className="text-xs font-bold font-mono">TUTUP [X]</span>
              </button>
            </div>
            <div className="bg-black/40 flex items-center justify-center p-1">
              <img 
                src={selectedPhotoUrl} 
                alt="Bukti Foto Lapangan" 
                className="w-full h-auto max-h-[70vh] object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="p-3 bg-slate-950 flex items-center justify-end gap-3 border-t border-slate-800">
              {selectedOriginalUrl && (
                <a
                  href={selectedOriginalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg transition-colors shadow-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka Dokumen Asli
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
