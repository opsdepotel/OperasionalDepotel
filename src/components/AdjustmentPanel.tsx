/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Role, UserProfile, BudgetRequest, UsageReportItem, RequestStatus, ItemStatus } from '../types';
import { ArrowLeft, User, Search, Coins, FileText, Camera, Upload, CheckCircle2, AlertCircle, Loader2, Paperclip, ShieldCheck, Calendar } from 'lucide-react';
import { uploadReceiptFile } from '../lib/googleApi';

interface AdjustmentPanelProps {
  profiles: UserProfile[];
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  googleToken: string;
  driveFolderId: string;
  onCreateAdjustment: (
    targetUserEmail: string,
    amount: number,
    type: string,
    notes: string,
    tanggal: string,
    file: File | null
  ) => Promise<void>;
  onClose: () => void;
  onAuthError?: () => void;
}

export const AdjustmentPanel: React.FC<AdjustmentPanelProps> = ({
  profiles,
  requests,
  usageItems,
  googleToken,
  driveFolderId,
  onCreateAdjustment,
  onClose,
  onAuthError
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [adjustmentType, setAdjustmentType] = useState('');
  const [notes, setNotes] = useState('');
  const [tanggalAdjustment, setTanggalAdjustment] = useState(new Date().toISOString().split('T')[0]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputAmount, setInputAmount] = useState<string>('');

  // File Upload / Camera State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showCameraStream, setShowCameraStream] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Format Currency
  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(num);
  };

  const isBbmRequest = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
  const isBbmUsageItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

  // Calculate user operational balance
  const getUserBalance = (userEmail: string) => {
    const userReqs = requests.filter(r => r.userEmail.toLowerCase() === userEmail.toLowerCase() && !isBbmRequest(r));
    const userReqIds = userReqs.map(r => r.id);
    const userUsage = usageItems.filter(item => userReqIds.includes(item.requestId) && !isBbmUsageItem(item));

    const totalTransferred = userReqs.filter(r => r.siteId !== 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalAdjustments = userReqs.filter(r => r.siteId === 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalReportedApproved = userUsage
      .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
      .reduce((sum, item) => sum + item.nominal, 0);
    
    return totalTransferred + totalAdjustments - totalReportedApproved;
  };

  // Auto-fill nominal amount when selected user changes
  useEffect(() => {
    if (selectedUser) {
      const balance = getUserBalance(selectedUser.email);
      setInputAmount(Math.abs(balance).toString());
    } else {
      setInputAmount('');
    }
  }, [selectedUser]);

  // Filter unbalanced users
  const unbalancedUsers = profiles.filter(user => {
    // Exclude users with role ADMIN if they don't have transaction history, or keep them. Let's include all registered profiles with non-zero balance.
    const balance = getUserBalance(user.email);
    const matchSearch = 
      user.nama?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.divisi?.toLowerCase().includes(searchQuery.toLowerCase());
    return Math.abs(balance) > 0.01 && matchSearch;
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const startCameraStream = async () => {
    setError(null);
    try {
      setShowCameraStream(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error('Failed to get camera stream:', err);
      setError('Gagal mengakses kamera in-app. Silakan gunakan opsi file upload.');
      setShowCameraStream(false);
    }
  };

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCameraStream(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob) {
              const file = new File([blob], `bukti_adjustment_kamera_${Date.now()}.png`, { type: 'image/png' });
              setSelectedFile(file);
            }
          }, 'image/png');
        }
        stopCameraStream();
      } catch (err: any) {
        setError('Gagal mengambil foto dari kamera.');
      }
    }
  };

  // Form Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setError(null);

    const balance = getUserBalance(selectedUser.email);
    if (Math.abs(balance) < 0.01) {
      setError('User sudah balance (Rp 0).');
      return;
    }

    if (!adjustmentType) {
      setError('Pilih tipe Adjustment.');
      return;
    }

    if (!selectedFile) {
      setError('Bukti Potongan / Bukti Transfer wajib diupload.');
      return;
    }

    const parsedAmount = parseFloat(inputAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Nominal penyesuaian harus berupa angka positif lebih dari 0.');
      return;
    }

    setIsSubmitting(true);
    try {
      const isDeduction = adjustmentType === 'Pemotongan Gaji' || adjustmentType === 'Pengembalian Cash dari User';
      const adjustmentAmount = isDeduction ? -parsedAmount : parsedAmount;

      await onCreateAdjustment(
        selectedUser.email,
        adjustmentAmount,
        adjustmentType,
        notes || `Penyesuaian Saldo via ${adjustmentType}`,
        tanggalAdjustment,
        selectedFile
      );
      
      // Reset form on success
      setSelectedUser(null);
      setAdjustmentType('');
      setNotes('');
      setInputAmount('');
      setTanggalAdjustment(new Date().toISOString().split('T')[0]);
      setSelectedFile(null);
    } catch (err: any) {
      const isAuthError = err.message && (
        err.message.includes('401') ||
        err.message.toLowerCase().includes('authentication credentials') ||
        err.message.toLowerCase().includes('invalid_grant') ||
        err.message.toLowerCase().includes('unauthorized') ||
        err.message.toLowerCase().includes('token')
      );
      if (isAuthError && onAuthError) {
        onAuthError();
      } else {
        setError(err.message || 'Gagal menyimpan transaksi adjustment.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // If a user is selected, render the Adjustment Form
  if (selectedUser) {
    const balance = getUserBalance(selectedUser.email);
    const isPositiveBalance = balance > 0;

    const isDeduction = adjustmentType 
      ? (adjustmentType === 'Pemotongan Gaji' || adjustmentType === 'Pengembalian Cash dari User')
      : (balance > 0);
    const parsedInputAmount = parseFloat(inputAmount) || 0;
    const currentAdjustmentAmount = isDeduction ? -parsedInputAmount : parsedInputAmount;
    const projectedBalance = balance + currentAdjustmentAmount;

    return (
      <div className="space-y-4">
        {/* Back Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSelectedUser(null);
              setAdjustmentType('');
              setNotes('');
              setSelectedFile(null);
              setError(null);
            }}
            className="p-2 hover:bg-slate-100 text-slate-600 rounded-xl transition-all cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-sm font-black text-slate-800 font-display">Form Adjustment Saldo</h2>
            <p className="text-[10px] text-slate-400 font-medium">Sesuaikan saldo operasional user secara fleksibel</p>
          </div>
        </div>

        {/* User Card Info */}
        <div className="bg-slate-900 text-white rounded-2xl p-4 border border-slate-800 space-y-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-slate-300 border border-slate-700">
              {selectedUser.nama?.charAt(0).toUpperCase() || selectedUser.email.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-bold text-xs">{selectedUser.nama || selectedUser.userId}</h3>
              <p className="text-[10px] text-slate-400 font-mono">{selectedUser.email}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-800 text-left">
            <div>
              <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Saldo Saat Ini</span>
              <span className={`text-[11px] font-bold font-mono font-display ${isPositiveBalance ? 'text-blue-400' : 'text-rose-400'}`}>
                {formatIDR(balance)}
              </span>
            </div>
            <div>
              <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Nominal Penyesuaian</span>
              <span className={`text-[11px] font-bold font-mono font-display ${currentAdjustmentAmount > 0 ? 'text-emerald-400' : currentAdjustmentAmount < 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                {currentAdjustmentAmount > 0 ? `+${formatIDR(currentAdjustmentAmount)}` : currentAdjustmentAmount < 0 ? formatIDR(currentAdjustmentAmount) : formatIDR(0)}
              </span>
            </div>
            <div>
              <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Proyeksi Saldo Akhir</span>
              <span className={`text-[11px] font-bold font-mono font-display ${projectedBalance === 0 ? 'text-emerald-400' : projectedBalance > 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                {formatIDR(projectedBalance)}
              </span>
            </div>
          </div>
          <div className="text-[9px] text-slate-400 leading-relaxed bg-slate-950 p-2 rounded-xl border border-slate-800/80">
            {projectedBalance === 0 ? (
              <span>* Transaksi ini akan langsung membuat saldo operasional user menjadi <strong>Rp 0 (Balance)</strong>.</span>
            ) : (
              <span>* Transaksi ini akan mengubah saldo operasional user menjadi <strong>{formatIDR(projectedBalance)}</strong>.</span>
            )}
          </div>
        </div>

        {/* Adjustment Form */}
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-[11px] flex items-start gap-2 text-left">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Tipe Adjustment */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Pilihan Tindakan Adjustment <span className="text-red-500">*</span>
            </label>
            
            {isPositiveBalance ? (
              // Balance > 0 options
              <div className="grid grid-cols-1 gap-2.5">
                <label className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${adjustmentType === 'Pemotongan Gaji' ? 'border-indigo-500 bg-indigo-50/10 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    name="adjustmentType"
                    value="Pemotongan Gaji"
                    checked={adjustmentType === 'Pemotongan Gaji'}
                    onChange={(e) => setAdjustmentType(e.target.value)}
                    className="text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Pemotongan Gaji (Salary Cut)</span>
                    <span className="text-[10px] text-slate-500">Saldo lebih dari user akan diselesaikan dengan memotong gaji bulanan.</span>
                  </div>
                </label>

                <label className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${adjustmentType === 'Pengembalian Cash dari User' ? 'border-indigo-500 bg-indigo-50/10 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    name="adjustmentType"
                    value="Pengembalian Cash dari User"
                    checked={adjustmentType === 'Pengembalian Cash dari User'}
                    onChange={(e) => setAdjustmentType(e.target.value)}
                    className="text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Pengembalian Cash dari User</span>
                    <span className="text-[10px] text-slate-500">User menyerahkan kembali sisa dana cash secara tunai / transfer ke kas perusahaan.</span>
                  </div>
                </label>
              </div>
            ) : (
              // Balance < 0 options
              <div className="grid grid-cols-1 gap-2.5">
                <label className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${adjustmentType === 'Transfer Adjustment dari Admin' ? 'border-indigo-500 bg-indigo-50/10 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    name="adjustmentType"
                    value="Transfer Adjustment dari Admin"
                    checked={adjustmentType === 'Transfer Adjustment dari Admin'}
                    onChange={(e) => setAdjustmentType(e.target.value)}
                    className="text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Transfer Adjustment dari Admin</span>
                    <span className="text-[10px] text-slate-500">Kekurangan dana (dana talangan) user diselesaikan dengan mentransfer dana dari Admin.</span>
                  </div>
                </label>

                <label className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${adjustmentType === 'Pembayaran Cash kepada User' ? 'border-indigo-500 bg-indigo-50/10 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    name="adjustmentType"
                    value="Pembayaran Cash kepada User"
                    checked={adjustmentType === 'Pembayaran Cash kepada User'}
                    onChange={(e) => setAdjustmentType(e.target.value)}
                    className="text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Pembayaran Cash kepada User</span>
                    <span className="text-[10px] text-slate-500">Membayarkan kekurangan dana operasional user secara cash.</span>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Nominal Adjustment Input */}
          <div className="space-y-1.5 text-left">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Nominal Adjustment (IDR) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                placeholder="Masukkan nominal adjustment..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none font-bold"
                required
                min="0"
              />
              <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
            <p className="text-[9px] text-slate-400 leading-normal">
              Pre-filled dengan total imbalance otomatis (Rp {formatIDR(Math.abs(balance))}). Anda dapat mengubah nilai di atas secara manual jika diperlukan.
            </p>
          </div>

          {/* Tanggal Adjustment */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Tanggal Adjustment <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="date"
                value={tanggalAdjustment}
                onChange={(e) => setTanggalAdjustment(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                required
              />
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          {/* Keterangan Tambahan */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Keterangan / Catatan Tambahan (Opsional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Penyesuaian operasional Juni 2026..."
              className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none min-h-[70px] resize-none"
            />
          </div>

          {/* Upload Bukti */}
          <div className="space-y-2">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Upload Bukti Potongan / Bukti Transfer <span className="text-red-500">*</span>
            </label>

            {/* Hidden inputs */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*,application/pdf"
              className="hidden"
            />
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleFileChange}
              accept="image/*"
              capture="environment"
              className="hidden"
            />

            {/* Upload Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-[11px] rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Upload className="w-4 h-4 text-slate-500" />
                <span>Upload File / Foto</span>
              </button>

              <button
                type="button"
                onClick={startCameraStream}
                className="py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-[11px] rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Camera className="w-4 h-4 text-slate-500" />
                <span>Ambil Foto Kamera</span>
              </button>
            </div>

            {/* In-App Camera Stream UI */}
            {showCameraStream && (
              <div className="relative border border-slate-300 rounded-xl overflow-hidden bg-slate-900 flex flex-col items-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full max-h-[220px] object-cover"
                />
                <div className="p-2 w-full bg-slate-950 flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={stopCameraStream}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white font-bold text-[10px] rounded-lg cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] rounded-lg cursor-pointer flex items-center gap-1"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Ambil Foto</span>
                  </button>
                </div>
              </div>
            )}

            {/* Selected File Badge */}
            {selectedFile && (
              <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl p-2.5 text-[10px] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 truncate">
                  <Paperclip className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-bold truncate">{selectedFile.name}</span>
                  <span className="text-[9px] text-emerald-600 bg-emerald-100/50 px-1.5 py-0.5 rounded-md font-mono">
                    {(selectedFile.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="text-emerald-800 hover:text-red-500 font-bold px-1 text-xs cursor-pointer"
                >
                  Hapus
                </button>
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="pt-2 flex justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setSelectedUser(null);
                setAdjustmentType('');
                setNotes('');
                setSelectedFile(null);
                setError(null);
              }}
              disabled={isSubmitting}
              className="px-4 py-2.5 text-slate-500 hover:bg-slate-50 font-bold text-xs rounded-xl border border-transparent hover:border-slate-200 transition-all cursor-pointer disabled:opacity-50"
            >
              Kembali
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Memproses...</span>
                </>
              ) : (
                <span>Simpan Transaksi Adjustment</span>
              )}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Otherwise, render list of unbalanced users
  return (
    <div className="space-y-4">
      {/* Back to Dashboard Header */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-sm gap-2">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-all cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Dashboard</span>
        </button>
        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Adjustment Mode</span>
        </span>
      </div>

      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-3">
        <h3 className="font-display font-black text-slate-800 text-xs tracking-wide uppercase">Adjustment Saldo Operasional</h3>
        <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
          Daftar seluruh user dengan saldo operasional yang tidak balance (lebih atau kurang). Klik pada kartu user untuk memproses penyesuaian saldo ke <strong>Rp 0 (Balance)</strong>.
        </p>

        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Cari user berdasarkan nama atau email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>
      </div>

      {/* Users List Grid */}
      {unbalancedUsers.length > 0 ? (
        <div className="grid grid-cols-1 gap-3.5">
          {unbalancedUsers.map((user) => {
            const balance = getUserBalance(user.email);
            const isPositive = balance > 0;

            return (
              <div
                key={user.email}
                onClick={() => {
                  setSelectedUser(user);
                  setError(null);
                }}
                className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer relative overflow-hidden group flex flex-col justify-between"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors shrink-0">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">
                        {user.nama || user.userId}
                      </h4>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5">{user.email}</p>
                      <p className="text-[9px] text-slate-500 font-medium mt-1">
                        Divisi: <strong className="text-slate-700">{user.divisi}</strong> • Role: <strong className="text-slate-700">{user.role}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[8px] font-bold text-slate-400 block uppercase tracking-wider">Saldo Operasional</span>
                    <span className={`text-sm font-bold font-mono font-display mt-0.5 block ${isPositive ? 'text-blue-600' : 'text-rose-600'}`}>
                      {isPositive ? `+${formatIDR(balance)}` : formatIDR(balance)}
                    </span>
                    <span className={`inline-block text-[8px] font-bold mt-1 px-1.5 py-0.5 rounded-md ${isPositive ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-rose-50 text-rose-600 border border-rose-100'}`}>
                      {isPositive ? 'Lebih Saldo' : 'Dana Talangan'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
          <h3 className="text-xs font-bold text-emerald-900 uppercase">Semua User Balance</h3>
          <p className="text-[10px] text-emerald-700/90 max-w-sm mx-auto">
            Luar biasa! Tidak ada user yang memiliki selisih saldo operasional (seluruh user dalam kondisi Balance Rp 0).
          </p>
        </div>
      )}
    </div>
  );
};
