/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useBackHandler } from '../hooks/useBackHandler';
import { UserProfile, SiteInfo, UserActivity, Role } from '../types';
import { Calendar, MapPin, Camera, ChevronLeft, Plus, Image as ImageIcon, Loader2, RefreshCw, Compass, ExternalLink, AlertTriangle, AlertCircle, AlertOctagon, User, Filter, Building2, Search, X, Sparkles, ShieldCheck, ShieldAlert, Monitor, ZoomIn, ZoomOut, RotateCcw, UploadCloud, Smartphone } from 'lucide-react';
import { detectFakeGps } from '../lib/fakeGpsDetector';
import { formatDivisiSubDivisi } from '../lib/googleApi';
import { AiScreenRecaptureModal, AiRecaptureResult } from './AiScreenRecaptureModal';
import { requestAiScreenRecapture } from '../lib/aiRecapture';

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
    indikasiFake?: boolean;
    fakeReason?: string;
  }, photoFile?: File) => Promise<void>;
  onUpdateActivity?: (act: UserActivity) => Promise<void> | void;
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
  onUpdateActivity,
  onBack
}) => {
  const currentRole = role || userProfile?.role || Role.USER;
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

  const isValidGpsCoordinates = (coord: string | null | undefined): boolean => {
    if (!coord) return false;
    const trimmed = coord.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (
      lower.includes('tidak') ||
      lower.includes('belum') ||
      lower.includes('gagal') ||
      lower.includes('error') ||
      lower.includes('mencari') ||
      lower.includes('null') ||
      lower.includes('undefined')
    ) {
      return false;
    }
    const parts = trimmed.split(',').map(p => p.trim());
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lon = parseFloat(parts[1]);
      return !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;
    }
    return false;
  };

  const [dateFilter, setDateFilter] = useState<string>(getTodayStr());
  const [divisiFilter, setDivisiFilter] = useState<string>('ALL');
  const [selectedUserFilter, setSelectedUserFilter] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedPhotoActivity, setSelectedPhotoActivity] = useState<UserActivity | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [selectedOriginalUrl, setSelectedOriginalUrl] = useState<string | null>(null);
  const [selectedPhotoFileId, setSelectedPhotoFileId] = useState<string | null>(null);
  const [selectedPhotoTitle, setSelectedPhotoTitle] = useState<string | null>(null);
  const [isPhotoLoading, setIsPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [fallbackAttempted, setFallbackAttempted] = useState(false);
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleResetZoomPan = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setIsDragging(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomScale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoomScale <= 1) return;
    e.preventDefault();
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (zoomScale <= 1 || e.touches.length !== 1) return;
    setIsDragging(true);
    setDragStart({
      x: e.touches[0].clientX - panOffset.x,
      y: e.touches[0].clientY - panOffset.y
    });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || zoomScale <= 1 || e.touches.length !== 1) return;
    setPanOffset({
      x: e.touches[0].clientX - dragStart.x,
      y: e.touches[0].clientY - dragStart.y
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  // AI Screen Recapture State
  const [aiRecaptureResults, setAiRecaptureResults] = useState<Record<string, AiRecaptureResult>>({});
  const [isAiRecaptureModalOpen, setIsAiRecaptureModalOpen] = useState(false);
  const [selectedAiActivity, setSelectedAiActivity] = useState<UserActivity | null>(null);
  const [selectedAiPhotoUrl, setSelectedAiPhotoUrl] = useState<string | null>(null);
  const [selectedAiPhotoFileId, setSelectedAiPhotoFileId] = useState<string | null>(null);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);

  // Helper to extract AI Screen Recapture result from database fields or in-memory state
  const getAiRecaptureResult = (act: UserActivity): AiRecaptureResult | null => {
    if (aiRecaptureResults[act.id]) {
      return aiRecaptureResults[act.id];
    }
    const verdictRaw = act.aiRecaptureVerdict ? String(act.aiRecaptureVerdict).trim() : '';
    if (
      !verdictRaw ||
      verdictRaw === '-' ||
      verdictRaw.toLowerCase() === 'null' ||
      verdictRaw.toLowerCase() === 'undefined' ||
      verdictRaw.toLowerCase() === 'n/a' ||
      verdictRaw.toLowerCase() === 'none' ||
      verdictRaw.toLowerCase() === 'belum diperiksa' ||
      verdictRaw.toLowerCase() === 'belum cek' ||
      verdictRaw.toLowerCase() === 'not_checked' ||
      verdictRaw.toLowerCase() === 'unchecked'
    ) {
      return null;
    }

    const vUpper = verdictRaw.toUpperCase().replace(/[\s_-]+/g, '');
    const isRecapture = 
      vUpper.includes('RECAPTURE') ||
      vUpper.includes('FOTOLAYAR') ||
      vUpper.includes('LAYAR') ||
      vUpper.includes('SCREEN') ||
      vUpper.includes('SPOOF') ||
      vUpper.includes('PALSU') ||
      vUpper.includes('FAKE') ||
      vUpper === 'TRUE' ||
      vUpper === '1';

    const isSuspicious = !isRecapture && (
      vUpper.includes('SUSPICIOUS') ||
      vUpper.includes('MENCURIGAKAN') ||
      vUpper.includes('RAGU')
    );

    const isAuthentic = !isRecapture && !isSuspicious && (
      vUpper.includes('AUTHENTIC') ||
      vUpper.includes('ASLI') ||
      vUpper.includes('VALID') ||
      vUpper.includes('DIRECT') ||
      vUpper.includes('ORIGINAL') ||
      vUpper === 'FALSE' ||
      vUpper === '0'
    );

    // If it is none of these valid verdicts, treat as not checked
    if (!isRecapture && !isSuspicious && !isAuthentic) {
      return null;
    }

    const standardVerdict = isRecapture
      ? 'SCREEN_RECAPTURE_DETECTED'
      : isSuspicious
        ? 'SUSPICIOUS'
        : 'AUTHENTIC';

    let indicators: string[] = [];
    if (act.aiRecaptureIndicators) {
      try {
        const parsed = JSON.parse(act.aiRecaptureIndicators);
        indicators = Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch {
        indicators = act.aiRecaptureIndicators.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      }
    }

    let conf = act.aiRecaptureConfidence;
    if (typeof conf === 'string') {
      const parsed = parseFloat(String(conf).replace(/[^0-9.]/g, ''));
      conf = !isNaN(parsed) ? (parsed <= 1 && parsed > 0 ? Math.round(parsed * 100) : Math.round(parsed)) : undefined;
    }
    const finalConfidence = conf ?? (isRecapture ? 95 : isSuspicious ? 70 : 98);

    return {
      isRecapture,
      confidence: finalConfidence,
      verdict: standardVerdict,
      summary: act.aiRecaptureSummary || (
        isRecapture
          ? 'Terdeteksi foto ulang dari layar digital (Tersimpan di Database).'
          : isSuspicious
            ? 'Status foto memerlukan verifikasi manual (Tersimpan di Database).'
            : 'Foto asli teridentifikasi diambil langsung di lokasi fisik (Tersimpan di Database).'
      ),
      indicators: indicators.length > 0 ? indicators : [
        isRecapture ? 'Tercatat indikasi foto layar di database' : isSuspicious ? 'Tercatat status mencurigakan di database' : 'Tercatat foto asli di database'
      ],
      recommendation: isRecapture
        ? 'Periksa keaslian fisik atau hubungi pelapor kegiatan.'
        : isSuspicious
          ? 'Lakukan konfirmasi visual langsung dengan pengguna.'
          : 'Foto bukti terverifikasi valid dan tersimpan di database.',
      checkedAt: act.aiRecaptureCheckedAt
    };
  };

  const resetPhotoModal = () => {
    setSelectedPhotoActivity(null);
    setSelectedPhotoUrl(null);
    setSelectedOriginalUrl(null);
    setSelectedPhotoFileId(null);
    setSelectedPhotoTitle(null);
    setIsPhotoLoading(false);
    setPhotoError(false);
    setFallbackAttempted(false);
    handleResetZoomPan();
  };

  useBackHandler(showAddForm, () => {
    setShowAddForm(false);
    formOpenPositionRef.current = null;
    formOpenedTimeRef.current = null;
  }, 'activity_addForm');
  useBackHandler(!!selectedPhotoUrl, resetPhotoModal, 'activity_photoModal');
  useBackHandler(isAiRecaptureModalOpen, () => setIsAiRecaptureModalOpen(false), 'activity_aiRecaptureModal');

  // Trigger AI Screen Recapture Inspection
  const handleRunAiRecapture = async (
    act: UserActivity,
    explicitPhotoUrl?: string,
    explicitFileId?: string,
    forceReanalyze = false
  ) => {
    let fileId = explicitFileId || act.buktiFileId?.trim() || '';
    if (!fileId && act.buktiUrl) {
      const m = act.buktiUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                act.buktiUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                act.buktiUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (m && m[1]) fileId = m[1];
    }

    const photoUrl = explicitPhotoUrl || (
      act.buktiUrl?.startsWith('data:')
        ? act.buktiUrl
        : fileId
          ? `https://drive.google.com/thumbnail?sz=w1200&id=${fileId}`
          : act.buktiUrl
    );

    setSelectedAiActivity(act);
    setSelectedAiPhotoUrl(photoUrl);
    setSelectedAiPhotoFileId(fileId || null);
    setIsAiRecaptureModalOpen(true);
    setAiAnalysisError(null);

    // 1. If result is already saved in database or cached state and not forcing re-analysis, load immediately without calling AI API!
    const existingResult = getAiRecaptureResult(act);
    if (existingResult && !forceReanalyze) {
      if (!aiRecaptureResults[act.id]) {
        setAiRecaptureResults(prev => ({ ...prev, [act.id]: existingResult }));
      }
      return;
    }

    setIsAiAnalyzing(true);
    try {
      const newResult = await requestAiScreenRecapture(act, photoUrl, fileId);

      setAiRecaptureResults(prev => ({
        ...prev,
        [act.id]: newResult,
      }));

      // Automatically persist to Google Sheet Activity database so it won't ever need re-checking
      if (onUpdateActivity) {
        try {
          await onUpdateActivity({
            ...act,
            aiRecaptureVerdict: newResult.verdict,
            aiRecaptureConfidence: newResult.confidence,
            aiRecaptureSummary: newResult.summary,
            aiRecaptureIndicators: JSON.stringify(newResult.indicators || []),
            aiRecaptureCheckedAt: newResult.checkedAt
          });
        } catch (err) {
          console.error('Failed to auto-save AI result to database:', err);
        }
      }
    } catch (err: any) {
      console.error('AI Screen Recapture check failed:', err);
      setAiAnalysisError(err.message || 'Gagal memeriksa keaslian foto dengan AI.');
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  // Form State
  const lastGpsPositionRef = useRef<GeolocationPosition | null>(null);
  const formOpenPositionRef = useRef<GeolocationPosition | null>(null);
  const formOpenedTimeRef = useRef<number | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [coordinatesDb, setCoordinatesDb] = useState('');
  const [coordinatesActual, setCoordinatesActual] = useState('');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsAddress, setGpsAddress] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [keterangan, setKeterangan] = useState('');
  const [originalPhotoFile, setOriginalPhotoFile] = useState<File | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isFetchingGps, setIsFetchingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Canvas utility to apply watermark to captured photo with downscaling and JPEG compression to prevent OOM crash
  const applyWatermarkToImage = (
    file: File,
    textLines: string[]
  ): Promise<File> => {
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
            // This prevents canvas allocation memory crash (OOM) on mobile devices while keeping image crisp
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

            // Draw the resized original image first
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

            // Calculate font size dynamically based on target image dimensions
            const minDimension = Math.min(targetWidth, targetHeight);
            const fontSize = Math.max(14, Math.floor(minDimension * 0.035)); // 3.5% of min dimension
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

            // Convert back to compressed JPEG File blob
            canvas.toBlob(
              (blob) => {
                if (blob) {
                  const cleanName = file.name ? file.name.replace(/\.[^/.]+$/, "") : "kegiatan";
                  const watermarkedFile = new File([blob], `${cleanName}_wm.jpg`, {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                  });
                  resolve(watermarkedFile);
                } else {
                  console.warn('canvas.toBlob returned null, falling back to original file');
                  resolve(file);
                }
              },
              'image/jpeg',
              0.82 // 82% JPEG compression gives crisp readability & minimal file size (~200KB)
            );
          } catch (err) {
            console.error('Error processing watermark on canvas:', err);
            resolve(file); // Graceful fallback
          }
        };
        img.onerror = (e) => {
          console.error('Error loading image for watermark:', e);
          resolve(file);
        };
        img.src = event.target?.result as string;
      };
      reader.onerror = (e) => {
        console.error('Error reading image file:', e);
        resolve(file);
      };
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

        const coordStr = coordinatesActual 
          ? (gpsAccuracy !== null ? `GPS: ${coordinatesActual} (±${gpsAccuracy}m)` : `GPS: ${coordinatesActual}`)
          : 'GPS Tidak Tersedia';

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

  // Continuous GPS tracking when form is opened
  useEffect(() => {
    if (!showAddForm) return;

    if (!navigator.geolocation) {
      setGpsError('Perangkat atau browser Anda tidak mendukung pencarian lokasi GPS.');
      return;
    }

    setIsFetchingGps(true);
    setGpsError(null);

    const updatePosition = (position: GeolocationPosition) => {
      lastGpsPositionRef.current = position;
      if (!formOpenPositionRef.current) {
        formOpenPositionRef.current = position;
        formOpenedTimeRef.current = position.timestamp || Date.now();
      }
      const lat = position.coords.latitude.toFixed(6);
      const lon = position.coords.longitude.toFixed(6);
      const acc = position.coords.accuracy;
      setCoordinatesActual(`${lat}, ${lon}`);
      setGpsAccuracy(acc ? Math.round(acc) : null);
      setGpsError(null);
      setIsFetchingGps(false);
    };

    const handleGpsError = (error: GeolocationPositionError) => {
      console.error('Error watching GPS:', error);
      let msg = 'Gagal mendapatkan koordinat GPS.';
      if (error.code === error.PERMISSION_DENIED) {
        msg = 'Akses lokasi (GPS) ditolak oleh pengguna/browser.';
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        msg = 'Informasi posisi GPS tidak tersedia pada perangkat.';
      } else if (error.code === error.TIMEOUT) {
        msg = 'Waktu permintaan posisi GPS habis (timeout).';
      }
      setGpsError(msg);
      setIsFetchingGps(false);
    };

    // First trigger an immediate position request
    navigator.geolocation.getCurrentPosition(updatePosition, handleGpsError, {
      enableHighAccuracy: true,
      timeout: 10000,
    });

    // Continuous location tracking
    const watchId = navigator.geolocation.watchPosition(updatePosition, handleGpsError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 3000,
    });

    // Interval re-check
    const intervalId = setInterval(() => {
      navigator.geolocation.getCurrentPosition(updatePosition, () => {}, {
        enableHighAccuracy: true,
        timeout: 5000,
      });
    }, 4000);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(intervalId);
    };
  }, [showAddForm]);

  // Handle Photo input
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedSiteId.trim() || !keterangan.trim()) {
      setErrorMsg('Wajib mengisi SiteID dan Keterangan Kegiatan terlebih dahulu.');
      return;
    }
    if (!isValidGpsCoordinates(coordinatesActual)) {
      setErrorMsg('Data koordinat GPS wajib ada sebelum mengambil foto bukti kegiatan. Silakan aktifkan lokasi (GPS) dan klik "Ambil Ulang GPS".');
      return;
    }
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setOriginalPhotoFile(file);
    }
  };

  // Get real GPS location
  const handleGetGps = () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError('Perangkat atau browser Anda tidak mendukung pencarian lokasi GPS.');
      return;
    }

    setIsFetchingGps(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        lastGpsPositionRef.current = position;
        const lat = position.coords.latitude.toFixed(6);
        const lon = position.coords.longitude.toFixed(6);
        const acc = position.coords.accuracy;
        setCoordinatesActual(`${lat}, ${lon}`);
        setGpsAccuracy(acc ? Math.round(acc) : null);
        setGpsError(null);
        setIsFetchingGps(false);
      },
      (error) => {
        console.error('Error fetching GPS:', error);
        let msg = 'Gagal mendapatkan koordinat GPS.';
        if (error.code === error.PERMISSION_DENIED) {
          msg = 'Akses lokasi (GPS) ditolak oleh pengguna/browser. Mohon aktifkan izin lokasi di browser/perangkat Anda.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          msg = 'Informasi posisi GPS tidak tersedia pada perangkat.';
        } else if (error.code === error.TIMEOUT) {
          msg = 'Waktu permintaan posisi GPS habis (timeout). Silakan coba lagi.';
        }
        setGpsError(msg);
        setCoordinatesActual('');
        setGpsAccuracy(null);
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
    if (!isValidGpsCoordinates(coordinatesActual)) {
      setErrorMsg('Data koordinat GPS wajib ada dan valid untuk menyimpan Log Kegiatan Harian. Silakan aktifkan fitur lokasi (GPS) dan klik "Ambil Ulang GPS".');
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

      // Perform silent Fake GPS check right before submission (including form open vs submit teleportation check)
      const fakeCheck = detectFakeGps(
        lastGpsPositionRef.current,
        coordinatesActual,
        null,
        1,
        formOpenPositionRef.current
      );

      await onSaveActivity({
        tanggal: getTodayStr(), // System date for real-time tracking
        siteId: finalSiteId,
        siteName: finalSiteName,
        coordinatesDb,
        coordinatesActual,
        keterangan: keterangan.trim(),
        indikasiFake: fakeCheck.isFake,
        fakeReason: fakeCheck.reason
      }, photoFile);

      // Reset form
      setSelectedSiteId('');
      setSiteName('');
      setCoordinatesDb('');
      setCoordinatesActual('');
      setGpsAccuracy(null);
      setGpsAddress('');
      setKeterangan('');
      setOriginalPhotoFile(null);
      setPhotoFile(null);
      setPhotoPreview(null);
      setShowAddForm(false);
      formOpenPositionRef.current = null;
      formOpenedTimeRef.current = null;
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

  // User Options based on selected divisiFilter
  const allUserOptions = profiles
    .filter(p => {
      if (divisiFilter === 'ALL') return true;
      return (p.divisi?.trim() || '').toLowerCase() === divisiFilter.trim().toLowerCase();
    })
    .sort((a, b) => {
      const nameA = (a.nama || a.userId || a.email).toLowerCase();
      const nameB = (b.nama || b.userId || b.email).toLowerCase();
      return nameA.localeCompare(nameB);
    });

  const parseActivityTime = (act: UserActivity): number => {
    const candidates = [act.timestamp, act.createdAt].filter(
      (s): s is string => !!s && typeof s === 'string' && s.trim().length > 0
    );

    for (const rawStr of candidates) {
      const s = rawStr.trim();

      // 1. If raw Unix timestamp number/string
      if (/^\d{10,13}$/.test(s)) {
        const num = Number(s);
        if (!isNaN(num)) return num > 1e11 ? num : num * 1000;
      }

      // 2. Standardize time delimiters from dot to colon if present (e.g. 07.31.33 or 07.31)
      const normalized = s.replace(/([T, ]\d{1,2})\.(\d{2})(?:\.(\d{2}))?/, (_, p1, p2, p3) => {
        return p3 ? `${p1}:${p2}:${p3}` : `${p1}:${p2}`;
      });

      // Try native Date.parse on normalized string
      const parsedIso = Date.parse(normalized);
      if (!isNaN(parsedIso)) return parsedIso;

      // 3. Fallback manual parsing for various formats
      const parts = normalized.split(/[, ]+/);
      if (parts.length >= 1) {
        const datePart = parts[0];
        const timePart = parts[1] || '00:00:00';

        let day = 0, month = 0, year = 0;

        if (datePart.includes('/')) {
          const dParts = datePart.split('/');
          if (dParts.length === 3) {
            day = parseInt(dParts[0], 10);
            month = parseInt(dParts[1], 10) - 1;
            year = parseInt(dParts[2], 10);
          }
        } else if (datePart.includes('-')) {
          const dParts = datePart.split('-');
          if (dParts.length === 3) {
            if (dParts[0].length === 4) {
              year = parseInt(dParts[0], 10);
              month = parseInt(dParts[1], 10) - 1;
              day = parseInt(dParts[2], 10);
            } else {
              day = parseInt(dParts[0], 10);
              month = parseInt(dParts[1], 10) - 1;
              year = parseInt(dParts[2], 10);
            }
          }
        }

        const tParts = timePart.replace(/\./g, ':').split(':');
        const hh = parseInt(tParts[0] || '0', 10);
        const mm = parseInt(tParts[1] || '0', 10);
        const ss = parseInt(tParts[2] || '0', 10);

        if (year > 0 && day > 0 && !isNaN(month)) {
          const t = new Date(year, month, day, hh, mm, ss).getTime();
          if (!isNaN(t)) return t;
        }
      }
    }

    // Fallback using act.tanggal + time from act.createdAt/timestamp if available
    if (act.tanggal) {
      const dateStr = act.tanggal.trim();
      let hh = 0, mm = 0, ss = 0;

      const timeSource = act.createdAt || act.timestamp || '';
      const timeMatch = timeSource.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
      if (timeMatch) {
        hh = parseInt(timeMatch[1], 10);
        mm = parseInt(timeMatch[2], 10);
        ss = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      }

      const dParts = dateStr.split('-');
      if (dParts.length === 3 && dParts[0].length === 4) {
        const year = parseInt(dParts[0], 10);
        const month = parseInt(dParts[1], 10) - 1;
        const day = parseInt(dParts[2], 10);
        const t = new Date(year, month, day, hh, mm, ss).getTime();
        if (!isNaN(t)) return t;
      }
    }

    return 0;
  };

  // Filter activities based on Role & Filter selections and sort newest first
  const filteredActivities = activities
    .filter(act => {
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
      // DIREKTUR, FINANCE, ADMINISTRATOR see all users' activities

      // 2. Filter Divisi (For DIREKTUR, FINANCE, ADMINISTRATOR)
      if ((currentRole === Role.DIREKTUR || currentRole === Role.FINANCE || currentRole === Role.ADMINISTRATOR) && divisiFilter !== 'ALL') {
        const userDivisi = (actProf?.divisi?.trim() || '').toLowerCase();
        if (userDivisi !== divisiFilter.trim().toLowerCase()) return false;
      }

      // 3. Filter Nama User
      if (selectedUserFilter.trim()) {
        const q = selectedUserFilter.trim().toLowerCase();
        const userName = (actProf?.nama || act.userName || '').toLowerCase();
        const userId = (actProf?.userId || '').toLowerCase();
        const userEmail = actEmail.toLowerCase();
        if (!userName.includes(q) && !userId.includes(q) && !userEmail.includes(q)) {
          return false;
        }
      }

      // 4. Filter Tanggal Activity
      if (dateFilter) {
        if (act.tanggal !== dateFilter) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const timeA = parseActivityTime(a);
      const timeB = parseActivityTime(b);
      if (timeA !== timeB) {
        return timeB - timeA; // Newest first
      }
      const dateComp = (b.tanggal || '').localeCompare(a.tanggal || '');
      if (dateComp !== 0) return dateComp;
      return (b.id || '').localeCompare(a.id || '');
    });

  // If showAddForm is active, render the Add Form View FULL SCREEN to replace the list view
  if (showAddForm) {
    const isGpsReady = isValidGpsCoordinates(coordinatesActual);

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
              formOpenPositionRef.current = null;
              formOpenedTimeRef.current = null;
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
              {/* Status GPS Lokasi (Tanpa Tampilan Koordinat Angka) */}
              <div className="space-y-2 bg-slate-50 border border-slate-200/80 p-3.5 rounded-2xl transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-indigo-600" />
                    <span>STATUS GPS LOKASI</span>
                  </span>
                  {isFetchingGps && !isGpsReady && (
                    <span className="text-[10px] font-semibold text-indigo-600 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin text-indigo-600" />
                      Mengecek GPS...
                    </span>
                  )}
                </div>

                {isGpsReady ? (
                  <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200/80 rounded-xl">
                    <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500 text-white shrink-0 shadow-xs">
                      <MapPin className="w-4.5 h-4.5 text-white" />
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 border-2 border-white rounded-full animate-ping"></span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-emerald-900">GPS Terdeteksi & Aktif</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                          Tersedia
                        </span>
                      </div>
                      <p className="text-[10px] text-emerald-700 font-medium mt-0.5">
                        Isian kegiatan harian telah diaktifkan
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 p-3 bg-red-50 border border-red-200/80 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-red-500 text-white shrink-0 shadow-xs animate-pulse">
                        <MapPin className="w-4.5 h-4.5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-red-900">GPS Belum Tersedia</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-red-100 text-red-800 rounded-md">
                            Terkunci
                          </span>
                        </div>
                        <p className="text-[10px] text-red-700 font-medium mt-0.5 leading-relaxed">
                          {gpsError || 'Aplikasi terus mengecek data GPS. Mohon aktifkan izin lokasi / GPS pada HP Anda.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-red-200/60 mt-1">
                      <button
                        type="button"
                        onClick={handleGetGps}
                        disabled={isFetchingGps}
                        className="text-[11px] font-bold bg-white text-red-700 hover:bg-red-100/60 px-2.5 py-1 rounded-lg border border-red-200 flex items-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${isFetchingGps ? 'animate-spin' : ''}`} />
                        <span>Coba Ambil Ulang GPS</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Site ID Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">SITE ID / LOKASI</label>
                <input
                  type="text"
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  disabled={!isGpsReady}
                  placeholder={isGpsReady ? "Tuliskan SiteID / lokasi" : "Form terkunci: Tunggu GPS aktif..."}
                  className={`w-full px-3 py-2 border rounded-xl text-xs font-semibold focus:outline-none transition-all ${
                    !isGpsReady
                      ? 'bg-slate-100/70 border-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-slate-50 border-slate-200 text-slate-800 focus:ring-1 focus:ring-indigo-500'
                  }`}
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

              {/* Keterangan */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">KETERANGAN KEGIATAN</label>
                <textarea
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                  disabled={!isGpsReady}
                  placeholder={isGpsReady ? "Deskripsikan pekerjaan atau kegiatan yang Anda lakukan hari ini..." : "Form terkunci: Tunggu GPS aktif..."}
                  rows={3}
                  className={`w-full px-3 py-2 border rounded-xl text-xs focus:outline-none transition-all ${
                    !isGpsReady
                      ? 'bg-slate-100/70 border-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-slate-50 border-slate-200 text-slate-800 focus:ring-1 focus:ring-indigo-500'
                  }`}
                  id="activity-keterangan-input"
                  required
                />
              </div>

              {/* Camera Capture Only input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  AMBIL FOTO BUKTI (KAMERA HP LANGSUNG)
                </label>
                <div className={`flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl p-4 transition-colors relative ${(!photoPreview && (!selectedSiteId.trim() || !keterangan.trim() || !isGpsReady)) ? 'bg-slate-100/50 cursor-not-allowed' : 'bg-slate-50 hover:bg-slate-100'}`}>
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
                        className="absolute bottom-2 right-2 bg-slate-900/80 hover:bg-slate-900 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer"
                      >
                        Ulangi Foto
                      </button>
                    </div>
                  ) : (!selectedSiteId.trim() || !keterangan.trim() || !isGpsReady) ? (
                    <div className="flex flex-col items-center justify-center py-5 w-full text-slate-400 select-none">
                      <Camera className="w-8 h-8 text-slate-300 mb-2" />
                      <span className="text-xs font-bold text-slate-400">Buka Kamera HP (Terkunci)</span>
                      <span className="text-[10px] text-slate-400 mt-1.5 font-medium text-center px-4 leading-relaxed">
                        {!isGpsReady ? (
                          <span className="text-red-600 font-bold block">
                            Data lokasi GPS belum tersedia. Klik "Coba Ambil Ulang GPS" atau aktifkan izin lokasi di browser Anda.
                          </span>
                        ) : (
                          <span>
                            Silakan pilih <strong className="text-slate-500 font-bold">Site ID</strong> dan isi <strong className="text-slate-500 font-bold">Keterangan Kegiatan</strong> terlebih dahulu untuk mengaktifkan kamera.
                          </span>
                        )}
                      </span>
                    </div>
                  ) : isMobileUser ? (
                    <label className="cursor-pointer flex flex-col items-center justify-center py-5 w-full">
                      <Camera className="w-8 h-8 text-indigo-500 mb-2 animate-pulse" />
                      <span className="text-xs font-bold text-slate-700">Buka Kamera HP (Wajib Kamera Direct)</span>
                      <span className="text-[10px] text-slate-400 mt-1 font-medium">Pengguna Wajib Mobile wajib memotret kegiatan harian langsung dari Kamera HP</span>
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
                  ) : (
                    <div className="grid grid-cols-2 gap-2 p-2 w-full">
                      <label className="cursor-pointer flex flex-col items-center justify-center p-3 bg-indigo-50/80 hover:bg-indigo-100/80 text-indigo-700 border border-indigo-200/80 rounded-xl transition-all">
                        <Camera className="w-5 h-5 text-indigo-600 mb-1" />
                        <span className="text-[10px] font-bold">Kamera HP</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handlePhotoChange}
                          className="hidden"
                        />
                      </label>
                      <label className="cursor-pointer flex flex-col items-center justify-center p-3 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-xl transition-all">
                        <UploadCloud className="w-5 h-5 text-indigo-500 mb-1" />
                        <span className="text-[10px] font-bold text-slate-600">File / Galeri</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handlePhotoChange}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting || !isGpsReady}
                className="w-full bg-indigo-600 text-white font-display font-bold text-xs py-3 px-4 rounded-xl shadow-md hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
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
            {/* Divisi Filter - For DIREKTUR, FINANCE, ADMINISTRATOR */}
            {(currentRole === Role.DIREKTUR || currentRole === Role.FINANCE || currentRole === Role.ADMINISTRATOR) && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Filter Divisi</label>
                <select
                  value={divisiFilter}
                  onChange={(e) => {
                    setDivisiFilter(e.target.value);
                    setSelectedUserFilter('');
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

            {/* User Filter - For MANAGER, DIREKTUR, FINANCE, ADMINISTRATOR */}
            {(currentRole === Role.MANAGER || currentRole === Role.DIREKTUR || currentRole === Role.FINANCE || currentRole === Role.ADMINISTRATOR) && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Filter Nama User</label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Ketik nama / email user..."
                    value={selectedUserFilter}
                    onChange={(e) => setSelectedUserFilter(e.target.value)}
                    className="w-full pl-8 pr-8 py-1.5 text-xs font-semibold border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white transition-all"
                    id="activity-user-filter"
                  />
                  {selectedUserFilter && (
                    <button
                      type="button"
                      onClick={() => setSelectedUserFilter('')}
                      className="absolute right-2.5 top-1.5 text-slate-400 hover:text-slate-600 text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full hover:bg-slate-200 transition-colors cursor-pointer"
                      title="Hapus filter nama"
                    >
                      ×
                    </button>
                  )}
                </div>
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
                const formattedDivisi = formatDivisiSubDivisi(actProf?.divisi, actProf?.subDivisi);

                return (
                  <div key={act.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" id={`activity-card-${act.id}`}>
                    <div className="p-4 space-y-2.5">
                      {/* User Badge Info Header */}
                      <div className="flex items-start justify-between border-b border-slate-100 pb-2 mb-1">
                        <div className="flex items-start gap-2">
                          <User className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="text-sm font-bold text-slate-800">{userName}</span>
                            {formattedDivisi && formattedDivisi !== '-' && (
                              <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                                {formattedDivisi}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-[11px] text-slate-500 font-semibold font-mono tracking-tight shrink-0 pt-0.5">
                          {act.tanggal} {act.createdAt ? (act.createdAt.includes(',') ? act.createdAt.split(',')[1]?.trim() : act.createdAt.includes(' ') ? act.createdAt.split(' ')[1]?.trim() : act.createdAt) : ''}
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                            Site: {act.siteId}
                          </span>
                          
                          <div className="flex items-center gap-2">
                            {act.buktiUrl && (
                              <button
                                onClick={() => {
                                  let fileId = act.buktiFileId?.trim() || '';
                                  if (!fileId && act.buktiUrl) {
                                    const m = act.buktiUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                                              act.buktiUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                                              act.buktiUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                                    if (m && m[1]) fileId = m[1];
                                  }

                                  const displayUrl = act.buktiUrl?.startsWith('data:')
                                    ? act.buktiUrl
                                    : fileId
                                      ? `https://drive.google.com/thumbnail?sz=w1000&id=${fileId}`
                                      : act.buktiUrl;

                                  const originalUrl = act.buktiUrl || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : '');

                                  setSelectedPhotoActivity(act);
                                  setSelectedPhotoUrl(displayUrl);
                                  setSelectedOriginalUrl(originalUrl);
                                  setSelectedPhotoFileId(fileId || null);
                                  setSelectedPhotoTitle(`Site: ${act.siteId} - ${act.siteName || ''}`);
                                  setIsPhotoLoading(true);
                                  setPhotoError(false);
                                  setFallbackAttempted(false);
                                }}
                                type="button"
                                className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all shadow-2xs cursor-pointer active:scale-95"
                                title="Klik untuk melihat foto bukti kegiatan"
                              >
                                <Camera className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Foto Bukti</span>
                              </button>
                            )}

                            {/* Administrator-Only: AI Screen Recapture / Spoofing Check */}
                            {currentRole === Role.ADMINISTRATOR && act.buktiUrl && (() => {
                              const aiRes = getAiRecaptureResult(act);
                              const isDbSaved = !!(act.aiRecaptureVerdict || aiRes?.checkedAt);

                              let btnStyle = 'bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-purple-500/10 hover:from-amber-500/20 hover:to-indigo-500/20 text-indigo-900 border-indigo-200';
                              let btnText = 'AI Screen Recapture';
                              let btnTitle = 'Periksa keaslian foto dengan AI (klik untuk analisis)';

                              if (aiRes) {
                                if (aiRes.isRecapture || aiRes.verdict === 'SCREEN_RECAPTURE_DETECTED') {
                                  btnStyle = 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-300 ring-1 ring-rose-200';
                                  btnText = `🚨 Foto Layar (${aiRes.confidence}%)`;
                                  btnTitle = `Terindikasi Foto Layar (${aiRes.confidence}%)${isDbSaved ? ' - Tersimpan di Database' : ''}`;
                                } else if (aiRes.verdict === 'SUSPICIOUS') {
                                  btnStyle = 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 ring-1 ring-amber-200';
                                  btnText = `⚠️ Ragu (${aiRes.confidence}%)`;
                                  btnTitle = `Mencurigakan / Butuh Verifikasi Manual (${aiRes.confidence}%)${isDbSaved ? ' - Tersimpan di Database' : ''}`;
                                } else {
                                  btnStyle = 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300 ring-1 ring-emerald-200';
                                  btnText = `🛡️ Foto Asli (${aiRes.confidence}%)`;
                                  btnTitle = `Foto Asli / Langsung (${aiRes.confidence}%)${isDbSaved ? ' - Tersimpan di Database' : ''}`;
                                }
                              }

                              return (
                                <button
                                  type="button"
                                  onClick={() => handleRunAiRecapture(act)}
                                  className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all shadow-2xs cursor-pointer active:scale-95 border ${btnStyle}`}
                                  title={btnTitle}
                                  id={`ai-screen-recapture-btn-${act.id}`}
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span>{btnText}</span>
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                        
                        <h4 className="font-display font-bold text-slate-900 text-xs mt-2">{act.siteName}</h4>
                        <p className="text-xs text-slate-600 mt-1 font-normal whitespace-pre-wrap leading-relaxed">{act.keterangan}</p>

                        {/* Admin-Only Fake GPS Detection Badge */}
                        {currentRole === Role.ADMINISTRATOR && act.indikasiFake && (
                          <div className="mt-2.5 p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs">
                            <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <span className="font-bold text-rose-900 block text-[11px]">
                                Indikasi Fake GPS Terdeteksi
                              </span>
                              <span className="text-[10px] text-rose-700 block mt-0.5 leading-relaxed">
                                Alasan: {act.fakeReason || 'Akurasi, altitude, atau timestamp anomali'}
                              </span>
                            </div>
                          </div>
                        )}
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
                          const dbParsed = dbCoords ? parseCoords(dbCoords) : null;
                          const actParsed = actualCoords ? parseCoords(actualCoords) : null;
                          if (dbParsed && actParsed) {
                            const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${dbParsed.lat},${dbParsed.lng}&destination=${actParsed.lat},${actParsed.lng}`;
                            window.open(mapsUrl, '_blank', 'noopener,noreferrer');
                          } else {
                            const targetCoord = (actualCoords || dbCoords).trim();
                            if (targetCoord) {
                              const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(targetCoord)}`;
                              window.open(mapsUrl, '_blank', 'noopener,noreferrer');
                            }
                          }
                        };

                        if (!actualCoords && !dbCoords) return null;

                        return (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono pt-2 border-t border-slate-100 bg-slate-50/50 -mx-4 -mb-4 px-4 py-2">
                            <div className="flex items-center gap-1.5 text-slate-500 flex-wrap">
                              <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <button
                                type="button"
                                onClick={handleOpenRoute}
                                className="inline-flex items-center gap-1 text-indigo-700 hover:text-indigo-900 font-bold hover:underline cursor-pointer transition-colors group/coord"
                                title="Klik untuk membuka lokasi / rute di Google Maps"
                              >
                                <span>{actualCoords || dbCoords}</span>
                                <ExternalLink className="w-2.5 h-2.5 text-indigo-500 group-hover/coord:translate-x-0.5 transition-transform" />
                              </button>
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
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 border border-red-300 rounded-md font-sans text-[10px] font-bold transition-all shadow-sm shrink-0 cursor-pointer"
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
            onClick={() => {
              formOpenPositionRef.current = lastGpsPositionRef.current;
              formOpenedTimeRef.current = lastGpsPositionRef.current?.timestamp || Date.now();
              setShowAddForm(true);
            }}
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
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[999] flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in"
          onClick={resetPhotoModal}
        >
          <div 
            className="relative max-w-2xl w-full bg-slate-900 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] border border-slate-800 animate-scale-up my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-2.5 bg-slate-950">
              <div className="flex items-center gap-2.5 min-w-0 pr-1">
                <div className="w-8 h-8 rounded-xl bg-indigo-950/80 border border-indigo-800/50 flex items-center justify-center shrink-0">
                  <Camera className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">FOTO BUKTI KEGIATAN</h3>
                  <p className="text-xs font-bold text-white truncate mt-0.5">{selectedPhotoTitle || 'Foto Lapangan'}</p>
                </div>
              </div>

              {/* Zoom Controls */}
              {!photoError && (
                <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setZoomScale(prev => {
                      const next = Math.max(0.5, Math.round((prev - 0.25) * 100) / 100);
                      if (next <= 1) setPanOffset({ x: 0, y: 0 });
                      return next;
                    })}
                    disabled={zoomScale <= 0.5}
                    className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent rounded-lg transition-all cursor-pointer"
                    title="Kecilkan (Zoom Out)"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleResetZoomPan}
                    className="px-2 py-1 text-[11px] font-bold text-indigo-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all cursor-pointer min-w-[46px] text-center"
                    title="Reset Ukuran (100%)"
                  >
                    {Math.round(zoomScale * 100)}%
                  </button>

                  <button
                    type="button"
                    onClick={() => setZoomScale(prev => Math.min(3.5, Math.round((prev + 0.25) * 100) / 100))}
                    disabled={zoomScale >= 3.5}
                    className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent rounded-lg transition-all cursor-pointer"
                    title="Perbesar (Zoom In)"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>

                  {(zoomScale !== 1 || panOffset.x !== 0 || panOffset.y !== 0) && (
                    <button
                      type="button"
                      onClick={handleResetZoomPan}
                      className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                      title="Reset Zoom & Posisi Foto"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              <button 
                onClick={resetPhotoModal}
                className="text-slate-400 hover:text-white hover:bg-slate-800 p-2 rounded-xl transition-all cursor-pointer shrink-0"
                title="Tutup"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Main Image Container */}
            <div 
              className="bg-slate-950 flex flex-col items-center justify-center p-3 sm:p-4 relative min-h-[300px] max-h-[70vh] overflow-hidden select-none touch-none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {isPhotoLoading && !photoError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 z-20 gap-2.5">
                  <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                  <span className="text-xs font-semibold text-slate-300">Memuat foto bukti...</span>
                </div>
              )}

              {!photoError ? (
                <div className="w-full flex justify-center items-center overflow-visible p-2 min-h-[250px] relative">
                  <img 
                    src={selectedPhotoUrl || ''} 
                    alt="Bukti Foto Lapangan"
                    title={zoomScale > 1 ? "Klik & geser untuk menggeser foto sampai batas tepi. Klik ganda untuk reset." : "Klik ganda (2x) untuk Zoom In / Out"}
                    onDragStart={(e) => e.preventDefault()}
                    style={{
                      transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomScale})`,
                      transformOrigin: 'center center',
                      transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)'
                    }}
                    onDoubleClick={() => {
                      if (zoomScale === 1) {
                        setZoomScale(2);
                      } else {
                        handleResetZoomPan();
                      }
                    }}
                    className={`max-w-full max-h-[65vh] w-auto h-auto object-contain rounded-2xl shadow-lg transition-opacity duration-300 ${
                      zoomScale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
                    } ${isPhotoLoading ? 'opacity-0' : 'opacity-100'}`}
                    referrerPolicy="no-referrer"
                    onLoad={() => setIsPhotoLoading(false)}
                    onError={() => {
                      setIsPhotoLoading(false);
                      if (selectedPhotoFileId && !fallbackAttempted) {
                        setFallbackAttempted(true);
                        setSelectedPhotoUrl(`https://lh3.googleusercontent.com/d/${selectedPhotoFileId}`);
                      } else {
                        setPhotoError(true);
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-6 space-y-3 bg-slate-900/60 rounded-2xl border border-slate-800 my-auto">
                  <AlertCircle className="w-12 h-12 text-amber-400 shrink-0" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-white">Preview Gambar Tidak Dapat Ditampilkan Langsung</h4>
                    <p className="text-xs text-slate-400 max-w-md leading-relaxed">
                      Google Drive membatasi tampilan tersemat (embed) untuk file ini. Anda dapat tetap melihat foto bukti secara penuh melalui tombol di bawah.
                    </p>
                  </div>
                  {selectedOriginalUrl && (
                    <a
                      href={selectedOriginalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Buka Foto di Google Drive / Tab Baru
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 bg-slate-950 flex items-center justify-between border-t border-slate-800 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {/* Administrator AI Screen Recapture Trigger Button from Photo Modal */}
                {currentRole === Role.ADMINISTRATOR && selectedPhotoActivity && (
                  <button
                    type="button"
                    onClick={() => {
                      handleRunAiRecapture(
                        selectedPhotoActivity,
                        selectedPhotoUrl || undefined,
                        selectedPhotoFileId || undefined
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
                    title="Periksa apakah foto ini asli diambil langsung atau memotret layar perangkat"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI Screen Recapture</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {selectedOriginalUrl && (
                  <a
                    href={selectedOriginalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-sm active:scale-95 shrink-0 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Buka Dokumen Asli
                  </a>
                )}
                <button
                  type="button"
                  onClick={resetPhotoModal}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Screen Recapture Forensic Modal */}
      <AiScreenRecaptureModal
        isOpen={isAiRecaptureModalOpen}
        onClose={() => setIsAiRecaptureModalOpen(false)}
        activity={selectedAiActivity}
        photoUrl={selectedAiPhotoUrl}
        photoFileId={selectedAiPhotoFileId}
        result={selectedAiActivity ? getAiRecaptureResult(selectedAiActivity) : null}
        isLoading={isAiAnalyzing}
        error={aiAnalysisError}
        onReanalyze={() => {
          if (selectedAiActivity) {
            handleRunAiRecapture(
              selectedAiActivity,
              selectedAiPhotoUrl || undefined,
              selectedAiPhotoFileId || undefined,
              true
            );
          }
        }}
        profiles={profiles}
      />
    </div>
  );
};
