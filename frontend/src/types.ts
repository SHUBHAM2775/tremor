// Centralized Type Definitions and Layout Constants

export interface PageInfo {
  id: number;
  title: string;
  wiki: string;
  anomaly_score: number | null;
  cluster_id: number | null;
  x: number | null;
  y: number | null;
  last_checked: string | null;
  conflict_type: string | null;
  conflict_type_confidence: number | null;
}

export interface Revision {
  id: number;
  revision_id: number;
  editor: string;
  timestamp: string;
  byte_change: number;
  comment: string;
  is_revert: boolean;
  is_bot: boolean;
}

export interface PageDetail {
  page: PageInfo;
  recent_revisions: Revision[];
}

export interface TimelinePoint {
  time: string;
  edits: number;
  reverts: number;
}

export interface TimelineResponse {
  window_label: string;
  window_days: number;
  data: TimelinePoint[];
}

export interface ClusterPage {
  id: number;
  title: string;
  anomaly_score: number | null;
  cluster_id: number | null;
  x: number | null;
  y: number | null;
}

export type Level = "critical" | "elevated" | "normal";

export type FetchStatus = "idle" | "checking" | "fetching" | "done" | "not_found" | "error";

export function getLevel(score: number): Level {
  if (score > 2.0) return "critical";
  if (score > 0.5) return "elevated";
  return "normal";
}

export const LEVEL_META = {
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

export const CONFLICT_TYPE_META: Record<string, { label: string; color: string }> = {
  "Political/Ideological": {
    label: "Political / Ideological",
    color: "#e11d48",
  },
  "Factual/Sourcing": {
    label: "Factual / Sourcing",
    color: "#06b6d4",
  },
  "Conduct/Personal": {
    label: "Conduct / Personal",
    color: "#a855f7",
  },
  "Notability/Inclusion": {
    label: "Notability / Inclusion",
    color: "#f97316",
  },
  "Vandalism/Bad-faith": {
    label: "Vandalism / Bad-faith",
    color: "#eab308",
  },
};

export const CLUSTER_COLORS = [
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
