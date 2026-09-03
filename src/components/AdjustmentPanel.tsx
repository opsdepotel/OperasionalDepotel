/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Role, UserProfile, BudgetRequest, UsageReportItem, RequestStatus, ItemStatus } from '../types';
import { ArrowLeft, User, Search, Coins, FileText, Camera, Upload, CheckCircle2, AlertCircle, Loader2, Paperclip, ShieldCheck, Calendar, AlertTriangle, Lock, Eye, X } from 'lucide-react';
import { uploadReceiptFile, parseNumericValue, formatDivisiSubDivisi } from '../lib/googleApi';
import { FinancialReportsModal } from './FinancialReportsModal';
import { UserOperationalBalanceReportModal } from './UserOperationalBalanceReportModal';

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
  const [unclosedTalanganAlertUser, setUnclosedTalanganAlertUser] = useState<UserProfile | null>(null);
  const [financialReportsUserEmail, setFinancialReportsUserEmail] = useState<string | null>(null);
  const [talanganReportUserEmail, setTalanganReportUserEmail] = useState<string | null>(null);
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
  const formatIDR = (num: any) => {
    const val = parseNumericValue(num);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
  };

  const isBbmRequest = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
  const isBbmUsageItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

  // Helper to check if request is a Dana Talangan request
  const isTalanganRequest = (r: BudgetRequest) => {
    return (
      r.id.startsWith('OPT-') ||
      r.keterangan?.toUpperCase().includes('[DANA TALANGAN]') ||
      r.keterangan?.toUpperCase().includes('DANA TALANGAN') ||
      r.keterangan?.toUpperCase().includes('TALANGAN') ||
      r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
    );
  };

  // Helper to get unclosed Dana Talangan requests for a user
  const getUnclosedTalanganRequests = (userEmail: string) => {
    return requests.filter(r => 
      r.userEmail.toLowerCase() === userEmail.toLowerCase() &&
      isTalanganRequest(r) &&
      r.status !== RequestStatus.CLOSED &&
      r.status !== RequestStatus.REJECTED &&
      r.status !== RequestStatus.CANCELLED
    );
  };

  // Calculate global user operational balance (including OP-, OPT-, ADJ-, excluding BBM)
  const getUserBalance = (userEmail: string) => {
    const userReqs = requests.filter(r => 
      r.userEmail.toLowerCase() === userEmail.toLowerCase() && 
      !isBbmRequest(r)
    );
    const userReqIds = userReqs.map(r => r.id);
    const userUsage = usageItems.filter(item => userReqIds.includes(item.requestId) && !isBbmUsageItem(item));

    const totalTransferred = userReqs.filter(r => r.siteId !== 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalAdjustments = userReqs.filter(r => r.siteId === 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalReportedApproved = userUsage
      .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
      .reduce((sum, item) => sum + item.nominal, 0);
    
    return totalTransferred + totalAdjustments - totalReportedApproved;
  };

  // Detailed user financial summary (strictly OP- / Non-Talangan)
  const getUserSummary = (userEmail: string) => {
    const userReqs = requests.filter(r => 
      r.userEmail.toLowerCase() === userEmail.toLowerCase() && 
      !isBbmRequest(r) && 
      !isTalanganRequest(r)
    );
    const userReqIds = userReqs.map(r => r.id);
    const userUsage = usageItems.filter(item => userReqIds.includes(item.requestId) && !isBbmUsageItem(item));

    const totalTransferred = userReqs.filter(r => r.siteId !== 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalAdjustments = userReqs.filter(r => r.siteId === 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalReportedApproved = userUsage
      .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
      .reduce((sum, item) => sum + item.nominal, 0);

    const balance = totalTransferred + totalAdjustments - totalReportedApproved;
    const requiredNominal = Math.abs(balance);
    const isPositive = balance > 0;

    return {
      totalTransferred,
      totalAdjustments,
      totalReportedApproved,
      balance,
      requiredNominal,
      isPositive,
      userReqs,
      userUsage: userUsage.filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
    };
  };

  // Dedicated financial breakdown summary for Dana Talangan (OPT-)
  const getTalanganSummary = (userEmail: string) => {
    const talanganReqs = requests.filter(r => 
      r.userEmail.toLowerCase() === userEmail.toLowerCase() && 
      !isBbmRequest(r) && 
      isTalanganRequest(r)
    );
    const talanganReqIds = talanganReqs.map(r => r.id);
    const talanganUsage = usageItems.filter(item => talanganReqIds.includes(item.requestId) && !isBbmUsageItem(item));

    const totalTalanganTransferred = talanganReqs.reduce((sum, r) => sum + (r.adminActionAmount || 0), 0);
    const totalTalanganReportedApproved = talanganUsage
      .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
      .reduce((sum, item) => sum + item.nominal, 0);

    const countTotal = talanganReqs.length;
    const unclosedList = talanganReqs.filter(r => 
      r.status !== RequestStatus.CLOSED && 
      r.status !== RequestStatus.REJECTED && 
      r.status !== RequestStatus.CANCELLED
    );

    const unclosedNominal = totalTalanganTransferred - totalTalanganReportedApproved;

    return {
      countTotal,
      unclosedCount: unclosedList.length,
      unclosedNominal,
      totalTalanganTransferred,
      totalTalanganReportedApproved,
      hasTalangan: countTotal > 0
    };
  };

  // Auto-fill nominal amount when selected user changes (OP- required nominal)
  useEffect(() => {
    if (selectedUser) {
      const summary = getUserSummary(selectedUser.email);
      setInputAmount(Math.round(summary.requiredNominal).toString());
    } else {
      setInputAmount('');
    }
  }, [selectedUser]);

  // Unique profiles deduplicated by email
  const uniqueProfiles = useMemo(() => {
    const map = new Map<string, UserProfile>();
    profiles.forEach(p => {
      const key = (p.email || '').toLowerCase().trim();
      if (key && !map.has(key)) {
        map.set(key, p);
      }
    });
    return Array.from(map.values());
  }, [profiles]);

  // Filter unbalanced users
  const unbalancedUsers = uniqueProfiles.filter(user => {
    // Exclude users with role ADMIN if they don't have transaction history, or keep them. Let's include all registered profiles with non-zero balance.
    const balance = getUserBalance(user.email);
    const matchSearch = 
      user.nama?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.divisi?.toLowerCase().includes(searchQuery.toLowerCase());
    return Math.abs(balance) > 0.01 && matchSearch;
  });

  // Calculate total required adjustment nominal for all unbalanced users
  const totalAdjustmentNominalAllUsers = useMemo(() => {
    return unbalancedUsers.reduce((sum, user) => {
      const summary = getUserSummary(user.email);
      return sum + summary.requiredNominal;
    }, 0);
  }, [unbalancedUsers, requests, usageItems]);

  // Adjustment transaction history
  const adjustmentHistoryRequests = useMemo(() => {
    return requests
      .filter(r => r.siteId === 'ADJUSTMENT')
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [requests]);

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

    const parsedAmount = parseNumericValue(inputAmount);
    if (parsedAmount <= 0) {
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
    const selectedSummary = getUserSummary(selectedUser.email);
    const selectedTalanganSummary = getTalanganSummary(selectedUser.email);
    const balance = selectedSummary.balance;
    const isPositiveBalance = selectedSummary.isPositive;
    const selectedUnclosedTalangan = getUnclosedTalanganRequests(selectedUser.email);

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
              <p className="text-[9px] text-slate-300 font-medium mt-0.5">
                Divisi : {formatDivisiSubDivisi(selectedUser.divisi, selectedUser.subDivisi)}
              </p>
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
              <span className="block text-[8px] font-bold text-indigo-300 uppercase tracking-wider">Nominal Adjustment</span>
              <span className={`text-[11px] font-bold font-mono font-display ${currentAdjustmentAmount > 0 ? 'text-emerald-400' : currentAdjustmentAmount < 0 ? 'text-amber-400' : 'text-indigo-200'}`}>
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

          {/* Rincian Finansial User (Operasional Biasa) */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-[10px] text-left">
            <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
              <span className="text-[8px] text-slate-400 uppercase block font-semibold">Total Transfer</span>
              <span className="font-bold font-mono text-slate-200">{formatIDR(selectedSummary.totalTransferred)}</span>
            </div>
            <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
              <span className="text-[8px] text-slate-400 uppercase block font-semibold">Laporan Disetujui</span>
              <span className="font-bold font-mono text-emerald-400">{formatIDR(selectedSummary.totalReportedApproved)}</span>
            </div>
            <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
              <span className="text-[8px] text-slate-400 uppercase block font-semibold">Adjustment Lalu</span>
              <span className="font-bold font-mono text-slate-300">{formatIDR(selectedSummary.totalAdjustments)}</span>
            </div>
          </div>

          {/* Badge Breakdown Khusus Dana Talangan (OPT-) di Form Jika Ada */}
          {selectedTalanganSummary.hasTalangan && (
            <div 
              onClick={() => setTalanganReportUserEmail(selectedUser.email)}
              className="bg-slate-950/80 hover:bg-slate-900/90 p-2.5 rounded-xl border border-amber-500/30 hover:border-amber-400/60 text-[10px] space-y-1.5 text-left cursor-pointer transition-all active:scale-98 group/talangan shadow-2xs"
              title="Klik untuk melihat Laporan Transaksi Khusus Dana Talangan (OPT-) User"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                <span className="text-[9px] font-bold text-amber-400 uppercase flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-amber-400 group-hover/talangan:scale-110 transition-transform" />
                  Rincian Khusus Dana Talangan (OPT-)
                </span>
                <span className="text-[8px] font-mono text-amber-300/80">
                  {selectedTalanganSummary.countTotal} Transaksi
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[9px]">
                <div>
                  <span className="text-[8px] text-slate-400 uppercase block">Total Transfer</span>
                  <span className="font-bold font-mono text-slate-200">{formatIDR(selectedTalanganSummary.totalTalanganTransferred)}</span>
                </div>
                <div>
                  <span className="text-[8px] text-slate-400 uppercase block">Laporan Disetujui</span>
                  <span className="font-bold font-mono text-emerald-400">{formatIDR(selectedTalanganSummary.totalTalanganReportedApproved)}</span>
                </div>
                <div>
                  <span className="text-[8px] text-slate-400 uppercase block font-semibold">Talangan Belum Closed</span>
                  <span className={`font-bold font-mono ${selectedTalanganSummary.unclosedNominal > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {formatIDR(selectedTalanganSummary.unclosedNominal)}
                    {selectedTalanganSummary.unclosedCount > 0 && (
                      <span className="text-[8px] font-normal text-amber-300/80 ml-1">
                        ({selectedTalanganSummary.unclosedCount})
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}

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
                <label className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${adjustmentType === 'Transfer Adjustment dari Finance' ? 'border-indigo-500 bg-indigo-50/10 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    name="adjustmentType"
                    value="Transfer Adjustment dari Finance"
                    checked={adjustmentType === 'Transfer Adjustment dari Finance'}
                    onChange={(e) => setAdjustmentType(e.target.value)}
                    className="text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Transfer Adjustment dari Finance</span>
                    <span className="text-[10px] text-slate-500">Kekurangan dana (dana talangan) user diselesaikan dengan mentransfer dana dari Finance.</span>
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
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="Masukkan nominal adjustment..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none font-bold"
                required
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

        {/* Ringkasan Total Nominal Adjustment */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-left">
            <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">User Membutuhkan Adjustment</span>
            <span className="text-sm font-black font-display text-slate-800">{unbalancedUsers.length} <span className="text-xs font-normal text-slate-500">User</span></span>
          </div>
          <div className="bg-indigo-50/80 p-3 rounded-xl border border-indigo-100 shadow-sm text-left">
            <span className="text-[9px] font-bold text-indigo-500 block uppercase tracking-wider">Total Nominal Adjustment Saldo</span>
            <span className="text-sm font-black font-mono font-display text-indigo-700 block">{formatIDR(totalAdjustmentNominalAllUsers)}</span>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative pt-1">
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
          {unbalancedUsers.map((user, idx) => {
            const userGlobalBalance = getUserBalance(user.email);
            const summary = getUserSummary(user.email);
            const talanganSummary = getTalanganSummary(user.email);
            const isGlobalPositive = userGlobalBalance > 0;
            const isGlobalNegative = userGlobalBalance < 0;
            const unclosedTalanganList = getUnclosedTalanganRequests(user.email);

            return (
              <div
                key={`${user.email}_${user.userId || idx}`}
                className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm transition-all relative overflow-hidden space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border bg-slate-50 text-slate-600 border-slate-100">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span>{user.nama || user.userId}</span>
                      </h4>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5">{user.email}</p>
                      <p className="text-[9px] text-slate-500 font-medium mt-1">
                        Divisi : <strong className="text-slate-700">{formatDivisiSubDivisi(user.divisi, user.subDivisi)}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[8px] font-bold text-slate-400 block uppercase tracking-wider">Saldo Operasional</span>
                    <span className={`text-sm font-bold font-mono font-display mt-0.5 block ${isGlobalPositive ? 'text-blue-600' : isGlobalNegative ? 'text-rose-600' : 'text-slate-600'}`}>
                      {isGlobalPositive ? `+${formatIDR(userGlobalBalance)}` : formatIDR(userGlobalBalance)}
                    </span>
                    <span className={`inline-block text-[8px] font-bold mt-1 px-1.5 py-0.5 rounded-md ${isGlobalPositive ? 'bg-blue-50 text-blue-600 border border-blue-200' : isGlobalNegative ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-slate-50 text-slate-600 border border-slate-200'}`}>
                      {isGlobalPositive ? 'Lebih Saldo' : isGlobalNegative ? 'Saldo Kurang' : 'Balance'}
                    </span>
                  </div>
                </div>

                {/* Detailed Financial Breakdown & Required Adjustment Nominal (Operasional Biasa) */}
                <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-2 text-left">
                  <div>
                    <span className="block text-[8px] font-bold text-slate-400 uppercase">Total Transfer</span>
                    <span className="text-[10px] font-bold font-mono text-slate-700">{formatIDR(summary.totalTransferred)}</span>
                  </div>
                  <div>
                    <span className="block text-[8px] font-bold text-slate-400 uppercase">Laporan Disetujui</span>
                    <span className="text-[10px] font-bold font-mono text-emerald-600">{formatIDR(summary.totalReportedApproved)}</span>
                  </div>
                  <div>
                    <span className="block text-[8px] font-bold text-slate-400 uppercase">Adjustment Lalu</span>
                    <span className="text-[10px] font-bold font-mono text-slate-600">{formatIDR(summary.totalAdjustments)}</span>
                  </div>
                  <div 
                    onClick={() => setFinancialReportsUserEmail(user.email)}
                    title="Klik untuk membuka Laporan Transaksi Saldo Operasional user terkait (Mengecualikan UID OPT-)"
                    className="bg-indigo-50/90 hover:bg-indigo-100/90 p-2 rounded-xl border border-indigo-200 col-span-2 sm:col-span-1 cursor-pointer transition-all hover:scale-[1.02] active:scale-95 group/badge relative overflow-hidden shadow-2xs flex flex-col justify-between"
                  >
                    <div>
                      <span className="block text-[8px] font-extrabold text-indigo-600 uppercase">Jumlah Nominal Adjustment</span>
                      <span className="text-[11px] font-extrabold font-mono text-indigo-700 block mt-0.5">{formatIDR(summary.requiredNominal)}</span>
                    </div>
                  </div>
                </div>

                {/* Badge Breakdown Khusus Dana Talangan (OPT-) Jika Ada */}
                {talanganSummary.hasTalangan && (
                  <div 
                    onClick={() => setTalanganReportUserEmail(user.email)}
                    className="bg-amber-50/80 hover:bg-amber-100/90 rounded-xl p-2.5 border border-amber-200/80 hover:border-amber-300 space-y-1.5 text-left cursor-pointer transition-all hover:scale-[1.01] active:scale-95 group/talangan shadow-2xs"
                    title="Klik untuk melihat Laporan Transaksi Khusus Dana Talangan (OPT-) User"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-amber-200/60 pb-1">
                      <div className="flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-amber-600 shrink-0 group-hover/talangan:scale-110 transition-transform" />
                        <span className="text-[9px] font-extrabold text-amber-900 uppercase tracking-wide">
                          Breakdown Khusus Dana Talangan (OPT-)
                        </span>
                      </div>
                      <span className="text-[8px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200 font-mono">
                        {talanganSummary.countTotal} Transaksi
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[9px]">
                      <div>
                        <span className="block text-[8px] font-semibold text-amber-800/80 uppercase">Total Transfer</span>
                        <span className="font-bold font-mono text-amber-950">{formatIDR(talanganSummary.totalTalanganTransferred)}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] font-semibold text-amber-800/80 uppercase">Laporan Disetujui</span>
                        <span className="font-bold font-mono text-emerald-700">{formatIDR(talanganSummary.totalTalanganReportedApproved)}</span>
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <span className="block text-[8px] font-semibold text-amber-800/80 uppercase">Talangan Belum Closed</span>
                        <span className={`font-bold font-mono ${talanganSummary.unclosedNominal > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {formatIDR(talanganSummary.unclosedNominal)}
                          {talanganSummary.unclosedCount > 0 && (
                            <span className="text-[8px] font-normal text-amber-800/70 ml-1">
                              ({talanganSummary.unclosedCount})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tombol Proses Adjustment di Bagian Kanan Bawah Kartu */}
                <div className="flex items-center justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUser(user);
                      setError(null);
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-white shrink-0" />
                    <span>Proses Adjustment</span>
                  </button>
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

      {/* Riwayat Transaksi Adjustment Saldo */}
      {adjustmentHistoryRequests.length > 0 && (
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-indigo-600" />
              <span>Riwayat Transaksi Adjustment Saldo ({adjustmentHistoryRequests.length})</span>
            </h3>
          </div>

          <div className="space-y-2">
            {adjustmentHistoryRequests.map((adj) => (
              <div key={adj.id} className="bg-white border border-slate-200 rounded-xl p-3 text-xs flex items-center justify-between gap-3 shadow-xs">
                <div className="space-y-0.5 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{adj.id}</span>
                    <span className="font-bold text-slate-800">{adj.userEmail}</span>
                  </div>
                  <p className="text-[10px] text-slate-500">{adj.keterangan}</p>
                  <div className="flex items-center gap-2 text-[9px] text-slate-400 font-mono mt-0.5">
                    <span>Waktu Executed (AdminActionTime): <strong className="text-emerald-700 font-semibold">{adj.adminActionTime || adj.createdAt || adj.tanggalPemakaian}</strong></span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`font-bold font-mono text-xs block ${adj.adminActionAmount > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {adj.adminActionAmount > 0 ? `+${formatIDR(adj.adminActionAmount)}` : formatIDR(adj.adminActionAmount)}
                  </span>
                  {adj.proofFileUrl && (
                    <a
                      href={adj.proofFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[9px] font-bold text-indigo-600 hover:underline mt-0.5"
                    >
                      <Paperclip className="w-3 h-3" />
                      <span>Bukti</span>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Popup modal Laporan Transaksi Saldo Operasional User saat Badge JUMLAH NOMINAL ADJUSTMENT di-klik (Kriteria pengecualian UID OPT-) */}
      {financialReportsUserEmail && (
        <UserOperationalBalanceReportModal
          isOpen={!!financialReportsUserEmail}
          onClose={() => setFinancialReportsUserEmail(null)}
          userProfile={profiles.find(p => p.email.toLowerCase() === financialReportsUserEmail.toLowerCase())}
          userEmail={financialReportsUserEmail}
          requests={requests}
          usageItems={usageItems}
          profiles={profiles}
          excludeTalangan={true}
        />
      )}

      {/* Popup modal Laporan Transaksi Khusus Dana Talangan (OPT-) saat Badge Breakdown Khusus Dana Talangan di-klik */}
      {talanganReportUserEmail && (
        <UserOperationalBalanceReportModal
          isOpen={!!talanganReportUserEmail}
          onClose={() => setTalanganReportUserEmail(null)}
          userProfile={profiles.find(p => p.email.toLowerCase() === talanganReportUserEmail.toLowerCase())}
          userEmail={talanganReportUserEmail}
          requests={requests}
          usageItems={usageItems}
          profiles={profiles}
          onlyTalangan={true}
        />
      )}
    </div>
  );
};
