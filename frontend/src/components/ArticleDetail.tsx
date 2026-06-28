import React, { useMemo } from "react";
import {
  Activity,
  MapPin,
  ExternalLink,
  Clock,
  MessageSquare,
  TrendingUp,
  User,
  Bot,
  ChevronDown,
  ChevronRight,
  BarChart2,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { PageDetail, TimelinePoint, getLevel, LEVEL_META } from "../types";
import { InfoTooltip, ChartTooltip } from "./UtilityComponents";
import { CompareModePanel } from "./CompareModePanel";

interface ArticleDetailProps {
  detail: PageDetail | null;
  loadingDetail: boolean;
  loadingSummary: boolean;
  summary: string;
  timeline: TimelinePoint[];
  revisionsExpanded: boolean;
  setRevisionsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  compareId: number | null;
  compareDetail: PageDetail | null;
  loadingCompare: boolean;
  setCompareId: (id: number | null) => void;
  setCompareDetail: (detail: PageDetail | null) => void;
  setSelectedId: (id: number) => void;
}

const REVISIONS_PREVIEW = 5;

export function ArticleDetail({
  detail,
  loadingDetail,
  loadingSummary,
  summary,
  timeline,
  revisionsExpanded,
  setRevisionsExpanded,
  compareId,
  compareDetail,
  loadingCompare,
  setCompareId,
  setCompareDetail,
  setSelectedId,
}: ArticleDetailProps) {
  // ─── Performance Memoization ──────────────────────────────────────────────────

  const timelineChart = useMemo(() => {
    if (timeline.filter((t) => t.edits > 0 || t.reverts > 0).length === 0) {
      return (
        <div
          className="h-full flex flex-col items-center justify-center gap-2"
          style={{ color: "var(--text-subtle)" }}
        >
          <BarChart2 className="w-7 h-7" />
          <span className="text-xs">No edits in this timeframe</span>
        </div>
      );
    }
    return (
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <AreaChart data={timeline} margin={{ top: 4, right: 4, left: -24, bottom: 4 }}>
          <defs>
            <linearGradient id="gEdits" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gReverts" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e11d48" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#e11d48" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border-muted)"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            stroke="transparent"
            tick={{
              fill: "var(--text-subtle)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            }}
            tickFormatter={(t) => t.substring(5, 10)}
          />
          <YAxis
            stroke="transparent"
            tick={{
              fill: "var(--text-subtle)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            }}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            wrapperStyle={{
              fontSize: 11,
              fontFamily: "var(--font-body)",
              color: "var(--text-muted)",
            }}
          />
          <Area
            name="Edits"
            type="monotone"
            dataKey="edits"
            stroke="#06b6d4"
            strokeWidth={1.5}
            fill="url(#gEdits)"
            dot={false}
            activeDot={{ r: 3, fill: "#06b6d4", stroke: "var(--bg-card)", strokeWidth: 2 }}
          />
          <Area
            name="Reverts"
            type="monotone"
            dataKey="reverts"
            stroke="#e11d48"
            strokeWidth={1.5}
            fill="url(#gReverts)"
            dot={false}
            activeDot={{ r: 3, fill: "#e11d48", stroke: "var(--bg-card)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }, [timeline]);

  const revisionLog = useMemo(() => {
    if (!detail) return null;
    const revisions = revisionsExpanded
      ? detail.recent_revisions
      : detail.recent_revisions.slice(0, REVISIONS_PREVIEW);

    if (revisions.length === 0) {
      return (
        <div
          className="py-8 text-center text-sm"
          style={{ color: "var(--text-subtle)" }}
        >
          No captured edits.
        </div>
      );
    }

    const pageTitle = detail.page.title;

    return (
      <div
        className="rounded overflow-hidden"
        style={{ border: "1px solid var(--border-muted)" }}
      >
        {revisions.map((rev, i) => {
          const bd = rev.byte_change;
          const bs = bd > 0 ? `+${bd}` : `${bd}`;
          const bc = bd > 0 ? "var(--color-normal)" : bd < 0 ? "var(--color-critical)" : "var(--text-subtle)";
          const wikiDiffUrl = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(pageTitle)}&diff=${rev.revision_id}`;

          return (
            <a
              key={rev.id}
              href={wikiDiffUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2 cursor-pointer no-underline"
              style={{
                borderBottom: i < revisions.length - 1
                  ? "1px solid var(--border-muted)"
                  : "none",
                display: "flex",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span
                    className="text-xs font-medium flex items-center gap-1 truncate max-w-[150px]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <User className="w-3 h-3 shrink-0" style={{ color: "var(--text-subtle)" }} />
                    {rev.editor}
                  </span>
                  {rev.is_bot && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-px rounded flex items-center gap-0.5"
                      style={{
                        fontFamily: "var(--font-mono)",
                        background: "rgba(161,161,170,0.1)",
                        border: "1px solid rgba(161,161,170,0.2)",
                        color: "var(--text-muted)",
                      }}
                    >
                      <Bot className="w-2.5 h-2.5" /> BOT
                    </span>
                  )}
                  {rev.is_revert && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-px rounded"
                      style={{
                        fontFamily: "var(--font-mono)",
                        background: "rgba(225,29,72,0.1)",
                        border: "1px solid rgba(225,29,72,0.25)",
                        color: "var(--accent-hi)",
                      }}
                    >
                      REVERT
                    </span>
                  )}
                  <span
                    className="text-[10px]"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
                  >
                    {new Date(rev.timestamp).toLocaleString()}
                  </span>
                  {/* External link icon — shown on hover as click affordance */}
                  <ExternalLink
                    className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ml-auto shrink-0"
                    style={{ color: "var(--accent-hi)" }}
                  />
                </div>
                <p className="text-xs italic line-clamp-2" style={{ color: "var(--text-muted)" }}>
                  {rev.comment || "(No edit comment)"}
                </p>
              </div>
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded self-start shrink-0"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: bc,
                  background: bd > 0 ? "rgba(34,197,94,0.07)" : bd < 0 ? "rgba(239,68,68,0.07)" : "transparent",
                  border: `1px solid ${bd > 0 ? "rgba(34,197,94,0.2)" : bd < 0 ? "rgba(239,68,68,0.2)" : "var(--border-muted)"}`,
                }}
              >
                {bs} B
              </span>
            </a>
          );
        })}
      </div>
    );
  }, [detail, revisionsExpanded]);

  return (
    <main
      id="detail-panel"
      className="lg:col-span-6 flex flex-col overflow-y-auto"
      style={{ borderRight: "1px solid var(--border)", background: "var(--bg-base)" }}
    >
      {!detail ? (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-4 p-10"
          style={{ color: "var(--text-subtle)" }}
        >
          <Activity className="w-10 h-10" style={{ color: "var(--border)" }} />
          <div className="text-center max-w-xs">
            <p className="text-sm font-medium mb-1" style={{ color: "var(--text-muted)" }}>Select an article to inspect</p>
            <p className="text-xs leading-relaxed">Click any article in the feed to see live dispute metrics, edit history, and an AI-generated analysis of the conflict.</p>
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-5 anim-fade-up flex-1">
          {/* ─ Article header ─ */}
          <div className="flex flex-wrap justify-between items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-2 mb-2">
                <span
                  className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
                  style={{
                    fontFamily: "var(--font-mono)",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                  }}
                >
                  {detail.page.wiki}
                </span>
                {detail.page.cluster_id !== null && detail.page.cluster_id !== -1 && (
                  <span
                    className="text-[10px] flex items-center gap-1"
                    style={{ color: "var(--text-subtle)" }}
                  >
                    <MapPin className="w-3 h-3" />
                    Cluster {detail.page.cluster_id}
                    <InfoTooltip text="Automatically assigned topic cluster based on semantic similarity to other tracked pages." />
                  </span>
                )}
                <a
                  href={`https://en.wikipedia.org/wiki/${encodeURIComponent(detail.page.title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] flex items-center gap-1 transition-colors duration-100 no-underline"
                  style={{ color: "var(--text-subtle)", fontFamily: "var(--font-mono)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-hi)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-subtle)")}
                >
                  <ExternalLink className="w-3 h-3" /> Wikipedia
                </a>
              </div>

              <h2
                className="text-2xl font-bold leading-tight mb-1"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                {detail.page.title}
              </h2>

              <p
                className="text-[11px] flex items-center gap-1.5"
                style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
              >
                <Clock className="w-3 h-3" />
                Last scored:{" "}
                {detail.page.last_checked
                  ? new Date(detail.page.last_checked).toLocaleString()
                  : "Pending"}
              </p>
            </div>

            {/* Score display */}
            {(() => {
              const score = detail.page.anomaly_score || 0;
              const level = getLevel(score);
              const meta = LEVEL_META[level];
              const scoreColor = level === "critical" ? "var(--color-critical)" : level === "elevated" ? "var(--color-elevated)" : "var(--color-normal)";
              return (
                <div
                  className="flex flex-col items-end shrink-0 p-4 rounded"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-muted)",
                    minWidth: 120,
                  }}
                >
                  <span
                    className="text-[9px] uppercase tracking-widest mb-1 flex items-center gap-1"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
                  >
                    Conflict Score
                    <InfoTooltip text="Z-score vs. this page's historical baseline. Above 1.5 = actively contested." />
                  </span>
                  <span
                    className="text-4xl font-black leading-none"
                    style={{ fontFamily: "var(--font-mono)", color: scoreColor }}
                  >
                    {score.toFixed(2)}
                  </span>
                  <span
                    className="text-[10px] font-semibold mt-2 px-2.5 py-0.5 rounded"
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: scoreColor,
                      background: level === "critical" ? "rgba(239,68,68,0.1)" : level === "elevated" ? "rgba(249,115,22,0.1)" : "rgba(34,197,94,0.08)",
                      border: `1px solid ${level === "critical" ? "rgba(239,68,68,0.25)" : level === "elevated" ? "rgba(249,115,22,0.25)" : "rgba(34,197,94,0.2)"}`,
                      animation: level === "critical" ? "live-blink 2s ease-in-out infinite" : "none",
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* ─ Divider ─ */}
          <div style={{ borderTop: "1px solid var(--border-muted)" }} />

          {/* ─ AI Summary ─ */}
          <div
            className="p-4 rounded"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-muted)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
              <span
                className="text-xs font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                Dispute Summary
              </span>
              <span
                className="text-[9px] px-2 py-px rounded uppercase tracking-widest font-bold"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--accent-bg)",
                  border: "1px solid var(--accent-border)",
                  color: "var(--accent-hi)",
                }}
              >
                AI
              </span>
            </div>
            {loadingSummary ? (
              <div className="space-y-2">
                {[100, 85, 65].map((w, i) => (
                  <div key={i} className={`skeleton h-3`} style={{ width: `${w}%`, animationDelay: `${i * 0.1}s` }} />
                ))}
              </div>
            ) : (
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-body)" }}>
                {summary || "No active dispute analysis generated."}
              </p>
            )}
          </div>

          {/* ─ Timeline chart ─ */}
          <div
            className="p-4 rounded"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-muted)" }}
          >
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
              <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                Conflict Intensity
              </span>
              <span
                className="text-[10px]"
                style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
              >
                Last 72 hours
              </span>
            </div>

            <div className="h-48" style={{ minWidth: 0 }}>
              {timelineChart}
            </div>
          </div>

          {/* ─ Revision log ─ */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                Recent Revisions
                <span
                  className="text-[10px] font-normal"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
                >
                  ({detail.recent_revisions.length})
                </span>
              </span>
              {detail.recent_revisions.length > REVISIONS_PREVIEW && (
                <button
                  id="toggle-revisions-btn"
                  onClick={() => setRevisionsExpanded((v) => !v)}
                  className="text-xs flex items-center gap-1 cursor-pointer transition-colors duration-100 bg-transparent border-0 p-0"
                  style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                  type="button"
                >
                  {revisionsExpanded
                    ? <><ChevronDown className="w-3.5 h-3.5" /> less</>
                    : <><ChevronRight className="w-3.5 h-3.5" /> all {detail.recent_revisions.length}</>}
                </button>
              )}
            </div>

            {revisionLog}

            {!revisionsExpanded && detail.recent_revisions.length > REVISIONS_PREVIEW && (
              <button
                onClick={() => setRevisionsExpanded(true)}
                className="w-full mt-2 py-2 text-xs text-center rounded cursor-pointer transition-colors duration-100"
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-muted)",
                  color: "var(--text-subtle)",
                  fontFamily: "var(--font-mono)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent-border)";
                  e.currentTarget.style.color = "var(--accent-hi)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-muted)";
                  e.currentTarget.style.color = "var(--text-subtle)";
                }}
                type="button"
              >
                + {detail.recent_revisions.length - REVISIONS_PREVIEW} more revisions
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Compare Panel ── */}
      <CompareModePanel
        compareId={compareId}
        compareDetail={compareDetail}
        loadingCompare={loadingCompare}
        setCompareId={setCompareId}
        setCompareDetail={setCompareDetail}
        selectedDetail={detail}
        setSelectedId={setSelectedId}
      />
    </main>
  );
}
export default ArticleDetail;
