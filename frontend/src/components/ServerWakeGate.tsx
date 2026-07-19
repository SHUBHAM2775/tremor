"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Activity, RefreshCw, Server, AlertTriangle, Sparkles, Terminal, MessageSquare } from "lucide-react";
import { API_BASE } from "../utils";

const WIKIPEDIA_FACTS: string[] = [
  "Wikipedia records every single edit ever made to every page — nothing is ever truly deleted, only hidden from the current view.",
  "The English Wikipedia gets edited roughly every second of every day.",
  "Wikipedia's \"edit war\" policy technically defines it as more than 3 reverts on the same page within 24 hours — known as the Three-Revert Rule.",
  "Some Wikipedia pages have been locked (\"protected\") for years due to repeated vandalism or disputes.",
  "Wikipedia has a formal \"Supreme Court\" — the Arbitration Committee — that resolves the most serious editor conflicts.",
  "Bots make a huge share of Wikipedia's edits — from fixing typos to reverting obvious vandalism, often within seconds.",
  "The most contentious Wikipedia articles are often not celebrities or events, but abstract topics like historical borders or naming disputes.",
  "Wikipedia editors sometimes fight for years over a single sentence's wording.",
  "Every Wikipedia edit includes a public \"edit summary\" — a one-line explanation editors give (or skip) for their change.",
  "This app clusters conflicts using UMAP and HDBSCAN — the same unsupervised ML techniques used in genomics and astronomy to find hidden groupings in data.",
  "Detecting an \"edit war\" here doesn't use any AI text-guessing — it's a statistical anomaly score on edit frequency, similar to fraud detection systems.",
  "Wikipedia's \"talk pages\" — where editors argue before editing the article itself — are sometimes longer than the article they're debating.",
  "A small fraction of Wikipedia's most active editors are responsible for a disproportionate share of total edits.",
  "Some of Wikipedia's longest-running disputes are about naming conventions — what to even call a place, person, or event.",
  "Wikipedia edits are timestamped to the second and tied to a public revision ID — nothing is anonymous at the data level, even anonymous IP edits.",
  "Wikipedia briefly considered banning anonymous editing entirely more than once — but decided against it.",
  "Sentence embeddings (used here for topic clustering) turn text into numbers so a computer can measure how \"similar\" two disputes are, mathematically.",
  "Not every heated edit is vandalism — many are good-faith disagreements between editors who simply disagree on facts.",
];

interface DisplayFact {
  factIndex: number;
  variant: 1 | 2 | 3; // 1: Sticky-note, 2: Terminal, 3: Speech bubble
  side: "left" | "right";
  verticalPercent: number;
  rotationDeg: number;
}

function distributeSlots(countOnSide: number): number[] {
  if (countOnSide === 1) {
    return Math.random() < 0.5
      ? [16 + Math.random() * 8]
      : [64 + Math.random() * 8];
  } else if (countOnSide === 2) {
    return [
      12 + Math.random() * 8,
      64 + Math.random() * 8,
    ];
  } else {
    return [
      10 + Math.random() * 5,
      42 + Math.random() * 5,
      70 + Math.random() * 5,
    ];
  }
}

function generateFactBatch(previousIndices: Set<number>): DisplayFact[] {
  // Pick 2 to 4 facts per batch
  const count = Math.floor(Math.random() * 3) + 2;

  // Filter out facts used in immediately previous batch
  const available = WIKIPEDIA_FACTS.map((_, i) => i).filter((i) => !previousIndices.has(i));
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const selectedFactIndices = shuffled.slice(0, Math.min(count, shuffled.length));

  // Determine left vs right count (guarantee at least 1 per side if count >= 2)
  let leftCount = 1;
  let rightCount = 1;
  const remaining = selectedFactIndices.length - 2;
  for (let i = 0; i < remaining; i++) {
    if (Math.random() < 0.5) leftCount++;
    else rightCount++;
  }

  const sides: ("left" | "right")[] = [
    ...Array(leftCount).fill("left"),
    ...Array(rightCount).fill("right"),
  ].sort(() => Math.random() - 0.5);

  const leftSlots = distributeSlots(leftCount);
  const rightSlots = distributeSlots(rightCount);

  let lIdx = 0;
  let rIdx = 0;

  return selectedFactIndices.map((factIdx, i) => {
    const side = sides[i];
    const topPercent = side === "left" ? leftSlots[lIdx++] : rightSlots[rIdx++];
    const variant = (Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3;
    const rotationDeg = Number((Math.random() * 4.4 - 2.2).toFixed(1)); // -2.2deg to +2.2deg

    return {
      factIndex: factIdx,
      variant,
      side,
      verticalPercent: topPercent,
      rotationDeg,
    };
  });
}

function calculateBatchHoldDuration(batch: DisplayFact[]): number {
  if (!batch || batch.length === 0) return 15000;
  let maxWords = 0;
  for (const item of batch) {
    const text = WIKIPEDIA_FACTS[item.factIndex] || "";
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount > maxWords) {
      maxWords = wordCount;
    }
  }
  const calculatedMs = maxWords * 400;
  return Math.min(25000, Math.max(15000, calculatedMs));
}

