/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { BudgetRequest } from '../types';
import { 
  CreditCard, 
  AlertCircle, 
  Coins, 
  Camera, 
  Video, 
  UploadCloud, 
  CheckCircle2 
} from 'lucide-react';
import { uploadReceiptFile } from '../lib/googleApi';

interface TransferModalProps {
  request: BudgetRequest;
  requesterName?: string;
  onTransfer: (transferredAmount: number, buktiUrl: string, buktiFileId: string) => Promise<void>;
  onClose: () => void;
  googleToken: string;
  driveFolderId: string | null;
  onAuthError?: () => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  request,
  requesterName,
  onTransfer,
  onClose,
  googleToken,
  driveFolderId,
  onAuthError
}) => {
  const [transferredAmount, setTransferredAmount] = useState(String(request.managerActionAmount));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showCameraStream, setShowCameraStream] = useState(false);

  // Refs for upload/capture
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

  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(num);
  };

  const isTalangan = request.id.startsWith('OPT-') || request.keterangan.startsWith('[DANA TALANGAN]');

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
      setError('Gagal mengakses kamera in-app. Silakan gunakan opsi "Kamera HP" atau "File / Galeri".');
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
              const file = new File([blob], `bukti_transfer_kamera_${Date.now()}.png`, { type: 'image/png' });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amt = isTalangan ? 0 : Number(transferredAmount);
    if (!isTalangan) {
      if (isNaN(amt) || amt <= 0) {
        setError('Nominal transfer harus lebih besar dari Rp 0.');
        return;
      }
      if (amt > request.managerActionAmount) {
        setError(`Nominal transfer tidak boleh melebihi jumlah yang disetujui manager (${formatIDR(request.managerActionAmount)}).`);
        return;
      }
      if (!selectedFile) {
        setError('Bukti Transfer wajib dilampirkan.');
        return;
      }
    }

    setIsSubmitting(true);
    let finalBuktiUrl = '';
    let finalBuktiFileId = '';

    try {
      if (!isTalangan && selectedFile) {
        if (!driveFolderId) {
          throw new Error('ID Folder Google Drive belum terinisialisasi.');
        }
        const uploadResult = await uploadReceiptFile(googleToken, driveFolderId, selectedFile);
        finalBuktiUrl = uploadResult.viewUrl;
        finalBuktiFileId = uploadResult.fileId;
      }

      await onTransfer(amt, finalBuktiUrl, finalBuktiFileId);
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
        setError(err.message || 'Gagal memproses transfer dana.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-5 animate-slide-up space-y-4">
      {/* Title */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-sm">Proses Transfer Anggaran</h2>
          <p className="text-[10px] text-slate-400">Role: Admin / Finansial</p>
        </div>
        <button
          onClick={onClose}
          className="text-xs font-semibold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50"
        >
          Tutup
        </button>
      </div>

      {/* Info card */}
      <div className="bg-slate-50 rounded-xl p-3.5 space-y-2 text-xs text-slate-600">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">UID Proses</span>
            <span className="font-mono font-bold text-slate-800">{request.id}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">Lokasi Site</span>
            <span className="font-bold text-slate-800">{request.siteId}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">Pemohon</span>
            <span className="font-semibold text-slate-800">{requesterName || request.userEmail}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">Disetujui Manager</span>
            <span className="font-bold text-emerald-600">{formatIDR(request.managerActionAmount)}</span>
          </div>
        </div>
        {request.managerComment && (
          <div className="pt-2 border-t border-slate-200">
            <span className="text-[10px] text-slate-400 block font-semibold">Catatan Manager</span>
            <p className="text-slate-700 italic">"{request.managerComment}"</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Amount to transfer */}
        {!isTalangan ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Nominal Dana Ditransfer (Rupiah)</label>
              <div className="relative">
                <input
                  type="number"
                  value={transferredAmount}
                  onChange={(e) => setTransferredAmount(e.target.value)}
                  placeholder="Nominal transfer"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                  required
                />
                <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
              {transferredAmount && !isNaN(Number(transferredAmount)) && (
                <p className="text-[10px] text-indigo-600 font-semibold mt-1">
                  Format: {formatIDR(Number(transferredAmount))}
                </p>
              )}
            </div>

            {/* Bukti Transfer Upload */}
            <div className="space-y-2 pt-1">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bukti / Nota Transfer Bank (Wajib)</label>
              
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
              ) : (
                <div className="bg-amber-50 border border-amber-100 text-amber-700 p-3 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4.5 h-4.5 text-amber-500 shrink-0" />
                  <span>Bukti transfer wajib dilampirkan atau diambil dari kamera</span>
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
          </div>
        ) : (
          <div className="bg-indigo-50 border border-indigo-100 text-indigo-800 rounded-xl p-3.5 text-xs space-y-1">
            <p className="font-semibold flex items-center gap-1.5 text-indigo-700">
              <Coins className="w-4 h-4 text-indigo-600" />
              <span>Konfirmasi Dana Talangan Pribadi</span>
            </p>
            <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
              Sistem mencatat transfer sebesar <strong>Rp 0</strong> untuk UID ini karena merupakan Dana Talangan Pribadi. Mengonfirmasi akan mengubah status menjadi <strong>TRANSFERRED</strong> agar pemohon dapat mulai mengunggah nota/bukti pemakaian dana secara bertahap.
            </p>
          </div>
        )}

        {/* Transfer Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
        >
          <CreditCard className="w-4 h-4" />
          <span>{isSubmitting ? 'Memproses & Mengunggah...' : (isTalangan ? 'Konfirmasi & Aktifkan UID' : 'Kirim Bukti & Konfirmasi Transfer')}</span>
        </button>
      </form>
    </div>
  );
};
