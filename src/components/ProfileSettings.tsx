/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UserProfile, Role } from '../types';
import { formatDivisiSubDivisi } from '../lib/googleApi';
import { useBackHandler } from '../hooks/useBackHandler';
import {
  User, Mail, Shield, Tag, Lock, ArrowLeft, Key, Eye, EyeOff, AlertCircle, CheckCircle2,
  Fuel, Smartphone, Camera, Image, Trash2, Loader2, RotateCw, X
} from 'lucide-react';

interface ProfileSettingsProps {
  userProfile: UserProfile;
  onUpdatePassword: (newPassword: string) => Promise<boolean>;
  onUpdateProfilePhoto: (updatedProfile: UserProfile, photoFile?: File | null) => Promise<boolean>;
  onClose: () => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  token?: string | null;
  driveFolderId?: string | null;
}

type Step = 'profile' | 'new-password' | 'success';

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  userProfile,
  onUpdatePassword,
  onUpdateProfilePhoto,
  onClose,
  theme,
  onThemeChange,
  token,
  driveFolderId
}) => {
  const [step, setStep] = useState<Step>('profile');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successPhotoMsg, setSuccessPhotoMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // Hidden native file inputs for camera and gallery
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Camera Live Stream state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Register back button handler for camera modal
  useBackHandler(isCameraOpen, () => stopCamera(), 'profile_camera_modal');

  const startCamera = async (mode: 'user' | 'environment' = 'user') => {
    setIsCameraOpen(true);
    setFacingMode(mode);
    setCameraError(null);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play();
      }
    } catch (err: any) {
      console.error('Failed to start camera:', err);
      setCameraError('Gagal mengakses kamera secara langsung. Anda dapat menggunakan tombol Kamera Bawaan HP.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCameraOpen(false);
  };

  const capturePhotoFromCamera = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `profile_${Date.now()}.jpg`, { type: 'image/jpeg' });
          stopCamera();
          handleProcessPhotoUpload(file);
        }
      }, 'image/jpeg', 0.88);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessPhotoUpload(file);
    }
    e.target.value = '';
  };

  const handleProcessPhotoUpload = async (file: File) => {
    setIsUploadingPhoto(true);
    setError(null);
    setSuccessPhotoMsg(null);
    try {
      const ok = await onUpdateProfilePhoto(userProfile, file);
      if (ok) {
        setSuccessPhotoMsg('Foto profil berhasil diperbarui & disimpan!');
      } else {
        setError('Gagal memperbarui foto profil. Silakan coba lagi.');
      }
    } catch (err: any) {
      setError(err.message || 'Gagal mengunggah foto profil ke Google Drive.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus foto profil ini?')) return;
    setIsUploadingPhoto(true);
    setError(null);
    setSuccessPhotoMsg(null);
    try {
      const ok = await onUpdateProfilePhoto(userProfile, null);
      if (ok) {
        setSuccessPhotoMsg('Foto profil berhasil dihapus!');
      } else {
        setError('Gagal menghapus foto profil.');
      }
    } catch (err: any) {
      setError(err.message || 'Gagal menghapus foto profil.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleStartChangePassword = () => {
    setError(null);
    setNewPassword('');
    setConfirmPassword('');
    setStep('new-password');
  };

  const handleSaveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 4) {
      setError('Sandi baru harus minimal 4 karakter.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Konfirmasi sandi baru tidak cocok.');
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await onUpdatePassword(newPassword);
      if (success) {
        setStep('success');
      } else {
        setError('Gagal memperbarui kata sandi. Silakan coba lagi.');
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem saat memperbarui kata sandi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Hidden Native File Inputs */}
      <input
        type="file"
        ref={cameraInputRef}
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        type="file"
        ref={galleryInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Header and Back Button */}
      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm text-left">
        <button
          onClick={step === 'profile' ? onClose : () => setStep('profile')}
          className="w-8 h-8 rounded-xl border border-slate-100 hover:bg-slate-50 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-all cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-sm font-black text-slate-800 font-display">Pengaturan Profil & Sandi</h2>
          <p className="text-[10px] text-slate-400 font-medium">Informasi akun pengguna, foto profil, dan kata sandi</p>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl p-4 text-xs flex items-start gap-2.5 animate-slide-up text-left">
          <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5 text-rose-500" />
          <div>
            <p className="font-bold">Gagal</p>
            <p className="text-[11px] text-rose-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {successPhotoMsg && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-2xl p-3.5 text-xs flex items-center gap-2 animate-slide-up text-left">
          <CheckCircle2 className="w-4.5 h-4.5 shrink-0 text-emerald-600" />
          <p className="font-bold text-[11px]">{successPhotoMsg}</p>
        </div>
      )}

      {/* STEP 1: SHOW PROFILE DETAIL */}
      {step === 'profile' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4 text-left">
          
          {/* PROFILE PHOTO & USER IDENTITY HEADER */}
          <div className="flex flex-col sm:flex-row items-center gap-4 pb-4 border-b border-slate-100 text-center sm:text-left">
            {/* Foto Avatar Container */}
            <div className="relative group shrink-0">
              {userProfile.fotoProfile ? (
                <img
                  src={userProfile.fotoProfile}
                  alt={userProfile.nama || 'Foto Profil'}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-2 border-indigo-500/20 shadow-md transition-transform"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center font-black font-display text-2xl sm:text-3xl shadow-md border-2 border-indigo-400/30 shrink-0">
                  {userProfile.nama ? userProfile.nama.charAt(0).toUpperCase() : 'U'}
                </div>
              )}

              {isUploadingPhoto && (
                <div className="absolute inset-0 bg-slate-900/60 rounded-2xl flex flex-col items-center justify-center text-white backdrop-blur-xs">
                  <Loader2 className="w-6 h-6 animate-spin text-white mb-1" />
                  <span className="text-[9px] font-bold">Mengunggah...</span>
                </div>
              )}
            </div>

            {/* User Info & Photo Action Buttons */}
            <div className="flex-1 space-y-2">
              <div>
                <h3 className="font-display font-black text-slate-800 text-sm leading-tight">{userProfile.nama || 'Tanpa Nama'}</h3>
                <p className="text-[10px] text-slate-400 font-medium font-mono mt-0.5">{userProfile.email}</p>
              </div>

              {/* Photo Action Buttons */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 pt-1">
                <button
                  type="button"
                  disabled={isUploadingPhoto}
                  onClick={() => startCamera('user')}
                  className="py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] rounded-xl flex items-center gap-1.5 transition-all cursor-pointer border border-indigo-150 disabled:opacity-50"
                  title="Ambil foto profil langsung menggunakan Kamera"
                >
                  <Camera className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Kamera</span>
                </button>

                <button
                  type="button"
                  disabled={isUploadingPhoto}
                  onClick={() => galleryInputRef.current?.click()}
                  className="py-1.5 px-3 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-[11px] rounded-xl flex items-center gap-1.5 transition-all cursor-pointer border border-slate-200 disabled:opacity-50"
                  title="Unggah foto profil dari Galeri perangkat"
                >
                  <Image className="w-3.5 h-3.5 text-slate-500" />
                  <span>Galeri</span>
                </button>

                {userProfile.fotoProfile && (
                  <button
                    type="button"
                    disabled={isUploadingPhoto}
                    onClick={handleRemovePhoto}
                    className="py-1.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-[11px] rounded-xl flex items-center gap-1.5 transition-all cursor-pointer border border-rose-200 disabled:opacity-50"
                    title="Hapus foto profil"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>Hapus Foto</span>
                  </button>
                )}
              </div>
              <p className="text-[9px] text-slate-400 font-medium italic">
                * Foto tersimpan di Google Drive & diperbarui ke database Users.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50/50 p-2.5 rounded-2xl border border-slate-100">
                <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <User className="w-3 h-3 text-indigo-500" /> User ID
                </span>
                <span className="font-bold text-slate-700 font-mono">{userProfile.userId}</span>
              </div>

              <div className="bg-slate-50/50 p-2.5 rounded-2xl border border-slate-100">
                <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Shield className="w-3 h-3 text-indigo-500" /> Hak Akses / Role
                </span>
                <span className="font-bold text-indigo-600">{userProfile.role}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50/50 p-2.5 rounded-2xl border border-slate-100">
                <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Tag className="w-3 h-3 text-indigo-500" /> Divisi
                </span>
                <span className="font-bold text-slate-700">
                  {formatDivisiSubDivisi(userProfile.divisi, userProfile.subDivisi)}
                </span>
              </div>

              <div className="bg-slate-50/50 p-2.5 rounded-2xl border border-slate-100">
                <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Mail className="w-3 h-3 text-indigo-500" /> Manager Email
                </span>
                <span className="font-bold text-slate-700 truncate block" title={userProfile.managerEmail}>
                  {userProfile.managerEmail || '-'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50/50 p-2.5 rounded-2xl border border-slate-100">
                <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Smartphone className="w-3 h-3 text-indigo-500" /> Akses Perangkat
                </span>
                <span className={`font-bold ${userProfile.mobile ? 'text-purple-600' : 'text-slate-700'}`}>
                  {userProfile.mobile ? 'Wajib Mobile' : 'Mobile & Windows'}
                </span>
              </div>

              <div className="bg-slate-50/50 p-2.5 rounded-2xl border border-slate-100">
                <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Smartphone className="w-3 h-3 text-indigo-500" /> Device ID Terikat
                </span>
                <span className="font-bold text-slate-700 font-mono truncate block text-[10px]" title={userProfile.deviceId || 'Belum Terikat'}>
                  {userProfile.deviceId || 'Belum Terikat'}
                </span>
              </div>
            </div>

            {userProfile.aksesBBM && (
              <div className="bg-amber-50/70 p-2.5 rounded-2xl border border-amber-200/60 flex items-center gap-2">
                <Fuel className="w-4 h-4 text-amber-600 shrink-0" />
                <div>
                  <span className="text-xs font-bold text-amber-800 block">Pengisian BBM Duren Sawit</span>
                  <span className="text-[10px] text-amber-700 font-medium">Akses pengisian BBM aktif untuk akun ini.</span>
                </div>
              </div>
            )}
          </div>

          {/* Pilihan Tema */}
          <div className="pt-3 border-t border-slate-100 space-y-2.5">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">
              Tema Tampilan Aplikasi
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onThemeChange('theme1')}
                className={`flex flex-col items-center gap-2 p-2.5 rounded-2xl border transition-all cursor-pointer text-center ${
                  theme === 'theme1'
                    ? 'border-indigo-500 bg-indigo-50/50 shadow-inner'
                    : 'border-slate-150 hover:bg-slate-50'
                }`}
              >
                <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-sm" />
                <span className="text-[10px] font-bold text-slate-700">Biru (Indigo)</span>
              </button>

              <button
                type="button"
                onClick={() => onThemeChange('theme2')}
                className={`flex flex-col items-center gap-2 p-2.5 rounded-2xl border transition-all cursor-pointer text-center ${
                  theme === 'theme2'
                    ? 'border-emerald-500 bg-emerald-50/50 shadow-inner'
                    : 'border-slate-150 hover:bg-slate-50'
                }`}
              >
                <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-teal-600 to-emerald-600 shadow-sm" />
                <span className="text-[10px] font-bold text-slate-700">Hijau (Emerald)</span>
              </button>

              <button
                type="button"
                onClick={() => onThemeChange('theme3')}
                className={`flex flex-col items-center gap-2 p-2.5 rounded-2xl border transition-all cursor-pointer text-center ${
                  theme === 'theme3'
                    ? 'border-amber-500 bg-amber-50/50 shadow-inner'
                    : 'border-slate-150 hover:bg-slate-50'
                }`}
              >
                <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-orange-600 to-amber-600 shadow-sm" />
                <span className="text-[10px] font-bold text-slate-700">Amber (Gold)</span>
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100">
            <button
              onClick={handleStartChangePassword}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 transition-all cursor-pointer"
            >
              <Key className="w-4 h-4" />
              <span>Ganti Password Akun</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: PASSWORD INPUT FORM */}
      {step === 'new-password' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4 text-left animate-scale-up">
          <div className="space-y-1">
            <h3 className="text-sm font-black text-slate-800 font-display">Kata Sandi Baru</h3>
            <p className="text-[10px] text-slate-400 font-medium">Buat kata sandi baru untuk mengamankan akun Anda</p>
          </div>

          <form onSubmit={handleSaveNewPassword} className="space-y-4">
            <div className="space-y-3">
              {/* Password Baru */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Sandi Baru <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimal 4 karakter..."
                    className="w-full pl-9 pr-10 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none font-bold"
                    required
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Konfirmasi Password Baru */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Konfirmasi Sandi Baru <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ulangi sandi baru..."
                    className="w-full pl-9 pr-10 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none font-bold"
                    required
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStep('profile')}
                className="flex-1 py-2.5 border border-slate-150 hover:bg-slate-50 text-slate-600 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Kembali
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Menyimpan...' : 'Simpan Sandi Baru'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STEP 5: SUCCESS MODAL/BANNER */}
      {step === 'success' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4 text-center animate-scale-up">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-sm font-black text-slate-800 font-display">Berhasil Diperbarui</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Kata sandi akun Anda telah sukses diperbarui dan disinkronkan ke database sistem!
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => {
                setStep('profile');
                onClose();
              }}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              Selesai & Tutup
            </button>
          </div>
        </div>
      )}

      {/* INTERACTIVE LIVE CAMERA MODAL FOR PROFILE PHOTO */}
      {isCameraOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[100000] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-5 space-y-4 relative border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">AMBIL FOTO PROFIL</h3>
              </div>
              <button
                type="button"
                onClick={stopCamera}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative bg-slate-900 rounded-2xl overflow-hidden aspect-square flex items-center justify-center border border-slate-800 shadow-inner">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />

              {cameraError && (
                <div className="absolute inset-0 bg-slate-900/90 p-5 flex flex-col items-center justify-center text-center text-white space-y-3">
                  <AlertCircle className="w-10 h-10 text-amber-400" />
                  <p className="text-xs font-semibold">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      stopCamera();
                      cameraInputRef.current?.click();
                    }}
                    className="py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all"
                  >
                    Buka Kamera Bawaan HP
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => startCamera(facingMode === 'user' ? 'environment' : 'user')}
                className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
                title="Putar Kamera Kamera Depan / Belakang"
              >
                <RotateCw className="w-4 h-4" />
                <span>Putar Kamera</span>
              </button>

              <button
                type="button"
                onClick={capturePhotoFromCamera}
                disabled={!!cameraError}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                <Camera className="w-4 h-4" />
                <span>Ambil & Gunakan Foto</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
