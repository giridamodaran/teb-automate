"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "teb.ask.pwa.dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaProvider() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" });
    }
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) === "1") return;
    if (isIos()) {
      const timer = window.setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <p className="text-sm font-medium text-slate-800">Install TEB Ask</p>
        <p className="mt-1 text-[12px] leading-5 text-slate-600">
          {iosHint
            ? "On iPhone/iPad: tap Share, then Add to Home Screen. It opens like an app."
            : "Add TEB Ask to your home screen and open it like an app."}
        </p>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="rounded-md px-2.5 py-1 text-[12px] text-slate-600" onClick={dismiss}>
            Not now
          </button>
          {installEvent ? (
            <button
              type="button"
              className="rounded-md bg-[#086fb8] px-2.5 py-1 text-[12px] text-white"
              onClick={() => void install()}
            >
              Install
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
