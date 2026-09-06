/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  MapPin,
  Camera,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Smartphone,
  Sparkles,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import {
  checkAllDevicePermissions,
  requestNotificationPermission,
  requestGeolocationPermission,
  requestCameraPermission,
  DevicePermissionsStatus,
  PermissionState,
} from '../lib/devicePermissions';
import {
  subscribeToPushNotifications,
  sendTestPushNotification,
} from '../lib/pushNotifications';
import { UserProfile } from '../types';

interface DevicePermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPermissionsUpdated?: (status: DevicePermissionsStatus) => void;
  forceShowAll?: boolean;
  userProfile?: UserProfile | null;
}

export const DevicePermissionsModal: React.FC<DevicePermissionsModalProps> = ({
  isOpen,
  onClose,
  onPermissionsUpdated,
  userProfile,
}) => {
  const [status, setStatus] = useState<DevicePermissionsStatus>({
    notification: 'prompt',
    geolocation: 'prompt',
    camera: 'prompt',
    allGranted: false,
    hasAnyDenied: false,
    hasAnyPrompt: true,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [requestingItem, setRequestingItem] = useState<string | null>(null);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [testPushStatus, setTestPushStatus] = useState<{ success: boolean; message: string } | null>(null);

  // Refresh permissions status
  const refreshStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const current = await checkAllDevicePermissions();
      setStatus(current);
      if (onPermissionsUpdated) {
        onPermissionsUpdated(current);
      }
    } catch (err) {
      console.warn('Failed to check device permissions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [onPermissionsUpdated]);

  useEffect(() => {
    if (isOpen) {
      refreshStatus();
    }
  }, [isOpen, refreshStatus]);

  // Listen to window focus so when user comes back from browser settings, status updates automatically
  useEffect(() => {
    const handleFocus = () => {
      if (isOpen) {
        refreshStatus();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [isOpen, refreshStatus]);

  if (!isOpen) return null;

  const handleRequestNotification = async () => {
    setRequestingItem('notification');
    try {
      const perm = await requestNotificationPermission();
      await refreshStatus();
      if (perm === 'granted') {
        const targetUser = userProfile || {
          email: 'ops.depotel@gmail.com',
          name: 'User DIOMS',
        };
        subscribeToPushNotifications(targetUser).catch((err) => {
          console.warn('[WebPush] Auto-subscribe after permission granted:', err);
        });
      }
    } finally {
      setRequestingItem(null);
    }
  };

  const handleTestPush = async () => {
    setIsTestingPush(true);
    setTestPushStatus(null);
    try {
      const targetUser = userProfile || {
        email: 'ops.depotel@gmail.com',
        name: 'User DIOMS',
      };
      // Ensure subscribed
      await subscribeToPushNotifications(targetUser);
      const result = await sendTestPushNotification(targetUser.email);
      setTestPushStatus({
        success: result.success,
        message: result.success
          ? result.message || 'Push notifikasi terkirim ke perangkat Anda!'
          : result.error || 'Gagal mengirim push notifikasi.',
      });
      setTimeout(() => setTestPushStatus(null), 6000);
    } catch (err: any) {
      setTestPushStatus({
        success: false,
        message: err?.message || 'Terjadi kesalahan saat menguji coba push notifikasi.',
      });
    } finally {
      setIsTestingPush(false);
    }
  };

  const handleRequestGeolocation = async () => {
    setRequestingItem('geolocation');
    try {
      await requestGeolocationPermission();
      await refreshStatus();
    } finally {
      setRequestingItem(null);
    }
  };

  const handleRequestCamera = async () => {
    setRequestingItem('camera');
    try {
      await requestCameraPermission();
      await refreshStatus();
    } finally {
      setRequestingItem(null);
    }
  };

  const handleRequestAll = async () => {
    setRequestingItem('all');
    try {
      // 1. Notification if prompt
      if (status.notification === 'prompt') {
        await requestNotificationPermission();
      }
      // 2. Geolocation if prompt
      if (status.geolocation === 'prompt') {
        await requestGeolocationPermission();
      }
      // 3. Camera if prompt
      if (status.camera === 'prompt') {
        await requestCameraPermission();
      }
      await refreshStatus();
    } finally {
      setRequestingItem(null);
    }
  };

  const renderBadge = (
    permState: PermissionState,
    onRequest: () => void,
    itemKey: string
  ) => {
    const isThisRequesting = requestingItem === itemKey || requestingItem === 'all';

    if (permState === 'granted') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold rounded-full shrink-0 shadow-2xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          Aktif
        </span>
      );
    }

    if (permState === 'denied') {
      return (
        <button
          type="button"
          onClick={() => setShowTroubleshoot(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold rounded-full shrink-0 transition-colors cursor-pointer"
          title="Izin diblokir di browser. Klik untuk melihat panduan membuka blokir."
        >
          <XCircle className="w-3.5 h-3.5 text-red-500" />
          Diblokir
        </button>
      );
    }

    if (permState === 'unsupported') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 bg-slate-100 text-slate-500 border border-slate-200 text-xs font-medium rounded-full shrink-0">
          Tidak Didukung
        </span>
      );
    }

    // Default / Prompt
    return (
      <button
        type="button"
        onClick={onRequest}
        disabled={isThisRequesting}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-xs active:scale-95 disabled:opacity-50 shrink-0"
      >
        {isThisRequesting ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Memproses...
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5 text-blue-200" />
            Aktifkan
          </>
        )}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-up">
        {/* Header */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 p-5 sm:p-6 text-white relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors cursor-pointer"
            title="Tutup"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 shrink-0 shadow-inner">
              <Smartphone className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold font-display text-white">
                Status Izin Perangkat
              </h2>
              <p className="text-xs text-slate-300">
                Akses fitur operasional lapangan & notifikasi status
              </p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Overview Info */}
          <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-3.5 text-xs text-blue-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Pastikan 3 izin utama di bawah ini berstatus <strong>Aktif</strong> agar notifikasi status UID dan dokumentasi kegiatan site tidak terhambat.
            </p>
          </div>

          {/* List of Permissions */}
          <div className="space-y-3">
            {/* 1. Notifikasi */}
            <div className={`border rounded-2xl p-4 transition-all ${
              status.notification === 'granted'
                ? 'bg-emerald-50/40 border-emerald-200/80'
                : status.notification === 'denied'
                ? 'bg-red-50/30 border-red-200'
                : 'bg-white border-slate-200 hover:border-blue-300'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    status.notification === 'granted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    <Bell className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-800">
                      Notifikasi Status UID
                    </h3>
                  </div>
                </div>
                {renderBadge(status.notification, handleRequestNotification, 'notification')}
              </div>

              {status.notification === 'granted' && (
                <div className="mt-3 pt-2.5 border-t border-emerald-100/80 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-emerald-800 font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Web Push VAPID Aktif
                  </span>
                  <button
                    type="button"
                    onClick={handleTestPush}
                    disabled={isTestingPush}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    {isTestingPush ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Mengirim...</span>
                      </>
                    ) : (
                      <>
                        <Bell className="w-3 h-3" />
                        <span>Uji Coba Notifikasi</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {testPushStatus && (
                <div className={`mt-2 p-2 rounded-lg text-[11px] flex items-center gap-1.5 ${
                  testPushStatus.success
                    ? 'bg-emerald-100 text-emerald-900'
                    : 'bg-amber-100 text-amber-900'
                }`}>
                  {testPushStatus.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  )}
                  <span>{testPushStatus.message}</span>
                </div>
              )}
            </div>

            {/* 2. Lokasi / GPS */}
            <div className={`border rounded-2xl p-4 transition-all ${
              status.geolocation === 'granted'
                ? 'bg-emerald-50/40 border-emerald-200/80'
                : status.geolocation === 'denied'
                ? 'bg-red-50/30 border-red-200'
                : 'bg-white border-slate-200 hover:border-blue-300'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    status.geolocation === 'granted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-800">
                      Lokasi & GPS Presisi
                    </h3>
                  </div>
                </div>
                {renderBadge(status.geolocation, handleRequestGeolocation, 'geolocation')}
              </div>
            </div>

            {/* 3. Kamera */}
            <div className={`border rounded-2xl p-4 transition-all ${
              status.camera === 'granted'
                ? 'bg-emerald-50/40 border-emerald-200/80'
                : status.camera === 'denied'
                ? 'bg-red-50/30 border-red-200'
                : 'bg-white border-slate-200 hover:border-blue-300'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    status.camera === 'granted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-purple-100 text-purple-700'
                  }`}>
                    <Camera className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-800">
                      Kamera Perangkat
                    </h3>
                  </div>
                </div>
                {renderBadge(status.camera, handleRequestCamera, 'camera')}
              </div>
            </div>
          </div>

          {/* Troubleshooting Help if any is blocked */}
          {(status.hasAnyDenied || showTroubleshoot) && (
            <div className="border border-amber-200 bg-amber-50/60 rounded-2xl p-3.5 text-xs text-amber-900 transition-all">
              <button
                type="button"
                onClick={() => setShowTroubleshoot(!showTroubleshoot)}
                className="w-full flex items-center justify-between font-bold text-amber-950 cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-amber-600" />
                  Cara Membuka Izin yang Diblokir di Browser
                </span>
                {showTroubleshoot ? (
                  <ChevronUp className="w-4 h-4 text-amber-700" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-amber-700" />
                )}
              </button>

              {showTroubleshoot && (
                <div className="mt-2.5 pt-2.5 border-t border-amber-200/80 space-y-2 text-slate-700 leading-relaxed">
                  <p>
                    <strong>📱 Google Chrome (Android & Laptop):</strong>
                    <br />
                    1. Ketuk ikon <strong>Gembok / Setelan Situs</strong> di sebelah kiri bilah alamat URL browser (paling atas).
                    <br />
                    2. Pilih <strong>Izin (*Permissions*)</strong>.
                    <br />
                    3. Aktifkan kembali <em>Notifikasi</em>, <em>Lokasi</em>, dan <em>Kamera</em> ke posisi <strong>Izinkan (*Allow*)</strong>.
                  </p>
                  <p>
                    <strong>🍏 Safari (iPhone / iPad):</strong>
                    <br />
                    1. Buka <strong>Pengaturan HP (Settings)</strong> &rarr; pilih <strong>Safari</strong>.
                    <br />
                    2. Gulir ke bawah ke bagian <strong>Kamera</strong> dan <strong>Lokasi</strong> &rarr; ubah menjadi <strong>Izinkan (*Allow*)</strong>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center gap-2.5">
          {status.hasAnyPrompt ? (
            <button
              type="button"
              onClick={handleRequestAll}
              disabled={requestingItem !== null}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-bold text-sm rounded-2xl transition-all cursor-pointer shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {requestingItem === 'all' ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Mengaktifkan Semua Izin...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-blue-200" />
                  Aktifkan Semua Izin Sekaligus
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-sm rounded-2xl transition-all cursor-pointer shadow-sm flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-200" />
              Semua Izin Siap - Lanjutkan
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto py-2.5 px-4 text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 font-semibold text-xs rounded-2xl transition-all cursor-pointer text-center shrink-0"
          >
            Lanjutkan ke Aplikasi
          </button>
        </div>
      </div>
    </div>
  );
};
