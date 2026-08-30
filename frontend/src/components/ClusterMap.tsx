import React, { useMemo, useCallback, useState } from "react";
import { Globe, RefreshCw, Crosshair, Search } from "lucide-react";
import { ClusterPage, PageDetail, CONFLICT_TYPE_META, getLevel } from "../types";
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
  reclusterMessage?: string | null;
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
  reclusterMessage,
  handleRecluster,
}: ClusterMapProps) {
  
  // ─── Interaction & Search States ───────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragStartPan, setDragStartPan] = useState({ x: 0, y: 0 });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);

  // ─── UMAP/HDBSCAN coordinate math ──────────────────────────────────────────

  const { validNodes, awaitingClusterCount } = useMemo(() => {
    const clustered = clusters.filter((c) => c.x !== null && c.y !== null && (c.x !== 0.0 || c.y !== 0.0));
    const awaitingCount = clusters.length - clustered.length;

    if (clustered.length <= 200) return { validNodes: clustered, awaitingClusterCount: awaitingCount };
    
    // Sort by anomaly score desc
    const sorted = [...clustered].sort((a, b) => (b.anomaly_score || 0) - (a.anomaly_score || 0));
    const top200 = sorted.slice(0, 200);
    
    // Selection Guarantee
    if (selectedId !== null && !top200.some((n) => n.id === selectedId)) {
      const selectedNode = clustered.find((n) => n.id === selectedId);
      if (selectedNode) {
        top200.push(selectedNode);
      }
    }
    
    return { validNodes: top200, awaitingClusterCount: awaitingCount };
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

  // Color helper for individual page dots (based on conflict_type)
  const getPageColor = useCallback((conflictType: string | null | undefined) => {
    if (conflictType && CONFLICT_TYPE_META[conflictType]) {
      return CONFLICT_TYPE_META[conflictType].color;
    }
    return "#9ca3af"; // neutral gray for unclassified/null
  }, []);

  // Compute each cluster's representative majority conflict_type
  const clusterMajorityMeta = useMemo(() => {
    const meta: Record<number, { conflict_type: string | null; label: string; color: string }> = {};
    topClusterIds.forEach((cid) => {
      const cNodes = validNodes.filter((n) => n.cluster_id === cid);
      const counts: Record<string, number> = {};
      cNodes.forEach((n) => {
        if (n.conflict_type) {
          counts[n.conflict_type] = (counts[n.conflict_type] || 0) + 1;
        }
      });
      let majorityType: string | null = null;
      let maxCount = 0;
      Object.entries(counts).forEach(([type, count]) => {
        if (count > maxCount) {
          maxCount = count;
          majorityType = type;
        }
      });

      if (majorityType && CONFLICT_TYPE_META[majorityType]) {
        meta[cid] = {
          conflict_type: majorityType,
          label: CONFLICT_TYPE_META[majorityType].label,
          color: CONFLICT_TYPE_META[majorityType].color,
        };
      } else {
        meta[cid] = {
          conflict_type: null,
          label: "Unclassified",
          color: "#9ca3af",
        };
      }
    });
    return meta;
  }, [validNodes, topClusterIds]);

  const getClusterColor = useCallback(
    (cid: number | null) => {
      if (cid === null || cid === -1) return "#9ca3af";
      return clusterMajorityMeta[cid]?.color || "#9ca3af";
    },
    [clusterMajorityMeta]
  );

  const { scaleX, scaleY } = useMemo(() => {
    const xs = validNodes.map((n) => n.x as number);
    const ys = validNodes.map((n) => n.y as number);
    
    if (xs.length === 0 || ys.length === 0) {
      return {
        scaleX: (x: number) => SZ / 2,
        scaleY: (y: number) => SZ / 2,
      };
    }

    // Outlier protection: Calculate mean and std dev of non-zero coordinates, then clip to 2.5 std devs
    const meanX = xs.reduce((sum, v) => sum + v, 0) / xs.length;
    const meanY = ys.reduce((sum, v) => sum + v, 0) / ys.length;

    const stdX = Math.sqrt(xs.reduce((sum, v) => sum + Math.pow(v - meanX, 2), 0) / xs.length) || 1;
    const stdY = Math.sqrt(ys.reduce((sum, v) => sum + Math.pow(v - meanY, 2), 0) / ys.length) || 1;

    const minClippedX = meanX - 2.5 * stdX;
    const maxClippedX = meanX + 2.5 * stdX;
    const minClippedY = meanY - 2.5 * stdY;
    const maxClippedY = meanY + 2.5 * stdY;

    const rangeX = maxClippedX - minClippedX || 1;
    const rangeY = maxClippedY - minClippedY || 1;

    return {
      scaleX: (x: number) => {
        const clipped = Math.max(minClippedX, Math.min(maxClippedX, x));
        return PAD + ((clipped - minClippedX) / rangeX) * (SZ - 2 * PAD);
      },
      scaleY: (y: number) => {
        const clipped = Math.max(minClippedY, Math.min(maxClippedY, y));
        // Invert Y axis for SVG rendering
        return SZ - PAD - ((clipped - minClippedY) / rangeY) * (SZ - 2 * PAD);
      },
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

  // Compute average scores for each cluster
  const clusterAvgScores = useMemo(() => {
    const avgs: Record<number, number> = {};
    topClusterIds.forEach((cid) => {
      const cNodes = validNodes.filter((n) => n.cluster_id === cid);
      if (cNodes.length === 0) return;
      const total = cNodes.reduce((sum, n) => sum + (n.anomaly_score || 0), 0);
      avgs[cid] = total / cNodes.length;
    });
    return avgs;
  }, [validNodes, topClusterIds]);

  // ─── Zoom and Panning Action Handlers ───────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // Left click only
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragStartPan({ x: pan.x, y: pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;

    const svgDx = dx * (SZ / rect.width);
    const svgDy = dy * (SZ / rect.height);

    setPan({
      x: dragStartPan.x + svgDx,
      y: dragStartPan.y + svgDy,
    });
  }, [isDragging, dragStart, dragStartPan]);

  const handleMouseUpOrLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const svgMouseX = mouseX * (SZ / rect.width);
    const svgMouseY = mouseY * (SZ / rect.height);

    const zoomFactor = 1.15;
    const nextZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
    const boundedZoom = Math.max(0.6, Math.min(8, nextZoom));

    const pointX = (svgMouseX - pan.x) / zoom;
    const pointY = (svgMouseY - pan.y) / zoom;

    setZoom(boundedZoom);
    setPan({
      x: svgMouseX - pointX * boundedZoom,
      y: svgMouseY - pointY * boundedZoom,
    });
  }, [zoom, pan]);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => {
      const nextZoom = Math.min(8, prev * 1.3);
      const factor = nextZoom / prev;
      setPan((p) => ({
        x: SZ / 2 - (SZ / 2 - p.x) * factor,
        y: SZ / 2 - (SZ / 2 - p.y) * factor,
      }));
      return nextZoom;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => {
      const nextZoom = Math.max(0.6, prev / 1.3);
      const factor = nextZoom / prev;
      setPan((p) => ({
        x: SZ / 2 - (SZ / 2 - p.x) * factor,
        y: SZ / 2 - (SZ / 2 - p.y) * factor,
      }));
      return nextZoom;
    });
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedClusterId(null);
  }, []);

  // Center view directly on a chosen cluster bounds
  const zoomToCluster = useCallback((cid: number) => {
    if (selectedClusterId === cid) {
      // Toggle off and reset
      handleReset();
      return;
    }

    const cNodes = adjustedNodes.filter((n) => n.cluster_id === cid);
    if (cNodes.length === 0) return;

    const xs = cNodes.map((n) => n.cx);
    const ys = cNodes.map((n) => n.cy);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const w = maxX - minX;
    const h = maxY - minY;

    const margin = 48; // padding space
    const nextZoom = Math.min(5, (SZ - margin) / Math.max(w, h || 1));
    const targetZoom = Math.max(1.3, nextZoom);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setSelectedClusterId(cid);
    setZoom(targetZoom);
    setPan({
      x: SZ / 2 - centerX * targetZoom,
      y: SZ / 2 - centerY * targetZoom,
    });
  }, [adjustedNodes, selectedClusterId, handleReset]);

  // ─── Rendering Math ────────────────────────────────────────────────────────
  
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
        style={{ display: "block", overflow: "visible", cursor: isDragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onWheel={handleWheel}
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

        {/* Static Radar Grid Background */}
        <rect x={0} y={0} width={SZ} height={SZ} fill="url(#radar-grid)" />
        <rect x={0} y={0} width={SZ} height={SZ} fill="transparent" />

        {/* Rotating Radar Sweep Line Overlay */}
        <line x1={SZ / 2} y1={SZ / 2} x2={SZ / 2} y2={PAD} stroke="var(--accent-hi)" strokeWidth={0.7} opacity={0.12} style={{ pointerEvents: "none" }}>
          <animateTransform attributeName="transform" type="rotate" from={`0 ${SZ / 2} ${SZ / 2}`} to={`360 ${SZ / 2} ${SZ / 2}`} dur="8s" repeatCount="indefinite" />
        </line>
        
        {/* Pulsing Target Radar Sweep Ring */}
        <circle cx={SZ / 2} cy={SZ / 2} r={SZ / 2 - PAD} fill="none" stroke="var(--border-muted)" strokeWidth={0.5} opacity={0.3} style={{ pointerEvents: "none" }} />
        <circle cx={SZ / 2} cy={SZ / 2} r={SZ / 4} fill="none" stroke="var(--border-muted)" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.2} style={{ pointerEvents: "none" }} />

        {/* Zoom & Pan Container Group */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          
          {/* Zoomable Axis Guides */}
          <line
            x1={SZ / 2}
            y1={-SZ * 5}
            x2={SZ / 2}
            y2={SZ * 6}
            stroke="var(--border-muted)"
            strokeWidth={0.5 / zoom}
            strokeDasharray={`${3 / zoom} ${3 / zoom}`}
            opacity={0.6}
          />
          <line
            x1={-SZ * 5}
            y1={SZ / 2}
            x2={SZ * 6}
            y2={SZ / 2}
            stroke="var(--border-muted)"
            strokeWidth={0.5 / zoom}
            strokeDasharray={`${3 / zoom} ${3 / zoom}`}
            opacity={0.6}
          />

          {/* 1. Nebula clouds */}
          {Object.entries(clusterCentroids).map(([cidStr, centroid]) => {
            const cid = Number(cidStr);
            const isHovered = hoveredClusterId === cid || selectedClusterId === cid;
            const isDimmed = (hoveredClusterId !== null && hoveredClusterId !== cid) || (selectedClusterId !== null && selectedClusterId !== cid);

            return (
              <circle
                key={`nebula-${cid}`}
                cx={centroid.cx}
                cy={centroid.cy}
                r={centroid.radius}
                fill={`url(#nebula-grad-${cid})`}
                opacity={isHovered ? 1.0 : isDimmed ? 0.08 : 0.7}
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
              const isHovered = hoveredClusterId === n.cluster_id || selectedClusterId === n.cluster_id;
              const isDimmed = (hoveredClusterId !== null && hoveredClusterId !== n.cluster_id) || (selectedClusterId !== null && selectedClusterId !== n.cluster_id);

              return (
                <line
                  key={`line-${n.id}`}
                  x1={n.cx}
                  y1={n.cy}
                  x2={centroid.cx}
                  y2={centroid.cy}
                  stroke={col}
                  strokeWidth={0.5 / zoom}
                  strokeDasharray={`${2 / zoom} ${3 / zoom}`}
                  opacity={isHovered ? 0.35 : isDimmed ? 0.02 : 0.15}
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
              const isDimmed = hoveredClusterId !== null || selectedClusterId !== null;
              
              // Article search highlighting
              const isQueryMatch = searchQuery && n.title.toLowerCase().includes(searchQuery.toLowerCase());
              const overallDimmed = searchQuery ? !isQueryMatch : isDimmed;

              const r = isSel ? 6 : isHover ? 4.5 : 3;
              const col = getPageColor(n.conflict_type);

              return (
                <circle
                  key={`o-${n.id}`}
                  cx={n.cx}
                  cy={n.cy}
                  r={r / zoom}
                  fill={col}
                  stroke={isSel ? "#ffffff" : "#1f2937"}
                  strokeWidth={(isSel ? 1.2 : 0.5) / zoom}
                  className="cursor-pointer transition-all duration-150"
                  style={{ opacity: overallDimmed ? 0.08 : 0.65 }}
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
              const col = getPageColor(n.conflict_type);
              
              const isClusterTargeted = hoveredClusterId === n.cluster_id || selectedClusterId === n.cluster_id;
              const isClusterDimmed = (hoveredClusterId !== null && !isClusterTargeted) || (selectedClusterId !== null && !isClusterTargeted);
              
              // Search highlighting check
              const isQueryMatch = searchQuery && n.title.toLowerCase().includes(searchQuery.toLowerCase());
              const overallDimmed = searchQuery ? !isQueryMatch : isClusterDimmed;
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
                  style={{ opacity: overallDimmed ? 0.08 : 1, transition: "opacity 0.2s ease" }}
                >
                  {/* Rotating/Pulsing target indicator for active search matches */}
                  {searchQuery && isQueryMatch && (
                    <g>
                      <circle
                        cx={n.cx}
                        cy={n.cy}
                        r={(r + 10) / zoom}
                        fill="none"
                        stroke="var(--accent-hi)"
                        strokeWidth={1 / zoom}
                        strokeDasharray={`${3 / zoom} ${3 / zoom}`}
                      >
                        <animateTransform attributeName="transform" type="rotate" from={`0 ${n.cx} ${n.cy}`} to={`360 ${n.cx} ${n.cy}`} dur="4s" repeatCount="indefinite" />
                      </circle>
                      <circle
                        cx={n.cx}
                        cy={n.cy}
                        r={(r + 6) / zoom}
                        fill="none"
                        stroke="var(--accent-hi)"
                        strokeWidth={1.5 / zoom}
                      >
                        <animate attributeName="r" values={`${r/zoom};${(r+8)/zoom};${r/zoom}`} dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                    </g>
                  )}

                  {/* Spike pulse ring */}
                  {isSpiking && !overallDimmed && (
                    <circle
                      cx={n.cx}
                      cy={n.cy}
                      r={r / zoom}
                      fill="none"
                      stroke={col}
                      strokeWidth={1.5 / zoom}
                      opacity={0}
                    >
                      <animate attributeName="r" values={`${r / zoom};${(r + 14) / zoom};${(r + 18) / zoom}`} dur="2.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.7;0.2;0" dur="2.2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {/* Selection Ring */}
                  {isSel && (
                    <circle
                      cx={n.cx}
                      cy={n.cy}
                      r={(r + 5) / zoom}
                      fill="none"
                      stroke={col}
                      strokeWidth={1.5 / zoom}
                      opacity={0.4}
                      filter="url(#node-glow)"
                    />
                  )}
                  {/* Compare Ring */}
                  {isComp && (
                    <circle
                      cx={n.cx}
                      cy={n.cy}
                      r={(r + 5) / zoom}
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth={1.5 / zoom}
                      strokeDasharray={`${3 / zoom} ${2 / zoom}`}
                      opacity={0.7}
                    />
                  )}
                  {/* Hover Halo */}
                  {isHover && !isSel && (
                    <circle
                      cx={n.cx}
                      cy={n.cy}
                      r={(r + 3) / zoom}
                      fill="none"
                      stroke={col}
                      strokeWidth={1 / zoom}
                      opacity={0.3}
                    />
                  )}
                  {/* Core Dot */}
                  <circle
                    cx={n.cx}
                    cy={n.cy}
                    r={r / zoom}
                    fill={col}
                    stroke={isSel ? "#ffffff" : isComp ? "#06b6d4" : "#111113"}
                    strokeWidth={(isSel ? 1.5 : 0.8) / zoom}
                    style={{
                      transition: "all 0.15s ease",
                    }}
                  />
                </g>
              );
            })}

          {/* 5. Centroid Labels */}
          {Object.entries(clusterCentroids).map(([cidStr, centroid]) => {
            const cid = Number(cidStr);
            const isHovered = hoveredClusterId === cid || selectedClusterId === cid;
            const isDimmed = (hoveredClusterId !== null && hoveredClusterId !== cid) || (selectedClusterId !== null && selectedClusterId !== cid);
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
                  y={centroid.cy + 15 / zoom}
                  textAnchor="middle"
                  fill="var(--bg-base)"
                  stroke="var(--bg-base)"
                  strokeWidth={3 / zoom}
                  fontSize={8.5 / zoom}
                  fontWeight={600}
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {shortLabel.length > 18 ? `${shortLabel.substring(0, 16)}...` : shortLabel}
                </text>
                <text
                  x={centroid.cx}
                  y={centroid.cy + 15 / zoom}
                  textAnchor="middle"
                  fill={getClusterColor(cid)}
                  fontSize={8.5 / zoom}
                  fontWeight={600}
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {shortLabel.length > 18 ? `${shortLabel.substring(0, 16)}...` : shortLabel}
                </text>
              </g>
            );
          })}
        </g>

        {/* 6. Floating Tooltip (Positioned in Screen Space outside zoom group) */}
        {hoveredPage && (() => {
          const n = adjustedNodes.find((node) => node.id === hoveredPage.id);
          if (!n) return null;
          
          const label = n.cluster_id !== null && n.cluster_id !== -1 ? getClusterLabel(n.cluster_id) : "Unclustered";
          const text = `${n.title} [${label}]`;
          
          const charLen = text.length;
          const tooltipWidth = Math.min(220, charLen * 6.5 + 16);
          const tooltipHeight = 24;
          
          const screenX = n.cx * zoom + pan.x;
          const screenY = n.cy * zoom + pan.y;
          
          let tx = screenX;
          let ty = screenY - 16;
          
          if (tx - tooltipWidth / 2 < 4) tx = tooltipWidth / 2 + 4;
          if (tx + tooltipWidth / 2 > SZ - 4) tx = SZ - tooltipWidth / 2 - 4;
          if (ty - tooltipHeight < 4) ty = screenY + 16 + tooltipHeight;
          
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
    zoom,
    pan,
    isDragging,
    handleMouseDown,
    handleMouseMove,
    handleMouseUpOrLeave,
    handleWheel,
    searchQuery,
    selectedClusterId,
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
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-widest flex items-center gap-2"
            style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}
          >
            <Globe className="w-3.5 h-3.5" style={{ color: "var(--text-subtle)" }} />
            Topic Map
            <InfoTooltip text="UMAP projection. Click clusters below or search to center & lock. Drag to pan. Scroll to zoom." position="bottom" />
          </span>
          {awaitingClusterCount > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">
              {awaitingClusterCount} awaiting clustering
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loadingRecluster && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse">
              {reclusterMessage || "Recalculation started, this may take a minute"}
            </span>
          )}
          <button
            id="recluster-btn"
            onClick={handleRecluster}
            disabled={loadingRecluster}
            title={loadingRecluster ? "Recalculation started, this may take a minute" : "Recalculate topic clusters via GitHub Actions"}
            className="flex items-center gap-1.5 text-[10px] font-semibold cursor-pointer disabled:opacity-50 transition-colors duration-100 px-2.5 py-1 rounded border-0"
            style={{
              fontFamily: "var(--font-mono)",
              background: "var(--bg-card)",
              border: "1px solid var(--border-muted)",
              color: loadingRecluster ? "var(--accent)" : "var(--text-muted)",
            }}
            onMouseEnter={(e) => {
              if (!loadingRecluster) {
                e.currentTarget.style.borderColor = "var(--accent-border)";
                e.currentTarget.style.color = "var(--accent-hi)";
              }
            }}
            onMouseLeave={(e) => {
              if (!loadingRecluster) {
                e.currentTarget.style.borderColor = "var(--border-muted)";
                e.currentTarget.style.color = "var(--text-muted)";
              }
            }}
            type="button"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingRecluster ? "animate-spin text-amber-400" : ""}`} />
            {loadingRecluster ? "Recalculating..." : "Recalculate"}
          </button>
        </div>
      </div>

      {/* Cyberpunk Search HUD Input */}
      <div className="px-4 py-2 shrink-0 bg-[var(--bg-surface)] flex items-center gap-2" style={{ borderBottom: "1px solid var(--border-muted)" }}>
        <Search className="w-3.5 h-3.5" style={{ color: "var(--text-subtle)" }} />
        <input
          type="text"
          placeholder="Type article title to locate..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 text-[11px] px-2.5 py-1.5 rounded border border-[var(--border-muted)] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border)] transition-colors placeholder-[var(--text-subtle)]"
          style={{ fontFamily: "var(--font-mono)" }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer bg-transparent border-0"
          >
            clear
          </button>
        )}
      </div>

      {/* SVG Canvas Container */}
      <div
        className="flex-1 flex items-center justify-center p-4 min-h-0 relative select-none"
      >
        {validNodes.length === 0 ? (
          <div
            className="flex flex-col items-center gap-3 text-xs text-center px-6"
            style={{ color: "var(--text-subtle)" }}
          >
            <Globe className="w-8 h-8" style={{ color: "var(--border)" }} />
            <div>
              <p className="font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                {loadingRecluster ? "Recalculation in progress" : "No topic map yet"}
              </p>
              <p className="leading-relaxed">
                {loadingRecluster
                  ? "UMAP and HDBSCAN are running via GitHub Actions. Map will update automatically once complete."
                  : "Click Recalculate to run UMAP + HDBSCAN and group tracked articles by topic similarity."}
              </p>
            </div>
          </div>
        ) : (
          <div style={{ width: "100%", height: "100%", maxWidth: SZ, maxHeight: SZ, aspectRatio: "1 / 1" }} className="relative">
            {umapSvg}

            {/* Floating Navigation / Zoom Controls */}
            <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
              <button
                onClick={handleZoomIn}
                className="w-6 h-6 flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-body)] hover:text-[var(--text-primary)] transition-all cursor-pointer text-xs font-mono select-none font-bold"
                title="Zoom In"
              >
                +
              </button>
              <button
                onClick={handleZoomOut}
                className="w-6 h-6 flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-body)] hover:text-[var(--text-primary)] transition-all cursor-pointer text-xs font-mono select-none font-bold"
                title="Zoom Out"
              >
                −
              </button>
              <button
                onClick={handleReset}
                className="w-6 h-6 flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all cursor-pointer text-[8px] font-mono select-none"
                title="Reset View"
              >
                RST
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Help Instructions text */}
      {validNodes.length > 0 && (
        <div className="text-[9px] text-center pb-2 select-none" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          Drag to pan • Scroll to zoom • Shift+Click to compare
        </div>
      )}

      {/* Hover / selection info card */}
      <div className="px-4 pb-2 shrink-0" style={{ minHeight: 48 }}>
        {(hoveredPage || selectedId) && (() => {
          const info = hoveredPage || validNodes.find((n) => n.id === selectedId);
          if (!info) return null;
          const score = info.anomaly_score || 0;
          const level = getLevel(score);
          const sc = level === "critical" ? "var(--color-critical)" : level === "elevated" ? "var(--color-elevated)" : "var(--color-normal)";
          const typeMeta = info.conflict_type && CONFLICT_TYPE_META[info.conflict_type] ? CONFLICT_TYPE_META[info.conflict_type] : null;
          return (
            <div
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded text-xs"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-muted)",
              }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate" style={{ color: "var(--text-primary)", maxWidth: 160 }}>
                    {info.title}
                  </span>
                  {typeMeta ? (
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded font-medium shrink-0"
                      style={{
                        backgroundColor: `${typeMeta.color}20`,
                        color: typeMeta.color,
                        border: `1px solid ${typeMeta.color}40`,
                      }}
                    >
                      {typeMeta.label}
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded font-medium shrink-0 bg-zinc-800 text-zinc-400 border border-zinc-700">
                      Unclassified
                    </span>
                  )}
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

      {/* Legend Redesign - Dashboard Cluster Cards with Zoom targeting */}
      <div
        className="px-4 py-3 shrink-0 flex-1 min-h-[140px] flex flex-col overflow-hidden"
        style={{ borderTop: "1px solid var(--border-muted)" }}
      >
        <span
          className="text-[10px] uppercase tracking-widest font-semibold block mb-2"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
        >
          Topic Clusters Inspector
        </span>
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2">
          {topClusterIds.map((cid) => {
            const majorityMeta = clusterMajorityMeta[cid] || { conflict_type: null, label: "Unclassified", color: "#9ca3af" };
            const col = majorityMeta.color;
            const count = clusterCounts[cid] || 0;
            const label = getClusterLabel(cid);
            const avgScore = clusterAvgScores[cid] || 0;
            const isHovered = hoveredClusterId === cid;
            const isSelected = selectedClusterId === cid;
            const isDimmed = (hoveredClusterId !== null && hoveredClusterId !== cid) || (selectedClusterId !== null && selectedClusterId !== cid);

            return (
              <div
                key={cid}
                onClick={() => zoomToCluster(cid)}
                className="flex items-center justify-between gap-3 p-2 rounded cursor-pointer border transition-all duration-200"
                style={{
                  background: isSelected ? "var(--bg-hover)" : "var(--bg-card)",
                  borderTopColor: isSelected ? col : "var(--border-muted)",
                  borderRightColor: isSelected ? col : "var(--border-muted)",
                  borderBottomColor: isSelected ? col : "var(--border-muted)",
                  borderLeftColor: col,
                  borderLeftWidth: "3px",
                  borderLeftStyle: "solid",
                  opacity: isDimmed ? 0.4 : 1,
                }}
                onMouseEnter={() => setHoveredClusterId(cid)}
                onMouseLeave={() => setHoveredClusterId(null)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[11px] font-bold text-[var(--text-primary)] truncate block">
                      {label.split(" (+")[0]}
                    </span>
                    <span className="text-[9px] font-mono text-[var(--text-muted)] shrink-0">
                      ({count} {count === 1 ? "pg" : "pgs"})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded font-medium shrink-0"
                      style={{
                        backgroundColor: `${col}20`,
                        color: col,
                        border: `1px solid ${col}40`,
                      }}
                    >
                      {majorityMeta.label}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-[var(--text-subtle)] font-mono">
                      Avg Score:
                    </span>
                    <span className="text-[9px] font-mono font-semibold" style={{ color: avgScore > 2.0 ? "var(--color-critical)" : avgScore > 0.5 ? "var(--color-elevated)" : "var(--color-normal)" }}>
                      {avgScore.toFixed(2)}
                    </span>
                  </div>
                </div>
                
                {/* Visual Target Locator Button */}
                <button
                  type="button"
                  className="w-6 h-6 flex items-center justify-center rounded border border-[var(--border-muted)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all shrink-0 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    zoomToCluster(cid);
                  }}
                  title="Locate Cluster"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          {/* Noise / Unclustered Row */}
          <div
            className="flex items-center justify-between gap-2 p-2 rounded border border-[var(--border-muted)] bg-[var(--bg-card)] opacity-60"
            style={{
              opacity: hoveredClusterId !== null || selectedClusterId !== null ? 0.2 : 0.6,
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
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
