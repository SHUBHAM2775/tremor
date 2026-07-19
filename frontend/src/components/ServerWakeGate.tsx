"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Activity, RefreshCw, Server, AlertTriangle } from "lucide-react";
import { API_BASE } from "../utils";

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

  const healthUrl = API_BASE ? `${API_BASE}/health` : "/health";

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
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-[#111113] text-[#fafafa] select-none p-4 font-sans">
      {/* Background ambient pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(225,29,72,0.06),transparent_70%)] pointer-events-none" />

      {/* Main card container */}
      <div className="relative max-w-md w-full card p-8 flex flex-col items-center text-center shadow-2xl border border-[#2d2d32] bg-[#18181b]/95 backdrop-blur-md rounded-xl">
        
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
    </div>
  );
}
