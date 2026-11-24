/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useBackHandler } from '../hooks/useBackHandler';
import { UserProfile, SiteInfo, UserActivity, Role } from '../types';
import { safeSetJson } from '../lib/storage';
import {
  saveOfflineActivityLog,
  getOfflineActivityLogs,
  removeOfflineActivityLog,
  dataURLtoFile,
  OfflineActivityItem
} from '../lib/offlineReportStorage';
import { Calendar, MapPin, Camera, ChevronLeft, Plus, Image as ImageIcon, Loader2, RefreshCw, Compass, ExternalLink, AlertTriangle, AlertCircle, AlertOctagon, User, Filter, Building2, Search, X, Sparkles, ShieldCheck, ShieldAlert, Monitor, ZoomIn, ZoomOut, RotateCcw, UploadCloud, Smartphone, Wifi, WifiOff, CloudOff, Send, Trash2, CheckCircle2, HardDrive, Car } from 'lucide-react';


import { detectFakeGps, recordGpsFixSample, PreviousActivityReference } from '../lib/fakeGpsDetector';
import { isMobileDevice } from '../lib/deviceUtils';
import { validateCapturedActivityPhoto, ActivityPhotoCaptureSource } from '../lib/activityPhotoValidator';
import { formatDivisiSubDivisi } from '../lib/googleApi';
import { AiScreenRecaptureModal, AiRecaptureResult } from './AiScreenRecaptureModal';
import { requestAiScreenRecapture } from '../lib/aiRecapture';
import { ActivityLogMapContainer } from './ActivityLogMapContainer';
import { AdminManualActivityModal, ManualActivitySubmitData } from './AdminManualActivityModal';

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
    jenisKendaraan?: string;
    platNomor?: string;
    indikasiFake?: boolean;
    fakeReason?: string;
  }, photoFile?: File) => Promise<void>;
  onUpdateActivity?: (act: UserActivity) => Promise<void> | void;
  onSaveManualActivity?: (data: ManualActivitySubmitData, photoFile: File) => Promise<void>;
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
  onSaveManualActivity,
  onBack
}) => {
  const currentRole = role || userProfile?.role || Role.USER;
  const isMobileUser = userProfile?.mobile === true ||
    String(userProfile?.mobile).trim().toUpperCase() === 'TRUE' ||
    String(userProfile?.mobile).trim().toUpperCase() === 'YA' ||
    String(userProfile?.mobile).trim() === '1';
  const isStrictMobile = isMobileUser || isMobileDevice();
  const supportsLiveCamera =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
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
  const [showMapContainer, setShowMapContainer] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Network connection status
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Offline Activities Queue
  const [offlineQueue, setOfflineQueue] = useState<OfflineActivityItem[]>([]);

  // Load offline activities from IndexedDB
  const refreshOfflineActivities = async () => {
    try {
      const logs = await getOfflineActivityLogs();
      setOfflineQueue(logs);
    } catch (err) {
      console.error('Failed to load offline activities:', err);
    }
  };

  useEffect(() => {
    refreshOfflineActivities();
  }, []);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Save Offline Item
  const saveOfflineActivity = async (
    data: {
      tanggal: string;
      siteId: string;
      siteName: string;
      coordinatesDb: string;
      coordinatesActual: string;
      keterangan: string;
      jenisKendaraan?: string;
      platNomor?: string;
      indikasiFake?: boolean;
      fakeReason?: string;
    },
    photoBlobOrUrl: File | string
  ) => {
    const newItem = await saveOfflineActivityLog(
      {
        ...data,
        userEmail: userEmail || userProfile?.email || '',
        userName: userProfile?.nama || userEmail || 'User'
      },
      photoBlobOrUrl
    );

    setOfflineQueue(prev => [newItem, ...prev.filter(q => q.id !== newItem.id)]);
    return newItem;
  };

  // Sync Offline Queue
  const syncOfflineActivities = async () => {
    if (offlineQueue.length === 0 || isSyncing) return;
    setIsSyncing(true);
    setSyncNotice(null);

    let successCount = 0;
    const remaining = [...offlineQueue];

    for (let i = offlineQueue.length - 1; i >= 0; i--) {
      const item = offlineQueue[i];
      try {
        const photoFile = dataURLtoFile(item.photoDataUrl, item.photoFileName, item.photoBlob);
        await onSaveActivity(
          {
            tanggal: item.tanggal,
            siteId: item.siteId,
            siteName: item.siteName,
            coordinatesDb: item.coordinatesDb,
            coordinatesActual: item.coordinatesActual,
            keterangan: item.keterangan,
            jenisKendaraan: item.jenisKendaraan,
            platNomor: item.platNomor,
            indikasiFake: item.indikasiFake,
            fakeReason: item.fakeReason
          },
          photoFile
        );

        await removeOfflineActivityLog(item.id);
        const idx = remaining.findIndex(q => q.id === item.id);
        if (idx !== -1) {
          remaining.splice(idx, 1);
        }
        successCount++;
      } catch (err: any) {
        console.error('Failed to sync offline activity item:', item.id, err);
        setSyncNotice(`Sebagian data belum disinkronkan. Akan dicoba kembali saat terhubung internet.`);
        break;
      }
    }

    setOfflineQueue(remaining);
    setIsSyncing(false);

    if (successCount > 0) {
      setSyncNotice(`${successCount} Laporan Kegiatan telah berhasil disinkronkan.`);
    }
  };

  // Auto sync when connection returns
  useEffect(() => {
    if (isOnline && offlineQueue.length > 0 && !isSyncing) {
      syncOfflineActivities();
    }
  }, [isOnline]);

  const handleDeleteOfflineDraft = async (id: string) => {
    await removeOfflineActivityLog(id);
    setOfflineQueue(prev => prev.filter(q => q.id !== id));
  };
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

  // Screen Recapture back handlers
  useBackHandler(!!selectedPhotoUrl, resetPhotoModal, 'activity_photoModal');
  useBackHandler(isAiRecaptureModalOpen, () => setIsAiRecaptureModalOpen(false), 'activity_aiRecaptureModal');

  // Manual Activity Report Modal State (Administrator)
  const [showAdminManualModal, setShowAdminManualModal] = useState(false);
  useBackHandler(showAdminManualModal, () => setShowAdminManualModal(false), 'activity_adminManualModal');

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
  const preFormBaselinePositionRef = useRef<GeolocationPosition | null>(null);
  const formOpenPositionRef = useRef<GeolocationPosition | null>(null);
  const formOpenedTimeRef = useRef<number | null>(null);
  const sessionGpsFixCountRef = useRef<number>(0);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [coordinatesDb, setCoordinatesDb] = useState('');
  const [coordinatesActual, setCoordinatesActual] = useState('');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [keterangan, setKeterangan] = useState('');
  const [jenisKendaraan, setJenisKendaraan] = useState('');
  const [platNomor, setPlatNomor] = useState('');
  const sanitizePlatNomor = (val: string) => val.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isPlatNomorRequired = jenisKendaraan === 'Mobil' || jenisKendaraan === 'Sepeda Motor';
  const isVehicleValid = Boolean(jenisKendaraan) && (!isPlatNomorRequired || sanitizePlatNomor(platNomor).length > 0);
  const [originalPhotoFile, setOriginalPhotoFile] = useState<File | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoValidationFlags, setPhotoValidationFlags] = useState<string[]>([]);
  const [capturedGpsSnapshot, setCapturedGpsSnapshot] = useState<{ coords: string; accuracy: number | null } | null>(null);
  const [isFetchingGps, setIsFetchingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Hybrid Live Camera Modal State & Refs (Option 4)
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraFallbackReason, setCameraFallbackReason] = useState<string | null>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [isCapturingFrame, setIsCapturingFrame] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraStartTokenRef = useRef(0);

  const stopCameraStream = () => {
    cameraStartTokenRef.current += 1;
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch {}
    }
    setIsCameraReady(false);
    setIsStartingCamera(false);
  };

  const closeLiveCameraModal = () => {
    stopCameraStream();
    setIsCameraModalOpen(false);
    setCameraFallbackReason(null);
    setIsCapturingFrame(false);
  };

  useBackHandler(showAddForm, () => {
    stopCameraStream();
    setIsCameraModalOpen(false);
    setCameraFallbackReason(null);
    setShowAddForm(false);
    setJenisKendaraan('');
    setPlatNomor('');
    setPhotoValidationFlags([]);
    setCapturedGpsSnapshot(null);
    formOpenPositionRef.current = null;
    formOpenedTimeRef.current = null;
  }, 'activity_addForm');
  useBackHandler(isCameraModalOpen, closeLiveCameraModal, 'activity_liveCameraModal');

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  useEffect(() => {
    if (!isCameraModalOpen) return;
    const handleVisibilityOrHide = () => {
      if (document.hidden && cameraStreamRef.current) {
        stopCameraStream();
        setCameraFallbackReason(
          'Kamera dijeda saat aplikasi berpindah ke latar belakang agar perangkat tidak terkunci. Ketuk "Coba Kamera Langsung" atau gunakan "Kamera Bawaan HP".'
        );
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrHide);
    window.addEventListener('pagehide', handleVisibilityOrHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrHide);
      window.removeEventListener('pagehide', handleVisibilityOrHide);
    };
  }, [isCameraModalOpen]);

  const startLiveCamera = async (facing: 'environment' | 'user' = cameraFacingMode) => {
    const token = ++cameraStartTokenRef.current;

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {}
    }

    setIsStartingCamera(true);
    setIsCameraReady(false);
    setCameraFallbackReason(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setIsStartingCamera(false);
      setCameraFallbackReason(
        'Browser perangkat ini tidak mendukung kamera langsung di dalam halaman. Silakan tekan tombol "Buka Kamera Bawaan HP" di bawah.'
      );
      return;
    }

    const requestWithTimeout = (constraints: MediaStreamConstraints, ms = 7000) => {
      return new Promise<MediaStream>((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('CAMERA_TIMEOUT'));
          }
        }, ms);

        navigator.mediaDevices
          .getUserMedia(constraints)
          .then((stream) => {
            window.clearTimeout(timer);
            if (settled) {
              stream.getTracks().forEach((t) => {
                try {
                  t.stop();
                } catch {}
              });
              return;
            }
            settled = true;
            resolve(stream);
          })
          .catch((err) => {
            window.clearTimeout(timer);
            if (settled) return;
            settled = true;
            reject(err);
          });
      });
    };

    try {
      let stream: MediaStream;
      try {
        stream = await requestWithTimeout({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1600 },
            height: { ideal: 1200 }
          },
          audio: false
        });
      } catch (err1: any) {
        const name1 = err1?.name || '';
        if (name1 === 'OverconstrainedError' || name1 === 'ConstraintNotSatisfiedError' || name1 === 'NotFoundError') {
          try {
            stream = await requestWithTimeout({
              video: { facingMode: facing },
              audio: false
            });
          } catch (err2: any) {
            const name2 = err2?.name || '';
            if (name2 === 'OverconstrainedError' || name2 === 'ConstraintNotSatisfiedError' || name2 === 'NotFoundError') {
              stream = await requestWithTimeout({
                video: true,
                audio: false
              });
            } else {
              throw err2;
            }
          }
        } else {
          throw err1;
        }
      }

      if (token !== cameraStartTokenRef.current) {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        return;
      }

      cameraStreamRef.current = stream;

      let videoEl = videoRef.current;
      if (!videoEl) {
        await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
        videoEl = videoRef.current;
      }

      if (token !== cameraStartTokenRef.current) {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        return;
      }

      if (videoEl) {
        videoEl.srcObject = stream;
        await new Promise<void>((resolveReady) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolveReady();
          };
          const checkReady = () => {
            if (videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
              finish();
            }
          };
          videoEl.onloadedmetadata = () => {
            videoEl.play().catch(() => {});
            checkReady();
          };
          videoEl.onplaying = checkReady;
          videoEl.play().catch(() => {});

          const pollReady = window.setInterval(() => {
            if (token !== cameraStartTokenRef.current) {
              window.clearInterval(pollReady);
              finish();
              return;
            }
            checkReady();
          }, 120);

          window.setTimeout(() => {
            window.clearInterval(pollReady);
            finish();
          }, 3500);
        });

        if (token !== cameraStartTokenRef.current) return;

        if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          setIsCameraReady(true);
          setIsStartingCamera(false);
        } else {
          stopCameraStream();
          setCameraFallbackReason(
            'Pratinjau kamera langsung tidak menampilkan gambar. Silakan gunakan "Buka Kamera Bawaan HP" di bawah.'
          );
        }
      } else {
        stopCameraStream();
        setCameraFallbackReason(
          'Tampilan pratinjau kamera belum siap. Silakan gunakan "Buka Kamera Bawaan HP" di bawah.'
        );
      }
    } catch (err: any) {
      if (token !== cameraStartTokenRef.current) return;
      stopCameraStream();

      const errName = err?.name || '';
      const errMsg = String(err?.message || '');
      let reason =
        'Kamera langsung gagal dibuka dari browser. Silakan gunakan tombol "Buka Kamera Bawaan HP" di bawah ini.';

      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        reason =
          'Izin akses kamera di browser belum diizinkan atau ditolak. Anda tetap dapat langsung memotret menggunakan tombol "Buka Kamera Bawaan HP" di bawah ini.';
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        reason =
          'Kamera sedang dipakai aplikasi lain atau terkunci sementara oleh perangkat. Tutup aplikasi kamera lain atau langsung tekan "Buka Kamera Bawaan HP".';
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        reason =
          'Perangkat kamera tidak ditemukan oleh browser. Silakan langsung gunakan tombol "Buka Kamera Bawaan HP" di bawah ini.';
      } else if (errMsg === 'CAMERA_TIMEOUT') {
        reason =
          'Kamera membutuhkan waktu terlalu lama untuk terbuka. Silakan langsung gunakan tombol "Buka Kamera Bawaan HP" di bawah ini.';
      }

      setCameraFallbackReason(reason);
    }
  };

  const handleOpenLiveCamera = () => {
    if (!selectedSiteId.trim() || !keterangan.trim()) {
      setErrorMsg('Wajib mengisi SiteID dan Keterangan Kegiatan terlebih dahulu.');
      return;
    }
    if (!jenisKendaraan) {
      setErrorMsg('Wajib memilih Jenis Kendaraan Operasional terlebih dahulu.');
      return;
    }
    if (isPlatNomorRequired && !sanitizePlatNomor(platNomor)) {
      setErrorMsg('Wajib mengisi Plat Nomor Kendaraan untuk jenis kendaraan Mobil atau Sepeda Motor.');
      return;
    }
    if (!isValidGpsCoordinates(coordinatesActual)) {
      setErrorMsg(
        'Data koordinat GPS wajib ada sebelum mengambil foto bukti kegiatan. Silakan aktifkan lokasi (GPS) dan klik "Ambil Ulang GPS".'
      );
      return;
    }
    setErrorMsg(null);
    setIsCameraModalOpen(true);
    void startLiveCamera(cameraFacingMode);
  };

  const handleSwitchCameraFacing = () => {
    const nextFacing = cameraFacingMode === 'environment' ? 'user' : 'environment';
    setCameraFacingMode(nextFacing);
    void startLiveCamera(nextFacing);
  };

  const handleCaptureLiveFrame = () => {
    const videoEl = videoRef.current;
    if (!videoEl || !isCameraReady || isCapturingFrame) return;

    const srcW = videoEl.videoWidth;
    const srcH = videoEl.videoHeight;
    if (!srcW || !srcH) {
      stopCameraStream();
      setCameraFallbackReason(
        'Bingkai kamera belum terbaca. Silakan gunakan "Buka Kamera Bawaan HP" di bawah ini.'
      );
      return;
    }

    setIsCapturingFrame(true);
    try {
      const MAX_DIM = 1600;
      let dstW = srcW;
      let dstH = srcH;
      if (dstW > MAX_DIM || dstH > MAX_DIM) {
        if (dstW > dstH) {
          dstH = Math.round((dstH * MAX_DIM) / dstW);
          dstW = MAX_DIM;
        } else {
          dstW = Math.round((dstW * MAX_DIM) / dstH);
          dstH = MAX_DIM;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = dstW;
      canvas.height = dstH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setIsCapturingFrame(false);
        stopCameraStream();
        setCameraFallbackReason(
          'Gagal memproses gambar kamera. Silakan gunakan "Buka Kamera Bawaan HP" di bawah ini.'
        );
        return;
      }

      ctx.drawImage(videoEl, 0, 0, dstW, dstH);
      canvas.toBlob(
        (blob) => {
          canvas.width = 0;
          canvas.height = 0;
          setIsCapturingFrame(false);

          if (!blob || blob.size === 0) {
            stopCameraStream();
            setCameraFallbackReason(
              'Hasil tangkapan kamera kosong. Silakan coba lagi atau gunakan "Buka Kamera Bawaan HP".'
            );
            return;
          }

          const capturedFile = new File([blob], `ACT_LIVE_${Date.now()}.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });

          stopCameraStream();
          setIsCameraModalOpen(false);
          setCameraFallbackReason(null);
          setErrorMsg(null);
          setPhotoValidationFlags([]);
          setCapturedGpsSnapshot({
            coords: coordinatesActual,
            accuracy: gpsAccuracy
          });
          setOriginalPhotoFile(capturedFile);
        },
        'image/jpeg',
        0.92
      );
    } catch {
      setIsCapturingFrame(false);
      stopCameraStream();
      setCameraFallbackReason(
        'Terjadi kendala saat menangkap foto. Silakan gunakan "Buka Kamera Bawaan HP" di bawah ini.'
      );
    }
  };

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

        const wmCoords = capturedGpsSnapshot?.coords || coordinatesActual;
        const wmAcc = capturedGpsSnapshot ? capturedGpsSnapshot.accuracy : gpsAccuracy;
        const coordStr = wmCoords 
          ? (wmAcc !== null ? `GPS: ${wmCoords} (±${wmAcc}m)` : `GPS: ${wmCoords}`)
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
  }, [originalPhotoFile, selectedSiteId, siteName, coordinatesDb, capturedGpsSnapshot]);

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

  // Reverse geocode helper: dipanggil HANYA 1 kali saat tombol Submit ditekan dan HANYA jika SiteID/Lokasi tidak terdaftar di database
  const resolveReverseGeocodeOnSubmit = async (coord: string): Promise<string> => {
    if (!coord) return '';
    const parts = coord.split(',').map(s => s.trim());
    if (parts.length !== 2 || isNaN(Number(parts[0])) || isNaN(Number(parts[1]))) {
      return coord;
    }
    if (!isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return `Lokasi GPS (${coord})`;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2500);
    try {
      const [lat, lon] = parts;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
        { signal: controller.signal }
      );
      if (!res.ok) return `Lokasi GPS (${coord})`;
      const data = await res.json();
      if (data && typeof data.display_name === 'string' && data.display_name.trim()) {
        return data.display_name.trim();
      }
      return `Lokasi GPS (${coord})`;
    } catch {
      return `Lokasi GPS (${coord})`;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  // Helper to apply a valid GeolocationPosition to refs, history buffer, and (when form is open) UI state
  const applyGpsPositionToState = (position: GeolocationPosition, updateFormUi: boolean) => {
    lastGpsPositionRef.current = position;
    if (!preFormBaselinePositionRef.current) {
      preFormBaselinePositionRef.current = position;
    }
    sessionGpsFixCountRef.current = recordGpsFixSample(position);

    if (updateFormUi) {
      if (!formOpenPositionRef.current) {
        formOpenPositionRef.current = preFormBaselinePositionRef.current || position;
        formOpenedTimeRef.current = formOpenPositionRef.current.timestamp || Date.now();
      }
      const lat = position.coords.latitude.toFixed(6);
      const lon = position.coords.longitude.toFixed(6);
      const acc = position.coords.accuracy;
      setCoordinatesActual(`${lat}, ${lon}`);
      setGpsAccuracy(acc ? Math.round(acc) : null);
      setGpsError(null);
      setIsFetchingGps(false);
    }
  };

  // Two-stage non-stuck GPS requester: tries High Accuracy first, then automatically falls back
  // to Coarse/Fused OS location if High Accuracy times out or is unavailable indoors.
  const requestGpsWithFallback = (
    onSuccess: (pos: GeolocationPosition) => void,
    onFinalError?: (err: GeolocationPositionError) => void,
    highAccTimeoutMs = 5500,
    highAccMaxAgeMs = 3000
  ) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          if (onFinalError) onFinalError(err);
          return;
        }
        // Fallback ke Fused / Network Location agar pengguna di dalam gedung tidak pernah stuck
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          (fallbackErr) => {
            if (onFinalError) onFinalError(fallbackErr);
          },
          {
            enableHighAccuracy: false,
            timeout: 6500,
            maximumAge: 60000
          }
        );
      },
      {
        enableHighAccuracy: true,
        timeout: highAccTimeoutMs,
        maximumAge: highAccMaxAgeMs
      }
    );
  };

  // Prioritas #1: Silent Pre-Form Baseline GPS & App-Switch (visibilitychange) Capture
  // Merekam baseline sebelum form dibuka dan saat user kembali dari aplikasi lain (mis. Fake GPS)
  // sekaligus membuat koordinat langsung siap (0 detik tunggu) ketika form dibuka.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const captureSilentBaseline = (forceFresh = false) => {
      requestGpsWithFallback(
        (pos) => {
          applyGpsPositionToState(pos, showAddForm);
        },
        undefined,
        5000,
        forceFresh ? 0 : 10000
      );
    };

    captureSilentBaseline(false);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        captureSilentBaseline(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [showAddForm]);

  // Continuous GPS tracking & sample accumulation when form is opened
  useEffect(() => {
    if (!showAddForm) return;

    if (!navigator.geolocation) {
      setGpsError('Perangkat atau browser Anda tidak mendukung pencarian lokasi GPS.');
      setIsFetchingGps(false);
      return;
    }

    // Jika sudah ada posisi valid dari pre-warm, langsung tampilkan agar form 0ms langsung terbuka tanpa tunggu!
    if (lastGpsPositionRef.current && lastGpsPositionRef.current.coords) {
      const existingPos = lastGpsPositionRef.current;
      if (!formOpenPositionRef.current) {
        formOpenPositionRef.current = preFormBaselinePositionRef.current || existingPos;
        formOpenedTimeRef.current = formOpenPositionRef.current.timestamp || Date.now();
      }
      const lat = existingPos.coords.latitude.toFixed(6);
      const lon = existingPos.coords.longitude.toFixed(6);
      const acc = existingPos.coords.accuracy;
      setCoordinatesActual(`${lat}, ${lon}`);
      setGpsAccuracy(acc ? Math.round(acc) : null);
      setGpsError(null);
      setIsFetchingGps(false);
    } else {
      setIsFetchingGps(true);
      setGpsError(null);
    }

    const updatePosition = (position: GeolocationPosition) => {
      applyGpsPositionToState(position, true);
    };

    const handleGpsError = (error: GeolocationPositionError) => {
      // Anti-Stuck: Jika sudah memiliki posisi GPS valid sebelumnya, jangan pernah mengunci ulang form
      if (lastGpsPositionRef.current && lastGpsPositionRef.current.coords) {
        const prev = lastGpsPositionRef.current;
        setCoordinatesActual(`${prev.coords.latitude.toFixed(6)}, ${prev.coords.longitude.toFixed(6)}`);
        setGpsAccuracy(prev.coords.accuracy ? Math.round(prev.coords.accuracy) : null);
        setGpsError(null);
        setIsFetchingGps(false);
        return;
      }

      console.warn('Error watching GPS:', error);
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

    // Watchdog anti-stuck: pastikan spinner tidak pernah menggantung > 9 detik di WebView mana pun
    const watchdogTimer = window.setTimeout(() => {
      setIsFetchingGps(false);
    }, 9000);

    // 1. Trigger immediate position request with automatic High-Accuracy -> Fused fallback
    requestGpsWithFallback(updatePosition, handleGpsError, 5500, 0);

    // 2. Continuous location tracking (maximumAge: 0 untuk mengumpulkan sampel segar Zero Drift & Jitter)
    const watchId = navigator.geolocation.watchPosition(
      updatePosition,
      (watchErr) => {
        if (watchErr.code === watchErr.PERMISSION_DENIED) {
          handleGpsError(watchErr);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );

    // 3. Interval re-check setiap 4 detik (non-blocking) untuk akumulasi sampel histori GPS
    const intervalId = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        updatePosition,
        () => {
          // Jika high-accuracy timeout di dalam ruangan, coba fallback ringan apabila belum punya fix sama sekali
          if (!lastGpsPositionRef.current) {
            navigator.geolocation.getCurrentPosition(updatePosition, () => {}, {
              enableHighAccuracy: false,
              timeout: 4000,
              maximumAge: 30000,
            });
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 3800,
          maximumAge: 0,
        }
      );
    }, 4000);

    return () => {
      window.clearTimeout(watchdogTimer);
      navigator.geolocation.clearWatch(watchId);
      clearInterval(intervalId);
    };
  }, [showAddForm]);

  // Handle Photo input (Native Camera fallback or Desktop Gallery)
  const handlePhotoChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    captureSource: ActivityPhotoCaptureSource = 'native-camera'
  ) => {
    const inputEl = e.target;
    if (!selectedSiteId.trim() || !keterangan.trim()) {
      setErrorMsg('Wajib mengisi SiteID dan Keterangan Kegiatan terlebih dahulu.');
      inputEl.value = '';
      return;
    }
    if (!jenisKendaraan) {
      setErrorMsg('Wajib memilih Jenis Kendaraan Operasional terlebih dahulu.');
      inputEl.value = '';
      return;
    }
    if (isPlatNomorRequired && !sanitizePlatNomor(platNomor)) {
      setErrorMsg('Wajib mengisi Plat Nomor Kendaraan untuk jenis kendaraan Mobil atau Sepeda Motor.');
      inputEl.value = '';
      return;
    }
    if (!isValidGpsCoordinates(coordinatesActual)) {
      setErrorMsg('Data koordinat GPS wajib ada sebelum mengambil foto bukti kegiatan. Silakan aktifkan lokasi (GPS) dan klik "Ambil Ulang GPS".');
      inputEl.value = '';
      return;
    }

    const file = inputEl.files && inputEl.files[0];
    if (!file) return;

    // Close live camera modal cleanly if opened via fallback
    stopCameraStream();
    setIsCameraModalOpen(false);
    setCameraFallbackReason(null);

    const validation = await validateCapturedActivityPhoto(file, {
      enforceStrictMobile: isStrictMobile,
      captureSource
    });

    if (!validation.allowed) {
      setErrorMsg(
        validation.rejectReason ||
          'Foto tidak dapat digunakan karena terdeteksi berasal dari Galeri/Penyimpanan HP. Anda wajib memotret secara langsung di lokasi saat ini menggunakan Kamera HP.'
      );
      setOriginalPhotoFile(null);
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoValidationFlags([]);
      setCapturedGpsSnapshot(null);
      inputEl.value = '';
      return;
    }

    setErrorMsg(null);
    setPhotoValidationFlags(validation.auditFlags);
    setCapturedGpsSnapshot({
      coords: coordinatesActual,
      accuracy: gpsAccuracy
    });
    setOriginalPhotoFile(file);
  };

  // Get real GPS location (Manual button with 2-stage fallback & anti-wipe protection)
  const handleGetGps = () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError('Perangkat atau browser Anda tidak mendukung pencarian lokasi GPS.');
      return;
    }

    setIsFetchingGps(true);
    const safetyTimer = window.setTimeout(() => {
      setIsFetchingGps(false);
    }, 9000);

    requestGpsWithFallback(
      (position) => {
        window.clearTimeout(safetyTimer);
        applyGpsPositionToState(position, true);
      },
      (error) => {
        window.clearTimeout(safetyTimer);
        // Jika sebelumnya sudah ada titik GPS yang valid, pertahankan agar form tidak terkunci
        if (lastGpsPositionRef.current && lastGpsPositionRef.current.coords) {
          const prev = lastGpsPositionRef.current;
          setCoordinatesActual(`${prev.coords.latitude.toFixed(6)}, ${prev.coords.longitude.toFixed(6)}`);
          setGpsAccuracy(prev.coords.accuracy ? Math.round(prev.coords.accuracy) : null);
          setGpsError(null);
          setIsFetchingGps(false);
          return;
        }

        console.warn('Error fetching GPS:', error);
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
      5500,
      0
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
    if (!jenisKendaraan) {
      setErrorMsg('Jenis Kendaraan operasional wajib dipilih.');
      return;
    }
    const cleanPlatNomor = sanitizePlatNomor(platNomor);
    if (isPlatNomorRequired && !cleanPlatNomor) {
      setErrorMsg('Plat Nomor Kendaraan wajib diisi untuk jenis kendaraan Mobil atau Sepeda Motor.');
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
      const resolvedGpsAddress = matchedSite
        ? ''
        : await resolveReverseGeocodeOnSubmit(coordinatesActual || coordinatesDb);
      const finalSiteName = matchedSite
        ? matchedSite.siteName
        : (resolvedGpsAddress || siteName.trim() || finalSiteId);
      const todayYmd = getTodayStr();

      // Prioritas #2: Cari laporan kegiatan terakhir milik user di hari yang sama (online maupun antrean offline)
      // untuk mendeteksi perpindahan lokasi mustahil antar-laporan meskipun browser sempat di-refresh
      let previousActivityRef: PreviousActivityReference | null = null;
      const cleanCurrEmail = (userEmail || userProfile?.email || '').toLowerCase().trim();
      let latestPrevTs = 0;

      const parseActivityTimestampMs = (rawTs?: string): number => {
        if (!rawTs) return 0;
        const direct = new Date(rawTs).getTime();
        if (!isNaN(direct) && direct > 0) return direct;
        const m = String(rawTs).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2})[\.:](\d{1,2})(?:[\.:](\d{1,2}))?)?/);
        if (m) {
          const [, d, mo, y, h = '0', mi = '0', s = '0'] = m;
          const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
          if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        return 0;
      };

      for (const act of activities) {
        if ((act.userEmail || '').toLowerCase().trim() !== cleanCurrEmail) continue;
        if (act.tanggal !== todayYmd) continue;
        if (!isValidGpsCoordinates(act.coordinatesActual)) continue;
        const tsMs = parseActivityTimestampMs(act.createdAt || act.timestamp);
        if (tsMs > latestPrevTs && tsMs <= Date.now()) {
          latestPrevTs = tsMs;
          previousActivityRef = {
            siteId: act.siteId,
            coordinatesActual: act.coordinatesActual,
            timestampMs: tsMs
          };
        }
      }

      for (const offItem of offlineQueue) {
        if ((offItem.userEmail || '').toLowerCase().trim() !== cleanCurrEmail) continue;
        if (offItem.tanggal !== todayYmd) continue;
        if (!isValidGpsCoordinates(offItem.coordinatesActual)) continue;
        const tsMs = typeof offItem.createdAt === 'number'
          ? offItem.createdAt
          : parseActivityTimestampMs(String(offItem.createdAt || ''));
        if (tsMs > latestPrevTs && tsMs <= Date.now()) {
          latestPrevTs = tsMs;
          previousActivityRef = {
            siteId: offItem.siteId,
            coordinatesActual: offItem.coordinatesActual,
            timestampMs: tsMs
          };
        }
      }

      // Perform silent Fake GPS check right before submission (Priorities #1, #2, #3)
      const fakeCheck = detectFakeGps(
        lastGpsPositionRef.current,
        coordinatesActual,
        null,
        Math.max(1, sessionGpsFixCountRef.current),
        formOpenPositionRef.current || preFormBaselinePositionRef.current,
        previousActivityRef
      );

      const combinedIndikasiFake = fakeCheck.isFake || photoValidationFlags.length > 0;
      const combinedFakeReason = [fakeCheck.reason, ...photoValidationFlags]
        .filter(Boolean)
        .join(' | ');

      const actPayload = {
        tanggal: todayYmd, // System date for real-time tracking
        siteId: finalSiteId,
        siteName: finalSiteName,
        coordinatesDb,
        coordinatesActual,
        keterangan: keterangan.trim(),
        jenisKendaraan,
        platNomor: cleanPlatNomor,
        indikasiFake: combinedIndikasiFake,
        fakeReason: combinedFakeReason
      };

      const resetFormFields = () => {
        stopCameraStream();
        setIsCameraModalOpen(false);
        setCameraFallbackReason(null);
        setSelectedSiteId('');
        setSiteName('');
        setCoordinatesDb('');
        setCoordinatesActual('');
        setGpsAccuracy(null);
        setKeterangan('');
        setJenisKendaraan('');
        setPlatNomor('');
        setOriginalPhotoFile(null);
        setPhotoFile(null);
        setPhotoPreview(null);
        setPhotoValidationFlags([]);
        setCapturedGpsSnapshot(null);
        setShowAddForm(false);
        // Jadikan posisi terakhir saat submit sebagai baseline untuk laporan berikutnya
        preFormBaselinePositionRef.current = lastGpsPositionRef.current;
        formOpenPositionRef.current = null;
        formOpenedTimeRef.current = null;
      };

      if (!isOnline) {
        await saveOfflineActivity(actPayload, photoPreview || photoFile);
        resetFormFields();
        setSyncNotice('Laporan tersimpan di perangkat. Akan otomatis dikirim saat jaringan internet kembali terhubung.');
        return;
      }

      try {
        await onSaveActivity(actPayload, photoFile);
        resetFormFields();
      } catch (err: any) {
        const errStr = (err.message || String(err)).toLowerCase();
        const isNetworkErr = !navigator.onLine || 
          errStr.includes('fetch') || 
          errStr.includes('network') || 
          errStr.includes('offline') || 
          errStr.includes('koneksi') ||
          errStr.includes('failed') ||
          errStr.includes('timeout') ||
          errStr.includes('401') ||
          errStr.includes('unauthenticated') ||
          errStr.includes('unauthorized') ||
          errStr.includes('authentication credentials') ||
          errStr.includes('invalid_grant');

        if (isNetworkErr) {
          await saveOfflineActivity(actPayload, photoPreview || photoFile);
          resetFormFields();
          setSyncNotice('Laporan tersimpan di perangkat. Akan otomatis dikirim saat jaringan internet kembali terhubung.');
        } else {
          setErrorMsg(err.message || 'Gagal menyimpan kegiatan.');
        }
      }
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

  const normalizeToYmd = (dateStr?: string | null): string => {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const s = dateStr.trim();
    // YYYY-MM-DD or YYYY/MM/DD
    const iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (iso) {
      return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    }
    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (dmy) {
      return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
    // ACT-YYYYMMDD
    const act = s.match(/ACT-(\d{4})(\d{2})(\d{2})/i);
    if (act) {
      return `${act[1]}-${act[2]}-${act[3]}`;
    }
    return s;
  };

  const parseActivityTime = (act: UserActivity): number => {
    // 1. Extract Year, Month, Day (Priority: act.tanggal -> act.createdAt -> act.timestamp -> act.id)
    let year = 0;
    let month = 0;
    let day = 0;

    const extractDate = (raw?: string | null): { y: number; m: number; d: number } | null => {
      if (!raw || typeof raw !== 'string') return null;
      const s = raw.trim();

      // Check ISO format YYYY-MM-DD or YYYY/MM/DD
      const isoMatch = s.match(/(?:^|[^\d])(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (isoMatch) {
        const y = parseInt(isoMatch[1], 10);
        const m = parseInt(isoMatch[2], 10) - 1;
        const d = parseInt(isoMatch[3], 10);
        if (y >= 2000 && y <= 2040 && m >= 0 && m <= 11 && d >= 1 && d <= 31) {
          return { y, m, d };
        }
      }

      // Check Indonesian / European format DD/MM/YYYY or DD-MM-YYYY
      const dmyMatch = s.match(/(?:^|[^\d])(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
      if (dmyMatch) {
        const d = parseInt(dmyMatch[1], 10);
        const m = parseInt(dmyMatch[2], 10) - 1;
        const y = parseInt(dmyMatch[3], 10);
        if (y >= 2000 && y <= 2040 && m >= 0 && m <= 11 && d >= 1 && d <= 31) {
          return { y, m, d };
        }
      }

      // Check ID format ACT-YYYYMMDD-
      const idMatch = s.match(/ACT-(\d{4})(\d{2})(\d{2})/i);
      if (idMatch) {
        const y = parseInt(idMatch[1], 10);
        const m = parseInt(idMatch[2], 10) - 1;
        const d = parseInt(idMatch[3], 10);
        if (y >= 2000 && y <= 2040 && m >= 0 && m <= 11 && d >= 1 && d <= 31) {
          return { y, m, d };
        }
      }

      return null;
    };

    const parsedDate =
      extractDate(act.tanggal) ||
      extractDate(act.createdAt) ||
      extractDate(act.timestamp) ||
      extractDate(act.id);

    if (parsedDate) {
      year = parsedDate.y;
      month = parsedDate.m;
      day = parsedDate.d;
    }

    // 2. Extract Hours, Minutes, Seconds from createdAt or timestamp
    let hh = 0;
    let mm = 0;
    let ss = 0;

    const timeCandidates = [act.createdAt, act.timestamp].filter(
      (s): s is string => !!s && typeof s === 'string' && s.trim().length > 0
    );

    for (const cand of timeCandidates) {
      const s = cand.trim();
      // Look for HH:MM:SS or HH.MM.SS (e.g. 17.36.36, 17:36:36, 17.36, T17:36:36)
      const timeMatch = s.match(/(?:^|[T, ]|\s)(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
      if (timeMatch) {
        const h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const sec = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && sec >= 0 && sec <= 59) {
          hh = h;
          mm = m;
          ss = sec;
          break;
        }
      }
    }

    if (year > 0 && day > 0) {
      return new Date(year, month, day, hh, mm, ss).getTime();
    }

    // 3. Fallback: Raw Unix timestamp if present
    for (const raw of [act.timestamp, act.createdAt]) {
      if (raw && typeof raw === 'string') {
        const trimmed = raw.trim();
        if (/^\d{10,13}$/.test(trimmed)) {
          const num = Number(trimmed);
          if (!isNaN(num)) return num > 1e11 ? num : num * 1000;
        }
      }
    }

    return 0;
  };

  // Map offline queue items into UserActivity format
  const offlineMappedActivities: (UserActivity & { isOfflineDraft?: boolean; offlineId?: string })[] = offlineQueue.map(q => ({
    id: q.id,
    userEmail: q.userEmail,
    userName: q.userName,
    tanggal: q.tanggal,
    createdAt: q.timestamp,
    siteId: q.siteId,
    siteName: q.siteName,
    coordinatesDb: q.coordinatesDb,
    coordinatesActual: q.coordinatesActual,
    keterangan: q.keterangan,
    jenisKendaraan: q.jenisKendaraan,
    platNomor: q.platNomor,
    buktiUrl: q.photoDataUrl,
    indikasiFake: q.indikasiFake,
    fakeReason: q.fakeReason,
    isOfflineDraft: true,
    offlineId: q.id
  }));

  const allCombinedActivities = [...offlineMappedActivities, ...activities];

  // Filter activities based on Role & Filter selections and sort newest first
  const filteredActivities = allCombinedActivities
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
        const actYmd = normalizeToYmd(act.tanggal);
        const filterYmd = normalizeToYmd(dateFilter) || dateFilter;
        if (actYmd !== filterYmd && act.tanggal !== dateFilter) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const timeA = parseActivityTime(a);
      const timeB = parseActivityTime(b);
      if (timeA !== timeB) {
        return timeB - timeA; // Newest first
      }
      const ymdA = normalizeToYmd(a.tanggal) || a.tanggal || '';
      const ymdB = normalizeToYmd(b.tanggal) || b.tanggal || '';
      const dateComp = ymdB.localeCompare(ymdA);
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
              stopCameraStream();
              setIsCameraModalOpen(false);
              setCameraFallbackReason(null);
              setShowAddForm(false);
              setErrorMsg(null);
              setSelectedSiteId('');
              setSiteName('');
              setCoordinatesDb('');
              setCoordinatesActual('');
              setKeterangan('');
              setJenisKendaraan('');
              setPlatNomor('');
              setOriginalPhotoFile(null);
              setPhotoFile(null);
              setPhotoPreview(null);
              setPhotoValidationFlags([]);
              setCapturedGpsSnapshot(null);
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

              {/* Kendaraan Operasional */}
              <div className="space-y-3 bg-slate-50/80 border border-slate-200/80 p-3.5 rounded-2xl">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Car className="w-3.5 h-3.5 text-indigo-600" />
                  <span>KENDARAAN OPERASIONAL</span>
                </span>

                {/* Jenis Kendaraan Dropdown */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="activity-jenis-kendaraan-select"
                    className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block"
                  >
                    JENIS KENDARAAN <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="activity-jenis-kendaraan-select"
                    value={jenisKendaraan}
                    onChange={(e) => {
                      setJenisKendaraan(e.target.value);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    disabled={!isGpsReady}
                    required
                    className={`w-full px-3 py-2 border rounded-xl text-xs font-semibold focus:outline-none transition-all ${
                      !isGpsReady
                        ? 'bg-slate-100/70 border-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-indigo-500'
                    }`}
                  >
                    <option value="">-- Pilih Jenis Kendaraan --</option>
                    <option value="Mobil">Mobil</option>
                    <option value="Sepeda Motor">Sepeda Motor</option>
                    <option value="Gabung Kendaraan">Gabung Kendaraan</option>
                    <option value="Kegiatan Non Kendaraan">Kegiatan Non Kendaraan</option>
                  </select>
                </div>

                {/* Plat Nomor Kendaraan (Selalu Huruf Besar) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="activity-plat-nomor-input"
                      className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block"
                    >
                      PLAT NOMOR KENDARAAN {isPlatNomorRequired && <span className="text-red-500">*</span>}
                    </label>
                    {jenisKendaraan && (
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          isPlatNomorRequired
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}
                      >
                        {isPlatNomorRequired ? 'Wajib diisi' : 'Opsional'}
                      </span>
                    )}
                  </div>
                  <input
                    id="activity-plat-nomor-input"
                    type="text"
                    value={platNomor}
                    onChange={(e) => {
                      setPlatNomor(sanitizePlatNomor(e.target.value));
                      if (errorMsg) setErrorMsg(null);
                    }}
                    onBeforeInput={(e: React.FormEvent<HTMLInputElement>) => {
                      const nativeEvent = e.nativeEvent as InputEvent;
                      if (nativeEvent?.data && /[^a-zA-Z0-9]/.test(nativeEvent.data)) {
                        e.preventDefault();
                      }
                    }}
                    disabled={!isGpsReady}
                    required={isPlatNomorRequired}
                    pattern={isPlatNomorRequired ? '[A-Z0-9]+' : '[A-Z0-9]*'}
                    title="Hanya huruf A-Z dan angka 0-9 tanpa spasi atau simbol"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={
                      !isGpsReady
                        ? 'Form terkunci: Tunggu GPS aktif...'
                        : !isPlatNomorRequired && jenisKendaraan
                          ? 'Opsional (boleh dikosongkan)'
                          : 'Contoh: B1234XYZ'
                    }
                    className={`w-full px-3 py-2 border rounded-xl text-xs font-mono font-bold uppercase tracking-wider focus:outline-none transition-all ${
                      !isGpsReady
                        ? 'bg-slate-100/70 border-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-white border-slate-200 text-slate-800 focus:ring-1 focus:ring-indigo-500'
                    }`}
                  />
                  <p className="text-[10px] text-slate-400 font-medium">
                    Hanya huruf <strong className="text-slate-500">A–Z</strong> dan angka <strong className="text-slate-500">0–9</strong> tanpa spasi atau simbol.
                  </p>
                </div>
              </div>

              {/* Camera Capture Only input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  AMBIL FOTO BUKTI (KAMERA HP LANGSUNG)
                </label>
                <div className={`flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl p-4 transition-colors relative ${(!photoPreview && (!selectedSiteId.trim() || !keterangan.trim() || !isVehicleValid || !isGpsReady)) ? 'bg-slate-100/50 cursor-not-allowed' : 'bg-slate-50 hover:bg-slate-100'}`}>
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
                          setPhotoValidationFlags([]);
                          setCapturedGpsSnapshot(null);
                          setErrorMsg(null);
                        }}
                        className="absolute bottom-2 right-2 bg-slate-900/80 hover:bg-slate-900 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg cursor-pointer"
                      >
                        Ulangi Foto
                      </button>
                    </div>
                  ) : (!selectedSiteId.trim() || !keterangan.trim() || !isVehicleValid || !isGpsReady) ? (
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
                            Silakan isi <strong className="text-slate-500 font-bold">Site ID</strong>, <strong className="text-slate-500 font-bold">Keterangan Kegiatan</strong>, dan <strong className="text-slate-500 font-bold">Kendaraan Operasional</strong> terlebih dahulu untuk mengaktifkan kamera.
                          </span>
                        )}
                      </span>
                    </div>
                  ) : isStrictMobile ? (
                    <div className="flex flex-col items-center gap-2 my-1 w-full">
                      {supportsLiveCamera ? (
                        <>
                          <button
                            type="button"
                            onClick={handleOpenLiveCamera}
                            id="activity-live-camera-btn"
                            className="cursor-pointer flex flex-col items-center justify-center gap-1.5 py-3.5 px-6 bg-sky-50/70 hover:bg-sky-100/70 active:scale-[0.98] border border-sky-200/80 text-sky-700 rounded-2xl shadow-xs transition-all w-full max-w-[240px]"
                          >
                            <Camera className="w-6 h-6 text-sky-600" />
                            <span className="text-xs font-bold text-sky-900 tracking-wide">Buka Kamera HP</span>
                            <span className="text-[10px] text-sky-600 font-medium">Pemotretan langsung anti-galeri</span>
                          </button>

                          <label className="cursor-pointer inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 hover:text-indigo-600 py-1 px-2.5 rounded-lg hover:bg-slate-100 transition-colors">
                            <Smartphone className="w-3 h-3" />
                            <span>Atau gunakan Kamera Bawaan HP</span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={(e) => { void handlePhotoChange(e, 'native-camera'); }}
                              onClick={(e) => {
                                stopCameraStream();
                                (e.target as HTMLInputElement).value = '';
                              }}
                              className="hidden"
                              id="activity-camera-input"
                            />
                          </label>
                        </>
                      ) : (
                        <label className="cursor-pointer flex flex-col items-center justify-center gap-1.5 py-3.5 px-6 my-1 bg-sky-50/50 hover:bg-sky-100/60 active:scale-[0.98] border border-sky-200/60 text-sky-700 rounded-2xl shadow-xs transition-all">
                          <Camera className="w-6 h-6 text-sky-600" />
                          <span className="text-xs font-bold text-sky-800 tracking-wide">Kamera HP</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => { void handlePhotoChange(e, 'native-camera'); }}
                            onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                            className="hidden"
                            id="activity-camera-input"
                            required
                          />
                        </label>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 p-2 w-full">
                      <label className="cursor-pointer flex flex-col items-center justify-center p-3 bg-sky-50/50 hover:bg-sky-100/60 text-sky-700 border border-sky-200/60 rounded-xl transition-all">
                        <Camera className="w-5 h-5 text-sky-600 mb-1" />
                        <span className="text-[10px] font-bold text-sky-800">Kamera HP</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => { void handlePhotoChange(e, 'native-camera'); }}
                          onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                          className="hidden"
                        />
                      </label>
                      <label className="cursor-pointer flex flex-col items-center justify-center p-3 bg-slate-50 hover:bg-sky-50 hover:text-sky-600 border border-slate-200 rounded-xl transition-all">
                        <UploadCloud className="w-5 h-5 text-slate-500 mb-1" />
                        <span className="text-[10px] font-bold text-slate-600">File / Galeri</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => { void handlePhotoChange(e, 'gallery'); }}
                          onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
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

        {/* Hybrid In-App Live Camera Modal (Option 4) */}
        {isCameraModalOpen && (
          <div className="fixed inset-0 z-[120] bg-slate-950/95 flex flex-col justify-between p-4 text-white animate-fade-in">
            {/* Top Bar */}
            <div className="flex items-center justify-between gap-2 max-w-lg w-full mx-auto">
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300 block">
                  Kamera Kegiatan Harian
                </span>
                <p className="text-xs font-bold text-white truncate">
                  {selectedSiteId.trim().toUpperCase()} {matchedSite ? `- ${matchedSite.siteName}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!cameraFallbackReason && (
                  <button
                    type="button"
                    onClick={handleSwitchCameraFacing}
                    disabled={isStartingCamera || isCapturingFrame}
                    title="Ganti Kamera Depan / Belakang"
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all cursor-pointer disabled:opacity-40"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeLiveCameraModal}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all cursor-pointer"
                  title="Tutup Kamera"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Center Viewfinder or Guaranteed Fallback */}
            <div className="flex-1 flex items-center justify-center my-3 max-w-lg w-full mx-auto min-h-0">
              {cameraFallbackReason ? (
                <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full space-y-4 text-center shadow-2xl">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/30 text-amber-300 flex items-center justify-center mx-auto">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-sm font-bold text-white">Gunakan Kamera Bawaan HP</h3>
                    <p className="text-xs text-slate-300 leading-relaxed">{cameraFallbackReason}</p>
                  </div>
                  <div className="space-y-2 pt-1">
                    <label
                      onClick={() => stopCameraStream()}
                      className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Buka Kamera Bawaan HP</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => { void handlePhotoChange(e, 'native-camera'); }}
                        onClick={(e) => {
                          stopCameraStream();
                          (e.target as HTMLInputElement).value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void startLiveCamera(cameraFacingMode)}
                      className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700 transition-all"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Coba Kamera Langsung Lagi</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative w-full h-full max-h-[65vh] rounded-2xl overflow-hidden bg-black border border-white/15 flex items-center justify-center shadow-2xl">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {isStartingCamera && (
                    <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-3 p-4 text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
                      <p className="text-xs font-semibold text-slate-200">Menyiapkan kamera HP...</p>
                      <label
                        onClick={() => {
                          stopCameraStream();
                          setCameraFallbackReason(
                            'Kamera bawaan HP telah dipilih. Jika Anda membatalkan pengambilan foto, ketuk "Buka Kamera Bawaan HP" atau "Coba Kamera Langsung Lagi".'
                          );
                        }}
                        className="mt-1 px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold rounded-lg border border-white/20 cursor-pointer flex items-center gap-1.5"
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        <span>Gunakan Kamera Bawaan HP</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => { void handlePhotoChange(e, 'native-camera'); }}
                          onClick={(e) => {
                            stopCameraStream();
                            (e.target as HTMLInputElement).value = '';
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Controls */}
            {!cameraFallbackReason && (
              <div className="max-w-lg w-full mx-auto flex flex-col items-center gap-3 pb-2">
                <button
                  type="button"
                  onClick={handleCaptureLiveFrame}
                  disabled={!isCameraReady || isCapturingFrame}
                  className="w-full max-w-xs py-3.5 px-6 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-display font-bold text-xs rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                  id="activity-capture-live-btn"
                >
                  {isCapturingFrame ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Mengambil Foto...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      <span>Ambil Foto Sekarang</span>
                    </>
                  )}
                </button>

                <label
                  onClick={() => {
                    stopCameraStream();
                    setCameraFallbackReason(
                      'Kamera bawaan HP telah dipilih. Jika Anda membatalkan pengambilan foto, ketuk "Buka Kamera Bawaan HP" atau "Coba Kamera Langsung Lagi".'
                    );
                  }}
                  className="cursor-pointer inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 hover:text-white py-1.5 px-3 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 transition-colors"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Ganti ke Kamera Bawaan HP (Autofokus/Flash)</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => { void handlePhotoChange(e, 'native-camera'); }}
                    onClick={(e) => {
                      stopCameraStream();
                      (e.target as HTMLInputElement).value = '';
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>
        )}
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
        
        {/* Network Status Badge */}
        <div className="flex items-center gap-1 text-[10px] font-bold">
          {isOnline ? (
            <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full" title="Terhubung ke Internet">
              <Wifi className="w-3 h-3 text-emerald-600" />
              Online
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-full animate-pulse" title="Koneksi Internet Terputus">
              <WifiOff className="w-3 h-3 text-amber-600" />
              Offline
            </span>
          )}
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        
        {/* Sync Toast Notice */}
        {syncNotice && (
          <div className="bg-indigo-900 text-white rounded-2xl p-3.5 shadow-md flex items-start justify-between gap-2 text-xs font-medium animate-fadeIn">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{syncNotice}</span>
            </div>
            <button
              onClick={() => setSyncNotice(null)}
              className="text-indigo-300 hover:text-white text-xs font-bold p-1 shrink-0 cursor-pointer"
            >
              ×
            </button>
          </div>
        )}

        {/* Offline Queue Control Card */}
        {offlineQueue.length > 0 && (
          <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100/60 rounded-2xl border border-amber-300 p-4 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500 text-white rounded-xl shadow-xs shrink-0">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-amber-950 text-xs tracking-tight">
                    Laporan Belum Disinkronkan ({offlineQueue.length})
                  </h3>
                  <p className="text-[10px] text-amber-800/90 font-medium leading-relaxed mt-0.5">
                    Laporan telah tersimpan di perangkat dan akan dikirim otomatis saat koneksi internet terhubung.
                  </p>
                </div>
              </div>
            </div>

            {/* List of pending items */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {offlineQueue.map((item) => (
                <div key={item.id} className="bg-white/90 border border-amber-200 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs shadow-2xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-800 truncate text-[11px]">{item.siteName || item.siteId}</span>
                      <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{item.tanggal}</span>
                    </div>
                    <p className="text-[10px] text-slate-600 truncate mt-0.5">{item.keterangan}</p>
                  </div>
                  <button
                    onClick={() => handleDeleteOfflineDraft(item.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
                    title="Hapus Laporan Ini"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="pt-1 flex items-center gap-2">
              <button
                onClick={syncOfflineActivities}
                disabled={isSyncing || !isOnline}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs py-2.5 px-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Menyinkronkan Laporan...
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    {!isOnline ? 'Internet Terputus (Menunggu Koneksi)' : 'Sinkronkan Sekarang'}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
        
        {/* Peta Lokasi Kegiatan Operasional Modal (Leaflet.js) - Akses Khusus ROLE ADMINISTRATOR */}
        {currentRole === Role.ADMINISTRATOR && showMapContainer && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/80 backdrop-blur-sm overflow-y-auto"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowMapContainer(false);
            }}
          >
            <div className="relative w-full max-w-5xl my-auto shadow-2xl">
              <ActivityLogMapContainer
                activities={allCombinedActivities}
                profiles={profiles}
                sites={sites}
                selectedDate={dateFilter}
                onClose={() => setShowMapContainer(false)}
              />
            </div>
          </div>
        )}

        {/* Filter Panel */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-indigo-600" />
              <h2 className="font-display font-bold text-slate-800 text-xs tracking-wider uppercase">Filter Activity User</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md uppercase">
                Role: {currentRole}
              </span>
            </div>
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

          {/* Tombol Lihat Peta Kegiatan (Khusus Role ADMINISTRATOR) di dalam kontainer FILTER ACTIVITY USER */}
          {currentRole === Role.ADMINISTRATOR && (
            <button
              onClick={() => setShowMapContainer(true)}
              className="w-full bg-gradient-to-r from-indigo-600 via-indigo-700 to-slate-900 hover:from-indigo-500 hover:to-slate-800 text-white font-display font-bold text-xs py-2.5 px-4 rounded-xl shadow-sm hover:shadow-indigo-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer border border-indigo-500/30 mt-2"
              id="btn-lihat-peta-kegiatan"
            >
              <Compass className="w-4 h-4 text-indigo-300" />
              <span>Lihat Peta Kegiatan</span>
            </button>
          )}
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
                  <div key={act.id} className={`bg-white rounded-2xl border ${act.isOfflineDraft ? 'border-amber-400 ring-2 ring-amber-200/60' : 'border-slate-200'} shadow-sm overflow-hidden flex flex-col`} id={`activity-card-${act.id}`}>
                    {act.isOfflineDraft && (
                      <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-bold px-3 py-1.5 flex items-center justify-between border-b border-amber-600">
                        <span className="flex items-center gap-1.5">
                          <WifiOff className="w-3.5 h-3.5 text-amber-100" />
                          BELUM DISINKRONKAN
                        </span>
                        <button
                          onClick={() => handleDeleteOfflineDraft(act.offlineId || act.id)}
                          className="text-amber-100 hover:text-white bg-amber-600/60 hover:bg-amber-700/80 px-2 py-0.5 rounded transition-colors cursor-pointer text-[9px]"
                        >
                          Hapus
                        </button>
                      </div>
                    )}
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
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                              Site: {act.siteId}
                            </span>
                            {(act.jenisKendaraan || act.platNomor) && (
                              <span
                                className="text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md inline-flex items-center gap-1"
                                title="Kendaraan Operasional"
                              >
                                <Car className="w-3 h-3 text-indigo-600 shrink-0" />
                                <span>{act.jenisKendaraan || 'Kendaraan'}</span>
                                {act.platNomor && (
                                  <span className="font-mono font-extrabold text-indigo-700">
                                    • {act.platNomor}
                                  </span>
                                )}
                              </span>
                            )}
                            {(() => {
                              const isManualAdmin = act.keterangan?.includes('[INPUT SUSULAN ADMIN') ||
                                                    act.coordinatesActual?.includes('[MANUAL ADMIN]') ||
                                                    act.fakeReason?.includes('Manual Activity Report') ||
                                                    act.id.startsWith('ACT-MANUAL-');
                              if (isManualAdmin) {
                                return (
                                  <span className="text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-md flex items-center gap-1 shadow-2xs" title="Laporan kegiatan diinput susulan oleh Administrator">
                                    <ShieldCheck className="w-3 h-3 text-amber-600" />
                                    Manual Admin
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                          
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
              formOpenPositionRef.current = preFormBaselinePositionRef.current || lastGpsPositionRef.current;
              formOpenedTimeRef.current = formOpenPositionRef.current?.timestamp || Date.now();
              setShowAddForm(true);
            }}
            className="w-full bg-slate-900 text-white font-display font-bold text-xs py-3 px-4 rounded-xl shadow-md hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-4"
            id="activity-add-trigger-btn"
          >
            <Plus className="w-4 h-4" />
            Tambah Activity Hari Ini
          </button>
        )}

        {/* "Manual Activity Report" Button - For Role ADMINISTRATOR */}
        {currentRole === Role.ADMINISTRATOR && onSaveManualActivity && (
          <button
            onClick={() => setShowAdminManualModal(true)}
            className="w-full bg-gradient-to-r from-slate-900 via-indigo-900 to-indigo-800 text-white font-display font-bold text-xs py-3 px-4 rounded-xl shadow-md hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-4 cursor-pointer"
            id="btn-admin-manual-activity-trigger"
          >
            <Plus className="w-4 h-4 text-indigo-300" />
            <span>+ Manual Activity Report (Admin)</span>
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

      {/* Manual Activity Report Modal for Administrator */}
      {showAdminManualModal && onSaveManualActivity && (
        <AdminManualActivityModal
          isOpen={showAdminManualModal}
          onClose={() => setShowAdminManualModal(false)}
          profiles={profiles}
          sites={sites}
          currentAdminEmail={userEmail}
          onSubmitManualActivity={onSaveManualActivity}
        />
      )}
    </div>
  );
};
