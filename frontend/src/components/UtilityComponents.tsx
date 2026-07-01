import React, { useState, useEffect } from "react";
import { Info, Clock } from "lucide-react";

// ─── Info tooltip ──────────────────────────────────────────────────────────────

interface InfoTooltipProps {
  text: string;
  position?: "top" | "bottom" | "left" | "right";
}

export function InfoTooltip({ text, position = "top" }: InfoTooltipProps) {
  const [show, setShow] = useState(false);

  // Position-specific class and style mapping
  const containerClasses = React.useMemo(() => {
    const base = "absolute w-56 p-3 rounded-md z-50 pointer-events-none text-[11px] leading-relaxed transition-all duration-150";
    if (position === "bottom") {
      return `${base} top-full left-1/2 -translate-x-1/2 mt-2`;
    }
    if (position === "right") {
      return `${base} left-full top-1/2 -translate-y-1/2 ml-2`;
    }
    if (position === "left") {
      return `${base} right-full top-1/2 -translate-y-1/2 mr-2`;
    }
    return `${base} bottom-full left-1/2 -translate-x-1/2 mb-2`;
  }, [position]);

  const arrowStyle = React.useMemo(() => {
    if (position === "bottom") {
      return {
        bottom: "100%",
        left: "50%",
        transform: "translateX(-50%)",
        borderWidth: 5,
        borderStyle: "solid",
        borderColor: "transparent transparent var(--bg-hover) transparent",
      };
    }
    if (position === "right") {
      return {
        right: "100%",
        top: "50%",
        transform: "translateY(-50%)",
        borderWidth: 5,
        borderStyle: "solid",
        borderColor: "transparent var(--bg-hover) transparent transparent",
      };
    }
    if (position === "left") {
      return {
        left: "100%",
        top: "50%",
        transform: "translateY(-50%)",
        borderWidth: 5,
        borderStyle: "solid",
        borderColor: "transparent transparent transparent var(--bg-hover)",
      };
    }
    return {
      top: "100%",
      left: "50%",
      transform: "translateX(-50%)",
      borderWidth: 5,
      borderStyle: "solid",
      borderColor: "var(--bg-hover) transparent transparent transparent",
    };
  }, [position]);

  return (
    <span className="relative inline-flex items-center ml-1 leading-none">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors cursor-help bg-transparent border-0 p-0"
        aria-label="More info"
        type="button"
      >
        <Info className="w-3 h-3" />
      </button>
      {show && (
        <div
          className={containerClasses}
          style={{
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
            color: "var(--text-body)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {text}
          <div
            className="absolute"
            style={arrowStyle}
          />
        </div>
      )}
    </span>
  );
}

// ─── Custom chart tooltip ──────────────────────────────────────────────────────

export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  let time = label;
  try {
    const d = new Date(String(label).replace(" ", "T") + ":00Z");
    time = d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {}
  return (
    <div
      className="rounded-md px-3 py-2.5 text-xs"
      style={{
        background: "var(--bg-hover)",
        border: "1px solid var(--border)",
        fontFamily: "var(--font-mono)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        minWidth: 130,
      }}
    >
      <div style={{ color: "var(--text-muted)", marginBottom: 6, fontSize: 10 }}>{time}</div>
      {payload.map((e: any, i: number) => (
        <div key={i} className="flex justify-between items-center gap-4 mb-0.5">
          <span className="flex items-center gap-1.5" style={{ color: "var(--text-body)" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: e.color }} />
            {e.name}
          </span>
          <span style={{ color: e.color, fontWeight: 600 }}>{e.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Header Clock ─────────────────────────────────────────────────────────────

export function HeaderClock() {
  const [time, setTime] = useState<string>("--:--:--");

  useEffect(() => {
    const update = () => {
      setTime(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded text-xs"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-muted)" }}
    >
      <Clock className="w-3 h-3" style={{ color: "var(--text-subtle)" }} />
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: 11 }}>
        {time}
      </span>
    </div>
  );
}
