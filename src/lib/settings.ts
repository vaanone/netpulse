// Shared dashboard settings — localStorage-backed.
// Used by BOTH the home page (`/`) and the settings page (`/settings`) so a
// toggle changed on one is reflected on the other after navigation remounts
// the page (each page re-reads localStorage in a useEffect).

export const SETTINGS_PASSWORD = "Hipoint@123";

export const LS_KEYS = {
  sectionVisibility: "np-vis",
  autoPoll: "np-autopoll",
  autoRefresh: "np-autorefresh",
  autoRefreshInterval: "np-autorefresh-interval",
  jumpTo: "np-jumpto",
  pollNow: "np-pollnow",
} as const;

export interface SectionDef {
  id: string;
  label: string;
  description?: string;
}

// Sections shown in the Settings page, in display order.
export const TOGGLE_SECTIONS: SectionDef[] = [
  { id: "summary-kpis", label: "Summary KPIs" },
  { id: "ring-topology", label: "Ring Topology" },
  { id: "search-switch", label: "Search Switch" },
  {
    id: "ring-traffic",
    label: "Ring Traffic (Mbps) & Utilization",
    description: "Per-link ingress / egress Mbps and utilization across the ring.",
  },
  {
    id: "switch-health",
    label: "Switch Health — Uptime & Port Status",
    description: "CPU, memory, uptime and per-switch port up/down counts.",
  },
  {
    id: "sfp-dom",
    label: "SFP DOM",
    description: "Digital Optical Monitoring readings (tx/rx power, temp, voltage).",
  },
  {
    id: "all-interfaces",
    label: "All SFP / Interfaces — Detailed Counters",
    description: "Full interface table with octet / error counters for every port.",
  },
  { id: "alerts", label: "Alerts" },
];

// Default visibility. The four detail sections are HIDDEN by default — the
// operator enables them from the Settings page only when they need them,
// keeping the home page focused on KPIs, topology and search.
// Explicit user choices stored in localStorage always override these defaults.
export const DEFAULT_SECTION_VISIBILITY: Record<string, boolean> = {
  "summary-kpis": true,
  "ring-topology": true,
  "search-switch": true,
  "ring-traffic": false,
  "switch-health": false,
  "sfp-dom": false,
  "all-interfaces": false,
  "alerts": true,
};

// Read the user's saved visibility overrides (may be partial / empty).
export function loadSectionVisibility(): Record<string, boolean> {
  try {
    const s = localStorage.getItem(LS_KEYS.sectionVisibility);
    if (s) return JSON.parse(s);
  } catch {}
  return {};
}

// Resolve visibility for a section: explicit override wins, else the default.
export function resolveSectionVisible(
  visibility: Record<string, boolean>,
  id: string,
): boolean {
  if (id in visibility) return visibility[id];
  return DEFAULT_SECTION_VISIBILITY[id] ?? true;
}

// Boolean settings stored as "true"/"false" strings. Unset ⇒ fallback.
export function loadBoolSetting(key: string, fallback = true): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v !== "false";
  } catch {
    return fallback;
  }
}

export function saveBoolSetting(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

// Numeric settings stored as strings. Unset / invalid ⇒ fallback.
// Used for configurable intervals (e.g. auto-refresh seconds).
export function loadNumSetting(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function saveNumSetting(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}
