import React, { memo, useMemo } from "react";
import { PageInfo, getLevel } from "../types";

interface TickerProps {
  pages: PageInfo[];
}

export const Ticker = memo(function Ticker({ pages }: TickerProps) {
  const topConflicts = useMemo(() => {
    return pages
      .filter((p) => (p.anomaly_score || 0) > 0.5)
      .sort((a, b) => (b.anomaly_score || 0) - (a.anomaly_score || 0))
      .slice(0, 10);
  }, [pages]);

  if (topConflicts.length === 0) return null;
  const items = [...topConflicts, ...topConflicts]; // double for seamless loop

  return (
    <div className="ticker-wrap h-8">
      {/* Fixed-width LIVE badge — text can never scroll underneath this */}
      <div className="ticker-badge">
        <span className="live-dot" />
        LIVE
      </div>
      {/* Scrolling marquee — strictly confined to the space right of the badge */}
      <div className="ticker-track">
        <div className="ticker-inner">
          {items.map((p, i) => {
            const score = p.anomaly_score || 0;
            const level = getLevel(score);
            return (
              <span key={i} className="inline-flex items-center gap-2 px-6" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                <span style={{ color: level === "critical" ? "var(--color-critical)" : "var(--color-elevated)" }}>
                  {score.toFixed(2)}
                </span>
                <span style={{ color: "var(--text-muted)" }}>·</span>
                <span style={{ color: "var(--text-body)" }}>{p.title}</span>
                <span style={{ color: "var(--text-subtle)" }}>·</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
});
