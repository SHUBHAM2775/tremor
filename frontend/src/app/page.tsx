"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Activity, BookOpen, Flame, BarChart2 } from "lucide-react";

// Types
import { PageDetail, TimelineResponse } from "../types";

// Hooks
import { useTrackedArticles } from "../hooks/useTrackedArticles";
import { useArticleSearch } from "../hooks/useArticleSearch";

// Components
import { Ticker } from "../components/Ticker";
import { HeaderClock } from "../components/UtilityComponents";
import { ArticleSidebar } from "../components/ArticleSidebar";
import { ArticleDetail } from "../components/ArticleDetail";
import { ClusterMap } from "../components/ClusterMap";

// Utilities
import { API_BASE, safeFetchJson } from "../utils";

export default function Dashboard() {
  // ─── Core Hook Integration ─────────────────────────────────────────────────
  const {
    pages,
    clusters,
    bufferInfo,
    fetchOverview,
    loadingPages,
    loadingLoadMore,
    loadMoreMessage,
    handleLoadMore,
    apiError,
  } = useTrackedArticles();

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const {
    searchTitle,
    filterQuery,
    handleSearchChange,
    fetchStatus,
    setFetchStatus,
    fetchMessage,
    setFetchMessage,
    handleOnDemandFetch,
    handleTrack,
  } = useArticleSearch({
    pages,
    setSelectedId,
    fetchOverview,
  });

  // ─── Detail and Comparison State ───────────────────────────────────────────
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);

  const [compareId, setCompareId] = useState<number | null>(null);
  const [compareDetail, setCompareDetail] = useState<PageDetail | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRecluster, setLoadingRecluster] = useState(false);
  const [reclusterMessage, setReclusterMessage] = useState<string | null>(null);
  const reclusterInitialTsRef = React.useRef<string | null>(null);
  const reclusterTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const [revisionsExpanded, setRevisionsExpanded] = useState(false);

  // States for interactive SVG hovering
  const [hoveredPage, setHoveredPage] = useState<any | null>(null);
  const [hoveredClusterId, setHoveredClusterId] = useState<number | null>(null);

  const [isFirstVisit, setIsFirstVisit] = useState(false);

  useEffect(() => {
    const hasVisited = localStorage.getItem("tremor:has_visited");
    if (!hasVisited) {
      setIsFirstVisit(true);
    }
  }, []);

  // Set default selection when pages first load
  useEffect(() => {
    if (pages.length > 0 && selectedId === null) {
      setSelectedId(pages[0].id);
    }
  }, [pages, selectedId]);

  // Monitor bufferInfo.last_recalculated_at to detect completion of cluster recalculation
  useEffect(() => {
    if (loadingRecluster && bufferInfo?.last_recalculated_at) {
      const currentTs = bufferInfo.last_recalculated_at;
      const initialTs = reclusterInitialTsRef.current;
      if (initialTs !== null && currentTs !== initialTs) {
        setLoadingRecluster(false);
        setReclusterMessage(null);
        if (reclusterTimeoutRef.current) {
          clearTimeout(reclusterTimeoutRef.current);
          reclusterTimeoutRef.current = null;
        }
      }
    }
  }, [loadingRecluster, bufferInfo?.last_recalculated_at]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (reclusterTimeoutRef.current) {
        clearTimeout(reclusterTimeoutRef.current);
      }
    };
  }, []);

  // Fetch detail for selected article
  const fetchDetail = useCallback(async (id: number) => {
    setLoadingDetail(true);
    setLoadingSummary(true);
    setRevisionsExpanded(false);

    // 1. Fetch details and timeline (very fast database queries)
    const detailsPromise = safeFetchJson<PageDetail>(`${API_BASE}/api/pages/${id}`)
      .then((pd) => {
        setDetail(pd);
      })
      .catch((e) => console.error("Failed to fetch page details:", e));

    const timelinePromise = safeFetchJson<TimelineResponse>(`${API_BASE}/api/pages/${id}/timeline`)
      .then((tl) => {
        setTimeline(tl);
      })
      .catch((e) => console.error("Failed to fetch page timeline:", e));

    // Resolve details and timeline as fast as possible to make UI changes instant
    Promise.all([detailsPromise, timelinePromise]).finally(() => {
      setLoadingDetail(false);
    });

    // 2. Fetch dispute summary in parallel but independently (might involve LLM computation)
    safeFetchJson<{ summary: string }>(`${API_BASE}/api/pages/${id}/summary`)
      .then((sm) => {
        setSummary(sm.summary);
      })
      .catch((e) => {
        console.error("Failed to fetch page summary:", e);
        setSummary("Failed to load dispute summary.");
      })
      .finally(() => {
        setLoadingSummary(false);
      });
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      fetchDetail(selectedId);
    }
  }, [selectedId, fetchDetail]);

  // Fetch comparison detail when compareId changes
  useEffect(() => {
    if (compareId === null) {
      setCompareDetail(null);
      return;
    }
    setLoadingCompare(true);
    safeFetchJson<PageDetail>(`${API_BASE}/api/pages/${compareId}`)
      .then((det) => {
        setCompareDetail(det);
      })
      .catch(console.error)
      .finally(() => setLoadingCompare(false));
  }, [compareId]);

  // Re-clustering handler via GitHub Actions dispatch
  const handleRecluster = useCallback(async () => {
    if (loadingRecluster) return;
    setLoadingRecluster(true);
    setReclusterMessage("Recalculation started, this may take a minute");

    try {
      const res = await safeFetchJson<{ message?: string; last_recalculated_at?: string | null }>(
        `${API_BASE}/api/clusters/recalculate`,
        { method: "POST" }
      );
      
      reclusterInitialTsRef.current = res?.last_recalculated_at ?? bufferInfo?.last_recalculated_at ?? "";

      // 90s safety timeout to automatically re-enable the button if workflow takes longer or signal missed
      if (reclusterTimeoutRef.current) {
        clearTimeout(reclusterTimeoutRef.current);
      }
      reclusterTimeoutRef.current = setTimeout(() => {
        setLoadingRecluster(false);
        setReclusterMessage(null);
        fetchOverview();
      }, 90000);
    } catch (e: any) {
      console.error("recluster fail", e);
      alert(e?.message || "Failed to trigger cluster recalculation workflow on GitHub Actions.");
      setLoadingRecluster(false);
      setReclusterMessage(null);
      if (reclusterTimeoutRef.current) {
        clearTimeout(reclusterTimeoutRef.current);
        reclusterTimeoutRef.current = null;
      }
    }
  }, [loadingRecluster, bufferInfo?.last_recalculated_at, fetchOverview]);

  // ─── Derived stats ─────────────────────────────────────────────────────────
  const conflicts = useMemo(() => {
    return pages.filter((p) => (p.anomaly_score || 0) > 1.5).length;
  }, [pages]);

  const totalTrackedCount = bufferInfo ? bufferInfo.total_tracked : pages.length;
  const totalConflictCount = bufferInfo && bufferInfo.conflict_count !== undefined ? bufferInfo.conflict_count : conflicts;

  const avgScore = useMemo(() => {
    return pages.length
      ? (pages.reduce((s, p) => s + (p.anomaly_score || 0), 0) / pages.length).toFixed(2)
      : "—";
  }, [pages]);

  const filteredPages = useMemo(() => {
    return pages.filter((p) => p.title.toLowerCase().includes(filterQuery.toLowerCase()));
  }, [pages, filterQuery]);

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
              { label: "Tracked", value: totalTrackedCount, icon: BookOpen },
              {
                label: "Conflicts",
                value: totalConflictCount,
                icon: Flame,
                danger: totalConflictCount > 0,
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

            <HeaderClock />

            <Link
              href="/about"
              onClick={() => {
                localStorage.setItem("tremor:has_visited", "true");
                setIsFirstVisit(false);
              }}
              className={`text-xs px-3 py-1.5 rounded transition-all duration-100 font-semibold cursor-pointer no-underline ${
                isFirstVisit ? "about-btn-glow" : ""
              }`}
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

        <Ticker pages={pages} />
      </header>

      {/* API Connection Warning Banner */}
      {apiError && (
        <div className="bg-red-950/80 border-b border-red-800/60 px-5 py-2 text-xs font-mono text-red-300 flex items-center justify-between z-50 shrink-0">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Backend Connection Warning: {apiError}. Retrying automatically...
          </span>
          <button
            onClick={() => fetchOverview()}
            className="px-2 py-0.5 rounded bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-700/50 transition-colors"
          >
            Retry Now
          </button>
        </div>
      )}

      {/* ══ 3-COLUMN GRID ════════════════════════════════════════════════════════ */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
        {/* COL 1: Feed Panel */}
        <ArticleSidebar
          pages={pages}
          filteredPages={filteredPages}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          searchTitle={searchTitle}
          handleSearchChange={handleSearchChange}
          handleTrack={handleTrack}
          fetchStatus={fetchStatus}
          setFetchStatus={setFetchStatus}
          fetchMessage={fetchMessage}
          setFetchMessage={setFetchMessage}
          handleOnDemandFetch={handleOnDemandFetch}
          bufferInfo={bufferInfo}
          loadingLoadMore={loadingLoadMore}
          loadMoreMessage={loadMoreMessage}
          handleLoadMore={handleLoadMore}
          loadingPages={loadingPages}
        />

        {/* COL 2: Detail Panel */}
        <ArticleDetail
          detail={detail}
          loadingDetail={loadingDetail}
          loadingSummary={loadingSummary}
          summary={summary}
          timeline={timeline}
          revisionsExpanded={revisionsExpanded}
          setRevisionsExpanded={setRevisionsExpanded}
          compareId={compareId}
          compareDetail={compareDetail}
          loadingCompare={loadingCompare}
          setCompareId={setCompareId}
          setCompareDetail={setCompareDetail}
          setSelectedId={setSelectedId}
        />

        {/* COL 3: Map Panel */}
        <ClusterMap
          clusters={clusters}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          compareId={compareId}
          setCompareId={setCompareId}
          setCompareDetail={setCompareDetail}
          hoveredPage={hoveredPage}
          setHoveredPage={setHoveredPage}
          hoveredClusterId={hoveredClusterId}
          setHoveredClusterId={setHoveredClusterId}
          loadingRecluster={loadingRecluster}
          reclusterMessage={reclusterMessage}
          handleRecluster={handleRecluster}
        />
      </div>
    </div>
  );
}
