/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { BudgetRequest, UsageReportItem, ItemStatus, RequestStatus, Role } from '../types';
import { uploadReceiptFile } from '../lib/googleApi';
import {
  Plus, Calendar, Coins, FileText, UploadCloud, AlertCircle, CheckCircle2,
  XCircle, ExternalLink, Send, Trash2, Edit2, Info, Loader2, Camera, X, Eye, Video,
  MessageSquare, Sparkles, AlertTriangle
} from 'lucide-react';

interface UsageReportFormProps {
  request: BudgetRequest;
  items: UsageReportItem[];
  googleToken: string;
  driveFolderId: string;
  onAddItem: (item: UsageReportItem) => Promise<void>;
  onUpdateItem: (item: UsageReportItem) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
  onSubmitReport?: (request: BudgetRequest) => Promise<void>;
  onSubmitReview?: (
    updatedItems: { itemId: string; status: ItemStatus; comment: string }[],
    nextRequestStatus: RequestStatus,
    targetReq?: BudgetRequest
  ) => Promise<void>;
  onClose: () => void;
  role?: Role;
  onAuthError?: () => void;
}

export const UsageReportForm: React.FC<UsageReportFormProps> = ({
  request,
  items,
  googleToken,
  driveFolderId,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onSubmitReport,
  onSubmitReview,
  onClose,
  role = Role.USER,
  onAuthError
}) => {
  // Filter items for this request UID
  const currentItems = items.filter(item => item.requestId === request.id);

  // Track review decisions locally before submitting
  // Format: { [itemId]: { status: ItemStatus, comment: string } }
  const [decisions, setDecisions] = useState<Record<string, { status: ItemStatus; comment: string }>>({});
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // Pre-fill local decisions with current values
  useEffect(() => {
    const initialDecisions: Record<string, { status: ItemStatus; comment: string }> = {};
    currentItems.forEach((item) => {
      if (role === Role.MANAGER) {
        initialDecisions[item.id] = {
          status: item.statusManager,
          comment: item.managerComment || ''
        };
      } else if (role === Role.ADMIN) {
        initialDecisions[item.id] = {
          status: item.statusAdmin,
          comment: item.adminComment || ''
        };
      }
    });
    setDecisions(initialDecisions);
  }, [items, request, role]);

  const handleDecisionChange = (itemId: string, status: ItemStatus) => {
    setDecisions(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        status,
        // Reset comment if approving
        comment: status === ItemStatus.APPROVED ? '' : prev[itemId]?.comment || ''
      }
    }));
  };

  const handleCommentChange = (itemId: string, comment: string) => {
    setDecisions(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        comment
      }
    }));
  };

  const handleSubmitReview = async () => {
    setActionError(null);

    // Validate that all items have a decision (cannot be PENDING)
    const pendingCount = currentItems.filter(item => {
      const dec = decisions[item.id];
      return !dec || dec.status === ItemStatus.PENDING;
    }).length;

    if (pendingCount > 0) {
      setActionError(`Harap berikan keputusan (Setujui / Revisi) untuk seluruh ${pendingCount} item pengeluaran.`);
      return;
    }

    // Validate that all rejected items have comments
    const missingCommentCount = currentItems.filter(item => {
      const dec = decisions[item.id];
      return dec?.status === ItemStatus.REJECTED && !dec.comment?.trim();
    }).length;

    if (missingCommentCount > 0) {
      setActionError('Setiap item yang butuh revisi wajib mencantumkan alasan revisi.');
      return;
    }

    // Determine the next status of the BudgetRequest UID based on decisions
    const hasRejections = currentItems.some(item => {
      const dec = decisions[item.id];
      return dec?.status === ItemStatus.REJECTED;
    });

    let nextRequestStatus: RequestStatus;

    if (role === Role.MANAGER) {
      if (hasRejections) {
        nextRequestStatus = RequestStatus.REPORTING;
      } else {
        nextRequestStatus = RequestStatus.REVIEW_ADMIN;
      }
    } else {
      // Role is ADMIN
      if (hasRejections) {
        nextRequestStatus = RequestStatus.REPORTING;
      } else {
        nextRequestStatus = RequestStatus.REPORTING;
      }
    }

    const payload = currentItems.map(item => ({
      itemId: item.id,
      status: decisions[item.id]?.status || ItemStatus.PENDING,
      comment: (decisions[item.id]?.comment || '').trim()
    }));

    setIsSubmittingReview(true);
    try {
      if (onSubmitReview) {
        await onSubmitReview(payload, nextRequestStatus, request);
      }
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
        setActionError(err.message || 'Gagal menyimpan hasil review.');
      }
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Modal & Preview States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showCameraStream, setShowCameraStream] = useState(false);
  const [previewItem, setPreviewItem] = useState<UsageReportItem | null>(null);
  const [previewRequestProof, setPreviewRequestProof] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // Form State for Adding/Editing Item
  const [editingItem, setEditingItem] = useState<UsageReportItem | null>(null);
  const [tanggal, setTanggal] = useState(() => new Date().toISOString().split('T')[0]);
  const [nominal, setNominal] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // AI Receipt Validation States for Manager and Admin
  const [scanningItemIds, setScanningItemIds] = useState<Record<string, boolean>>({});
  const [scanResults, setScanResults] = useState<Record<string, { nominal: number; keterangan: string; tanggal: string }>>({});
  const [scanErrors, setScanErrors] = useState<Record<string, string | null>>({});
  const [mismatchModal, setMismatchModal] = useState<{
    isOpen: boolean;
    itemKeterangan: string;
    userNominal: number;
    extNominal: number;
    userTanggal: string;
    extTanggal: string;
    extKeterangan: string;
  } | null>(null);

  const handleValidateItemWithAi = async (item: UsageReportItem) => {
    setScanningItemIds(prev => ({ ...prev, [item.id]: true }));
    setScanErrors(prev => ({ ...prev, [item.id]: null }));

    try {
      const response = await window.fetch('/api/gemini/analyze-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: item.buktiUrl,
          googleToken: googleToken,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Terjadi kesalahan saat memproses gambar dengan AI.');
      }

      const extData = result.data;
      setScanResults(prev => ({ ...prev, [item.id]: extData }));

      // Compare original report data vs extracted data
      const nominalMismatch = Math.abs((extData.nominal || 0) - item.nominal) > 10;
      const dateMismatch = extData.tanggal && item.tanggalPenggunaan && extData.tanggal !== item.tanggalPenggunaan;

      if (nominalMismatch || dateMismatch) {
        // Trigger Pop up Warning/Notifikasi
        setMismatchModal({
          isOpen: true,
          itemKeterangan: item.keterangan,
          userNominal: item.nominal,
          extNominal: extData.nominal || 0,
          userTanggal: item.tanggalPenggunaan,
          extTanggal: extData.tanggal || '-',
          extKeterangan: extData.keterangan || '-',
        });
      }
    } catch (err: any) {
      console.error('Error in handleValidateItemWithAi in UsageReportForm:', err);
      setScanErrors(prev => ({ ...prev, [item.id]: err.message || 'Gagal menjalankan validasi AI.' }));
    } finally {
      setScanningItemIds(prev => ({ ...prev, [item.id]: false }));
    }
  };

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

  // Format IDR Currency
  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(num);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  // In-App Web Camera Stream Helpers
  const startCameraStream = async () => {
    setActionError(null);
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
      setActionError('Gagal mengakses kamera in-app. Silakan gunakan opsi "Kamera HP (Native)" atau "File / Galeri".');
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

  const captureInAppPhoto = () => {
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
              const file = new File([blob], `nota_kamera_${Date.now()}.png`, { type: 'image/png' });
              setSelectedFile(file);
            }
          }, 'image/png');
        }
        stopCameraStream();
      } catch (err: any) {
        setActionError('Gagal mengambil foto dari kamera.');
      }
    }
  };

  // Submit single usage item (Add or Edit)
  const handleItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);

    const amount = Number(nominal);
    if (isNaN(amount) || amount <= 0) {
      setActionError('Nominal penggunaan harus lebih besar dari Rp 0.');
      return;
    }
    if (!keterangan.trim()) {
      setActionError('Keterangan penggunaan wajib diisi.');
      return;
    }

    setUploading(true);
    try {
      let finalBuktiUrl = editingItem?.buktiUrl || '';
      let finalBuktiFileId = editingItem?.buktiFileId || '';

      // Upload file to Google Drive if a new one is selected
      if (selectedFile) {
        const uploadResult = await uploadReceiptFile(googleToken, driveFolderId, selectedFile);
        finalBuktiUrl = uploadResult.viewUrl;
        finalBuktiFileId = uploadResult.fileId;
      }

      if (!finalBuktiUrl) {
        throw new Error('Bukti atau Nota pembayaran wajib diupload.');
      }

      const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

      if (editingItem) {
        // Update existing item
        const updated: UsageReportItem = {
          ...editingItem,
          tanggalPenggunaan: tanggal,
          nominal: amount,
          keterangan: keterangan.trim(),
          buktiUrl: finalBuktiUrl,
          buktiFileId: finalBuktiFileId,
          // Reset rejection statuses when editing/correcting
          statusManager: ItemStatus.PENDING,
          statusAdmin: ItemStatus.PENDING,
          managerComment: '',
          adminComment: '',
          updatedAt: timestamp
        };
        await onUpdateItem(updated);
        setEditingItem(null);
      } else {
        // Add new item
        const newItem: UsageReportItem = {
          id: `ITEM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
          requestId: request.id,
          tanggalPenggunaan: tanggal,
          nominal: amount,
          keterangan: keterangan.trim(),
          buktiUrl: finalBuktiUrl,
          buktiFileId: finalBuktiFileId,
          statusManager: ItemStatus.PENDING,
          managerComment: '',
          statusAdmin: ItemStatus.PENDING,
          adminComment: '',
          updatedAt: timestamp
        };
        await onAddItem(newItem);
      }

      // Reset form
      setNominal('');
      setKeterangan('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      setIsFormOpen(false);
      stopCameraStream();
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
        setActionError(err.message || 'Gagal menyimpan item penggunaan.');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleEditClick = (item: UsageReportItem) => {
    setEditingItem(item);
    setTanggal(item.tanggalPenggunaan);
    setNominal(String(item.nominal));
    setKeterangan(item.keterangan);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    setActionError(null);
    setIsFormOpen(true);
  };

  const handleCancelEdit = () => {
    setEditingItem(null);
    setTanggal(new Date().toISOString().split('T')[0]);
    setNominal('');
    setKeterangan('');
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    setActionError(null);
    stopCameraStream();
    setIsFormOpen(false);
  };

  const totalReportedAmount = currentItems.reduce((sum, i) => sum + i.nominal, 0);

  // Status check for rejected items
  const hasRejectedItems = currentItems.some(
    i => i.statusManager === ItemStatus.REJECTED || i.statusAdmin === ItemStatus.REJECTED
  );

  const isTalangan = request.id.startsWith('OPT-') || request.keterangan.startsWith('[DANA TALANGAN]');

  return (
    <div className="space-y-4 max-w-md mx-auto animate-slide-up pb-8">
      {/* Title Header */}
      <div className="flex items-center justify-between bg-white border border-slate-100 p-4 rounded-2xl shadow-sm">
        <div>
          <span className="text-[10px] font-bold text-slate-400 tracking-wider block">ID PROSES (UID)</span>
          <span className="text-sm font-display font-extrabold text-slate-800">{request.id}</span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold transition-all cursor-pointer"
        >
          Kembali
        </button>
      </div>

      {/* Financial Comparison Summary Card */}
      <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-sm">
        <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">
          {isTalangan ? 'REKONSILIASI DANA TALANGAN PRIBADI' : 'REKONSILIASI NILAI ANGGARAN'}
        </p>
        <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-slate-800">
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">
              {isTalangan ? 'Sumber Anggaran' : 'Dana Ditransfer Admin'}
            </span>
            <span className="text-sm font-bold font-display text-blue-400">
              {isTalangan ? 'Talangan Pribadi' : formatIDR(request.adminActionAmount)}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">Total Dilaporkan (User)</span>
            <span className={`text-sm font-bold font-display ${!isTalangan && totalReportedAmount > request.adminActionAmount ? 'text-red-400' : 'text-emerald-400'}`}>
              {formatIDR(totalReportedAmount)}
            </span>
          </div>
        </div>
        <div className="mt-3 text-[10px] text-slate-400 flex items-start gap-1.5 bg-slate-800/50 p-2 rounded-xl">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
          <span>
            {isTalangan
              ? 'Seluruh nominal pengeluaran di atas dibayarkan secara mandiri oleh user, dan akan mengurangi saldo operasional Anda setelah disetujui.'
              : totalReportedAmount > request.adminActionAmount
                ? 'Peringatan: Jumlah yang dilaporkan melebihi dana yang ditransfer oleh admin!'
                : 'Jumlah laporan yang dicatat masih dalam batas alokasi dana.'}
          </span>
        </div>
      </div>

      {/* Bukti Transfer / Adjustment Card for CLOSED UIDs */}
      {request.buktiTransferUrl && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
          <div className="flex items-center gap-2 text-indigo-800">
            <CheckCircle2 className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">BUKTI TRANSFER / PENYESUAIAN</p>
              <h4 className="text-xs font-bold text-slate-800">Dokumen Penyelesaian Transaksi</h4>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 font-medium">
            Transaksi ini telah selesai disesuaikan oleh Admin dengan lampiran dokumen pendukung sebagai bukti potongan atau transfer.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPreviewRequestProof(true)}
              className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Lihat Bukti Dokumen</span>
            </button>
            <a
              href={request.buktiTransferUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2 px-3 bg-white hover:bg-slate-50 text-indigo-600 font-bold text-[10px] rounded-xl border border-indigo-200 flex items-center justify-center gap-1.5 transition-all cursor-pointer text-center"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Buka Dokumen Asli</span>
            </a>
          </div>
        </div>
      )}

      {/* Section 1: Item List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Item Laporan Penggunaan ({currentItems.length})</h3>
          {hasRejectedItems && (
            <span className="text-[10px] font-semibold bg-red-150 text-red-600 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
              <AlertCircle className="w-3 h-3" />
              Butuh Perbaikan
            </span>
          )}
        </div>

        {currentItems.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 text-center py-8 px-4 rounded-2xl text-slate-400 text-xs font-medium">
            <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p>Belum ada rincian penggunaan operasional.</p>
            <p className="text-[10px] text-slate-400 mt-1">Klik tombol di bawah untuk menambahkan rincian penggunaan.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {currentItems.map((item) => {
              const isRejected = item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED;
              const isApproved = item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED;
              const isLocked = request.status === RequestStatus.CLOSED || ((item.statusManager === ItemStatus.APPROVED || item.statusAdmin === ItemStatus.APPROVED) && !isRejected);

              return (
                <div key={item.id} className="bg-white border border-slate-100 rounded-2xl p-3.5 shadow-sm space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[9px] font-mono text-slate-400 block">{item.id}</span>
                      <h4 className="text-xs font-bold text-slate-800 mt-0.5">{item.keterangan}</h4>
                      <p className="text-[10px] text-slate-500 font-medium flex items-center gap-1 mt-0.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {item.tanggalPenggunaan}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-700 block">{formatIDR(item.nominal)}</span>
                      {/* Status indicator badge */}
                      <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full mt-1.5 ${
                        isApproved
                          ? 'bg-emerald-50 text-emerald-600'
                          : isRejected
                          ? 'bg-red-50 text-red-600'
                          : 'bg-amber-50 text-amber-600'
                      }`}>
                        {isApproved ? 'Selesai disetujui' : isRejected ? 'Butuh Revisi' : 'Proses Review'}
                      </span>
                    </div>
                  </div>

                  {/* Reject Comments if any */}
                  {item.statusManager === ItemStatus.REJECTED && item.managerComment && (
                    <div className="bg-red-50 text-red-700 p-2 rounded-xl text-[10px] border border-red-100 flex items-start gap-1">
                      <Info className="w-3.5 h-3.5 shrink-0 text-red-500 mt-0.5" />
                      <span><strong>Butuh Revisi (Manager):</strong> {item.managerComment}</span>
                    </div>
                  )}

                  {item.statusAdmin === ItemStatus.REJECTED && item.adminComment && (
                    <div className="bg-red-50 text-red-700 p-2 rounded-xl text-[10px] border border-red-100 flex items-start gap-1">
                      <Info className="w-3.5 h-3.5 shrink-0 text-red-500 mt-0.5" />
                      <span><strong>Butuh Revisi (Admin):</strong> {item.adminComment}</span>
                    </div>
                  )}

                  {/* Decision Buttons for Manager and Admin */}
                  {(role === Role.MANAGER || role === Role.ADMIN) && (
                    <div className="space-y-2 mt-2">
                      {/* AI Validation Area */}
                      <div className="bg-indigo-50/40 rounded-xl p-2.5 border border-indigo-100/60 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-indigo-700 font-bold flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                            <span>AI Receipt & Invoice Validator</span>
                          </span>
                          
                          <button
                            type="button"
                            onClick={() => handleValidateItemWithAi(item)}
                            disabled={scanningItemIds[item.id]}
                            className="py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-extrabold text-[9px] rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                          >
                            {scanningItemIds[item.id] ? (
                              <>
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                <span>Menganalisis...</span>
                              </>
                            ) : scanResults[item.id] ? (
                              <span>Ulangi Validasi AI</span>
                            ) : (
                              <span>Validasi Bukti via AI</span>
                            )}
                          </button>
                        </div>

                        {scanErrors[item.id] && (
                          <p className="text-[9px] text-red-600 font-semibold bg-red-50 p-1.5 rounded-md">
                            {scanErrors[item.id]}
                          </p>
                        )}

                        {scanResults[item.id] && (
                          <div className="text-[10px] bg-white border border-slate-150 rounded-lg p-2.5 space-y-2 text-slate-600 shadow-sm animate-fade-in">
                            <div className="flex items-center gap-1 pb-1.5 border-b border-slate-100 font-bold text-indigo-700">
                              <Sparkles className="w-3 h-3 text-indigo-500 animate-pulse" />
                              <span>Hasil Pengecekan AI (Tanggal & Nominal)</span>
                            </div>
                            
                            {/* Perbandingan Nominal */}
                            <div className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                              <span className="text-[10px] text-slate-500 font-medium">Nominal Transaksi:</span>
                              <div className="flex flex-col items-end text-right font-mono text-[10px]">
                                <span>Input: <strong className="text-slate-800 font-bold">{formatIDR(item.nominal)}</strong></span>
                                <span>AI: <strong className="text-indigo-800 font-bold">{formatIDR(scanResults[item.id].nominal)}</strong></span>
                              </div>
                            </div>
                            {Math.abs(scanResults[item.id].nominal - item.nominal) > 10 ? (
                              <div className="text-red-600 font-bold flex items-center gap-1 bg-red-50/50 p-1 rounded border border-red-100 text-[9px]">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                                <span>Nominal berbeda! Selisih {formatIDR(Math.abs(scanResults[item.id].nominal - item.nominal))}</span>
                              </div>
                            ) : (
                              <div className="text-emerald-700 font-bold flex items-center gap-1 bg-emerald-50/50 p-1 rounded border border-emerald-100 text-[9px]">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                                <span>Nominal Sesuai</span>
                              </div>
                            )}

                            {/* Perbandingan Tanggal */}
                            <div className="flex items-center justify-between gap-2 py-0.5 border-t border-slate-50 pt-1.5 text-[11px]">
                              <span className="text-[10px] text-slate-500 font-medium">Tanggal Transaksi:</span>
                              <div className="flex flex-col items-end text-right font-mono text-[10px]">
                                <span>Input: <strong className="text-slate-800 font-bold">{item.tanggalPenggunaan}</strong></span>
                                <span>AI: <strong className="text-indigo-800 font-bold">{scanResults[item.id].tanggal}</strong></span>
                              </div>
                            </div>
                            {scanResults[item.id].tanggal && item.tanggalPenggunaan && scanResults[item.id].tanggal !== item.tanggalPenggunaan ? (
                              <div className="text-red-600 font-bold flex items-center gap-1 bg-red-50/50 p-1 rounded border border-red-100 text-[9px]">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                                <span>Tanggal berbeda!</span>
                              </div>
                            ) : (
                              <div className="text-emerald-700 font-bold flex items-center gap-1 bg-emerald-50/50 p-1 rounded border border-emerald-100 text-[9px]">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                                <span>Tanggal Sesuai</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 space-y-2">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase">
                          Review Keputusan ({role === Role.MANAGER ? 'Manager' : 'Admin / Finansial'})
                        </span>
                      
                      {/* If role is Admin, show Manager's decision for context */}
                      {role === Role.ADMIN && (
                        <div className="text-[10px] bg-white border border-slate-100 p-2 rounded-xl text-slate-600 mb-1.5">
                          <span>Status Persetujuan Manager: </span>
                          <span className={`font-bold ${item.statusManager === ItemStatus.APPROVED ? 'text-emerald-600' : 'text-red-600'}`}>
                            {item.statusManager === ItemStatus.APPROVED ? 'DISETUJUI' : 'REVISI'}
                          </span>
                          {item.managerComment && <p className="italic text-slate-400 mt-0.5">"{item.managerComment}"</p>}
                        </div>
                      )}

                      {role === Role.MANAGER && item.statusManager === ItemStatus.APPROVED ? (
                        <div className="text-center py-2 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700 font-bold text-xs flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          <span>Telah Disetujui Manager</span>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => handleDecisionChange(item.id, ItemStatus.APPROVED)}
                              className={`py-1.5 px-3 text-xs font-semibold rounded-xl border text-center flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                decisions[item.id]?.status === ItemStatus.APPROVED
                                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Setujui</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDecisionChange(item.id, ItemStatus.REJECTED)}
                              className={`py-1.5 px-3 text-xs font-semibold rounded-xl border text-center flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                decisions[item.id]?.status === ItemStatus.REJECTED
                                  ? 'border-red-500 bg-red-50 text-red-700 font-bold'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              <XCircle className="w-3.5 h-3.5 text-red-500" />
                              <span>Revisi</span>
                            </button>
                          </div>

                          {/* If rejected/revision, reason is required */}
                          {decisions[item.id]?.status === ItemStatus.REJECTED && (
                            <div className="space-y-1 mt-1.5">
                              <label className="block text-[9px] font-bold text-red-500 uppercase">Alasan Revisi (Wajib)</label>
                              <div className="relative">
                                <input
                                  type="text"
                                  value={decisions[item.id]?.comment || ''}
                                  onChange={(e) => handleCommentChange(item.id, e.target.value)}
                                  placeholder="Contoh: Bukti buram, Nominal tidak sesuai nota"
                                  className="w-full pl-8 pr-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                                  required
                                />
                                <MessageSquare className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-50 text-xs">
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <span>Lihat Bukti Nota</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>

                     {/* Show delete or edit options ONLY for Role.USER, and only if the item has not been approved by either Manager or Admin (isLocked) */}
                    {role === Role.USER && !isLocked && [RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(request.status) && (
                      <div className="flex items-center gap-2">
                        {isRejected && (
                          <button
                            onClick={() => handleEditClick(item)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg font-semibold flex items-center gap-1 transition-all"
                            title="Perbaiki / Ajukan Kembali"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Perbaiki</span>
                          </button>
                        )}
                        {!hasRejectedItems && (
                          <button
                            onClick={async () => {
                              if (window.confirm('Hapus item penggunaan ini?')) {
                                try {
                                  await onDeleteItem(item.id);
                                } catch (e: any) {
                                  setActionError(e.message);
                                }
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title="Hapus"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Trigger Button to Open Input Form Modal ONLY for Role.USER */}
      {role === Role.USER && [RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(request.status) && (
        !hasRejectedItems ? (
          <button
            onClick={() => {
              setEditingItem(null);
              setTanggal(new Date().toISOString().split('T')[0]);
              setNominal('');
              setKeterangan('');
              setSelectedFile(null);
              setActionError(null);
              setIsFormOpen(true);
            }}
            className="w-full py-3 border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/20 hover:bg-indigo-50/50 text-indigo-600 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
          >
            <Plus className="w-4.5 h-4.5" />
            <span>Tambah Rincian Penggunaan</span>
          </button>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-xs text-amber-800 flex items-start gap-2.5">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <div className="space-y-0.5">
              <p className="font-bold">Perbaikan Laporan Diperlukan</p>
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Terdapat item laporan yang ditolak (REJECTED). Anda hanya diperbolehkan melakukan perbaikan pada item tersebut dan tidak dapat menambah atau menghapus item lainnya.
              </p>
            </div>
          </div>
        )
      )}

      {/* Submit Report Button for User */}
      {role === Role.USER && onSubmitReport && [RequestStatus.TRANSFERRED, RequestStatus.REPORTING].includes(request.status) && currentItems.length > 0 && (
        <button
          onClick={async () => {
            if (window.confirm('Kirim seluruh laporan penggunaan ini untuk direview oleh Manager?')) {
              setIsSubmittingReport(true);
              try {
                await onSubmitReport(request);
              } catch (e: any) {
                setActionError(e.message);
              } finally {
                setIsSubmittingReport(false);
              }
            }
          }}
          disabled={isSubmittingReport}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer mt-2"
        >
          <Send className="w-4 h-4" />
          <span>{isSubmittingReport ? 'Mengirim...' : 'Kirim Laporan ke Manager'}</span>
        </button>
      )}

      {/* Submit Review Button for Manager/Admin */}
      {(role === Role.MANAGER || role === Role.ADMIN) && onSubmitReview && currentItems.length > 0 && (
        <div className="space-y-2">
          {actionError && (
            <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}
          <button
            onClick={handleSubmitReview}
            disabled={isSubmittingReview}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer mt-2"
          >
            <Send className="w-4 h-4" />
            <span>{isSubmittingReview ? 'Mengirim Keputusan...' : 'Kirim Seluruh Keputusan Review'}</span>
          </button>
        </div>
      )}

      {/* ----------------- POPUP MODAL FORM INPUT ----------------- */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-scale-up border border-slate-100 flex flex-col my-8">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                  <Plus className="w-4.5 h-4.5" />
                </div>
                <h4 className="text-xs font-bold text-slate-800">
                  {editingItem ? 'Edit Item Laporan' : 'Tambah Rincian Penggunaan'}
                </h4>
              </div>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Content */}
            <form onSubmit={handleItemSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
              {actionError && (
                <div className="bg-red-50 border border-red-100 text-red-600 rounded-2xl p-3.5 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Date */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Tanggal Penggunaan</label>
                <div className="relative">
                  <input
                    type="date"
                    value={tanggal}
                    onChange={(e) => setTanggal(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                    required
                  />
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>
              </div>

              {/* Nominal */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Nominal (Rupiah)</label>
                <div className="relative">
                  <input
                    type="number"
                    value={nominal}
                    onChange={(e) => setNominal(e.target.value)}
                    placeholder="contoh: 450000"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                    required
                  />
                  <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>
                {nominal && !isNaN(Number(nominal)) && (
                  <p className="text-[10px] text-indigo-600 font-semibold mt-1">
                    Format: {formatIDR(Number(nominal))}
                  </p>
                )}
              </div>

              {/* Keterangan */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Keterangan Belanja</label>
                <div className="relative">
                  <input
                    type="text"
                    value={keterangan}
                    onChange={(e) => setKeterangan(e.target.value)}
                    placeholder="contoh: Makan siang tim survey, Bensin mobil dinas"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                    required
                  />
                  <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>
              </div>

              {/* Bukti File / Nota Source Selection */}
              <div className="space-y-2 pt-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bukti / Nota Pembayaran</label>
                
                {/* File Status Indicator */}
                {selectedFile ? (
                  <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 p-3 rounded-xl text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
                      <div className="truncate">
                        <p className="font-bold truncate">{selectedFile.name}</p>
                        <p className="text-[9px] text-emerald-500 font-mono">{(selectedFile.size / 1024).toFixed(0)} KB</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      className="text-[10px] font-bold text-red-500 hover:text-red-700 hover:underline px-2 py-1 bg-red-50 rounded-lg shrink-0 cursor-pointer"
                    >
                      Hapus
                    </button>
                  </div>
                ) : editingItem ? (
                  <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 p-3 rounded-xl text-xs flex items-center gap-2">
                    <Info className="w-4.5 h-4.5 text-indigo-500 shrink-0" />
                    <span>Menggunakan Nota sebelumnya (tetap aman jika tidak diganti)</span>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-100 text-amber-700 p-3 rounded-xl text-xs flex items-center gap-2">
                    <AlertCircle className="w-4.5 h-4.5 text-amber-500 shrink-0" />
                    <span>Bukti nota wajib diupload atau diambil foto kamera</span>
                  </div>
                )}

                {/* Hidden Input Selectors */}
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
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                />

                {/* Capture/Upload Options Panel */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Native device camera */}
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="p-3 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-xl text-center flex flex-col items-center justify-center gap-1.5 transition-all text-[10px] font-bold text-slate-600 cursor-pointer"
                  >
                    <Camera className="w-5 h-5 text-indigo-500" />
                    <span>Kamera HP</span>
                  </button>

                  {/* Choose file / gallery */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-xl text-center flex flex-col items-center justify-center gap-1.5 transition-all text-[10px] font-bold text-slate-600 cursor-pointer"
                  >
                    <UploadCloud className="w-5 h-5 text-indigo-500" />
                    <span>File / Galeri</span>
                  </button>
                </div>
              </div>

              {/* Submit Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs cursor-pointer transition-all text-center"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      <span>{editingItem ? 'Simpan' : 'Tambahkan'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------- POPUP MODAL BUKTI PREVIEW ----------------- */}
      {previewItem && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-5 space-y-4 animate-scale-up relative border border-slate-100 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">BUKTI NOTA PEMBAYARAN</h3>
                <h4 className="text-sm font-bold text-slate-800 mt-0.5">{previewItem.keterangan}</h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Receipt metadata info */}
            <div className="bg-slate-50 rounded-2xl p-3 text-xs text-slate-600 grid grid-cols-2 gap-2 border border-slate-100">
              <div>
                <span className="text-[9px] text-slate-400 font-bold block uppercase">Nominal Laporan</span>
                <span className="font-bold text-slate-800">{formatIDR(previewItem.nominal)}</span>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-bold block uppercase">Tanggal Belanja</span>
                <span className="font-bold text-indigo-600">{previewItem.tanggalPenggunaan}</span>
              </div>
            </div>

            {/* Inline Preview Window */}
            <div className="flex-1 bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden flex items-center justify-center min-h-[300px] relative p-1">
              {previewItem.buktiFileId ? (
                <img
                  src={`https://drive.google.com/thumbnail?sz=w1000&id=${previewItem.buktiFileId}`}
                  alt="Bukti Nota"
                  className="max-w-full max-h-[50vh] rounded-xl object-contain shadow-sm"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = document.getElementById('preview-fallback');
                    if (fallback) fallback.classList.remove('hidden');
                  }}
                />
              ) : null}
              
              {/* Fallback block for direct preview errors or non-image types (like PDF) */}
              <div 
                id="preview-fallback" 
                className={`flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2 ${previewItem.buktiFileId ? 'hidden absolute inset-0 bg-slate-50 flex' : ''}`}
              >
                <FileText className="w-12 h-12 text-slate-300" />
                <p className="text-xs font-bold text-slate-700">Dokumen Nota Terlampir</p>
                <p className="text-[10px] text-slate-400 max-w-[240px]">Bukti nota ini tidak dapat ditampilkan sebagai gambar langsung (format PDF atau pembatasan akses). Silakan unduh atau buka langsung.</p>
              </div>
            </div>

            {/* Action footer */}
            <div className="pt-3 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all cursor-pointer text-center"
              >
                Tutup Preview
              </button>
              <a
                href={previewItem.buktiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-indigo-100 text-center"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Buka Nota Asli</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- POPUP MODAL REQUEST PROOF PREVIEW ----------------- */}
      {previewRequestProof && request.buktiTransferUrl && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-5 space-y-4 animate-scale-up relative border border-slate-100 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-xs font-bold text-indigo-500 uppercase tracking-widest">BUKTI TRANSFER / PENYESUAIAN</h3>
                <h4 className="text-sm font-bold text-slate-800 mt-0.5">{request.keterangan}</h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewRequestProof(false)}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Receipt metadata info */}
            <div className="bg-slate-50 rounded-2xl p-3 text-xs text-slate-600 grid grid-cols-2 gap-2 border border-slate-100">
              <div>
                <span className="text-[9px] text-slate-400 font-bold block uppercase">Jumlah Penyesuaian</span>
                <span className="font-bold text-slate-800">{formatIDR(request.adminActionAmount)}</span>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-bold block uppercase">ID Proses (UID)</span>
                <span className="font-bold text-indigo-600">{request.id}</span>
              </div>
            </div>

            {/* Inline Preview Window */}
            <div className="flex-1 bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden flex items-center justify-center min-h-[300px] relative p-1">
              {request.buktiTransferFileId ? (
                <img
                  src={`https://drive.google.com/thumbnail?sz=w1000&id=${request.buktiTransferFileId}`}
                  alt="Bukti Transfer / Penyesuaian"
                  className="max-w-full max-h-[50vh] rounded-xl object-contain shadow-sm"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = document.getElementById('request-preview-fallback');
                    if (fallback) fallback.classList.remove('hidden');
                  }}
                />
              ) : null}
              
              {/* Fallback block for direct preview errors or non-image types (like PDF) */}
              <div 
                id="request-preview-fallback" 
                className={`flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2 ${request.buktiTransferFileId ? 'hidden absolute inset-0 bg-slate-50 flex' : ''}`}
              >
                <FileText className="w-12 h-12 text-slate-300" />
                <p className="text-xs font-bold text-slate-700">Dokumen Lampiran Terlampir</p>
                <p className="text-[10px] text-slate-400 max-w-[240px]">Dokumen ini tidak dapat ditampilkan sebagai gambar langsung (format PDF atau pembatasan akses). Silakan unduh atau buka langsung.</p>
              </div>
            </div>

            {/* Action footer */}
            <div className="pt-3 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewRequestProof(false)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all cursor-pointer text-center"
              >
                Tutup Preview
              </button>
              <a
                href={request.buktiTransferUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-indigo-100 text-center"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Buka Dokumen Asli</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Pop Up Notifikasi Mismatch / Warning */}
      {mismatchModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 space-y-4 animate-scale-up border border-red-100 text-left">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shadow-inner">
              <AlertTriangle className="w-6 h-6 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-black text-slate-800 font-display">Peringatan: Bukti Ditengarai Tidak Sesuai!</h3>
              <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                Hasil ekstraksi kecerdasan buatan (AI) menunjukkan ketidakcocokan antara data laporan yang diinput pengguna dengan bukti nota terlampir:
              </p>
              
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 text-xs space-y-2.5">
                <div>
                  <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Item Laporan Pengguna:</span>
                  <p className="font-bold text-slate-700 text-xs">"{mismatchModal.itemKeterangan}"</p>
                  <div className="flex gap-4 mt-1 font-mono text-[10px] text-slate-600">
                    <span>Nominal: <strong className="text-slate-800 font-bold">{formatIDR(mismatchModal.userNominal)}</strong></span>
                    <span>Tanggal: <strong className="text-slate-800 font-bold">{mismatchModal.userTanggal}</strong></span>
                  </div>
                </div>
                <div className="border-t border-slate-200 pt-2.5">
                  <span className="text-[9px] text-indigo-500 font-bold block uppercase tracking-wider">Hasil Ekstraksi AI:</span>
                  <p className="font-bold text-indigo-900 text-xs">"{mismatchModal.extKeterangan}"</p>
                  <div className="flex gap-4 mt-1 font-mono text-[10px] text-indigo-900">
                    <span>Nominal: <strong className="font-bold text-red-600">{formatIDR(mismatchModal.extNominal)}</strong></span>
                    <span>Tanggal: <strong className="font-bold text-indigo-800">{mismatchModal.extTanggal}</strong></span>
                  </div>
                </div>
              </div>
              
              <p className="text-[10px] text-red-600 bg-red-50/50 p-2.5 rounded-xl font-medium border border-red-100 leading-normal">
                ⚠️ <strong>Saran Sistem:</strong> Disarankan bagi Manager atau Admin untuk mem-verifikasi laporan ini dengan lebih teliti karena bukti transaksi ditengarai tidak cocok.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setMismatchModal(null)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm text-center"
              >
                Saya Mengerti, Lanjutkan Review
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
