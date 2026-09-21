"use client";
import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Shows on mobile from the 2nd visit. Android: native prompt. iOS: Add to Home Screen hint. */
export function InstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    if (standalone) return;
    let visits = 0;
    try {
      visits = Number(localStorage.getItem("pe:visits") ?? 0) + 1;
      if (!sessionStorage.getItem("pe:counted")) { localStorage.setItem("pe:visits", String(visits)); sessionStorage.setItem("pe:counted", "1"); }
      else visits -= 1;
      if (localStorage.getItem("pe:install-dismissed")) return;
    } catch { return; }
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    if (!mobile || visits < 2) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIos(isIos);
    if (isIos) setShow(true);
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); setShow(true); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (!show) return null;
  const dismiss = () => { try { localStorage.setItem("pe:install-dismissed", "1"); } catch {} setShow(false); };
  return (
    <div role="dialog" aria-label="Install PitchEdge" className="glass fixed inset-x-3 bottom-20 z-50 flex items-center gap-3 p-3 md:hidden">
      <div className="flex-1 text-sm text-slate-200">
        {ios ? <>Install PitchEdge: tap Share, then <b>Add to Home Screen</b>.</> : <>Install PitchEdge for offline fixtures and faster loads.</>}
      </div>
      {!ios && evt && <button className="focus-ring rounded-lg bg-edge px-3 py-1.5 text-sm font-medium text-ink-950" onClick={async () => { await evt.prompt(); dismiss(); }}>Install</button>}
      <button className="focus-ring px-2 text-sm text-slate-400" onClick={dismiss} aria-label="Dismiss">Not now</button>
    </div>
  );
}
