import type { OmRecordDTO } from "../types/om";

export interface UniversalSuggestion {
  id: string;
  displayName: string;
  controller: string;
}

const BASE = "";

export async function searchOmRecords(keyword: string, force: boolean): Promise<OmRecordDTO[]> {
  const params = new URLSearchParams({ keyword, force: String(force) });
  const res = await fetch(`${BASE}/api/search?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getLivePuzzleSuggestions(keyword: string): Promise<UniversalSuggestion[]> {
  const res = await fetch(`${BASE}/api/suggestions?keyword=${encodeURIComponent(keyword)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function checkBootReady(): Promise<boolean> {
  const res = await fetch(`${BASE}/api/boot/ready`);
  return res.json();
}

export async function getCachePath(): Promise<string> {
  const res = await fetch(`${BASE}/api/cache/path`);
  return res.text();
}

export async function getCacheInfo(): Promise<string> {
  const res = await fetch(`${BASE}/api/cache/info`);
  return res.text();
}
