import { useState, useEffect, useCallback } from "react";
import { PageInfo, ClusterPage, BufferInfo } from "../types";
import { API_BASE, safeFetchJson } from "../utils";

export function useTrackedArticles() {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [clusters, setClusters] = useState<ClusterPage[]>([]);
  const [loadingPages, setLoadingPages] = useState(true);
  const [pagesLimit, setPagesLimit] = useState(300);
  const [apiError, setApiError] = useState<string | null>(null);

  const [bufferInfo, setBufferInfo] = useState<BufferInfo | null>(null);

  const [loadingLoadMore, setLoadingLoadMore] = useState(false);
  const [loadMoreMessage, setLoadMoreMessage] = useState<string | null>(null);

  const fetchBufferInfo = useCallback(async () => {
    try {
      const data = await safeFetchJson<BufferInfo>(`${API_BASE}/api/pages/buffer-info`);
      setBufferInfo(data);
      return data;
    } catch (e) {
      console.error("Failed to fetch buffer info:", e);
      return null;
    }
  }, []);

  const fetchOverview = useCallback(async () => {
    try {
      const [pd, cd, buf] = await Promise.all([
        safeFetchJson<PageInfo[]>(`${API_BASE}/api/pages?limit=${pagesLimit}`),
        safeFetchJson<ClusterPage[]>(`${API_BASE}/api/clusters?limit=1000`),
        safeFetchJson<BufferInfo>(`${API_BASE}/api/pages/buffer-info`).catch(() => null),
      ]);
      setClusters(cd);
      setPages(pd);
      if (buf) {
        setBufferInfo(buf);
      }
      setApiError(null);
    } catch (e: any) {
      console.error("Failed to fetch overview data:", e);
      setApiError(e?.message || "Backend service unreachable");
    } finally {
      setLoadingPages(false);
    }
  }, [pagesLimit]);

  // Initial and periodic polling with Page Visibility API pause/resume
  useEffect(() => {
    let timerId: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      timerId = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          fetchOverview();
        }
      }, 60000);
    };

    const stopPolling = () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchOverview();
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Initial trigger and start interval if tab is currently visible
    if (typeof document !== "undefined") {
      if (document.visibilityState === "visible") {
        fetchOverview();
        startPolling();
      }
      document.addEventListener("visibilitychange", handleVisibilityChange);
    } else {
      fetchOverview();
    }

    return () => {
      stopPolling();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [fetchOverview]);

  const handleLoadMore = useCallback(async () => {
    if (loadingLoadMore) return;

    const totalTracked = bufferInfo ? bufferInfo.total_tracked : 0;
    const currentRendered = pages.length;
    const cap = bufferInfo ? bufferInfo.cap : 1000;

    // Case 1: Page forward through already tracked articles in the DB/cache
    if (currentRendered < totalTracked) {
      if (currentRendered >= cap) return;
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
      const newLimit = pagesLimit + 100;
      setPagesLimit(newLimit);
      const [pd, cd] = await Promise.all([
        safeFetchJson<PageInfo[]>(`${API_BASE}/api/pages?limit=${newLimit}`),
        safeFetchJson<ClusterPage[]>(`${API_BASE}/api/clusters?limit=1000`),
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

  return {
    pages,
    setPages,
    clusters,
    setClusters,
    bufferInfo,
    fetchBufferInfo,
    fetchOverview,
    loadingPages,
    loadingLoadMore,
    loadMoreMessage,
    handleLoadMore,
    pagesLimit,
    setPagesLimit,
    apiError,
  };
}
export default useTrackedArticles;
