import React, { useState, useMemo, useRef, useCallback } from "react";
import { Radio, Plus, RefreshCw, X, BookOpen, ChevronUp, ChevronDown, ArrowUpDown } from "lucide-react";
import { PageInfo, FetchStatus, getLevel, LEVEL_META } from "../types";

interface ArticleSidebarProps {
  pages: PageInfo[];
  filteredPages: PageInfo[];
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  searchTitle: string;
  handleSearchChange: (val: string) => void;
  handleTrack: (e: React.FormEvent) => void;
  fetchStatus: FetchStatus;
  setFetchStatus: (status: FetchStatus) => void;
  fetchMessage: string;
  setFetchMessage: (msg: string) => void;
  handleOnDemandFetch: (title: string) => void;
  bufferInfo: {
    buffer_size: number;
    total_tracked: number;
    cap: number;
    conflict_count?: number;
    redis_available: boolean;
  } | null;
  loadingLoadMore: boolean;
  loadMoreMessage: string | null;
  handleLoadMore: () => void;
  loadingPages: boolean;
}

export const ArticleSidebar = React.memo(function ArticleSidebar({
  pages,
  filteredPages,
  selectedId,
  setSelectedId,
  searchTitle,
  handleSearchChange,
  handleTrack,
  fetchStatus,
  setFetchStatus,
  fetchMessage,
  setFetchMessage,
  handleOnDemandFetch,
  bufferInfo,
  loadingLoadMore,
  loadMoreMessage,
  handleLoadMore,
  loadingPages,
}: ArticleSidebarProps) {
  const articleListRef = useRef<HTMLDivElement>(null);
  const [sortBy, setSortBy] = useState<"contested" | "latest">("contested");

  const sortedPages = useMemo(() => {
    const list = [...filteredPages];
    if (sortBy === "latest") {
      list.sort((a, b) => {
        const timeA = a.last_checked ? new Date(a.last_checked).getTime() : 0;
        const timeB = b.last_checked ? new Date(b.last_checked).getTime() : 0;
        if (timeA === timeB) {
          return (b.anomaly_score || 0) - (a.anomaly_score || 0);
        }
        return timeB - timeA;
      });
    } else {
      // "contested" -> anomaly_score descending, nulls last
      list.sort((a, b) => {
        const scoreA = a.anomaly_score ?? -Infinity;
        const scoreB = b.anomaly_score ?? -Infinity;
        return scoreB - scoreA;
      });
    }
    return list;
  }, [filteredPages, sortBy]);

  const scrollToTop = useCallback(() => {
    if (articleListRef.current) {
      articleListRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    if (articleListRef.current) {
      articleListRef.current.scrollTo({
        top: articleListRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  return (
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
          onChange={(e) => handleSearchChange(e.target.value)}
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
          className="flex items-center justify-center w-9 h-9 rounded shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity border-0"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {(fetchStatus === "checking" || fetchStatus === "fetching") ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </button>
      </form>

      {/* Sort Control Toolbar */}
      <div
        className="px-3 py-2 flex items-center justify-between shrink-0 text-xs"
        style={{
          borderBottom: "1px solid var(--border-muted)",
          background: "var(--bg-surface)",
        }}
      >
        <div
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}
        >
          <ArrowUpDown className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
          <span>Sort</span>
        </div>
        <select
          id="article-sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "contested" | "latest")}
          className="px-2 py-1 rounded text-xs cursor-pointer focus:outline-none transition-colors border"
          style={{
            background: "var(--bg-base)",
            borderColor: "var(--border-muted)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <option value="contested">Most Contested</option>
          <option value="latest">Latest Conflicts</option>
        </select>
      </div>

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
              className="ml-auto shrink-0 opacity-60 hover:opacity-100 bg-transparent border-0 p-0"
              type="button"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Article list with jump to top/bottom controls */}
      <div className="relative flex-1 overflow-hidden group/sidebar-scroll">
        <div ref={articleListRef} className="h-full overflow-y-auto">
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
          ) : sortedPages.length === 0 ? (
            <div className="flex flex-col gap-0">
              <div
                className="flex flex-col items-center justify-center py-8 gap-2 px-4 text-center"
                style={{ color: "var(--text-subtle)" }}
              >
                <p className="text-xs">No tracked article matches <span style={{ color: "var(--text-muted)" }}>&#8220;{searchTitle}&#8221;</span>.</p>
              </div>
              {/* On-demand Wikipedia fetch affordance */}
              {fetchStatus === "idle" && searchTitle.trim().length > 1 && (
                <div
                  className="mx-3 mb-3 p-3 rounded"
                  style={{
                    background: "var(--accent-bg)",
                    border: "1px solid var(--accent-border)",
                  }}
                >
                  <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--accent-hi)", fontFamily: "var(--font-mono)" }}>
                    Not tracked yet — fetch from Wikipedia?
                  </p>
                  <p className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
                    Pull revision history for &#8220;{searchTitle.trim()}&#8221; and start tracking it live.
                  </p>
                  <button
                    id="fetch-from-wikipedia-btn"
                    onClick={() => {
                      handleOnDemandFetch(searchTitle.trim());
                    }}
                    className="text-[10px] font-semibold px-3 py-1.5 rounded cursor-pointer transition-opacity hover:opacity-80 border-0"
                    style={{
                      background: "var(--accent)",
                      color: "#fff",
                      fontFamily: "var(--font-mono)",
                    }}
                    type="button"
                  >
                    Fetch &#8220;{searchTitle.trim().length > 22 ? searchTitle.trim().substring(0, 20) + "…" : searchTitle.trim()}&#8221; from Wikipedia
                  </button>
                </div>
              )}
            </div>
          ) : (
            sortedPages.map((p, idx) => {
              const isSelected = p.id === selectedId;
              const score = p.anomaly_score || 0;
              const level = getLevel(score);
              const meta = LEVEL_META[level];

              return (
                <button
                  key={p.id}
                  id={`article-${p.id}`}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-150 border-0 ${
                    isSelected ? "" : "hover:bg-[var(--bg-hover)]/40"
                  }`}
                  style={{
                    borderBottom: "1px solid var(--border-muted)",
                    background: isSelected ? "var(--bg-hover)" : "transparent",
                  }}
                  type="button"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: meta.dot }}
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs truncate ${isSelected ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-body)]"}`}
                    >
                      {idx + 1}. {p.title}
                    </p>
                    <p className="text-[9px] uppercase tracking-wider mt-0.5 text-[var(--text-subtle)] font-mono">
                      {meta.label}
                    </p>
                  </div>
                  <span className="shrink-0 flex items-center gap-1">
                    <span
                      className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded border`}
                      style={{
                        minWidth: "36px",
                        textAlign: "center",
                        color: level === "critical" ? "var(--color-critical)" : level === "elevated" ? "var(--color-elevated)" : "var(--color-normal)",
                        background: level === "critical" ? "rgba(239,68,68,0.08)" : level === "elevated" ? "rgba(249,115,22,0.08)" : "rgba(34,197,94,0.07)",
                        borderColor: level === "critical" ? "rgba(239,68,68,0.25)" : level === "elevated" ? "rgba(249,115,22,0.25)" : "rgba(34,197,94,0.2)",
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
          {pages.length > 0 && !searchTitle && (() => {
            const cap = bufferInfo ? bufferInfo.cap : 1000;
            const totalTracked = bufferInfo ? bufferInfo.total_tracked : 0;
            const currentRendered = pages.length;
            const canPageForward = currentRendered < totalTracked && currentRendered < cap;
            const canFetchNew = currentRendered >= totalTracked && totalTracked < cap;
            const isCapReached = !canPageForward && !canFetchNew;

            return (
              <div className="p-4 border-t border-[var(--border-muted)] bg-[var(--bg-base)] flex flex-col gap-2">
                {loadMoreMessage && (
                  <div className="text-[10px] text-[var(--text-subtle)] flex items-center gap-2 mb-1 animate-pulse" style={{ fontFamily: "var(--font-mono)" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                    {loadMoreMessage}
                  </div>
                )}
                <button
                  onClick={handleLoadMore}
                  disabled={loadingLoadMore || isCapReached}
                  className="w-full py-2.5 px-4 rounded text-[10px] font-semibold uppercase tracking-wider cursor-pointer transition-all duration-150 flex items-center justify-center gap-2 border"
                  style={{
                    background: loadingLoadMore
                      ? "var(--bg-card)"
                      : isCapReached
                        ? "var(--bg-card)"
                        : "var(--accent)",
                    color: isCapReached
                      ? "var(--text-muted)"
                      : "#fff",
                    borderColor: "var(--border-muted)",
                    cursor: (loadingLoadMore || isCapReached) ? "not-allowed" : "pointer",
                    opacity: loadingLoadMore ? 0.7 : 1,
                  }}
                  type="button"
                >
                  {loadingLoadMore ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  {isCapReached
                    ? `Tracking cap reached (${cap} articles)`
                    : loadingLoadMore
                      ? "Loading Articles..."
                      : "Load 100 More"}
                </button>
                {bufferInfo && (
                  <div className="text-[9px] text-[var(--text-subtle)] text-center mt-1" style={{ fontFamily: "var(--font-mono)" }}>
                    Tracked: {bufferInfo.total_tracked} / {bufferInfo.cap} articles
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Scroll Top Button */}
        <button
          type="button"
          onClick={scrollToTop}
          className="absolute top-2 right-4 p-1.5 rounded-full border shadow-md transition-all duration-200 opacity-0 group-hover/sidebar-scroll:opacity-100 hover:scale-105 cursor-pointer z-10"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            color: "var(--accent-hi)",
          }}
          title="Scroll to top"
        >
          <ChevronUp className="w-4 h-4" />
        </button>

        {/* Scroll Bottom Button */}
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-2 right-4 p-1.5 rounded-full border shadow-md transition-all duration-200 opacity-0 group-hover/sidebar-scroll:opacity-100 hover:scale-105 cursor-pointer z-10"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            color: "var(--accent-hi)",
          }}
          title="Scroll to bottom"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
});
export default ArticleSidebar;
