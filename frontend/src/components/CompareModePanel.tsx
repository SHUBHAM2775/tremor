import React from "react";
import { X, Zap } from "lucide-react";
import { PageDetail, getLevel } from "../types";

interface CompareModePanelProps {
  compareId: number | null;
  compareDetail: PageDetail | null;
  loadingCompare: boolean;
  setCompareId: (id: number | null) => void;
  setCompareDetail: (detail: PageDetail | null) => void;
  selectedDetail: PageDetail | null;
  setSelectedId: (id: number) => void;
}

export function CompareModePanel({
  compareId,
  compareDetail,
  loadingCompare,
  setCompareId,
  setCompareDetail,
  selectedDetail,
  setSelectedId,
}: CompareModePanelProps) {
  if (compareId === null) return null;

  return (
    <div
      className="shrink-0 border-t anim-fade-up"
      style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
    >
      <div
        className="px-5 py-3 flex items-center justify-between gap-3"
        style={{ borderBottom: "1px solid var(--border-muted)" }}
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-widest flex items-center gap-2"
          style={{ fontFamily: "var(--font-mono)", color: "#06b6d4" }}
        >
          <Zap className="w-3 h-3" />
          Compare Mode
          <span style={{ color: "var(--text-subtle)", fontWeight: 400 }}>Shift+click nodes on the map to select</span>
        </span>
        <button
          onClick={() => { setCompareId(null); setCompareDetail(null); }}
          className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-0 p-0"
          type="button"
        >
          <X className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
        </button>
      </div>
      {loadingCompare ? (
        <div className="p-4 space-y-2">
          {[90, 70].map((w, i) => (
            <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : compareDetail ? (
        <div className="p-4 flex gap-6 flex-wrap">
          {/* Compare page title + score */}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold mb-0.5 truncate" style={{ color: "var(--text-primary)" }}>
              {compareDetail.page.title}
            </div>
            <div className="text-[10px] flex items-center gap-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}>
              <span>vs. <span style={{ color: "var(--text-muted)" }}>{selectedDetail?.page.title}</span></span>
              {compareDetail.page.cluster_id !== null && compareDetail.page.cluster_id !== -1 && (
                <span>· Cluster {compareDetail.page.cluster_id}</span>
              )}
            </div>
          </div>
          {/* Score comparison */}
          <div className="flex items-center gap-4 shrink-0">
            {[
              { label: selectedDetail?.page.title ?? "A", score: selectedDetail?.page.anomaly_score ?? 0 },
              { label: compareDetail.page.title, score: compareDetail.page.anomaly_score ?? 0 },
            ].map(({ label, score }) => {
              const level = getLevel(score);
              const sc = level === "critical" ? "var(--color-critical)" : level === "elevated" ? "var(--color-elevated)" : "var(--color-normal)";
              return (
                <div key={label} className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-subtle)", fontFamily: "var(--font-mono)" }}>
                    {label.length > 12 ? label.substring(0, 10) + "…" : label}
                  </span>
                  <span className="text-2xl font-black" style={{ fontFamily: "var(--font-mono)", color: sc }}>
                    {score.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Action links */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => { setSelectedId(compareId); setCompareId(null); setCompareDetail(null); }}
              className="text-[10px] px-2.5 py-1.5 rounded cursor-pointer transition-opacity hover:opacity-80 border-0"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-muted)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
              type="button"
            >
              Focus this article
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
export default CompareModePanel;
