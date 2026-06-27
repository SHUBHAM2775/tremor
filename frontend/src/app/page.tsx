"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import Link from "next/link";
import {
  Activity,
  BookOpen,
  Plus,
  RefreshCw,
  AlertTriangle,
  User,
  Bot,
  MessageSquare,
  MapPin,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  Info,
  X,
  Zap,
  Globe,
  BarChart2,
  Radio,
  Layers,
  Clock,
  ExternalLink,
  Flame,
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

const API_BASE = "";

// Helper to perform safe fetch and JSON parsing
async function safeFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }
  const contentType = res.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw new TypeError("Response is not JSON");
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageInfo {
  id: number;
  title: string;
  wiki: string;
  anomaly_score: number | null;
  cluster_id: number | null;
  x: number | null;
  y: number | null;
  last_checked: string | null;
}

interface Revision {
  id: number;
  revision_id: number;
  editor: string;
  timestamp: string;
  byte_change: number;
  comment: string;
  is_revert: boolean;
  is_bot: boolean;
}

interface PageDetail {
  page: PageInfo;
  recent_revisions: Revision[];
}

interface TimelinePoint {
  time: string;
  edits: number;
  reverts: number;
}

interface ClusterPage {
  id: number;
  title: string;
  anomaly_score: number | null;
  cluster_id: number | null;
  x: number | null;
  y: number | null;
}

// ─── Score helpers ─────────────────────────────────────────────────────────────

type Level = "critical" | "elevated" | "normal";

function getLevel(score: number): Level {
  if (score > 2.0) return "critical";
  if (score > 0.5) return "elevated";
  return "normal";
}

const LEVEL_META = {
  critical: {
    label: "High Conflict",
    scoreClass: "score-critical",
    dot: "#ef4444",
    dotPulse: true,
  },
  elevated: {
    label: "Elevated",
    scoreClass: "score-elevated",
    dot: "#f97316",
    dotPulse: false,
  },
  normal: {
    label: "Normal",
    scoreClass: "score-normal",
    dot: "#22c55e",
    dotPulse: false,
  },
};

// ─── Cluster colours (intentional variety, not "AI blue") ─────────────────────

const CLUSTER_COLORS = [
  "#e11d48", // rose
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#84cc16", // lime
  "#8b5cf6", // violet
];

// ─── Info tooltip ──────────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex items-center ml-1 leading-none">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors cursor-help"
        aria-label="More info"
      >
        <Info className="w-3 h-3" />
      </button>
      {show && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 rounded-md z-50 pointer-events-none text-[11px] leading-relaxed"
          style={{
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
            color: "var(--text-body)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {text}
          <div
            className="absolute top-full left-1/2 -translate-x-1/2"
            style={{
              borderWidth: 5,
              borderStyle: "solid",
              borderColor: "var(--bg-hover) transparent transparent transparent",
            }}
          />
        </div>
      )}
    </span>
  );
}

// ─── Custom chart tooltip ──────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
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

// ─── Ticker item (memoized — pure component that only cares about pages prop) ─

