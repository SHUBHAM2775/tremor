export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// Helper to perform safe fetch and JSON parsing
export async function safeFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
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
