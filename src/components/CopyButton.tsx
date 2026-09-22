"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "./ui";

/** Copies text to the clipboard (with a fallback for older phone browsers) and confirms. */
export async function copyText(text: string): Promise<boolean> {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try {
    const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length); const ok = document.execCommand("copy"); document.body.removeChild(t); return ok;
  } catch { return false; }
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button type="button" onClick={async () => { const ok = await copyText(text); setState(ok ? "ok" : "fail"); setTimeout(() => setState("idle"), 2000); }}
      className={cn("focus-ring inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors duration-200",
        state === "ok" ? "border-edge/60 bg-edge/15 text-edge" : state === "fail" ? "border-miss/50 text-miss" : "hairline text-slate-200 hover:border-edge/40 hover:text-edge", className)}>
      {state === "ok" ? <Check size={14} /> : <Copy size={14} />}{state === "ok" ? "Copied" : state === "fail" ? "Copy failed — press and hold the code" : label}
    </button>
  );
}