const Ticker = memo(function Ticker({ pages }: { pages: PageInfo[] }) {
  const topConflicts = useMemo(() => {
    return pages
      .filter((p) => (p.anomaly_score || 0) > 0.5)
      .sort((a, b) => (b.anomaly_score || 0) - (a.anomaly_score || 0))
      .slice(0, 10);
  }, [pages]);

  if (topConflicts.length === 0) return null;
  const items = [...topConflicts, ...topConflicts]; // double for seamless loop
  return (
    // ticker-wrap is now a flex row:
    //   ticker-badge   — fixed-width LIVE zone (flex-shrink-0, own background)
    //   ticker-track   — flex-1 overflow-hidden zone that constrains the marquee
    //   ticker-inner   — the actual scrolling strip (starts at the right edge of the badge)
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


// ─── Header Clock (Isolated to prevent full page re-renders) ──────────────────

function HeaderClock() {
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

// ─── On-demand fetch status type ─────────────────────────────────────────────
type FetchStatus = "idle" | "checking" | "fetching" | "done" | "not_found" | "error";

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [clusters, setClusters] = useState<ClusterPage[]>([]);
  const [searchTitle, setSearchTitle] = useState("");
  const [hoveredPage, setHoveredPage] = useState<ClusterPage | null>(null);
  const [hoveredClusterId, setHoveredClusterId] = useState<number | null>(null);

  // ─── Debounced filter — only re-filter list 200ms after user stops typing ──
  const [filterInputValue, setFilterInputValue] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFilterChange = useCallback((val: string) => {
    setFilterInputValue(val);
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => setFilterQuery(val), 200);
  }, []);

  // ─── On-demand Wikipedia search state ──────────────────────────────────────
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [fetchMessage, setFetchMessage] = useState("");

  // ─── Compare mode — hold Shift + click a second article ───────────────────
  const [compareId, setCompareId] = useState<number | null>(null);
  const [compareDetail, setCompareDetail] = useState<PageDetail | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const [loadingPages, setLoadingPages] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRecluster, setLoadingRecluster] = useState(false);

  const [revisionsExpanded, setRevisionsExpanded] = useState(false);
  const REVISIONS_PREVIEW = 5;
  const TOP_CLUSTERS = 6;

  // ─── Load More & Buffer state ──────────────────────────────────────────────
  const [bufferInfo, setBufferInfo] = useState<{
    buffer_size: number;
    total_tracked: number;
    cap: number;
    redis_available: boolean;
  } | null>(null);
  const [loadingLoadMore, setLoadingLoadMore] = useState(false);
  const [loadMoreMessage, setLoadMoreMessage] = useState<string | null>(null);
  const [pagesLimit, setPagesLimit] = useState(300);

  // ─── Cluster map math (all memoized for stable useMemo deps) ─────────────────

  const PAD = 28, SZ = 320;

  const validNodes = useMemo(() => {
    const nodesWithCoords = clusters.filter((c) => c.x !== null && c.y !== null);
    if (nodesWithCoords.length <= 200) return nodesWithCoords;
    
    // Sort by anomaly score desc
    const sorted = [...nodesWithCoords].sort((a, b) => (b.anomaly_score || 0) - (a.anomaly_score || 0));
    
    // Take top 200
    const top200 = sorted.slice(0, 200);
    
    // Selection Guarantee: if selectedId is set and its node is not in top 200, swap it in / append it
    if (selectedId !== null && !top200.some((n) => n.id === selectedId)) {
      const selectedNode = nodesWithCoords.find((n) => n.id === selectedId);
      if (selectedNode) {
        top200.push(selectedNode);
      }
    }
    
    return top200;
  }, [clusters, selectedId]);

  const { clusterCounts, topClusterIds } = useMemo(() => {
    const counts: Record<number, number> = {};
    validNodes.forEach((n) => {
      if (n.cluster_id !== null && n.cluster_id !== -1) {
        counts[n.cluster_id] = (counts[n.cluster_id] || 0) + 1;
      }
    });
    const topIds = Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_CLUSTERS)
      .map(([id]) => Number(id));
    return { clusterCounts: counts, topClusterIds: topIds };
  }, [validNodes]);

  const getClusterColor = useCallback(
    (cid: number | null) => {
      if (cid === null || cid === -1) return "#3f3f46";
      const idx = topClusterIds.indexOf(cid);
      return idx >= 0 ? CLUSTER_COLORS[idx % CLUSTER_COLORS.length] : "#3f3f46";
    },
    [topClusterIds]
  );

  const { scaleX, scaleY } = useMemo(() => {
    const xs = validNodes.map((n) => n.x as number);
    const ys = validNodes.map((n) => n.y as number);
    const maxAbsX = xs.length ? Math.max(...xs.map(Math.abs)) : 0;
    const maxAbsY = ys.length ? Math.max(...ys.map(Math.abs)) : 0;
    return {
      scaleX: (x: number) => maxAbsX === 0 ? SZ / 2 : SZ / 2 + (x / maxAbsX) * (SZ / 2 - PAD),
      scaleY: (y: number) => maxAbsY === 0 ? SZ / 2 : SZ / 2 - (y / maxAbsY) * (SZ / 2 - PAD),
    };
  }, [validNodes]);

  // Prevent overlapping nodes by running a deterministic collision layout in screen space
  const adjustedNodes = useMemo(() => {
    if (validNodes.length === 0) return [];
    
    // Assign initial mapped coordinates
    const nodes = validNodes.map((n) => ({
      ...n,
      cx: scaleX(n.x as number),
      cy: scaleY(n.y as number),
    }));
    
    const nodeRadius = 5.5; // Visual circle radius is ~4-7px
    const minDist = nodeRadius * 2 + 3; // Keep at least 14px space between node centers
    
    // Relaxation iterations to resolve overlaps
    for (let iter = 0; iter < 15; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].cx - nodes[j].cx;
          const dy = nodes[i].cy - nodes[j].cy;
          const dist = Math.hypot(dx, dy) || 0.1;
          if (dist < minDist) {
            const overlap = minDist - dist;
            const pushX = (dx / dist) * (overlap / 2);
            const pushY = (dy / dist) * (overlap / 2);
            
            nodes[i].cx += pushX;
            nodes[i].cy += pushY;
            nodes[j].cx -= pushX;
            nodes[j].cy -= pushY;
          }
        }
      }
      
      // Enforce container boundary bounds
      nodes.forEach((n) => {
        n.cx = Math.max(PAD, Math.min(SZ - PAD, n.cx));
        n.cy = Math.max(PAD, Math.min(SZ - PAD, n.cy));
      });
    }
    return nodes;
  }, [validNodes, scaleX, scaleY]);

  // Calculate cluster centroids and bounds for the background nebula clouds
  const clusterCentroids = useMemo(() => {
    const centroids: Record<number, { cx: number; cy: number; radius: number }> = {};
    
    topClusterIds.forEach((cid) => {
      const cNodes = adjustedNodes.filter((n) => n.cluster_id === cid);
      if (cNodes.length === 0) return;
      
      const sumX = cNodes.reduce((sum, n) => sum + n.cx, 0);
      const sumY = cNodes.reduce((sum, n) => sum + n.cy, 0);
      const cx = sumX / cNodes.length;
      const cy = sumY / cNodes.length;
      
      // Find standard deviation or max distance to determine cloud size
      let maxDist = 18; // base minimum radius
      cNodes.forEach((n) => {
        const d = Math.hypot(n.cx - cx, n.cy - cy);
        if (d > maxDist) maxDist = d;
      });
      
      centroids[cid] = {
        cx,
        cy,
        radius: Math.min(SZ / 2.8, maxDist + 12), // Cap size to look balanced
      };
    });
    
    return centroids;
  }, [adjustedNodes, topClusterIds]);

  // Dynamic naming helper for legend and metadata
  const getClusterLabel = useCallback(
    (cid: number) => {
      const clusterPages = validNodes.filter((n) => n.cluster_id === cid);
      if (clusterPages.length === 0) return `Cluster ${cid}`;
      
      const sorted = [...clusterPages].sort((a, b) => (b.anomaly_score || 0) - (a.anomaly_score || 0));
      const topTitle = sorted[0].title;
      
      if (clusterPages.length === 1) {
        return topTitle;
      }
      return `${topTitle} (+${clusterPages.length - 1})`;
    },
    [validNodes]
  );

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

  const umapSvg = useMemo(() => {
    if (validNodes.length === 0) return null;
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${SZ} ${SZ}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Topic cluster map"
        role="img"
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          {/* Subtle starfield/radar background grid */}
          <pattern id="radar-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="var(--border-muted)" strokeWidth="0.5" opacity="0.25" />
            <circle cx="0" cy="0" r="0.8" fill="var(--text-subtle)" opacity="0.15" />
          </pattern>
          {/* Node selection outer glow filter */}
          <filter id="node-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          {/* Hardware-accelerated radial gradients for the background nebulae */}
          {topClusterIds.map((cid) => {
            const col = getClusterColor(cid);
            return (
              <radialGradient id={`nebula-grad-${cid}`} key={`neb-grad-${cid}`}>
                <stop offset="0%" stopColor={col} stopOpacity={0.28} />
                <stop offset="50%" stopColor={col} stopOpacity={0.08} />
                <stop offset="100%" stopColor={col} stopOpacity={0} />
              </radialGradient>
            );
          })}
        </defs>

        {/* Background Grid Pattern */}
        <rect x={0} y={0} width={SZ} height={SZ} fill="url(#radar-grid)" />
        <rect x={0} y={0} width={SZ} height={SZ} fill="transparent" />

        {/* Axis guides (minimal styled dashed lines) */}
        <line
          x1={SZ / 2}
          y1={PAD / 2}
          x2={SZ / 2}
          y2={SZ - PAD / 2}
          stroke="var(--border-muted)"
          strokeWidth={0.5}
          strokeDasharray="3 3"
          opacity={0.6}
        />
        <line
          x1={PAD / 2}
          y1={SZ / 2}
          x2={SZ - PAD / 2}
          y2={SZ / 2}
          stroke="var(--border-muted)"
          strokeWidth={0.5}
          strokeDasharray="3 3"
          opacity={0.6}
        />

        {/* 1. Nebula clouds (drawn behind everything) */}
        {Object.entries(clusterCentroids).map(([cidStr, centroid]) => {
          const cid = Number(cidStr);
          const isHovered = hoveredClusterId === cid;
          const isDimmed = hoveredClusterId !== null && hoveredClusterId !== cid;

          return (
            <circle
              key={`nebula-${cid}`}
              cx={centroid.cx}
              cy={centroid.cy}
              r={centroid.radius}
              fill={`url(#nebula-grad-${cid})`}
              opacity={isHovered ? 1.0 : isDimmed ? 0.2 : 0.7}
              style={{ transition: "all 0.25s ease" }}
            />
          );
        })}

        {/* 2. Constellation connector lines */}
        {adjustedNodes
          .filter((n) => n.cluster_id !== null && n.cluster_id !== -1 && topClusterIds.includes(n.cluster_id))
          .map((n) => {
            const centroid = clusterCentroids[n.cluster_id!];
            if (!centroid) return null;
            const col = getClusterColor(n.cluster_id);
            const isHovered = hoveredClusterId === n.cluster_id;
            const isDimmed = hoveredClusterId !== null && hoveredClusterId !== n.cluster_id;

            return (
              <line
                key={`line-${n.id}`}
                x1={n.cx}
                y1={n.cy}
                x2={centroid.cx}
                y2={centroid.cy}
                stroke={col}
                strokeWidth={0.5}
                strokeDasharray="2 3"
                opacity={isHovered ? 0.35 : isDimmed ? 0.04 : 0.15}
                style={{ transition: "opacity 0.2s ease" }}
              />
            );
          })}

        {/* 3. Noise / other nodes (rendered below cluster nodes) */}
        {adjustedNodes
          .filter((n) => n.cluster_id === null || n.cluster_id === -1 || !topClusterIds.includes(n.cluster_id))
          .map((n) => {
            const isSel = n.id === selectedId;
            const isHover = hoveredPage?.id === n.id;
            const isDimmed = hoveredClusterId !== null;

            return (
              <circle
                key={`o-${n.id}`}
                cx={n.cx}
                cy={n.cy}
                r={isSel ? 6 : isHover ? 4.5 : 3}
                fill="#4b5563"
                stroke={isSel ? "#ffffff" : "#1f2937"}
                strokeWidth={isSel ? 1.2 : 0.5}
                className="cursor-pointer transition-all duration-150"
                style={{ opacity: isDimmed ? 0.15 : 0.45 }}
                onClick={() => setSelectedId(n.id)}
                onMouseEnter={() => setHoveredPage(n)}
                onMouseLeave={() => setHoveredPage(null)}
              />
            );
          })}

        {/* 4. Top cluster nodes (rendered on top) */}
        {adjustedNodes
          .filter((n) => n.cluster_id !== null && n.cluster_id !== -1 && topClusterIds.includes(n.cluster_id))
          .map((n) => {
            const isSel = n.id === selectedId;
            const isComp = n.id === compareId;
            const isHover = hoveredPage?.id === n.id;
            const col = getClusterColor(n.cluster_id);
            const isDimmed = hoveredClusterId !== null && hoveredClusterId !== n.cluster_id;
            const isSpiking = (n.anomaly_score || 0) > 2.0;

            const r = isSel ? 7 : isHover ? 5.5 : 4;

            return (
              <g
                key={n.id}
                className="cursor-pointer"
                onClick={(e) => {
                  if (e.shiftKey && selectedId !== null && selectedId !== n.id) {
                    setCompareId(n.id);
                  } else {
                    setSelectedId(n.id);
                    setCompareId(null);
                    setCompareDetail(null);
                  }
                }}
                onMouseEnter={() => {
                  setHoveredPage(n);
                  if (n.cluster_id !== null && n.cluster_id !== -1) {
                    setHoveredClusterId(n.cluster_id);
                  }
                }}
                onMouseLeave={() => {
                  setHoveredPage(null);
                  setHoveredClusterId(null);
                }}
              >
                {/* Spike pulse ring — only on actively spiking nodes */}
                {isSpiking && !isDimmed && (
                  <circle
                    cx={n.cx}
                    cy={n.cy}
                    r={r}
                    fill="none"
                    stroke={col}
                    strokeWidth={1.5}
                    opacity={0}
                  >
                    <animate attributeName="r" values={`${r};${r + 14};${r + 18}`} dur="2.2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.7;0.2;0" dur="2.2s" repeatCount="indefinite" />
                  </circle>
                )}
                {/* Selection Ring (Glowing) */}
                {isSel && (
                  <circle
                    cx={n.cx}
                    cy={n.cy}
                    r={r + 5}
                    fill="none"
                    stroke={col}
                    strokeWidth={1.5}
                    opacity={0.4}
                    filter="url(#node-glow)"
                  />
                )}
                {/* Compare ring */}
                {isComp && (
                  <circle
                    cx={n.cx}
                    cy={n.cy}
                    r={r + 5}
                    fill="none"
                    stroke="#06b6d4"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    opacity={0.7}
                  />
                )}
                {/* Hover halo */}
                {isHover && !isSel && (
                  <circle
                    cx={n.cx}
                    cy={n.cy}
                    r={r + 3}
                    fill="none"
                    stroke={col}
                    strokeWidth={1}
                    opacity={0.3}
                  />
                )}
                {/* Core dot */}
                <circle
                  cx={n.cx}
                  cy={n.cy}
                  r={r}
                  fill={col}
                  stroke={isSel ? "#ffffff" : isComp ? "#06b6d4" : "#111113"}
                  strokeWidth={isSel ? 1.5 : 0.8}
                  style={{
                    transition: "all 0.15s ease",
                    opacity: isDimmed ? 0.25 : 1,
                  }}
                />
              </g>
            );
          })}

        {/* 5. Centroid labels on the map — only for clusters with 3+ pages to avoid overlap */}
        {Object.entries(clusterCentroids).map(([cidStr, centroid]) => {
          const cid = Number(cidStr);
          const isHovered = hoveredClusterId === cid;
          const isDimmed = hoveredClusterId !== null && hoveredClusterId !== cid;
          const label = getClusterLabel(cid);
          const count = clusterCounts[cid] || 0;
          
          // Collision avoidance: only show persistent labels for clusters with 3+ members
          // Smaller clusters get labels only on hover to reduce visual clutter
          const alwaysShow = count >= 3;
          
          // Clean the label name (remove (+N pages) part to keep it compact on map)
          const shortLabel = label.split(" (+")[0];

          return (
            <g
              key={`label-${cid}`}
              style={{ pointerEvents: "none", transition: "all 0.25s ease" }}
              opacity={isHovered ? 1.0 : isDimmed ? 0.02 : alwaysShow ? 0.5 : 0}
            >
              <text
                x={centroid.cx}
                y={centroid.cy + 15}
                textAnchor="middle"
                fill="var(--bg-base)"
                stroke="var(--bg-base)"
                strokeWidth={3}
                fontSize={8.5}
                fontWeight={600}
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {shortLabel.length > 18 ? `${shortLabel.substring(0, 16)}...` : shortLabel}
              </text>
              <text
                x={centroid.cx}
                y={centroid.cy + 15}
                textAnchor="middle"
                fill={getClusterColor(cid)}
                fontSize={8.5}
                fontWeight={600}
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {shortLabel.length > 18 ? `${shortLabel.substring(0, 16)}...` : shortLabel}
              </text>
            </g>
          );
        })}

        {/* 6. Floating tooltip */}
        {hoveredPage && (() => {
          const n = adjustedNodes.find((node) => node.id === hoveredPage.id);
          if (!n) return null;
          
          const label = n.cluster_id !== null && n.cluster_id !== -1 ? getClusterLabel(n.cluster_id) : "Unclustered";
          const text = `${n.title} [${label}]`;
          
          const charLen = text.length;
          const tooltipWidth = Math.min(220, charLen * 6.5 + 16);
          const tooltipHeight = 24;
          
          let tx = n.cx;
          let ty = n.cy - 16;
          
          if (tx - tooltipWidth / 2 < 4) tx = tooltipWidth / 2 + 4;
          if (tx + tooltipWidth / 2 > SZ - 4) tx = SZ - tooltipWidth / 2 - 4;
          if (ty - tooltipHeight < 4) ty = n.cy + 16 + tooltipHeight;
          
          return (
            <g style={{ pointerEvents: "none" }} className="transition-all duration-100">
              <rect
                x={tx - tooltipWidth / 2}
                y={ty - tooltipHeight}
                width={tooltipWidth}
                height={tooltipHeight}
                rx={4}
                fill="var(--bg-card)"
                stroke="var(--border)"
                strokeWidth={0.8}
                style={{ filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))" }}
              />
              <text
                x={tx}
                y={ty - tooltipHeight / 2 + 3}
                textAnchor="middle"
                fill="var(--text-primary)"
                fontSize={9}
                fontWeight={500}
                style={{ fontFamily: "var(--font-body)" }}
              >
                {n.title.length > 30 ? `${n.title.substring(0, 28)}...` : n.title}
              </text>
            </g>
          );
        })()}
      </svg>
    );
  }, [
    validNodes,
    selectedId,
    hoveredPage,
    hoveredClusterId,
    topClusterIds,
    adjustedNodes,
    clusterCentroids,
    getClusterColor,
    getClusterLabel,
  ]);

  // ─── Data fetching ────────────────────────────────────────────────────────────

  const fetchBufferInfo = useCallback(async () => {
    try {
      const data = await safeFetchJson<{
        buffer_size: number;
        total_tracked: number;
        cap: number;
        redis_available: boolean;
      }>(`${API_BASE}/api/pages/buffer-info`);
      setBufferInfo(data);
    } catch (e) {
      console.error("Failed to fetch buffer info:", e);
    }
  }, []);

  const fetchOverview = useCallback(async () => {
    try {
      const [pd, cd] = await Promise.all([
        safeFetchJson<PageInfo[]>(`${API_BASE}/api/pages?limit=${pagesLimit}`),
        safeFetchJson<ClusterPage[]>(`${API_BASE}/api/clusters?limit=2000`),
      ]);
      setClusters(cd);
      setPages(pd);
      await fetchBufferInfo();
    } catch (e) {
      console.error("Failed to fetch overview data:", e);
    } finally {
      setLoadingPages(false);
    }
  }, [fetchBufferInfo, pagesLimit]);

  useEffect(() => {
    fetchOverview();
    const iv = setInterval(fetchOverview, 15000);
    return () => clearInterval(iv);
  }, [fetchOverview]);

  // Set default selection when pages first load
  useEffect(() => {
    if (pages.length > 0 && selectedId === null) {
      setSelectedId(pages[0].id);
    }
  }, [pages, selectedId]);

  const fetchDetail = async (id: number) => {
    setLoadingDetail(true);
    setLoadingSummary(true);
    setRevisionsExpanded(false);
    try {
      const [pd, tl, sm] = await Promise.all([
        safeFetchJson<PageDetail>(`${API_BASE}/api/pages/${id}`),
        safeFetchJson<TimelinePoint[]>(`${API_BASE}/api/pages/${id}/timeline?window_days=3`),
        safeFetchJson<{ summary: string }>(`${API_BASE}/api/pages/${id}/summary`),
      ]);
      setDetail(pd);
      setTimeline(tl);
      setSummary(sm.summary);
    } catch (e) {
      console.error("Failed to fetch page details:", e);
    } finally {
      setLoadingDetail(false);
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    if (selectedId !== null) fetchDetail(selectedId);
  }, [selectedId]);

  // ─── Compare mode fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    if (compareId === null) {
      setCompareDetail(null);
      return;
    }
    setLoadingCompare(true);
    safeFetchJson<PageDetail>(`${API_BASE}/api/pages/${compareId}`)
      .then((detail) => {
        setCompareDetail(detail);
      })
      .catch(console.error)
      .finally(() => setLoadingCompare(false));
  }, [compareId]);

  // ─── Batch Load More handler ──────────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (loadingLoadMore) return;

    const totalTracked = bufferInfo ? bufferInfo.total_tracked : 0;
    const currentRendered = pages.length;

    // Case 1: Page forward through already tracked articles in the DB/cache
    if (currentRendered < totalTracked) {
      setLoadingLoadMore(true);
      const newLimit = pagesLimit + 100;
      setPagesLimit(newLimit);
      setLoadMoreMessage("Loading next 100 tracked articles...");
      try {
        const pd = await safeFetchJson<PageInfo[]>(`${API_BASE}/api/pages?limit=${newLimit}`);
        setPages(pd);
        await fetchBufferInfo();
      } catch (e) {
        console.error("Failed to page forward from cache:", e);
        alert("Failed to load more cached articles.");
      } finally {
        setLoadMoreMessage(null);
        setLoadingLoadMore(false);
      }
      return;
    }

    // Case 2: Fetch brand-new articles from Wikipedia
    setLoadingLoadMore(true);
    setLoadMoreMessage("Queuing batch load from Wikipedia...");
    try {
      const res = await fetch(`${API_BASE}/api/pages/load-more`, {
        method: "POST",
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Load more request failed");
      }
      const data = await res.json() as { message: string; job_id?: string; queued?: boolean; titles: string[] };
      
      if (data.job_id) {
        setLoadMoreMessage(`Loading ${data.titles.length} articles (via queue)...`);
        // Poll status of the job
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise((r) => setTimeout(r, 2500));
          try {
            const jobStatus = await safeFetchJson<{ status: string; result?: unknown; error?: string }>(
              `${API_BASE}/api/pages/track/status/${data.job_id}`
            );
            if (jobStatus.status === "finished") {
              setLoadMoreMessage("Batch loaded successfully! Recalculating clusters...");
              break;
            } else if (jobStatus.status === "failed") {
              throw new Error(jobStatus.error || "Batch tracking job failed");
            } else {
              setLoadMoreMessage(`Tracking batch... (${jobStatus.status})`);
            }
          } catch (e) {
            console.error("Error polling batch job status:", e);
          }
        }
      } else {
        // BackgroundTask fallback path: wait a few seconds and refresh
        setLoadMoreMessage(`Loading ${data.titles.length} articles in background...`);
        await new Promise((r) => setTimeout(r, 8000));
      }
      
      setLoadMoreMessage("Refreshing feed...");
      // Increase pagesLimit to include the newly loaded pages
      const newLimit = pagesLimit + 100;
      setPagesLimit(newLimit);
      const [pd, cd] = await Promise.all([
        safeFetchJson<PageInfo[]>(`${API_BASE}/api/pages?limit=${newLimit}`),
        safeFetchJson<ClusterPage[]>(`${API_BASE}/api/clusters?limit=2000`),
      ]);
      setClusters(cd);
      setPages(pd);
      await fetchBufferInfo();
      setLoadMoreMessage(null);
    } catch (err: any) {
      setLoadMoreMessage(null);
      alert(err.message || "Failed to load more articles.");
    } finally {
      setLoadingLoadMore(false);
    }
  }, [loadingLoadMore, bufferInfo, pages.length, pagesLimit, fetchBufferInfo]);

  // ─── On-demand Wikipedia fetch ────────────────────────────────────────────────
  const handleOnDemandFetch = useCallback(async (title: string) => {
    setFetchStatus("checking");
    setFetchMessage(`Checking Wikipedia for "${title}"…`);
    try {
      // Step 1: Verify the title exists on Wikipedia
      const checkData = await safeFetchJson<{ exists: boolean; canonical_title: string }>(
        `${API_BASE}/api/pages/check-wikipedia?title=${encodeURIComponent(title)}`
      );
      if (!checkData.exists) {
        setFetchStatus("not_found");
        setFetchMessage(`"${title}" doesn't exist on Wikipedia.`);
        return;
      }
      const canonicalTitle = checkData.canonical_title;
      // Step 2: Kick off background fetch (Redis queue or BackgroundTask)
      setFetchStatus("fetching");
      setFetchMessage(`Fetching "${canonicalTitle}" from Wikipedia…`);
      const trackRes = await fetch(`${API_BASE}/api/pages/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: canonicalTitle }),
      });
      if (!trackRes.ok) throw new Error("Track request failed");
      const trackData = await trackRes.json() as { message: string; job_id?: string; queued?: boolean };

      // Step 3a: If Redis returned a job_id, poll job status
      if (trackData.job_id) {
        for (let attempt = 0; attempt < 24; attempt++) {
          await new Promise((r) => setTimeout(r, 2500));
          try {
            const jobStatus = await safeFetchJson<{ status: string; result?: unknown }>(
              `${API_BASE}/api/pages/track/status/${trackData.job_id}`
            );
            if (jobStatus.status === "finished" || jobStatus.status === "failed") break;
          } catch { /* status endpoint unavailable — fall through to DB poll */ break; }
        }
      }

      // Step 3b: Poll until the page appears in DB (covers both Redis and fallback paths)
      let found: PageInfo | null = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((r) => setTimeout(r, 2500));
        const searchData = await safeFetchJson<{ found: boolean; page?: PageInfo }>(
          `${API_BASE}/api/pages/search?title=${encodeURIComponent(canonicalTitle)}`
        );
        if (searchData.found && searchData.page) {
          found = searchData.page;
          break;
        }
      }
      if (found) {
        setFetchStatus("done");
        setFetchMessage(`"${canonicalTitle}" added! Click to explore.`);
        setSearchTitle("");
        await fetchOverview();
        setSelectedId(found.id);
      } else {
        setFetchStatus("done");
        setFetchMessage(`Fetch started for "${canonicalTitle}". Refresh in a moment.`);
        fetchOverview();
        setSearchTitle("");
      }
    } catch (err) {
      setFetchStatus("error");
      setFetchMessage("Failed to reach Wikipedia. Check your connection.");
    }
  }, [fetchOverview]);


  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTitle.trim()) return;
    const title = searchTitle.trim();
    // Check if it's already in DB first
    const exactMatch = pages.find(
      (p) => p.title.toLowerCase() === title.toLowerCase()
    );
    if (exactMatch) {
      setSelectedId(exactMatch.id);
      setSearchTitle("");
      return;
    }
    // Not in DB — trigger on-demand fetch
    setFetchStatus("idle");
    setFetchMessage("");
    handleOnDemandFetch(title);
  };

  const handleRecluster = async () => {
    setLoadingRecluster(true);
    try {
      const res = await safeFetchJson<{ message?: string }>(
        `${API_BASE}/api/clusters/recalculate`,
        { method: "POST" }
      );
      alert(res.message || "Running.");
      setTimeout(fetchOverview, 4000);
    } catch (e) {
      console.error("recluster fail", e);
    } finally {
      setLoadingRecluster(false);
    }
  };

  // ─── Derived stats ────────────────────────────────────────────────────────────
  // Conflicts = pages with genuine Z-score anomalies (> 1.5 std devs above baseline)
  const conflicts = pages.filter((p) => (p.anomaly_score || 0) > 1.5).length;
  const avgScore = pages.length
    ? (pages.reduce((s, p) => s + (p.anomaly_score || 0), 0) / pages.length).toFixed(2)
    : "—";
  const filteredPages = useMemo(() => {
    return pages
      .filter((p) => p.title.toLowerCase().includes(filterQuery.toLowerCase()));
  }, [pages, filterQuery]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: "var(--bg-base)", color: "var(--text-body)" }}
    >

      {/* ══ MASTHEAD ══════════════════════════════════════════════════════════════ */}
      <header
        className="sticky top-0 z-40"
        style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-2.5 gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <div
              className="w-8 h-8 rounded flex items-center justify-center shrink-0"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <span
                className="text-base font-bold tracking-tight leading-none"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                Tremor
              </span>
              <p className="text-[10px] leading-none mt-0.5" style={{ color: "var(--text-subtle)", fontFamily: "var(--font-mono)" }}>
                Wikipedia Edit War Seismograph
              </p>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { label: "Tracked", value: pages.length, icon: BookOpen },
              {
                label: "Conflicts",
                value: conflicts,
                icon: Flame,
                danger: conflicts > 0,
              },
              { label: "Avg Score", value: avgScore, icon: BarChart2 },
            ].map(({ label, value, icon: Icon, danger }) => (
              <div
                key={label}
                className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
                style={{
                  background: "var(--bg-card)",
                  border: `1px solid ${danger ? "rgba(239,68,68,0.3)" : "var(--border-muted)"}`,
                }}
              >
                <Icon
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: danger ? "var(--color-critical)" : "var(--text-muted)" }}
                />
                <span style={{ color: "var(--text-subtle)" }}>{label}</span>
                <span
                  className="font-semibold"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: danger ? "var(--color-critical)" : "var(--text-primary)",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}

            {/* Clock */}
            <HeaderClock />

            {/* About Link */}
            <Link
              href="/about"
              className="text-xs px-3 py-1.5 rounded transition-all duration-100 font-semibold cursor-pointer"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-muted)",
                color: "var(--text-muted)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border-muted)";
              }}
            >
              About
            </Link>
          </div>
        </div>

        {/* Breaking news ticker */}
        <Ticker pages={pages} />
      </header>

      {/* ══ 3-COLUMN GRID ════════════════════════════════════════════════════════ */}
      <div
        className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden"
      >

        {/* ── COL 1: ARTICLE FEED ────────────────────────────────────────────── */}
        <section
          id="feed-panel"
          className="lg:col-span-3 flex flex-col overflow-hidden"
          style={{ borderRight: "1px solid var(--border)" }}
        >
          {/* Column header */}
          <div
            className="px-4 py-2.5 flex items-center justify-between shrink-0"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}
          >
            <span
              className="text-[10px] font-semibold uppercase tracking-widest flex items-center gap-2"
              style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}
            >
              <Radio className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
              Tracked Articles
            </span>
            <span className="accent-pill">
              <span className="live-dot" style={{ width: 5, height: 5 }} />
              live
            </span>
          </div>

          {/* Add article form + on-demand search status */}
          <form
            onSubmit={handleTrack}
            className="px-3 py-2.5 flex gap-2 shrink-0"
            style={{ borderBottom: "1px solid var(--border-muted)" }}
          >
            <input
              id="add-article-input"
              type="text"
              value={searchTitle}
              onChange={(e) => {
                setSearchTitle(e.target.value);
                // Reset fetch status when user types a new title
                if (fetchStatus !== "idle") {
                  setFetchStatus("idle");
                  setFetchMessage("");
                }
              }}
              placeholder="Search or add Wikipedia article…"
              className="flex-1 px-3 py-2 rounded text-sm focus:outline-none"
              style={{
                background: "var(--bg-base)",
                border: `1px solid ${fetchStatus === "not_found" || fetchStatus === "error" ? "rgba(239,68,68,0.4)" : "var(--border-muted)"}`,
                color: "var(--text-primary)",
                fontFamily: "var(--font-body)",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = fetchStatus === "not_found" || fetchStatus === "error" ? "rgba(239,68,68,0.4)" : "var(--border-muted)")}
            />
            <button
              id="add-article-btn"
              type="submit"
              disabled={fetchStatus === "checking" || fetchStatus === "fetching" || !searchTitle.trim()}
              className="flex items-center justify-center w-9 h-9 rounded shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {(fetchStatus === "checking" || fetchStatus === "fetching") ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </button>
          </form>

          {/* On-demand fetch status message */}
          {fetchStatus !== "idle" && (
            <div
              className="px-3 py-2 shrink-0 text-xs flex items-start gap-2"
              style={{
                background: fetchStatus === "not_found" || fetchStatus === "error"
                  ? "rgba(239,68,68,0.06)"
                  : fetchStatus === "done" ? "rgba(34,197,94,0.06)" : "var(--accent-bg)",
                borderBottom: "1px solid var(--border-muted)",
                color: fetchStatus === "not_found" || fetchStatus === "error"
                  ? "var(--color-critical)"
                  : fetchStatus === "done" ? "var(--color-normal)" : "var(--accent-hi)",
              }}
            >
              {(fetchStatus === "checking" || fetchStatus === "fetching") && (
                <RefreshCw className="w-3 h-3 animate-spin mt-0.5 shrink-0" />
              )}
              <span className="leading-relaxed">{fetchMessage}</span>
              {(fetchStatus === "not_found" || fetchStatus === "error" || fetchStatus === "done") && (
                <button
                  onClick={() => { setFetchStatus("idle"); setFetchMessage(""); }}
                  className="ml-auto shrink-0 opacity-60 hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Filter tracked articles input */}
          {pages.length > 0 && (
            <div className="px-3 pb-2.5 pt-2 shrink-0">
              <input
                id="filter-article-input"
                type="text"
                value={filterInputValue}
                onChange={(e) => handleFilterChange(e.target.value)}
                placeholder="Filter tracked articles…"
                className="w-full px-3 py-1.5 rounded text-xs focus:outline-none"
                style={{
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-muted)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-body)",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-muted)")}
              />
            </div>
          )}

          {/* Article list */}
          <div className="flex-1 overflow-y-auto">
            {loadingPages && pages.length === 0 ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="skeleton h-12 w-full" style={{ animationDelay: `${i * 0.08}s` }} />
                ))}
              </div>
            ) : pages.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 gap-3 px-4 text-center"
                style={{ color: "var(--text-subtle)" }}
              >
                <BookOpen className="w-8 h-8" style={{ color: "var(--border)" }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>No articles tracked yet</p>
                  <p className="text-xs mt-1 leading-relaxed">Type a Wikipedia article title above and press enter to start tracking its edit activity.</p>
                </div>
              </div>
            ) : filteredPages.length === 0 ? (
              <div className="flex flex-col gap-0">
                <div
                  className="flex flex-col items-center justify-center py-8 gap-2 px-4 text-center"
                  style={{ color: "var(--text-subtle)" }}
                >
                  <p className="text-xs">No tracked article matches <span style={{ color: "var(--text-muted)" }}>&#8220;{filterInputValue}&#8221;</span>.</p>
                </div>
                {/* On-demand Wikipedia fetch affordance */}
                {fetchStatus === "idle" && filterInputValue.trim().length > 1 && (
                  <div
                    className="mx-3 mb-3 p-3 rounded cursor-pointer"
                    style={{
                      background: "var(--accent-bg)",
                      border: "1px solid var(--accent-border)",
                    }}
                  >
                    <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--accent-hi)", fontFamily: "var(--font-mono)" }}>
                      Not tracked yet — fetch from Wikipedia?
                    </p>
                    <p className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
                      Pull revision history for &#8220;{filterInputValue.trim()}&#8221; and start tracking it live.
                    </p>
                    <button
                      id="fetch-from-wikipedia-btn"
                      onClick={() => {
                        setSearchTitle(filterInputValue.trim());
                        handleOnDemandFetch(filterInputValue.trim());
                      }}
                      className="text-[10px] font-semibold px-3 py-1.5 rounded cursor-pointer transition-opacity hover:opacity-80"
                      style={{
                        background: "var(--accent)",
                        color: "#fff",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      Fetch &#8220;{filterInputValue.trim().length > 22 ? filterInputValue.trim().substring(0, 20) + "…" : filterInputValue.trim()}&#8221; from Wikipedia
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filteredPages.map((p, idx) => {
                const isSelected = p.id === selectedId;
                const score = p.anomaly_score || 0;
                const level = getLevel(score);
                const meta = LEVEL_META[level];

                return (
                  <button
                    key={p.id}
                    id={`article-${p.id}`}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-150 ${
                      isSelected ? "" : "hover:bg-[var(--bg-hover)]/40"
                    }`}
                    style={{
                      borderBottom: "1px solid var(--border-muted)",
                      background: isSelected ? "var(--bg-card)" : "transparent",
                      borderLeft: isSelected ? `3px solid var(--accent)` : "3px solid transparent",
                    }}
                  >
                    {/* Score dot */}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        background: meta.dot,
                        boxShadow: meta.dotPulse ? `0 0 6px ${meta.dot}` : "none",
                        animation: meta.dotPulse ? "live-blink 1.5s ease-in-out infinite" : "none",
                      }}
                    />

                    {/* Title */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[9px] uppercase tracking-widest mb-0.5"
                        style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
                      >
                        {p.wiki}
                        {p.cluster_id !== null && p.cluster_id !== -1
                          ? ` · C${p.cluster_id}` : ""}
                      </div>
                      <div
                        className="text-sm font-medium truncate"
                        style={{ color: isSelected ? "var(--text-primary)" : "var(--text-body)" }}
                      >
                        {idx + 1}. {p.title}
                      </div>
                    </div>

                    {/* Score badge */}
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0"
                      style={{ fontFamily: "var(--font-mono)" }}
                      // Inline styles for score class since we're using CSS variables
                      data-level={level}
                    >
                      <span
                        style={{
                          color: level === "critical" ? "var(--color-critical)" : level === "elevated" ? "var(--color-elevated)" : "var(--color-normal)",
                          background: level === "critical" ? "rgba(239,68,68,0.08)" : level === "elevated" ? "rgba(249,115,22,0.08)" : "rgba(34,197,94,0.07)",
                        }}
                      >
                        {score.toFixed(2)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}

            {/* Load 100 More Button */}
            {pages.length > 0 && !filterInputValue && (
              <div className="p-4 border-t border-[var(--border-muted)] bg-[var(--bg-base)] flex flex-col gap-2">
                {loadMoreMessage && (
                  <div className="text-[10px] text-[var(--text-subtle)] flex items-center gap-2 mb-1 animate-pulse" style={{ fontFamily: "var(--font-mono)" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                    {loadMoreMessage}
                  </div>
                )}
                <button
                  onClick={handleLoadMore}
                  disabled={loadingLoadMore || (bufferInfo ? bufferInfo.total_tracked >= bufferInfo.cap : false)}
                  className="w-full py-2.5 px-4 rounded text-[10px] font-semibold uppercase tracking-wider cursor-pointer transition-all duration-150 flex items-center justify-center gap-2 border"
                  style={{
                    background: loadingLoadMore
                      ? "var(--bg-card)"
                      : (bufferInfo && bufferInfo.total_tracked >= bufferInfo.cap)
                        ? "var(--bg-card)"
                        : "var(--accent)",
                    color: (bufferInfo && bufferInfo.total_tracked >= bufferInfo.cap)
                      ? "var(--text-muted)"
                      : "#fff",
                    borderColor: "var(--border-muted)",
                    cursor: (loadingLoadMore || (bufferInfo && bufferInfo.total_tracked >= bufferInfo.cap)) ? "not-allowed" : "pointer",
                    opacity: loadingLoadMore ? 0.7 : 1,
                  }}
                >
                  {loadingLoadMore ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  {bufferInfo && bufferInfo.total_tracked >= bufferInfo.cap
                    ? `Tracking cap reached (${bufferInfo.cap} articles)`
                    : loadingLoadMore
                      ? "Loading Articles..."
                      : bufferInfo
                        ? bufferInfo.redis_available
                          ? `Load 100 More (Buffer: ${bufferInfo.buffer_size})`
                          : "Load 100 More (Direct Fetch)"
                        : "Load 100 More"}
                </button>
                {bufferInfo && (
                  <div className="text-[9px] text-[var(--text-subtle)] text-center mt-1" style={{ fontFamily: "var(--font-mono)" }}>
                    Tracked: {bufferInfo.total_tracked} / {bufferInfo.cap} articles
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── COL 2: ARTICLE DETAIL ──────────────────────────────────────────── */}
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
            <div className="p-5 space-y-5 anim-fade-up">

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
                      className="text-[10px] flex items-center gap-1 transition-colors duration-100"
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
                      className="text-xs flex items-center gap-1 cursor-pointer transition-colors duration-100"
                      style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-hi)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
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
                  >
                    + {detail.recent_revisions.length - REVISIONS_PREVIEW} more revisions
                  </button>
                )}
              </div>

            </div>
          )}

          {/* ── Compare Panel (appears when Shift+click a cluster node) ── */}
          {compareId !== null && (
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
                  className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
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
                      <span>vs. <span style={{ color: "var(--text-muted)" }}>{detail?.page.title}</span></span>
                      {compareDetail.page.cluster_id !== null && compareDetail.page.cluster_id !== -1 && (
                        <span>· Cluster {compareDetail.page.cluster_id}</span>
                      )}
                    </div>
                  </div>
                  {/* Score comparison */}
                  <div className="flex items-center gap-4 shrink-0">
                    {[
                      { label: detail?.page.title ?? "A", score: detail?.page.anomaly_score ?? 0 },
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
                      onClick={() => { setSelectedId(compareId!); setCompareId(null); setCompareDetail(null); }}
                      className="text-[10px] px-2.5 py-1.5 rounded cursor-pointer transition-opacity hover:opacity-80"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--border-muted)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                    >
                      Focus this article
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </main>

        {/* ── COL 3: CLUSTER MAP ─────────────────────────────────────────────── */}
        <section
          id="cluster-panel"
          className="lg:col-span-3 flex flex-col overflow-hidden"
          style={{ background: "var(--bg-surface)" }}
        >
          {/* Column header */}
          <div
            className="px-4 py-2.5 flex items-center justify-between shrink-0"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <span
              className="text-[10px] font-semibold uppercase tracking-widest flex items-center gap-2"
              style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}
            >
              <Globe className="w-3.5 h-3.5" style={{ color: "var(--text-subtle)" }} />
              Topic Map
              <InfoTooltip text="UMAP projection. Similar topics cluster together. Color = cluster group. Shift+click a node to compare two articles side by side." />
            </span>
            <button
              id="recluster-btn"
              onClick={handleRecluster}
              disabled={loadingRecluster}
              className="flex items-center gap-1.5 text-[10px] font-semibold cursor-pointer disabled:opacity-40 transition-colors duration-100 px-2.5 py-1 rounded"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--bg-card)",
                border: "1px solid var(--border-muted)",
                color: "var(--text-muted)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent-border)";
                e.currentTarget.style.color = "var(--accent-hi)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border-muted)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <RefreshCw className={`w-3 h-3 ${loadingRecluster ? "animate-spin" : ""}`} />
              Recalculate
            </button>
          </div>

          {/* SVG canvas — flex-1 fills remaining height within the constrained column */}
          <div
            className="flex-1 flex items-center justify-center p-4 min-h-0"
          >
            {validNodes.length === 0 ? (
              <div
                className="flex flex-col items-center gap-3 text-xs text-center px-6"
                style={{ color: "var(--text-subtle)" }}
              >
                <Globe className="w-8 h-8" style={{ color: "var(--border)" }} />
                <div>
                  <p className="font-medium mb-1" style={{ color: "var(--text-muted)" }}>No topic map yet</p>
                  <p className="leading-relaxed">Click Recalculate to run UMAP + HDBSCAN and group tracked articles by topic similarity.</p>
                </div>
              </div>
            ) : (
              <div style={{ width: "100%", height: "100%", maxWidth: SZ, maxHeight: SZ, aspectRatio: "1 / 1" }}>
                {umapSvg}
              </div>
            )}
          </div>

          {/* Hover / selection info card */}
          <div className="px-4 pb-2 shrink-0" style={{ minHeight: 48 }}>
            {(hoveredPage || selectedId) && (() => {
              const info = hoveredPage || validNodes.find((n) => n.id === selectedId);
              if (!info) return null;
              const score = info.anomaly_score || 0;
              const level = getLevel(score);
              const sc = level === "critical" ? "var(--color-critical)" : level === "elevated" ? "var(--color-elevated)" : "var(--color-normal)";
              return (
                <div
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded text-xs"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-muted)",
                  }}
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate" style={{ color: "var(--text-primary)", maxWidth: 160 }}>
                      {info.title}
                    </div>
                    <div
                      className="text-[10px] mt-0.5"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
                    >
                      {info.cluster_id !== null && info.cluster_id !== -1
                        ? getClusterLabel(info.cluster_id)
                        : "Unclustered / noise"}
                    </div>
                  </div>
                  <span
                    className="text-[12px] font-bold shrink-0"
                    style={{ fontFamily: "var(--font-mono)", color: sc }}
                  >
                    {score.toFixed(2)}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Legend */}
          <div
            className="px-4 py-3 shrink-0"
            style={{ borderTop: "1px solid var(--border-muted)" }}
          >
            <span
              className="text-[10px] uppercase tracking-widest font-semibold block mb-2"
              style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
            >
              Topic Clusters
            </span>
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
              {topClusterIds.map((cid, i) => {
                const col = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
                const count = clusterCounts[cid] || 0;
                const label = getClusterLabel(cid);
                const isDimmed = hoveredClusterId !== null && hoveredClusterId !== cid;

                return (
                  <div
                    key={cid}
                    className="flex items-center justify-between gap-2 p-1.5 rounded cursor-pointer transition-all duration-200"
                    style={{
                      background: hoveredClusterId === cid ? "var(--bg-hover)" : "transparent",
                      opacity: isDimmed ? 0.35 : 1,
                    }}
                    onMouseEnter={() => setHoveredClusterId(cid)}
                    onMouseLeave={() => setHoveredClusterId(null)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col }} />
                      <span
                        className="text-[11px] font-medium truncate"
                        style={{ color: "var(--text-body)" }}
                      >
                        {label}
                      </span>
                    </div>
                    <span
                      className="text-[10px] shrink-0 font-mono"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {count} {count === 1 ? "page" : "pages"}
                    </span>
                  </div>
                );
              })}

              {/* Noise / Unclustered */}
              <div
                className="flex items-center justify-between gap-2 p-1.5 rounded"
                style={{
                  opacity: hoveredClusterId !== null ? 0.35 : 1,
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}
                  />
                  <span className="text-[11px] font-medium text-[var(--text-muted)] truncate">
                    Unclustered / Noise
                  </span>
                </div>
                <span className="text-[10px] shrink-0 font-mono text-[var(--text-subtle)]">
                  {validNodes.filter((n) => n.cluster_id === null || n.cluster_id === -1).length} pages
                </span>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
