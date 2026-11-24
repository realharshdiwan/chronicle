import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        aria-label="Install Chronicle app"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-cyan-300/45 bg-cyan-400/16 text-cyan-100 hover:bg-cyan-400/26 hover:text-white transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 text-cyan-300" />
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label="Install Chronicle on iOS"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-indigo-300/20 bg-indigo-500/12 text-indigo-100 hover:text-white hover:bg-indigo-500/22 transition-colors whitespace-nowrap shrink-0"
        >
          <Share className="w-3.5 h-3.5 text-cyan-300" />
          <span className="hidden sm:inline">Install</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-label="Install Chronicle on iPhone or iPad"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#050611]/70 backdrop-blur-md p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-indigo-300/25 bg-[#121530]/92 backdrop-blur-2xl p-5 shadow-2xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-white">
                  Install Chronicle on iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close iOS install instructions"
                  className="p-1 rounded text-indigo-200 hover:text-white hover:bg-indigo-400/20"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-xs text-slate-200 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>
                  Tap the <strong className="text-white">Share</strong> button in
                  Safari&apos;s toolbar.
                </li>
                <li>
                  Scroll down and tap{' '}
                  <strong className="text-white">Add to Home Screen</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 hover:from-cyan-300 hover:to-violet-300 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
