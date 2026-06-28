import React, { useState, useCallback, useRef } from "react";
import { PageInfo, FetchStatus } from "../types";
import { API_BASE, safeFetchJson } from "../utils";

interface UseArticleSearchProps {
  pages: PageInfo[];
  setSelectedId: (id: number | null) => void;
  fetchOverview: () => Promise<void>;
}

export function useArticleSearch({
  pages,
  setSelectedId,
  fetchOverview,
}: UseArticleSearchProps) {
  const [searchTitle, setSearchTitle] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [fetchMessage, setFetchMessage] = useState("");

  const handleSearchChange = useCallback((val: string) => {
    setSearchTitle(val);
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => setFilterQuery(val), 200);
  }, []);

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
      // Step 2: Kick off background fetch
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
          } catch {
            break;
          }
        }
      }

      // Step 3b: Poll until the page appears in DB
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
        setFilterQuery("");
        await fetchOverview();
        setSelectedId(found.id);
      } else {
        setFetchStatus("done");
        setFetchMessage(`Fetch started for "${canonicalTitle}". Refresh in a moment.`);
        fetchOverview();
        setSearchTitle("");
        setFilterQuery("");
      }
    } catch {
      setFetchStatus("error");
      setFetchMessage("Failed to reach Wikipedia. Check your connection.");
    }
  }, [fetchOverview, setSelectedId]);

  const handleTrack = useCallback(async (e: React.FormEvent) => {
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
      setFilterQuery("");
      return;
    }
    // Not in DB — trigger on-demand fetch
    setFetchStatus("idle");
    setFetchMessage("");
    handleOnDemandFetch(title);
  }, [searchTitle, pages, setSelectedId, handleOnDemandFetch]);

  return {
    searchTitle,
    setSearchTitle,
    filterQuery,
    setFilterQuery,
    handleSearchChange,
    fetchStatus,
    setFetchStatus,
    fetchMessage,
    setFetchMessage,
    handleOnDemandFetch,
    handleTrack,
  };
}
export default useArticleSearch;