interface ServerWakeGateProps {
  children: React.ReactNode;
}

export function ServerWakeGate({ children }: ServerWakeGateProps) {
  // Determine if we should gate in production mode.
  // In development (localhost), skip waking gate entirely.
  const isProduction =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.NEXT_PUBLIC_VERCEL_ENV);

  const [isWaking, setIsWaking] = useState<boolean>(isProduction);
  const [elapsed, setElapsed] = useState<number>(0);
  const [isTimedOut, setIsTimedOut] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);

  // Multi-fact batch state
  const [factBatch, setFactBatch] = useState<DisplayFact[]>([]);
  const [isBatchVisible, setIsBatchVisible] = useState<boolean>(true);
  const [prevIndices, setPrevIndices] = useState<Set<number>>(() => new Set());

  const healthUrl = API_BASE ? `${API_BASE}/api/health` : "/api/health";

  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(healthUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        setIsWaking(false);
        return true;
      }
    } catch {
      // Fetch failures expected during backend cold start (quenched gracefully)
    }
    return false;
  }, [healthUrl]);

  // Initial batch setup
  useEffect(() => {
    if (!isProduction || !isWaking) return;
    const initialBatch = generateFactBatch(new Set());
    setFactBatch(initialBatch);
    setPrevIndices(new Set(initialBatch.map((f) => f.factIndex)));
  }, [isProduction, isWaking]);

  // Main polling & timer loop
  useEffect(() => {
    if (!isProduction || !isWaking) return;

    let timerInterval: NodeJS.Timeout;
    let pollInterval: NodeJS.Timeout;
    let isCancelled = false;

    // Timer elapsed ticker (every 1 sec)
    timerInterval = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= 90) {
          setIsTimedOut(true);
        }
        return next;
      });
    }, 1000);

    // Initial check
    checkHealth().then((ok) => {
      if (ok || isCancelled) return;

      // Poll every 3 seconds
      pollInterval = setInterval(async () => {
        const success = await checkHealth();
        if (success && !isCancelled) {
          clearInterval(pollInterval);
          clearInterval(timerInterval);
        }
      }, 3000);
    });

    return () => {
      isCancelled = true;
      clearInterval(timerInterval);
      clearInterval(pollInterval);
    };
  }, [isProduction, isWaking, retryCount, checkHealth]);

  // Fact batch rotation loop (scales duration based on reading time of longest fact)
  useEffect(() => {
    if (!isProduction || !isWaking || factBatch.length === 0) return;

    const holdDurationMs = calculateBatchHoldDuration(factBatch);

    let fadeTimeout: NodeJS.Timeout;
    const rotationTimeout = setTimeout(() => {
      setIsBatchVisible(false);
      fadeTimeout = setTimeout(() => {
        setPrevIndices((oldPrev) => {
          const newBatch = generateFactBatch(oldPrev);
          setFactBatch(newBatch);
          setIsBatchVisible(true);
          return new Set(newBatch.map((f) => f.factIndex));
        });
      }, 400);
    }, holdDurationMs);

    return () => {
      clearTimeout(rotationTimeout);
      clearTimeout(fadeTimeout);
    };
  }, [isProduction, isWaking, factBatch]);

  const handleManualRetry = () => {
    setIsTimedOut(false);
    setElapsed(0);
    setRetryCount((c) => c + 1);
  };

  // Skip rendering loader if dev environment or backend is ready
  if (!isWaking) {
    return <>{children}</>;
  }

  const formatElapsed = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-[999999] flex flex-col items-center justify-center bg-[#111113] text-[#fafafa] select-none p-4 font-sans gap-5 overflow-hidden">
      {/* Background ambient pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(225,29,72,0.06),transparent_70%)] pointer-events-none" />

      {/* Main card container */}
      <div className="relative max-w-md w-full card p-8 flex flex-col items-center text-center shadow-2xl border border-[#2d2d32] bg-[#18181b]/95 backdrop-blur-md rounded-xl z-20">
        
        {/* Pulsing icon header */}
        <div className="relative mb-6 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-[#1c0a10] border border-[#e11d48]/30 flex items-center justify-center text-[#e11d48]">
            {isTimedOut ? (
              <AlertTriangle className="w-8 h-8 text-[#f97316] animate-bounce" />
            ) : (
              <Activity className="w-8 h-8 animate-pulse" />
            )}
          </div>
          {!isTimedOut && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e11d48] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-[#e11d48]"></span>
            </span>
          )}
        </div>

        {/* Title */}
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-[#fafafa] mb-3">
          {isTimedOut ? "Server spin-up delayed" : "Waking up the server"}
        </h2>

        {/* Subtitle / Message */}
        <p className="text-sm text-[#d4d4d8] leading-relaxed mb-6">
          {isTimedOut ? (
            <span>
              The backend is taking longer than usual to boot on Render free tier.
              Hang tight or hit retry to check status again.
            </span>
          ) : (
            <span>
              Waking up the server — this can take up to a minute on first load due to free tier cold starts.
            </span>
          )}
        </p>

        {/* Status bar */}
        <div className="w-full bg-[#111113] border border-[#2d2d32] rounded-lg p-3 flex items-center justify-between font-mono text-xs mb-6">
          <div className="flex items-center gap-2 text-[#71717a]">
            <Server className="w-3.5 h-3.5 text-[#fb7185]" />
            <span>Status:</span>
            <span className="text-[#fb7185] font-medium">
              {isTimedOut ? "Awaiting boot..." : "Spinning up process"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[#a1a1aa] bg-[#1f1f23] px-2.5 py-1 rounded border border-[#3f3f46]/40">
            <span className="text-[10px] text-[#71717a] uppercase tracking-wider">Elapsed</span>
            <span className="text-[#fafafa] font-semibold">{formatElapsed(elapsed)}</span>
          </div>
        </div>

        {/* Action Button / Loading Indicator */}
        {isTimedOut ? (
          <button
            onClick={handleManualRetry}
            className="w-full py-2.5 px-4 bg-[#e11d48] hover:bg-[#fb7185] text-white font-medium text-sm rounded-md transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#e11d48]/20"
          >
            <RefreshCw className="w-4 h-4 animate-spin-once" />
            <span>Retry Connection</span>
          </button>
        ) : (
          <div className="w-full space-y-2">
            <div className="w-full bg-[#111113] h-1.5 rounded-full overflow-hidden border border-[#2d2d32]">
              <div className="bg-gradient-to-r from-[#e11d48] via-[#fb7185] to-[#e11d48] h-full w-1/2 rounded-full animate-pulse transition-all duration-300" style={{ width: `${Math.min(95, (elapsed / 60) * 100)}%` }} />
            </div>
            <div className="flex justify-between items-center text-[11px] font-mono text-[#71717a]">
              <span>Polling GET /health</span>
              <span>Every 3s</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Scattered Multi-Fact Floating Boxes (Desktop / Large Screens) ── */}
      <div className="hidden lg:block pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {factBatch.map((factItem, idx) => {
          const text = WIKIPEDIA_FACTS[factItem.factIndex];
          const isLeft = factItem.side === "left";

          return (
            <div
              key={`${factItem.factIndex}-${idx}`}
              className={`absolute w-72 bg-[#18181b]/95 backdrop-blur-md border border-[#2d2d32] p-4 shadow-xl shadow-black/40 transition-all duration-400 transform-gpu pointer-events-auto ${
                factItem.variant === 3
                  ? "rounded-2xl rounded-tl-sm"
                  : factItem.variant === 2
                  ? "rounded-md"
                  : "rounded-xl"
              } ${
                isBatchVisible
                  ? "opacity-100 translate-y-0 scale-100"
                  : "opacity-0 translate-y-3 scale-95"
              }`}
              style={{
                top: `${factItem.verticalPercent}%`,
                left: isLeft ? "4%" : "auto",
                right: !isLeft ? "4%" : "auto",
                transform: isBatchVisible
                  ? `rotate(${factItem.rotationDeg}deg)`
                  : `rotate(${factItem.rotationDeg}deg) translateY(12px) scale(0.95)`,
              }}
            >
              {/* Variant 1: Sticky-note style */}
              {factItem.variant === 1 && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[#2d2d32]/60">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-[#fb7185] uppercase tracking-wider font-semibold">
                      <Sparkles className="w-3.5 h-3.5 text-[#e11d48]" />
                      <span>DID YOU KNOW?</span>
                    </div>
                    <span className="font-mono text-[10px] text-[#71717a]">
                      #{factItem.factIndex + 1}
                    </span>
                  </div>
                  <p className="text-xs text-[#d4d4d8] leading-relaxed font-sans text-left">
                    {text}
                  </p>
                </div>
              )}

              {/* Variant 2: Terminal / Data-readout style */}
              {factItem.variant === 2 && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[#2d2d32]/60 font-mono text-[10px]">
                    <div className="flex items-center gap-1.5 text-[#fb7185] font-semibold uppercase tracking-wider">
                      <Terminal className="w-3.5 h-3.5 text-[#e11d48]" />
                      <span>WIKI_DATA // {factItem.factIndex + 1}</span>
                    </div>
                    <span className="text-[#71717a]">[SYS]</span>
                  </div>
                  <p className="text-xs text-[#d4d4d8] leading-relaxed font-mono text-left">
                    <span className="text-[#fb7185] font-bold mr-1">&gt;</span>
                    {text}
                  </p>
                </div>
              )}

              {/* Variant 3: Quote-bubble style */}
              {factItem.variant === 3 && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[#2d2d32]/60 font-mono text-[10px]">
                    <div className="flex items-center gap-1.5 text-[#fb7185] font-semibold uppercase tracking-wider">
                      <MessageSquare className="w-3.5 h-3.5 text-[#e11d48]" />
                      <span>INSIGHT</span>
                    </div>
                    <span className="text-[#71717a]">{factItem.factIndex + 1}/{WIKIPEDIA_FACTS.length}</span>
                  </div>
                  <p className="text-xs text-[#d4d4d8] leading-relaxed font-sans text-left italic">
                    "{text}"
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile / Small Screen Single Floating Fact Card */}
      {factBatch.length > 0 && (
        <div className="block lg:hidden relative max-w-md w-full z-10 px-1 mt-2">
          <div
            className={`bg-[#18181b]/95 backdrop-blur-md border border-[#2d2d32] rounded-2xl rounded-tl-sm p-4 shadow-xl shadow-black/40 transition-all duration-300 transform-gpu ${
              isBatchVisible
                ? "opacity-100 translate-y-0 scale-100"
                : "opacity-0 translate-y-2 scale-[0.97]"
            }`}
            style={{
              transform: isBatchVisible
                ? `rotate(${factBatch[0]?.rotationDeg || -1.2}deg)`
                : `rotate(${factBatch[0]?.rotationDeg || -1.2}deg) translateY(8px) scale(0.97)`,
            }}
          >
            <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[#2d2d32]/60">
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-[#fb7185] uppercase tracking-wider font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-[#e11d48]" />
                <span>DID YOU KNOW?</span>
              </div>
              <span className="font-mono text-[10px] text-[#71717a]">
                {factBatch[0]?.factIndex + 1}/{WIKIPEDIA_FACTS.length}
              </span>
            </div>
            <p className="text-xs text-[#d4d4d8] leading-relaxed font-sans text-left">
              {WIKIPEDIA_FACTS[factBatch[0]?.factIndex || 0]}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

