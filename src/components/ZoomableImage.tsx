import React, { useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
  maxHeightClass?: string;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
  onLoad?: () => void;
  darkTheme?: boolean;
}

export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  src,
  alt,
  className = '',
  maxHeightClass = 'max-h-[55vh]',
  referrerPolicy = 'no-referrer',
  onError,
  onLoad,
  darkTheme = false
}) => {
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

  return (
    <div className="flex flex-col items-center w-full relative">
      {/* Zoom Controls Toolbar */}
      <div className={`flex items-center gap-1 mb-2 border rounded-xl p-1 shrink-0 z-10 ${
        darkTheme 
          ? 'bg-slate-900 border-slate-800' 
          : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <button
          type="button"
          onClick={() => setZoomScale(prev => {
            const next = Math.max(0.5, Math.round((prev - 0.25) * 100) / 100);
            if (next <= 1) setPanOffset({ x: 0, y: 0 });
            return next;
          })}
          disabled={zoomScale <= 0.5}
          className={`p-1.5 rounded-lg transition-all cursor-pointer ${
            darkTheme 
              ? 'text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent' 
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent'
          }`}
          title="Kecilkan (Zoom Out)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleResetZoomPan}
          className={`px-2 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer min-w-[46px] text-center ${
            darkTheme 
              ? 'text-indigo-400 hover:text-white hover:bg-slate-800' 
              : 'text-indigo-600 hover:text-indigo-800 hover:bg-slate-100'
          }`}
          title="Reset Ukuran (100%)"
        >
          {Math.round(zoomScale * 100)}%
        </button>

        <button
          type="button"
          onClick={() => setZoomScale(prev => Math.min(3.5, Math.round((prev + 0.25) * 100) / 100))}
          disabled={zoomScale >= 3.5}
          className={`p-1.5 rounded-lg transition-all cursor-pointer ${
            darkTheme 
              ? 'text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent' 
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent'
          }`}
          title="Perbesar (Zoom In)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        {(zoomScale !== 1 || panOffset.x !== 0 || panOffset.y !== 0) && (
          <button
            type="button"
            onClick={handleResetZoomPan}
            className={`p-1.5 text-amber-500 hover:text-amber-600 rounded-lg transition-all cursor-pointer ${
              darkTheme ? 'hover:bg-slate-800' : 'hover:bg-slate-100'
            }`}
            title="Reset Zoom & Posisi Foto"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Image Stage Container */}
      <div
        className="w-full flex justify-center items-center overflow-hidden p-2 relative min-h-[200px] select-none touch-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={src}
          alt={alt}
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
          className={`max-w-full ${maxHeightClass} w-auto h-auto object-contain rounded-xl shadow-sm transition-opacity duration-300 ${
            zoomScale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
          } ${className}`}
          referrerPolicy={referrerPolicy}
          onError={onError}
          onLoad={onLoad}
        />
      </div>
    </div>
  );
};
