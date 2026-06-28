import React, { useMemo, useCallback } from "react";
import { Globe, RefreshCw } from "lucide-react";
import { ClusterPage, PageDetail, CLUSTER_COLORS, getLevel } from "../types";
import { InfoTooltip } from "./UtilityComponents";

interface ClusterMapProps {
  clusters: ClusterPage[];
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  compareId: number | null;
  setCompareId: (id: number | null) => void;
  setCompareDetail: (detail: PageDetail | null) => void;
  hoveredPage: ClusterPage | null;
  setHoveredPage: (page: ClusterPage | null) => void;
  hoveredClusterId: number | null;
  setHoveredClusterId: (id: number | null) => void;
  loadingRecluster: boolean;
  handleRecluster: () => void;
}

const PAD = 28;
const SZ = 320;
const TOP_CLUSTERS = 6;

export const ClusterMap = React.memo(function ClusterMap({
  clusters,
  selectedId,
  setSelectedId,
  compareId,
  setCompareId,
  setCompareDetail,
  hoveredPage,
  setHoveredPage,
  hoveredClusterId,
  setHoveredClusterId,
  loadingRecluster,
  handleRecluster,
}: ClusterMapProps) {
  
  // ─── UMAP/HDBSCAN coordinate math ──────────────────────────────────────────

  const validNodes = useMemo(() => {
    const nodesWithCoords = clusters.filter((c) => c.x !== null && c.y !== null);
    if (nodesWithCoords.length <= 200) return nodesWithCoords;
    
    // Sort by anomaly score desc
    const sorted = [...nodesWithCoords].sort((a, b) => (b.anomaly_score || 0) - (a.anomaly_score || 0));
    const top200 = sorted.slice(0, 200);
    
    // Selection Guarantee
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

  // Prevent overlapping nodes in screen space
  const adjustedNodes = useMemo(() => {
    if (validNodes.length === 0) return [];
    
    const nodes = validNodes.map((n) => ({
      ...n,
      cx: scaleX(n.x as number),
      cy: scaleY(n.y as number),
    }));
    
    const nodeRadius = 5.5;
    const minDist = nodeRadius * 2 + 3; // Keep space between node centers
    
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
      
      // Enforce container bounds
      nodes.forEach((n) => {
        n.cx = Math.max(PAD, Math.min(SZ - PAD, n.cx));
        n.cy = Math.max(PAD, Math.min(SZ - PAD, n.cy));
      });
    }
    return nodes;
  }, [validNodes, scaleX, scaleY]);

  // Calculate cluster centroids for background nebulae
  const clusterCentroids = useMemo(() => {
    const centroids: Record<number, { cx: number; cy: number; radius: number }> = {};
    
    topClusterIds.forEach((cid) => {
      const cNodes = adjustedNodes.filter((n) => n.cluster_id === cid);
      if (cNodes.length === 0) return;
      
      const sumX = cNodes.reduce((sum, n) => sum + n.cx, 0);
      const sumY = cNodes.reduce((sum, n) => sum + n.cy, 0);
      const cx = sumX / cNodes.length;
      const cy = sumY / cNodes.length;
      
      let maxDist = 18; // base minimum radius
      cNodes.forEach((n) => {
        const d = Math.hypot(n.cx - cx, n.cy - cy);
        if (d > maxDist) maxDist = d;
      });
      
      centroids[cid] = {
        cx,
        cy,
        radius: Math.min(SZ / 2.8, maxDist + 12),
      };
    });
    
    return centroids;
  }, [adjustedNodes, topClusterIds]);

  // Dynamic naming helper for legend and map
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
          {/* Node selection glow filter */}
          <filter id="node-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          {/* Radial gradients for the background nebulae */}
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

        <rect x={0} y={0} width={SZ} height={SZ} fill="url(#radar-grid)" />
        <rect x={0} y={0} width={SZ} height={SZ} fill="transparent" />

        {/* Axis guides */}
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

        {/* 1. Nebula clouds */}
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

        {/* 3. Noise / unclustered nodes */}
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

        {/* 4. Top cluster nodes */}
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
                {/* Spike pulse ring */}
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
                {/* Selection Ring */}
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
                {/* Compare Ring */}
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
                {/* Hover Halo */}
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
                {/* Core Dot */}
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

        {/* 5. Centroid Labels */}
        {Object.entries(clusterCentroids).map(([cidStr, centroid]) => {
          const cid = Number(cidStr);
          const isHovered = hoveredClusterId === cid;
          const isDimmed = hoveredClusterId !== null && hoveredClusterId !== cid;
          const label = getClusterLabel(cid);
          const count = clusterCounts[cid] || 0;
          
          const alwaysShow = count >= 3;
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

        {/* 6. Floating Tooltip */}
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
    compareId,
    setCompareId,
    setCompareDetail,
    setSelectedId,
    setHoveredClusterId,
    setHoveredPage,
  ]);

  return (
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
          className="flex items-center gap-1.5 text-[10px] font-semibold cursor-pointer disabled:opacity-40 transition-colors duration-100 px-2.5 py-1 rounded border-0"
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
          type="button"
        >
          <RefreshCw className={`w-3 h-3 ${loadingRecluster ? "animate-spin" : ""}`} />
          Recalculate
        </button>
      </div>

      {/* SVG Canvas */}
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
  );
});
export default ClusterMap;
