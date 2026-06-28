import { useState, useEffect, useCallback } from "react";
import { PageInfo, ClusterPage } from "../types";
import { API_BASE, safeFetchJson } from "../utils";

export function useTrackedArticles() {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [clusters, setClusters] = useState<ClusterPage[]>([]);
  const [loadingPages, setLoadingPages] = useState(true);
  const [pagesLimit, setPagesLimit] = useState(300);

  const [bufferInfo, setBufferInfo] = useState<{
    buffer_size: number;
    total_tracked: number;
    cap: number;
    conflict_count?: number;
    redis_available: boolean;
  } | null>(null);

  const [loadingLoadMore, setLoadingLoadMore] = useState(false);
  const [loadMoreMessage, setLoadMoreMessage] = useState<string | null>(null);

  const fetchBufferInfo = useCallback(async () => {
    try {
      const data = await safeFetchJson<{
        buffer_size: number;
        total_tracked: number;
        cap: number;
        conflict_count?: number;
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
        safeFetchJson<ClusterPage[]>(`${API_BASE}/api/clusters?limit=1000`),
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

  // Initial and periodic polling
  useEffect(() => {
    fetchOverview();
    const iv = setInterval(fetchOverview, 15000);
    return () => clearInterval(iv);
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
  };
}
export default useTrackedArticles;
