import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PwaInstallBanner: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [showIosGuide, setShowIosGuide] = useState<boolean>(false);

  useEffect(() => {
    // Check if already in standalone mode (installed)
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      setIsInstalled(true);
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Detect iOS safari
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    if (isIos && !(navigator as any).standalone) {
      setShowIosGuide(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choiceResult = await deferredPrompt.userChoice;
    if (choiceResult.outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  if (isInstalled || isDismissed) return null;

  if (deferredPrompt) {
    return (
      <div className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white px-4 py-2.5 shadow-md flex items-center justify-between gap-3 text-xs sm:text-sm animate-fade-in z-30 relative">
        <div className="flex items-center gap-2.5">
          <img
            src="/DIOMS-icon192.png"
            alt="DIOMS Icon"
            className="w-8 h-8 rounded-lg shadow-xs shrink-0 object-cover border border-white/20"
          />
          <div>
            <p className="font-semibold leading-snug">Instal DIOMS Depotel</p>
            <p className="text-blue-100 text-xs hidden sm:block">Pasang di Layar Utama HP/Desktop untuk akses cepat offline.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleInstallClick}
            className="flex items-center gap-1.5 bg-white text-blue-700 hover:bg-blue-50 font-semibold px-3 py-1.5 rounded-lg text-xs shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Instal</span>
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
            title="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (showIosGuide) {
    return (
      <div className="bg-slate-800 text-white px-4 py-2 shadow-xs flex items-center justify-between gap-2 text-xs z-30 relative">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-blue-400 shrink-0" />
          <span>
            Instal di iOS: Tap tombol <strong>Bagikan (Share)</strong> lalu pilih <strong>'Tambah ke Layar Utama'</strong>.
          </span>
        </div>
        <button
          onClick={() => setIsDismissed(true)}
          className="text-slate-400 hover:text-white p-1"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return null;
};
