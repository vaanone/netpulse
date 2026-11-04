"use client";

/**
 * NETPULSE — ISP Network Monitoring Tool
 * Cisco SFP & Ring Traffic Monitoring Dashboard
 *
 * A Creation by JJ.
 *
 * Single-page NOC dashboard: KPI summary, ring topology (circular / linear),
 * per-link traffic, switch health (CPU / memory / uptime), SFP DOM cards,
 * alerts feed with synthesized Web Audio beeps, and a full interfaces table.
 *
 * All data comes from the NETPULSE API routes via TanStack Query. There is no
 * server-side data fetching in this page.
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpDown, Bell, BellOff, Building2,
  Cable, ChevronDown, Cpu, Database, Gauge, HardDrive, LayoutGrid, Link2,
  Lock, MapPin, MemoryStick, Network, Plus, RadioTower, RefreshCw, Rocket,
  Search, Settings, ShieldAlert, ShieldCheck, Signal, Siren, Trash2, Wrench,
  X, Zap, CircleCheck, CircleX, CircleAlert, Server, Wifi, Activity as ActivityIcon,
  ChevronRight, Eye, Pencil, RotateCw, Crosshair, Layers, CircuitBoard,
  ArrowLeft, ArrowRight as ArrowRightIcon, Cog, Info, Trash, CircleDashed,
  Hash, Microchip, Thermometer, Filter, ArrowDownUp, SortDesc, SortAsc,
  ExternalLink, Hourglass, MonitorDot, Network as NetworkIcon, Router,
  CircleDot, Map as MapIcon, Building, Radio, FolderTree, Boxes, Workflow,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch as SwitchToggle } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction,
} from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Types — mirror the /api/metrics snapshot shape. BigInts come back as strings.
// ---------------------------------------------------------------------------

interface PortSnapshot {
  switchId: string; switchName: string; switchIp: string; switchStatus: string;
  mode: "snmp" | "simulate" | "boot"; error?: string;
  portId: string | null; ifIndex: number; ifName: string; ifDescr: string; ifAlias?: string;
  ifSpeed: string | bigint | null; ifHighSpeed: number | null; ifOperStatus: number | null;
  isRingPort: boolean; remoteSwitchId?: string | null; remoteSwitchName?: string | null;
  txPower: number | null; rxPower: number | null; temperature: number | null;
  voltage: number | null; biasCurrent: number | null;
  txWarnLow: number | null; txWarnHigh: number | null; txAlarmLow: number | null; txAlarmHigh: number | null;
  rxWarnLow: number | null; rxWarnHigh: number | null; rxAlarmLow: number | null; rxAlarmHigh: number | null;
  opticalMargin: number | null;
  transceiverType?: string; partNumber?: string; serialNumber?: string;
  inOctets: string | bigint | null; outOctets: string | bigint | null;
  inErrors: string | bigint | null; outErrors: string | bigint | null;
  inBps: number | null; outBps: number | null; inMbps: number | null; outMbps: number | null;
  utilization: number | null; totalErrors: number; lastPolledAt: string | Date | null;
}

interface NeighborSnapshot {
  localIfIndex: number; localIfName: string | null; deviceId: string; devicePort: string;
  address: string | null; platform: string | null; protocol: "cdp" | "lldp";
  matchedSwitchId: string | null; matchedSwitchName: string | null; matchedSwitchIp: string | null;
}

interface SwitchSnapshot {
  switchId: string; name: string; ipAddress: string; location?: string | null;
  snmpVersion: number; ringId: string | null; ringName: string | null;
  ringLabel: string | null; companyName: string | null;
  nextSwitchId: string | null; nextSwitchName: string | null; prevSwitchId: string | null;
  status: "up" | "down" | "unreachable" | "unknown"; mode: "snmp" | "simulate" | "boot"; error?: string;
  sysName?: string | null; sysDescr?: string | null; uptimeSeconds?: number | null;
  cpuUsage?: number | null; memoryUsed?: number | null; memoryFree?: number | null;
  memoryTotal?: number | null; memoryUsage?: number | null; lastSeen?: string | Date | null;
  ports: PortSnapshot[]; neighbors: NeighborSnapshot[];
  ringPortAutoDetected: boolean;
  suggestedNextSwitchId: string | null; suggestedNextSwitchName: string | null; suggestedNextSwitchReason: string | null;
  ringPort?: PortSnapshot | null; ringInMbps?: number | null; ringOutMbps?: number | null;
  ringUtilization?: number | null;
  portsUp: number; portsDown: number; portsAlarm: number; portsWarning: number;
}

interface RingLinkSnapshot {
  id: string; fromSwitchId: string; fromSwitchName: string; fromPortName: string;
  toSwitchId: string; toSwitchName: string; toPortName: string;
  status: string; inMbps: number; outMbps: number; utilization: number;
  rxPowerA: number | null; rxPowerB: number | null; txPowerA: number | null; txPowerB: number | null;
  health: "ok" | "warning" | "critical";
}

interface MetricsSnapshot {
  switches: SwitchSnapshot[];
  links: RingLinkSnapshot[];
  polledAt: string;
}

interface SwitchRow {
  id: string; name: string; ipAddress: string; location?: string | null;
  snmpVersion: number; community?: string | null; snmpPort: number;
  v3SecurityLevel?: string | null; v3Username?: string | null;
  v3AuthProtocol?: string | null; v3AuthPassword?: string | null;
  v3PrivProtocol?: string | null; v3PrivPassword?: string | null;
  ringId?: string | null; nextSwitchId?: string | null;
  status?: string; lastSeen?: string | null; pollingMode?: string;
  nextSwitch?: { id: string; name: string; ipAddress: string; snmpVersion: number } | null;
  ring?: {
    id: string; name: string; label: string | null; location: string | null;
    company: { id: string; name: string } | null;
  } | null;
}

interface CompanyRow {
  id: string; name: string; description?: string | null; createdAt: string;
  rings: Array<{
    id: string; name: string; label: string | null; location: string | null;
    _count: { switches: number };
  }>;
}

interface RingRow {
  id: string; name: string; label: string | null; location: string | null;
  companyId: string; company?: { id: string; name: string } | null;
  _count: { switches: number };
}

interface AlertRow {
  id: string; switchId: string | null; portId: string | null;
  severity: string; category: string; message: string; value?: string | null;
  acknowledged: boolean; resolved: boolean; timestamp: string; resolvedAt?: string | null;
  switch?: { name: string; ipAddress: string } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETTINGS_PASSWORD = "Hipoint@123";

const POLL_INTERVAL_LABEL = "Poll interval 30s";
const AUTO_REFRESH_LABEL = "Auto-refresh 15s";

const SECTION_IDS = [
  "summary-kpis",
  "ring-topology",
  "search-switch",
  "ring-traffic",
  "switch-health",
  "sfp-dom",
  "alerts",
  "switches",
  "all-interfaces",
] as const;

type SectionId = (typeof SECTION_IDS)[number];

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: "summary-kpis", label: "Summary KPIs", icon: <Gauge className="size-3.5" /> },
  { id: "ring-topology", label: "Ring Topology", icon: <Network className="size-3.5" /> },
  { id: "search-switch", label: "Search Switch", icon: <Search className="size-3.5" /> },
  { id: "ring-traffic", label: "Ring Traffic", icon: <Activity className="size-3.5" /> },
  { id: "switch-health", label: "Switch Health", icon: <Cpu className="size-3.5" /> },
  { id: "sfp-dom", label: "SFP DOM", icon: <Signal className="size-3.5" /> },
  { id: "switches", label: "Switches", icon: <Server className="size-3.5" /> },
  { id: "all-interfaces", label: "All Interfaces", icon: <LayoutGrid className="size-3.5" /> },
  { id: "alerts", label: "Alerts", icon: <Bell className="size-3.5" /> },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMbps(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  if (v < 0.001) return "0 Mbps";
  if (v < 1) return `${(v * 1000).toFixed(0)} Kbps`;
  if (v < 10) return `${v.toFixed(2)} Mbps`;
  if (v < 100) return `${v.toFixed(1)} Mbps`;
  if (v < 1000) return `${v.toFixed(0)} Mbps`;
  return `${(v / 1000).toFixed(2)} Gbps`;
}

function fmtMbpsShort(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  if (v < 1) return `${(v * 1000).toFixed(0)} K`;
  if (v < 1000) return `${v.toFixed(1)} M`;
  return `${(v / 1000).toFixed(2)} G`;
}

function fmtDbm(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v.toFixed(2)} dBm`;
}

function fmtUptime(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtBytes(v: string | bigint | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  if (!isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let val = n / 1024, i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function fmtTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0, key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} className="bg-primary/30 text-primary rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
  }
  return <>{parts}</>;
}

function severityColor(sev: string): string {
  switch (sev) {
    case "critical": return "text-crit";
    case "warning": return "text-warn";
    case "info": return "text-ok";
    default: return "text-muted-foreground";
  }
}

function severityBg(sev: string): string {
  switch (sev) {
    case "critical": return "bg-crit/15 text-crit border-crit/40";
    case "warning": return "bg-warn/15 text-warn border-warn/40";
    case "info": return "bg-ok/15 text-ok border-ok/40";
    default: return "bg-muted text-muted-foreground";
  }
}

function healthColor(h: string): string {
  switch (h) {
    case "ok": return "text-ok";
    case "warning": return "text-warn";
    case "critical": return "text-crit";
    default: return "text-muted-foreground";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "up": return "text-ok";
    case "down":
    case "unreachable": return "text-crit";
    default: return "text-muted-foreground";
  }
}

function statusDot(status: string): string {
  switch (status) {
    case "up": return "bg-ok";
    case "down":
    case "unreachable": return "bg-crit";
    default: return "bg-muted-foreground";
  }
}

function snmpVersionLabel(v: number): string {
  switch (v) {
    case 1: return "v1";
    case 3: return "v3";
    default: return "v2c";
  }
}

// ---------------------------------------------------------------------------
// Web Audio alert sound — sine oscillators with harmonics + ADSR envelope.
// Critical = 3 rising beeps A5 → D6 → G6
// Warning = 2 beeps E5 → B5
// Info = 1 chime C5
// ---------------------------------------------------------------------------

let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_audioCtx) {
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      _audioCtx = new Ctor();
    } catch { return null; }
  }
  if (_audioCtx && _audioCtx.state === "suspended") _audioCtx.resume().catch(() => {});
  return _audioCtx;
}

function playBeep(ctx: AudioContext, freq: number, startAt: number, duration = 0.18, gainPeak = 0.22) {
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc2.type = "sine";
  osc.frequency.value = freq;
  osc2.frequency.value = freq * 2.005; // slight detune for richness
  osc2.detune.value = 4;
  const oscGain2 = ctx.createGain();
  oscGain2.gain.value = 0.32; // second harmonic quieter
  // ADSR envelope
  const t0 = startAt;
  const attack = 0.012;
  const decay = 0.06;
  const sustain = gainPeak * 0.55;
  const release = duration;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + attack);
  gain.gain.linearRampToValueAtTime(sustain, t0 + attack + decay);
  gain.gain.linearRampToValueAtTime(0, t0 + attack + decay + release);
  osc.connect(gain);
  osc2.connect(oscGain2);
  oscGain2.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc2.start(t0);
  osc.stop(t0 + attack + decay + release + 0.02);
  osc2.stop(t0 + attack + decay + release + 0.02);
}

function playAlertSound(severity: string) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  if (severity === "critical") {
    // A5(880) → D6(1174.66) → G6(1567.98)
    playBeep(ctx, 880.0, now + 0.0, 0.16, 0.26);
    playBeep(ctx, 1174.66, now + 0.22, 0.16, 0.26);
    playBeep(ctx, 1567.98, now + 0.44, 0.22, 0.28);
  } else if (severity === "warning") {
    // E5(659.25) → B5(987.77)
    playBeep(ctx, 659.25, now + 0.0, 0.18, 0.24);
    playBeep(ctx, 987.77, now + 0.24, 0.20, 0.24);
  } else {
    // C5(523.25)
    playBeep(ctx, 523.25, now + 0.0, 0.22, 0.22);
  }
}

// ---------------------------------------------------------------------------
// Scroll + section highlight
// ---------------------------------------------------------------------------

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.remove("ring-2", "ring-primary/60");
  // re-trigger highlight animation
  void el.offsetWidth;
  el.classList.add("ring-2", "ring-primary/60");
  setTimeout(() => el.classList.remove("ring-2", "ring-primary/60"), 1600);
}

// ---------------------------------------------------------------------------
// Card primitives
// ---------------------------------------------------------------------------

function PanelCard({ className, children, id, ...rest }: React.ComponentProps<typeof Card> & { id?: string }) {
  return (
    <Card
      id={id}
      className={cn(
        "bg-panel border-border/60 shadow-lg shadow-black/20 transition-shadow",
        "scroll-mt-24",
        className
      )}
      {...rest}
    >
      {children}
    </Card>
  );
}

function SectionTitle({ icon, title, subtitle, action }: {
  icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode;
}) {
  return (
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
            {icon}
          </span>
          <div className="min-w-0">
            <CardTitle className="text-sm tracking-wide truncate">{title}</CardTitle>
            {subtitle && <CardDescription className="text-xs truncate">{subtitle}</CardDescription>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </CardHeader>
  );
}

// ===========================================================================
// MAIN HOME COMPONENT
// ===========================================================================

export default function Home() {
  const queryClient = useQueryClient();

  // --- Queries ---
  const metricsQ = useQuery<MetricsSnapshot>({
    queryKey: ["metrics"],
    queryFn: async () => {
      const r = await fetch("/api/metrics", { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load metrics");
      return r.json();
    },
    refetchInterval: 15_000,
  });

  const switchesQ = useQuery<SwitchRow[]>({
    queryKey: ["switches"],
    queryFn: async () => {
      const r = await fetch("/api/switches", { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load switches");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const companiesQ = useQuery<CompanyRow[]>({
    queryKey: ["companies"],
    queryFn: async () => {
      const r = await fetch("/api/companies", { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load companies");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const ringsQ = useQuery<RingRow[]>({
    queryKey: ["rings"],
    queryFn: async () => {
      const r = await fetch("/api/rings", { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load rings");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const alertsQ = useQuery<AlertRow[]>({
    queryKey: ["alerts"],
    queryFn: async () => {
      const r = await fetch("/api/alerts?acknowledged=false&resolved=false&limit=100", { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load alerts");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const [showAllAlerts, setShowAllAlerts] = React.useState(false);
  const allAlertsQ = useQuery<AlertRow[]>({
    queryKey: ["alerts-all"],
    queryFn: async () => {
      const r = await fetch("/api/alerts?limit=200", { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load alerts");
      return r.json();
    },
    enabled: showAllAlerts,
    refetchInterval: 15_000,
  });

  // --- Poll Now mutation ---
  const pollMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/poll", { method: "POST" });
      if (!r.ok) throw new Error("Poll failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Poll cycle completed", { description: "Snapshot refreshed from devices." });
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["metrics"] });
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
        queryClient.invalidateQueries({ queryKey: ["alerts-all"] });
      });
    },
    onError: (e: Error) => toast.error("Poll failed", { description: e.message }),
  });

  // --- UI state ---
  const [soundEnabled, setSoundEnabled] = React.useState(true);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = React.useState(false);
  const [manageCompaniesOpen, setManageCompaniesOpen] = React.useState(false);
  const [switchFormOpen, setSwitchFormOpen] = React.useState(false);
  const [editingSwitch, setEditingSwitch] = React.useState<SwitchRow | null>(null);
  const [detailSwitchId, setDetailSwitchId] = React.useState<string | null>(null);
  const [allAlertsOpen, setAllAlertsOpen] = React.useState(false);

  // --- Derived data ---
  const snapshot = metricsQ.data;
  const switches = snapshot?.switches ?? [];
  const links = snapshot?.links ?? [];
  const alerts = alertsQ.data ?? [];
  const allAlerts = allAlertsQ.data ?? [];

  // --- Alert sound: play when unack count increases ---
  const prevUnackCountRef = React.useRef<number>(0);
  React.useEffect(() => {
    const unack = alerts.filter(a => !a.acknowledged && !a.resolved);
    const count = unack.length;
    if (count > prevUnackCountRef.current && prevUnackCountRef.current !== 0) {
      // find newest unack alert
      const newest = unack[0];
      if (soundEnabled && newest) {
        playAlertSound(newest.severity);
      }
    }
    queueMicrotask(() => { prevUnackCountRef.current = count; });
  }, [alerts, soundEnabled]);

  // --- KPI computations ---
  const switchesUp = switches.filter(s => s.status === "up").length;
  const ringLinksUp = links.filter(l => l.status === "up").length;
  const totalRingLinks = links.length;
  const totalIngress = switches.reduce((a, s) => a + (s.ringInMbps ?? 0), 0);
  const totalEgress = switches.reduce((a, s) => a + (s.ringOutMbps ?? 0), 0);
  const activeAlertsCount = alerts.length;
  const ringPortsCount = switches.filter(s => s.ringPort != null).length;

  // Severity summary for alerts badge
  const hasCritical = alerts.some(a => a.severity === "critical");
  const hasWarning = alerts.some(a => a.severity === "warning");
  const alertsBadgeClass = hasCritical
    ? "bg-crit/20 text-crit border-crit/40"
    : hasWarning
      ? "bg-warn/20 text-warn border-warn/40"
      : "bg-ok/20 text-ok border-ok/40";

  const detailSwitch = detailSwitchId ? switches.find(s => s.switchId === detailSwitchId) ?? null : null;
  const editingSwitchRow = editingSwitch ? (switchesQ.data?.find(s => s.id === editingSwitch.id) ?? editingSwitch) : null;

  return (
    <div className="bg-grid min-h-screen flex flex-col text-foreground">
      {/* =========================================================
          HEADER
      ========================================================== */}
      <Header
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(v => !v)}
        unackCount={activeAlertsCount}
        alertsBadgeClass={alertsBadgeClass}
        onOpenAlerts={() => { setShowAllAlerts(true); setAllAlertsOpen(true); }}
        onOpenSettings={() => setSettingsOpen(true)}
        onPollNow={() => pollMut.mutate()}
        polling={pollMut.isPending}
      />

      <main className="flex-1 px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-5 sm:space-y-6 max-w-[1800px] w-full mx-auto">
        {/* a. Summary KPIs */}
        <SummaryKpis
          switchesUp={switchesUp}
          switchesTotal={switches.length}
          ringLinksUp={ringLinksUp}
          ringLinksTotal={totalRingLinks}
          totalIngress={totalIngress}
          totalEgress={totalEgress}
          activeAlerts={activeAlertsCount}
          ringPorts={ringPortsCount}
          loading={metricsQ.isLoading}
        />

        {/* b. Ring Topology */}
        <RingTopology
          switches={switches}
          links={links}
          onSwitchClick={(id) => setDetailSwitchId(id)}
        />

        {/* c. Search Switch */}
        <SearchSwitch
          switches={switches}
          onSwitchClick={(id) => setDetailSwitchId(id)}
        />

        {/* d. Ring Traffic */}
        <RingTraffic links={links} onSwitchClick={(id) => setDetailSwitchId(id)} />

        {/* e. Switch Health */}
        <SwitchHealth
          switches={switches}
          onSwitchClick={(id) => setDetailSwitchId(id)}
        />

        {/* f. Main grid: SFP DOM (2 cols) + Switches (1 col) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
          <div className="lg:col-span-2">
            <SfpDomCards switches={switches} onSwitchClick={(id) => setDetailSwitchId(id)} />
          </div>
          <div className="space-y-5 sm:space-y-6">
            <SwitchesList
              switches={switches}
              rows={switchesQ.data ?? []}
              onSwitchClick={(id) => setDetailSwitchId(id)}
              loading={switchesQ.isLoading}
            />
          </div>
        </div>

        {/* g. All Interfaces */}
        <AllInterfaces switches={switches} onSwitchClick={(id) => setDetailSwitchId(id)} />

        {/* h. Alerts Feed — below All Interfaces */}
        <AlertsFeed
          alerts={alerts}
          onOpenAll={() => { setShowAllAlerts(true); setAllAlertsOpen(true); }}
          onAck={async (id) => {
            try {
              const r = await fetch(`/api/alerts/${id}/ack`, { method: "POST" });
              if (!r.ok) throw new Error("Ack failed");
              toast.success("Alert acknowledged");
              queueMicrotask(() => {
                queryClient.invalidateQueries({ queryKey: ["alerts"] });
                queryClient.invalidateQueries({ queryKey: ["alerts-all"] });
              });
            } catch (e: any) { toast.error(e.message); }
          }}
          onSwitchClick={(id) => setDetailSwitchId(id)}
          loading={alertsQ.isLoading}
        />
      </main>

      {/* =========================================================
          FOOTER
      ========================================================== */}
      <Footer polledAt={snapshot?.polledAt} />

      {/* =========================================================
          DIALOGS
      ========================================================== */}
      <SettingsGateDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onUnlock={() => {
          setSettingsOpen(false);
          queueMicrotask(() => setSettingsMenuOpen(true));
        }}
      />

      <SettingsMenuDialog
        open={settingsMenuOpen}
        onOpenChange={setSettingsMenuOpen}
        onManageCompanies={() => {
          setSettingsMenuOpen(false);
          queueMicrotask(() => setManageCompaniesOpen(true));
        }}
        onAddSwitch={() => {
          setSettingsMenuOpen(false);
          queueMicrotask(() => { setEditingSwitch(null); setSwitchFormOpen(true); });
        }}
      />

      <ManageCompaniesDialog
        open={manageCompaniesOpen}
        onOpenChange={setManageCompaniesOpen}
        companies={companiesQ.data ?? []}
        loading={companiesQ.isLoading}
        onAddSwitch={() => {
          setManageCompaniesOpen(false);
          queueMicrotask(() => { setEditingSwitch(null); setSwitchFormOpen(true); });
        }}
      />

      <SwitchFormDialog
        open={switchFormOpen}
        onOpenChange={setSwitchFormOpen}
        companies={companiesQ.data ?? []}
        rings={ringsQ.data ?? []}
        switches={switchesQ.data ?? []}
        editing={editingSwitchRow}
        onSaved={() => {
          queueMicrotask(() => {
            queryClient.invalidateQueries({ queryKey: ["switches"] });
            queryClient.invalidateQueries({ queryKey: ["metrics"] });
            queryClient.invalidateQueries({ queryKey: ["companies"] });
            queryClient.invalidateQueries({ queryKey: ["rings"] });
          });
        }}
      />

      <SwitchDetailDialog
        sw={detailSwitch}
        onOpenChange={(o) => { if (!o) setDetailSwitchId(null); }}
        onSwitchClick={(id) => setDetailSwitchId(id)}
        onEdit={(row) => {
          setDetailSwitchId(null);
          queueMicrotask(() => { setEditingSwitch(row); setSwitchFormOpen(true); });
        }}
      />

      <AllAlertsDialog
        open={allAlertsOpen}
        onOpenChange={(o) => { setAllAlertsOpen(o); if (!o) setShowAllAlerts(false); }}
        alerts={allAlerts}
        loading={allAlertsQ.isLoading}
        onSwitchClick={(id) => { setAllAlertsOpen(false); queueMicrotask(() => setDetailSwitchId(id)); }}
      />
    </div>
  );
}

// ===========================================================================
// HEADER
// ===========================================================================

function Header(props: {
  soundEnabled: boolean;
  onToggleSound: () => void;
  unackCount: number;
  alertsBadgeClass: string;
  onOpenAlerts: () => void;
  onOpenSettings: () => void;
  onPollNow: () => void;
  polling: boolean;
}) {
  const { soundEnabled, onToggleSound, unackCount, alertsBadgeClass, onOpenAlerts, onOpenSettings, onPollNow, polling } = props;
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-panel/95 backdrop-blur supports-[backdrop-filter]:bg-panel/80">
      <div className="max-w-[1800px] mx-auto px-3 sm:px-4 lg:px-6 h-14 sm:h-16 flex items-center gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="size-10 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <img src="/netpulse-logo.png" alt="NETPULSE logo" className="size-8 object-contain" />
          </span>
          <div className="min-w-0">
            <div className="font-bold text-base sm:text-lg tracking-wider leading-none">NETPULSE</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground tracking-wide truncate">ISP Network Monitoring Tool</div>
          </div>
        </div>

        {/* Jump to */}
        <div className="hidden md:block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Crosshair className="size-3.5" />
                <span>Jump to</span>
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Sections</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SECTIONS.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => scrollToSection(s.id)} className="gap-2 cursor-pointer">
                  <span className="text-primary">{s.icon}</span>
                  <span>{s.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex-1" />

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onPollNow} disabled={polling} className="gap-1.5">
            <RefreshCw className={cn("size-3.5", polling && "animate-spin")} />
            <span className="hidden sm:inline">Poll Now</span>
          </Button>

          <Button variant="ghost" size="icon" onClick={onToggleSound} aria-label="Toggle sound" className="size-9">
            {soundEnabled ? <Bell className="size-4" /> : <BellOff className="size-4 text-muted-foreground" />}
          </Button>

          <Button variant="outline" size="sm" onClick={onOpenAlerts} className="gap-1.5 relative">
            <Siren className="size-3.5" />
            <span className="hidden sm:inline">Alerts</span>
            {unackCount > 0 && (
              <Badge className={cn("ml-1 px-1.5 py-0 h-5 min-w-5 justify-center text-[10px] font-bold", alertsBadgeClass)}>
                {unackCount > 99 ? "99+" : unackCount}
              </Badge>
            )}
          </Button>

          <Button variant="outline" size="icon" onClick={onOpenSettings} aria-label="Settings" className="size-9">
            <Settings className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

// ===========================================================================
// SUMMARY KPIS
// ===========================================================================

function SummaryKpis(props: {
  switchesUp: number; switchesTotal: number;
  ringLinksUp: number; ringLinksTotal: number;
  totalIngress: number; totalEgress: number;
  activeAlerts: number; ringPorts: number;
  loading: boolean;
}) {
  const kpis = [
    {
      id: "switches-up", label: "Switches Up", value: `${props.switchesUp}`,
      sub: `of ${props.switchesTotal} total`, icon: <Server className="size-4" />,
      color: "text-ok", ring: "border-ok/30",
    },
    {
      id: "ring-links-up", label: "Ring Links Up", value: `${props.ringLinksUp}`,
      sub: `of ${props.ringLinksTotal} links`, icon: <Link2 className="size-4" />,
      color: "text-ok", ring: "border-ok/30",
    },
    {
      id: "total-ingress", label: "Total Ingress", value: fmtMbpsShort(props.totalIngress),
      sub: "ring port ingress", icon: <ArrowRight className="size-4" />,
      color: "text-primary", ring: "border-primary/30",
    },
    {
      id: "total-egress", label: "Total Egress", value: fmtMbpsShort(props.totalEgress),
      sub: "ring port egress", icon: <ArrowRight className="size-4 rotate-180" />,
      color: "text-primary", ring: "border-primary/30",
    },
    {
      id: "active-alerts", label: "Active Alerts", value: `${props.activeAlerts}`,
      sub: props.activeAlerts === 0 ? "all clear" : "needs attention",
      icon: <Siren className="size-4" />,
      color: props.activeAlerts === 0 ? "text-ok" : "text-crit",
      ring: props.activeAlerts === 0 ? "border-ok/30" : "border-crit/30",
    },
    {
      id: "ring-ports", label: "Ring Ports", value: `${props.ringPorts}`,
      sub: "auto-detected", icon: <Cable className="size-4" />,
      color: "text-primary", ring: "border-primary/30",
    },
  ] as const;

  return (
    <section id="summary-kpis" className="scroll-mt-24">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {kpis.map((kpi) => (
          <motion.div
            key={kpi.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <PanelCard className={cn("py-4 gap-0", kpi.ring)}>
              <CardContent className="px-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{kpi.label}</span>
                  <span className={cn("flex size-6 items-center justify-center rounded-md bg-muted/40", kpi.color)}>{kpi.icon}</span>
                </div>
                <div className={cn("text-xl sm:text-2xl font-bold tabular-nums leading-tight", kpi.color)}>
                  {props.loading ? <span className="inline-block w-12 h-6 rounded bg-muted/40 animate-pulse" /> : kpi.value}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{kpi.sub}</div>
              </CardContent>
            </PanelCard>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ===========================================================================
// RING TOPOLOGY
// ===========================================================================

function RingTopology(props: {
  switches: SwitchSnapshot[];
  links: RingLinkSnapshot[];
  onSwitchClick: (id: string) => void;
}) {
  const { switches, links, onSwitchClick } = props;
  const [layout, setLayout] = React.useState<"circular" | "linear">("circular");
  const [hoveredLink, setHoveredLink] = React.useState<RingLinkSnapshot | null>(null);
  const [popoverPos, setPopoverPos] = React.useState<{ x: number; y: number } | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Group switches by ring
  const rings = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; label: string | null; switches: SwitchSnapshot[] }>();
    for (const sw of switches) {
      const rid = sw.ringId ?? "_none";
      if (!map.has(rid)) {
        map.set(rid, {
          id: rid,
          name: sw.ringName ?? "Unassigned",
          label: sw.ringLabel ?? sw.companyName ?? null,
          switches: [],
        });
      }
      map.get(rid)!.switches.push(sw);
    }
    // sort each ring's switches into walking order following nextSwitchId
    for (const ring of map.values()) {
      ring.switches = orderRingSwitches(ring.switches);
    }
    return Array.from(map.values());
  }, [switches]);

  function onLinkHover(link: RingLinkSnapshot | null, e: React.MouseEvent | null) {
    if (link && e && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPopoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setHoveredLink(link);
    } else {
      setHoveredLink(null);
      setPopoverPos(null);
    }
  }

  return (
    <PanelCard id="ring-topology" className="scroll-mt-24">
      <SectionTitle
        icon={<Network className="size-4" />}
        title="Ring Topology"
        subtitle="Fiber links between ring switches — hover any line for live Mbps"
        action={
          <Tabs value={layout} onValueChange={(v) => setLayout(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="circular" className="text-xs px-2.5 h-6">Circular</TabsTrigger>
              <TabsTrigger value="linear" className="text-xs px-2.5 h-6">Linear</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <CardContent>
        <div ref={containerRef} className="relative overflow-x-auto">
          {rings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No switches configured. Open Settings → Add Switch to begin.
            </div>
          ) : (
            <div className="space-y-6">
              {rings.map((ring) => (
                <RingDiagram
                  key={ring.id}
                  ring={ring}
                  links={links}
                  layout={layout}
                  onSwitchClick={onSwitchClick}
                  onLinkHover={onLinkHover}
                />
              ))}
            </div>
          )}

          {/* Hover popover */}
          <AnimatePresence>
            {hoveredLink && popoverPos && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.12 }}
                style={{ left: popoverPos.x, top: popoverPos.y }}
                className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+12px)]"
              >
                <div
                  className="rounded-xl border border-white/10 px-4 py-3 shadow-2xl min-w-[180px]"
                  style={{ background: "oklch(0.11 0.025 245)" }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <Cable className="size-3 text-primary" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Fiber Link</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-xs text-muted-foreground truncate max-w-[140px]">{hoveredLink.fromSwitchName}</div>
                    <ArrowRight className="size-3 text-primary shrink-0" />
                    <div className="text-xs text-muted-foreground truncate max-w-[140px]">{hoveredLink.toSwitchName}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground tracking-wider">In</div>
                      <div className="text-4xl font-bold text-primary tabular-nums leading-none">{fmtMbpsShort(hoveredLink.inMbps).replace(/\s.*/, "")}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Mbps</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground tracking-wider">Out</div>
                      <div className="text-4xl font-bold text-primary tabular-nums leading-none">{fmtMbpsShort(hoveredLink.outMbps).replace(/\s.*/, "")}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Mbps</div>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[10px]">
                    <span className={cn("font-medium", healthColor(hoveredLink.health))}>{hoveredLink.health.toUpperCase()}</span>
                    <span className="text-muted-foreground">Util {hoveredLink.utilization.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>Rx A {hoveredLink.rxPowerA != null ? hoveredLink.rxPowerA.toFixed(1) : "—"} dBm</span>
                    <span>Rx B {hoveredLink.rxPowerB != null ? hoveredLink.rxPowerB.toFixed(1) : "—"} dBm</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardContent>
    </PanelCard>
  );
}

function orderRingSwitches(switches: SwitchSnapshot[]): SwitchSnapshot[] {
  if (switches.length === 0) return switches;
  const byId = new Map(switches.map(s => [s.switchId, s]));
  // find head: switch whose prevSwitchId is null OR whose prev is not in this set
  const ids = new Set(switches.map(s => s.switchId));
  let head = switches.find(s => !s.prevSwitchId || !ids.has(s.prevSwitchId)) ?? switches[0];
  const ordered: SwitchSnapshot[] = [];
  const seen = new Set<string>();
  let cur: SwitchSnapshot | undefined = head;
  let guard = 0;
  while (cur && !seen.has(cur.switchId) && guard < switches.length + 2) {
    ordered.push(cur);
    seen.add(cur.switchId);
    cur = cur.nextSwitchId ? byId.get(cur.nextSwitchId) : undefined;
    guard++;
  }
  // append any leftover
  for (const s of switches) if (!seen.has(s.switchId)) ordered.push(s);
  return ordered;
}

function RingDiagram(props: {
  ring: { id: string; name: string; label: string | null; switches: SwitchSnapshot[] };
  links: RingLinkSnapshot[];
  layout: "circular" | "linear";
  onSwitchClick: (id: string) => void;
  onLinkHover: (link: RingLinkSnapshot | null, e: React.MouseEvent | null) => void;
}) {
  const { ring, links, layout, onSwitchClick, onLinkHover } = props;
  const nodes = ring.switches;

  if (nodes.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4">
        <div className="font-medium text-foreground mb-1">{ring.label ?? ring.name}</div>
        No switches in this ring.
      </div>
    );
  }

  // Build links local to this ring
  const ringLinkPairs: Array<{ from: SwitchSnapshot; to: SwitchSnapshot; link?: RingLinkSnapshot }> = [];
  for (const sw of nodes) {
    if (!sw.nextSwitchId) continue;
    const to = nodes.find(n => n.switchId === sw.nextSwitchId);
    if (!to) continue;
    const link = links.find(l => l.fromSwitchId === sw.switchId && l.toSwitchId === to.switchId);
    ringLinkPairs.push({ from: sw, to, link });
  }

  const W = layout === "linear" ? Math.max(900, nodes.length * 180) : Math.max(560, Math.min(900, nodes.length * 130));
  const H = layout === "linear" ? 220 : Math.max(420, Math.min(560, nodes.length * 90));
  const cx = W / 2, cy = H / 2;
  const radius = layout === "circular" ? Math.min(cx, cy) - 80 : 0;

  const nodePos = (i: number, n: number) => {
    if (layout === "circular") {
      const angle = (i / Math.max(n, 1)) * 2 * Math.PI - Math.PI / 2;
      return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    }
    // linear
    const padding = 80;
    const usable = W - padding * 2;
    const x = n === 1 ? cx : padding + (i / (n - 1)) * usable;
    return { x, y: H / 2 };
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="flex size-5 items-center justify-center rounded bg-primary/10 text-primary">
          <CircleDot className="size-3" />
        </span>
        <span className="text-sm font-semibold">{ring.label ?? ring.name}</span>
        <Badge variant="outline" className="text-[10px]">{nodes.length} switches</Badge>
        <Badge variant="outline" className="text-[10px]">{ringLinkPairs.length} links</Badge>
      </div>
      <div className="overflow-x-auto">
        <svg width={W} height={H} className="block max-w-full" style={{ minWidth: layout === "linear" ? W : "100%" }}>
          {/* Links */}
          {ringLinkPairs.map(({ from, to, link }, i) => {
            const fromIdx = nodes.indexOf(from);
            const toIdx = nodes.indexOf(to);
            const p1 = nodePos(fromIdx, nodes.length);
            const p2 = nodePos(toIdx, nodes.length);
            const color = link?.health === "critical" ? "oklch(0.65 0.22 25)" : link?.health === "warning" ? "oklch(0.80 0.17 80)" : "oklch(0.78 0.16 195)";
            const strokeWidth = link ? (link.utilization > 60 ? 3.5 : link.utilization > 20 ? 2.5 : 1.8) : 1.5;
            return (
              <g key={i}>
                <line
                  x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeOpacity={0.85}
                  strokeLinecap="round"
                  className="cursor-pointer transition-all"
                  onMouseEnter={(e) => link && onLinkHover(link, e)}
                  onMouseMove={(e) => link && onLinkHover(link, e)}
                  onMouseLeave={() => onLinkHover(null, null)}
                />
                {link && (
                  <text
                    x={(p1.x + p2.x) / 2}
                    y={(p1.y + p2.y) / 2 - 6}
                    textAnchor="middle"
                    className="pointer-events-none"
                    fill={color}
                    fontSize="11"
                    fontWeight="600"
                  >
                    {fmtMbpsShort(link.inMbps)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Closing arc link (ring closure) */}
          {layout === "circular" && nodes.length > 2 && (() => {
            const last = nodes[nodes.length - 1];
            const first = nodes[0];
            const closingLink = links.find(l => l.fromSwitchId === last.switchId && l.toSwitchId === first.switchId);
            if (!closingLink && (!last.nextSwitchId || last.nextSwitchId !== first.switchId)) return null;
            if (!closingLink) return null;
            const p1 = nodePos(nodes.length - 1, nodes.length);
            const p2 = nodePos(0, nodes.length);
            const color = closingLink.health === "critical" ? "oklch(0.65 0.22 25)" : closingLink.health === "warning" ? "oklch(0.80 0.17 80)" : "oklch(0.78 0.16 195)";
            return (
              <line
                x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke={color} strokeWidth={2.5} strokeOpacity={0.7} strokeLinecap="round"
                strokeDasharray="6 4"
                className="cursor-pointer"
                onMouseEnter={(e) => onLinkHover(closingLink, e)}
                onMouseMove={(e) => onLinkHover(closingLink, e)}
                onMouseLeave={() => onLinkHover(null, null)}
              />
            );
          })()}

          {/* Nodes */}
          {nodes.map((sw, i) => {
            const p = nodePos(i, nodes.length);
            const isUp = sw.status === "up";
            const fill = isUp ? "oklch(0.21 0.02 245)" : "oklch(0.28 0.04 25)";
            const stroke = isUp ? "oklch(0.78 0.16 195)" : "oklch(0.65 0.22 25)";
            return (
              <g
                key={sw.switchId}
                className="cursor-pointer"
                onClick={() => onSwitchClick(sw.switchId)}
              >
                <circle cx={p.x} cy={p.y} r={28} fill={fill} stroke={stroke} strokeWidth={2} className="transition-all hover:stroke-[3px]" />
                {/* status dot */}
                <circle cx={p.x + 18} cy={p.y - 18} r={5} fill={isUp ? "oklch(0.78 0.18 150)" : "oklch(0.65 0.22 25)"} stroke="oklch(0.16 0.018 240)" strokeWidth={1.5} />
                {/* name */}
                <text x={p.x} y={p.y - 36} textAnchor="middle" fill="oklch(0.96 0.005 200)" fontSize="14" fontWeight="700" className="pointer-events-none select-none">
                  {sw.name.length > 16 ? sw.name.slice(0, 14) + "…" : sw.name}
                </text>
                {/* IP */}
                <text x={p.x} y={p.y + 4} textAnchor="middle" fill="oklch(0.72 0.012 220)" fontSize="11" fontFamily="monospace" className="pointer-events-none select-none">
                  {sw.ipAddress}
                </text>
                {/* Mbps */}
                {sw.ringInMbps != null && (
                  <text x={p.x} y={p.y + 44} textAnchor="middle" fill="oklch(0.78 0.16 195)" fontSize="12" fontWeight="700" className="pointer-events-none select-none">
                    ↓ {fmtMbpsShort(sw.ringInMbps)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ===========================================================================
// SEARCH SWITCH
// ===========================================================================

function SearchSwitch(props: {
  switches: SwitchSnapshot[];
  onSwitchClick: (id: string) => void;
}) {
  const { switches, onSwitchClick } = props;
  const [query, setQuery] = React.useState("");

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return switches.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.ipAddress.toLowerCase().includes(q) ||
      (s.location ?? "").toLowerCase().includes(q) ||
      (s.ringName ?? "").toLowerCase().includes(q) ||
      (s.companyName ?? "").toLowerCase().includes(q) ||
      (s.sysName ?? "").toLowerCase().includes(q)
    ).slice(0, 12);
  }, [switches, query]);

  return (
    <PanelCard id="search-switch" className="scroll-mt-24">
      <SectionTitle
        icon={<Search className="size-4" />}
        title="Search Switch"
        subtitle="Find by name, IP, location, ring or sysName"
      />
      <CardContent>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search switches…"
            className="pl-9"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent"
              aria-label="Clear search"
            >
              <X className="size-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {query.trim() && (
          <div className="mt-3">
            {results.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">No matches for “{query}”.</div>
            ) : (
              <ScrollArea className="max-h-72">
                <div className="space-y-1.5 pr-2">
                  {results.map((sw) => (
                    <button
                      key={sw.switchId}
                      onClick={() => onSwitchClick(sw.switchId)}
                      className="w-full text-left flex items-center gap-3 p-2.5 rounded-lg border border-border/60 hover:bg-accent/40 hover:border-primary/30 transition-colors"
                    >
                      <span className={cn("size-2 rounded-full shrink-0", statusDot(sw.status))} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{highlightMatch(sw.name, query)}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate">{highlightMatch(sw.ipAddress, query)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="outline" className="text-[10px]">SNMP {snmpVersionLabel(sw.snmpVersion)}</Badge>
                        <div className="text-[10px] text-muted-foreground mt-1 truncate max-w-[140px]">
                          {sw.ringLabel ?? sw.ringName ?? "Unassigned"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
            <div className="text-[10px] text-muted-foreground mt-2">{results.length} match{results.length !== 1 ? "es" : ""}</div>
          </div>
        )}
      </CardContent>
    </PanelCard>
  );
}

// ===========================================================================
// RING TRAFFIC TABLE — sortable + 3-state status filter
// ===========================================================================

type SortState = "none" | "desc" | "asc";
type SortKey = "inMbps" | "outMbps" | "utilization" | "rxPowerA" | "rxPowerB";
type StatusFilter = "all" | "up" | "down";

function RingTraffic(props: {
  links: RingLinkSnapshot[];
  onSwitchClick: (id: string) => void;
}) {
  const { links, onSwitchClick } = props;
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [sortKey, setSortKey] = React.useState<SortKey | null>(null);
  const [sortState, setSortState] = React.useState<SortState>("none");

  const cycleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortState("desc"); return; }
    if (sortState === "desc") { setSortState("asc"); return; }
    if (sortState === "asc") { setSortKey(null); setSortState("none"); return; }
    setSortState("desc");
  };

  const reset = () => { setStatusFilter("all"); setSortKey(null); setSortState("none"); };

  const processed = React.useMemo(() => {
    let out = [...links];
    if (statusFilter === "up") out = out.filter(l => l.status === "up");
    else if (statusFilter === "down") out = out.filter(l => l.status !== "up");
    if (sortKey && sortState !== "none") {
      out.sort((a, b) => {
        const av = (a as any)[sortKey] ?? -Infinity;
        const bv = (b as any)[sortKey] ?? -Infinity;
        return sortState === "desc" ? bv - av : av - bv;
      });
    }
    return out;
  }, [links, statusFilter, sortKey, sortState]);

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="size-3 opacity-40" />;
    if (sortState === "desc") return <SortDesc className="size-3 text-primary" />;
    if (sortState === "asc") return <SortAsc className="size-3 text-primary" />;
    return <ArrowUpDown className="size-3 opacity-40" />;
  };

  return (
    <PanelCard id="ring-traffic" className="scroll-mt-24">
      <SectionTitle
        icon={<Activity className="size-4" />}
        title="Ring Traffic (Mbps) & Utilization"
        subtitle="Per-link fiber traffic with sortable columns"
        action={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              Showing {processed.length} of {links.length} links
            </Badge>
            <Button variant="ghost" size="sm" onClick={reset} className="h-7 text-xs gap-1">
              <RotateCw className="size-3" /> Reset
            </Button>
          </div>
        }
      />
      <CardContent>
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-xs">From Switch</TableHead>
                <TableHead className="text-xs">To Switch</TableHead>
                <TableHead className="text-xs">
                  <button onClick={() => {
                    setStatusFilter(s => s === "all" ? "up" : s === "up" ? "down" : "all");
                  }} className="flex items-center gap-1.5 hover:text-primary transition-colors">
                    Status
                    <Filter className={cn("size-3", statusFilter !== "all" && "text-primary")} />
                  </button>
                </TableHead>
                <TableHead className="text-xs cursor-pointer select-none hover:text-primary" onClick={() => cycleSort("inMbps")}>
                  <span className="flex items-center gap-1">In Mbps {sortIcon("inMbps")}</span>
                </TableHead>
                <TableHead className="text-xs cursor-pointer select-none hover:text-primary" onClick={() => cycleSort("outMbps")}>
                  <span className="flex items-center gap-1">Out Mbps {sortIcon("outMbps")}</span>
                </TableHead>
                <TableHead className="text-xs cursor-pointer select-none hover:text-primary" onClick={() => cycleSort("utilization")}>
                  <span className="flex items-center gap-1">Util% {sortIcon("utilization")}</span>
                </TableHead>
                <TableHead className="text-xs cursor-pointer select-none hover:text-primary" onClick={() => cycleSort("rxPowerA")}>
                  <span className="flex items-center gap-1">Rx A {sortIcon("rxPowerA")}</span>
                </TableHead>
                <TableHead className="text-xs cursor-pointer select-none hover:text-primary" onClick={() => cycleSort("rxPowerB")}>
                  <span className="flex items-center gap-1">Rx B {sortIcon("rxPowerB")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                    No links match the current filters.
                  </TableCell>
                </TableRow>
              ) : processed.map((l) => (
                <TableRow key={l.id} className="text-xs">
                  <TableCell>
                    <button onClick={() => onSwitchClick(l.fromSwitchId)} className="text-left hover:text-primary hover:underline">
                      <div className="font-medium truncate max-w-[140px]">{l.fromSwitchName}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">{l.fromPortName}</div>
                    </button>
                  </TableCell>
                  <TableCell>
                    <button onClick={() => onSwitchClick(l.toSwitchId)} className="text-left hover:text-primary hover:underline">
                      <div className="font-medium truncate max-w-[140px]">{l.toSwitchName}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">{l.toPortName}</div>
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-full", l.status === "up" ? "bg-ok" : "bg-crit")} />
                      <span className={cn("font-medium", l.status === "up" ? "text-ok" : "text-crit")}>{l.status}</span>
                    </span>
                  </TableCell>
                  <TableCell className="font-mono tabular-nums text-primary font-semibold">{fmtMbps(l.inMbps)}</TableCell>
                  <TableCell className="font-mono tabular-nums text-primary font-semibold">{fmtMbps(l.outMbps)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("tabular-nums font-medium", l.utilization > 85 ? "text-crit" : l.utilization > 60 ? "text-warn" : "text-ok")}>
                        {l.utilization.toFixed(1)}%
                      </span>
                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full", l.utilization > 85 ? "bg-crit" : l.utilization > 60 ? "bg-warn" : "bg-ok")}
                          style={{ width: `${Math.min(100, l.utilization)}%` }}
                        />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn("font-mono tabular-nums", l.rxPowerA != null && l.rxPowerA < -25 ? "text-crit" : l.rxPowerA != null && l.rxPowerA < -18 ? "text-warn" : "")}>
                    {fmtDbm(l.rxPowerA)}
                  </TableCell>
                  <TableCell className={cn("font-mono tabular-nums", l.rxPowerB != null && l.rxPowerB < -25 ? "text-crit" : l.rxPowerB != null && l.rxPowerB < -18 ? "text-warn" : "")}>
                    {fmtDbm(l.rxPowerB)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Click a switch name to open its detail dialog.</span>
          <span>Click a column header to sort — click again to toggle direction.</span>
        </div>
      </CardContent>
    </PanelCard>
  );
}

// ===========================================================================
// SWITCH HEALTH — CPU / Memory / Uptime
// ===========================================================================

function SwitchHealth(props: {
  switches: SwitchSnapshot[];
  onSwitchClick: (id: string) => void;
}) {
  const { switches, onSwitchClick } = props;
  const rows = [...switches].sort((a, b) => (b.cpuUsage ?? 0) - (a.cpuUsage ?? 0));

  return (
    <PanelCard id="switch-health" className="scroll-mt-24">
      <SectionTitle
        icon={<Cpu className="size-4" />}
        title="Switch Health — CPU / Memory / Uptime"
        subtitle="Sorted by CPU usage (highest first)"
      />
      <CardContent>
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-xs">Switch</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">CPU</TableHead>
                <TableHead className="text-xs">Memory</TableHead>
                <TableHead className="text-xs">Uptime</TableHead>
                <TableHead className="text-xs">Ports Up/Down</TableHead>
                <TableHead className="text-xs">Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    No switches available.
                  </TableCell>
                </TableRow>
              ) : rows.map((sw) => (
                <TableRow key={sw.switchId} className="text-xs">
                  <TableCell>
                    <button onClick={() => onSwitchClick(sw.switchId)} className="text-left hover:text-primary hover:underline">
                      <div className="font-medium">{sw.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{sw.ipAddress}</div>
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-full", statusDot(sw.status))} />
                      <span className={cn("font-medium", statusColor(sw.status))}>{sw.status}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <UsageBar value={sw.cpuUsage ?? null} />
                  </TableCell>
                  <TableCell>
                    <UsageBar value={sw.memoryUsage ?? null} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{fmtUptime(sw.uptimeSeconds)}</TableCell>
                  <TableCell>
                    <span className="font-mono">
                      <span className="text-ok">{sw.portsUp}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-crit">{sw.portsDown}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-[10px] text-muted-foreground">{timeAgo(sw.lastSeen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </PanelCard>
  );
}

function UsageBar({ value }: { value: number | null }) {
  if (value == null || !isFinite(value)) return <span className="text-muted-foreground text-xs">—</span>;
  const color = value > 90 ? "bg-crit" : value > 75 ? "bg-warn" : "bg-ok";
  const textColor = value > 90 ? "text-crit" : value > 75 ? "text-warn" : "text-ok";
  return (
    <div className="flex items-center gap-2">
      <span className={cn("font-mono tabular-nums text-xs w-10", textColor)}>{value.toFixed(1)}%</span>
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full transition-all", color)} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

// ===========================================================================
// SFP DOM CARDS
// ===========================================================================

function SfpDomCards(props: {
  switches: SwitchSnapshot[];
  onSwitchClick: (id: string) => void;
}) {
  const { switches, onSwitchClick } = props;

  // Only switches that have at least one SFP port with DOM readings
  const withDom = switches.filter(s => s.ports.some(p => p.txPower != null || p.rxPower != null || p.temperature != null));

  return (
    <PanelCard id="sfp-dom" className="scroll-mt-24">
      <SectionTitle
        icon={<Signal className="size-4" />}
        title="SFP DOM"
        subtitle="Digital Optical Monitoring — per-switch transceiver readings"
        action={<Badge variant="outline" className="text-[10px]">{withDom.length} switches with DOM</Badge>}
      />
      <CardContent>
        {withDom.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No SFP DOM readings available yet. The poller will populate these on the next cycle.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {withDom.map((sw) => (
              <SwitchDomCard key={sw.switchId} sw={sw} onSwitchClick={onSwitchClick} />
            ))}
          </div>
        )}
      </CardContent>
    </PanelCard>
  );
}

function SwitchDomCard(props: { sw: SwitchSnapshot; onSwitchClick: (id: string) => void }) {
  const { sw, onSwitchClick } = props;
  const sfpPorts = sw.ports.filter(p => p.txPower != null || p.rxPower != null || p.temperature != null);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-border/40 bg-muted/20">
        <button onClick={() => onSwitchClick(sw.switchId)} className="flex items-center gap-2 text-left hover:text-primary min-w-0">
          <span className={cn("size-2 rounded-full shrink-0", statusDot(sw.status))} />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{sw.name}</div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">{sw.ipAddress}</div>
          </div>
        </button>
        <Badge variant="outline" className="text-[10px] shrink-0">{sfpPorts.length} SFP</Badge>
      </div>
      <ScrollArea className="max-h-72">
        <div className="p-2 space-y-1.5">
          {sfpPorts.map((p) => (
            <DomPortRow key={p.ifIndex} port={p} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function DomPortRow({ port }: { port: PortSnapshot }) {
  const isRing = port.isRingPort;
  const tempHot = port.temperature != null && port.temperature > 70;
  const rxLow = port.rxPower != null && port.rxAlarmLow != null && port.rxPower <= port.rxAlarmLow;
  const rxWarn = port.rxPower != null && port.opticalMargin != null && port.opticalMargin < 3 && port.opticalMargin >= 0;
  return (
    <div className={cn(
      "flex items-center gap-2 p-2 rounded-md border text-xs",
      isRing ? "border-primary/40 bg-primary/5" : "border-border/40"
    )}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium font-mono truncate">{port.ifName}</span>
          {isRing && <Badge className="text-[9px] px-1 py-0 h-3.5 bg-primary/15 text-primary border-primary/30">RING</Badge>}
          {port.ifOperStatus !== 1 ? (
            <Badge className="text-[9px] px-1 py-0 h-3.5 bg-crit/15 text-crit border-crit/30">DOWN</Badge>
          ) : null}
        </div>
        {port.transceiverType && (
          <div className="text-[10px] text-muted-foreground truncate">{port.transceiverType}</div>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <DomMetric label="Tx" value={port.txPower != null ? `${port.txPower.toFixed(1)}` : "—"} unit="dBm" warn={false} />
        <DomMetric
          label="Rx"
          value={port.rxPower != null ? `${port.rxPower.toFixed(1)}` : "—"}
          unit="dBm"
          warn={rxWarn}
          crit={rxLow}
        />
        <DomMetric label="Tmp" value={port.temperature != null ? `${port.temperature.toFixed(0)}` : "—"} unit="°C" warn={tempHot} />
        <DomMetric label="Util" value={port.utilization != null ? `${port.utilization.toFixed(0)}` : "—"} unit="%" warn={(port.utilization ?? 0) > 85} />
      </div>
    </div>
  );
}

function DomMetric({ label, value, unit, warn, crit }: { label: string; value: string; unit: string; warn?: boolean; crit?: boolean }) {
  const color = crit ? "text-crit" : warn ? "text-warn" : "text-foreground";
  return (
    <div className="text-center min-w-[44px]">
      <div className="text-[9px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={cn("font-mono tabular-nums font-semibold text-xs", color)}>{value}</div>
      <div className="text-[8px] text-muted-foreground">{unit}</div>
    </div>
  );
}

// ===========================================================================
// ALERTS FEED
// ===========================================================================

function AlertsFeed(props: {
  alerts: AlertRow[];
  onOpenAll: () => void;
  onAck: (id: string) => void;
  onSwitchClick: (id: string) => void;
  loading: boolean;
}) {
  const { alerts, onOpenAll, onAck, onSwitchClick, loading } = props;
  const display = alerts.slice(0, 20);

  return (
    <PanelCard id="alerts" className="scroll-mt-24 py-4">
      <SectionTitle
        icon={<Siren className="size-4" />}
        title="Alerts"
        subtitle="Unacknowledged active alerts"
        action={
          <Button variant="outline" size="sm" onClick={onOpenAll} className="h-7 text-xs gap-1">
            <LayoutGrid className="size-3" /> View All
          </Button>
        }
      />
      <CardContent className="px-3">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-12 rounded-md bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : display.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CircleCheck className="size-8 text-ok mb-2" />
            <div className="text-sm font-medium text-ok">All clear</div>
            <div className="text-xs text-muted-foreground">No unacknowledged alerts.</div>
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="space-y-1.5 pr-2">
              {display.map((a) => (
                <AlertRowItem key={a.id} alert={a} onAck={onAck} onSwitchClick={onSwitchClick} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </PanelCard>
  );
}

function AlertRowItem({ alert, onAck, onSwitchClick }: {
  alert: AlertRow;
  onAck: (id: string) => void;
  onSwitchClick: (id: string) => void;
}) {
  const sevIcon = alert.severity === "critical" ? <CircleX className="size-3.5" />
    : alert.severity === "warning" ? <CircleAlert className="size-3.5" />
      : <Info className="size-3.5" />;
  return (
    <div className={cn("rounded-md border p-2 flex items-start gap-2", severityBg(alert.severity))}>
      <span className="mt-0.5 shrink-0">{sevIcon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium leading-snug">{alert.message}</div>
        <div className="flex items-center gap-2 mt-1 text-[10px] opacity-80">
          {alert.switch && (
            <button onClick={() => onSwitchClick(alert.switchId!)} className="hover:underline font-medium">
              {alert.switch.name}
            </button>
          )}
          <span>·</span>
          <span className="uppercase">{alert.category}</span>
          <span>·</span>
          <span>{timeAgo(alert.timestamp)}</span>
        </div>
      </div>
      {!alert.acknowledged && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAck(alert.id)}
          className="h-6 px-2 text-[10px] shrink-0 hover:bg-background/20"
        >
          Ack
        </Button>
      )}
    </div>
  );
}

// ===========================================================================
// SWITCHES LIST
// ===========================================================================

function SwitchesList(props: {
  switches: SwitchSnapshot[];
  rows: SwitchRow[];
  onSwitchClick: (id: string) => void;
  loading: boolean;
}) {
  const { switches, onSwitchClick, loading } = props;

  return (
    <PanelCard id="switches" className="scroll-mt-24 py-4">
      <SectionTitle
        icon={<Server className="size-4" />}
        title="Switches"
        subtitle={`${switches.length} configured`}
      />
      <CardContent className="px-3">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-14 rounded-md bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : switches.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No switches configured.
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="space-y-1.5 pr-2">
              {switches.map((sw) => (
                <SwitchListItem key={sw.switchId} sw={sw} onClick={() => onSwitchClick(sw.switchId)} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </PanelCard>
  );
}

function SwitchListItem({ sw, onClick }: { sw: SwitchSnapshot; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 p-2.5 rounded-lg border border-border/60 hover:bg-accent/40 hover:border-primary/30 transition-colors"
    >
      <span className={cn("size-2 rounded-full shrink-0", statusDot(sw.status))} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{sw.name}</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">SNMP {snmpVersionLabel(sw.snmpVersion)}</Badge>
        </div>
        <div className="text-[10px] text-muted-foreground font-mono truncate">{sw.ipAddress}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[10px] text-muted-foreground">
          {sw.ports.length} port{sw.ports.length !== 1 ? "s" : ""}
        </div>
        {sw.nextSwitchName ? (
          <div className="text-[10px] text-muted-foreground flex items-center gap-0.5 justify-end">
            <ArrowRight className="size-2.5" /> {sw.nextSwitchName}
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground">no next</div>
        )}
      </div>
    </button>
  );
}

// ===========================================================================
// ALL INTERFACES TABLE
// ===========================================================================

function AllInterfaces(props: {
  switches: SwitchSnapshot[];
  onSwitchClick: (id: string) => void;
}) {
  const { switches, onSwitchClick } = props;
  const [filter, setFilter] = React.useState<"all" | "ring" | "sfp" | "down">("all");

  const rows = React.useMemo(() => {
    const out: Array<{ sw: SwitchSnapshot; port: PortSnapshot }> = [];
    for (const sw of switches) {
      for (const port of sw.ports) {
        if (filter === "ring" && !port.isRingPort) continue;
        if (filter === "sfp" && port.txPower == null && port.rxPower == null) continue;
        if (filter === "down" && port.ifOperStatus === 1) continue;
        out.push({ sw, port });
      }
    }
    return out;
  }, [switches, filter]);

  return (
    <PanelCard id="all-interfaces" className="scroll-mt-24">
      <SectionTitle
        icon={<LayoutGrid className="size-4" />}
        title="All SFP / Interfaces — Detailed Counters"
        subtitle="Per-interface counters across all switches"
        action={
          <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-2.5 h-6">All</TabsTrigger>
              <TabsTrigger value="ring" className="text-xs px-2.5 h-6">Ring</TabsTrigger>
              <TabsTrigger value="sfp" className="text-xs px-2.5 h-6">SFP</TabsTrigger>
              <TabsTrigger value="down" className="text-xs px-2.5 h-6">Down</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <CardContent>
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <ScrollArea className="max-h-[28rem]">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30 sticky top-0">
                  <TableHead className="text-xs">Switch</TableHead>
                  <TableHead className="text-xs">Interface</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">In Mbps</TableHead>
                  <TableHead className="text-xs">Out Mbps</TableHead>
                  <TableHead className="text-xs">Util%</TableHead>
                  <TableHead className="text-xs">Rx Power</TableHead>
                  <TableHead className="text-xs">Tx Power</TableHead>
                  <TableHead className="text-xs">Temp</TableHead>
                  <TableHead className="text-xs">Errors</TableHead>
                  <TableHead className="text-xs">Transceiver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                      No interfaces match the filter.
                    </TableCell>
                  </TableRow>
                ) : rows.map(({ sw, port }) => (
                  <TableRow key={`${sw.switchId}-${port.ifIndex}`} className="text-xs">
                    <TableCell>
                      <button onClick={() => onSwitchClick(sw.switchId)} className="text-left hover:text-primary hover:underline">
                        <div className="font-medium truncate max-w-[120px]">{sw.name}</div>
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono">{port.ifName}</span>
                        {port.isRingPort && <Badge className="text-[9px] px-1 py-0 h-3.5 bg-primary/15 text-primary border-primary/30">RING</Badge>}
                      </div>
                      {port.ifAlias && <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{port.ifAlias}</div>}
                    </TableCell>
                    <TableCell>
                      <span className={cn("font-medium", port.ifOperStatus === 1 ? "text-ok" : port.ifOperStatus === 2 ? "text-crit" : "text-muted-foreground")}>
                        {port.ifOperStatus === 1 ? "up" : port.ifOperStatus === 2 ? "down" : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-primary">{fmtMbps(port.inMbps)}</TableCell>
                    <TableCell className="font-mono tabular-nums text-primary">{fmtMbps(port.outMbps)}</TableCell>
                    <TableCell className={cn("tabular-nums font-medium", (port.utilization ?? 0) > 85 ? "text-crit" : (port.utilization ?? 0) > 60 ? "text-warn" : "text-ok")}>
                      {port.utilization != null ? `${port.utilization.toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className={cn("font-mono tabular-nums", port.rxPower != null && port.rxAlarmLow != null && port.rxPower <= port.rxAlarmLow ? "text-crit" : port.opticalMargin != null && port.opticalMargin < 3 ? "text-warn" : "")}>
                      {fmtDbm(port.rxPower)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">{fmtDbm(port.txPower)}</TableCell>
                    <TableCell className={cn("font-mono tabular-nums", (port.temperature ?? 0) > 70 ? "text-crit" : (port.temperature ?? 0) > 60 ? "text-warn" : "")}>
                      {port.temperature != null ? `${port.temperature.toFixed(0)}°C` : "—"}
                    </TableCell>
                    <TableCell className={cn("font-mono tabular-nums", port.totalErrors > 0 ? "text-crit font-bold" : "text-muted-foreground")}>{port.totalErrors}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground truncate max-w-[140px]">{port.transceiverType ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </CardContent>
    </PanelCard>
  );
}

// ===========================================================================
// FOOTER
// ===========================================================================

function Footer({ polledAt }: { polledAt?: string }) {
  return (
    <footer className="border-t border-border/60 bg-panel/80 backdrop-blur sticky bottom-0 z-30">
      <div className="max-w-[1800px] mx-auto px-3 sm:px-4 lg:px-6 h-10 flex items-center justify-center text-[10px] sm:text-xs text-muted-foreground gap-2 flex-wrap">
        <span className="size-1.5 rounded-full bg-primary shrink-0" />
        <span className="truncate">NETPULSE · ISP Network Monitoring Tool - A Creation by JJ</span>
        <span className="hidden sm:inline">·</span>
        <span className="hidden sm:inline">{POLL_INTERVAL_LABEL}</span>
        <span>·</span>
        <span>{AUTO_REFRESH_LABEL}</span>
        <span>·</span>
        <span>Last poll <span className="text-foreground font-mono">{polledAt ? fmtTime(polledAt) : "—"}</span></span>
      </div>
    </footer>
  );
}

// ===========================================================================
// SETTINGS GATE DIALOG (password)
// ===========================================================================

function SettingsGateDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUnlock: () => void;
}) {
  const { open, onOpenChange, onUnlock } = props;
  const [pwd, setPwd] = React.useState("");
  const [attempts, setAttempts] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      queueMicrotask(() => { setPwd(""); setAttempts(0); setError(null); });
    }
  }, [open]);

  function submit() {
    if (pwd === SETTINGS_PASSWORD) {
      setError(null);
      onUnlock();
    } else {
      const next = attempts + 1;
      setAttempts(next);
      setError(next >= 3 ? "Hint: the default password is shown below." : "Incorrect password. Try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Lock className="size-5" />
            </span>
            <div>
              <DialogTitle>Settings Locked</DialogTitle>
              <DialogDescription>Enter the password to manage switches, companies and rings.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="settings-pwd">Password</Label>
            <Input
              id="settings-pwd"
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Enter password…"
              autoFocus
            />
          </div>
          {error && (
            <div className="text-xs text-crit flex items-center gap-1.5">
              <CircleAlert className="size-3.5" /> {error}
            </div>
          )}
          {attempts >= 3 && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Info className="size-3.5" /> Default password: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{SETTINGS_PASSWORD}</code>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} className="gap-1.5">
            <Lock className="size-3.5" /> Unlock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// SETTINGS MENU DIALOG
// ===========================================================================

function SettingsMenuDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onManageCompanies: () => void;
  onAddSwitch: () => void;
}) {
  const { open, onOpenChange, onManageCompanies, onAddSwitch } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-ok/10 text-ok border border-ok/20">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription>Manage your monitored network.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3">
          <button
            onClick={onManageCompanies}
            className="flex items-center gap-3 p-4 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-accent/30 transition-colors text-left"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Building2 className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Companies & Branch Rings</div>
              <div className="text-xs text-muted-foreground">Create companies, branch rings, manage assignments.</div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground ml-auto shrink-0" />
          </button>

          <button
            onClick={onAddSwitch}
            className="flex items-center gap-3 p-4 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-accent/30 transition-colors text-left"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Plus className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Add Switch</div>
              <div className="text-xs text-muted-foreground">Register a new Cisco switch with SNMP credentials.</div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground ml-auto shrink-0" />
          </button>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// DESTRUCTIVE GATE DIALOG
// ===========================================================================

interface DestructiveGateProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

function DestructiveGateDialog(props: DestructiveGateProps) {
  const { open, onOpenChange, title, description, confirmLabel, onConfirm } = props;
  const [pwd, setPwd] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) queueMicrotask(() => { setPwd(""); setError(null); });
  }, [open]);

  function submit() {
    if (pwd === SETTINGS_PASSWORD) {
      setError(null);
      onConfirm();
      onOpenChange(false);
    } else {
      setError("Incorrect password.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-warn/10 text-warn border border-warn/30">
              <ShieldAlert className="size-5" />
            </span>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-warn/30 bg-warn/5 p-3 text-xs text-warn flex items-start gap-2">
            <ShieldAlert className="size-3.5 mt-0.5 shrink-0" />
            <span>This action modifies or removes monitored infrastructure. Confirm with the settings password to proceed.</span>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="destructive-pwd">Password</Label>
            <Input
              id="destructive-pwd"
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Enter password…"
              autoFocus
            />
          </div>
          {error && (
            <div className="text-xs text-crit flex items-center gap-1.5">
              <CircleAlert className="size-3.5" /> {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={submit} className="gap-1.5">
            <ShieldAlert className="size-3.5" /> {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// MANAGE COMPANIES DIALOG
// ===========================================================================

function ManageCompaniesDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companies: CompanyRow[];
  loading: boolean;
  onAddSwitch: () => void;
}) {
  const { open, onOpenChange, companies, loading, onAddSwitch } = props;
  const queryClient = useQueryClient();
  const [newCompany, setNewCompany] = React.useState("");
  const [newCompanyDesc, setNewCompanyDesc] = React.useState("");
  const [ringForms, setRingForms] = React.useState<Record<string, { name: string; label: string; location: string }>>({});
  const [gate, setGate] = React.useState<{ kind: "company" | "ring"; id: string; name: string } | null>(null);

  const createCompanyMut = useMutation({
    mutationFn: async (body: { name: string; description?: string }) => {
      const r = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Company created");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["companies"] });
        queryClient.invalidateQueries({ queryKey: ["rings"] });
      });
      setNewCompany(""); setNewCompanyDesc("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createRingMut = useMutation({
    mutationFn: async (body: { name: string; label?: string; location?: string; companyId: string }) => {
      const r = await fetch("/api/rings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Branch ring created");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["rings"] });
        queryClient.invalidateQueries({ queryKey: ["companies"] });
      });
      setRingForms({});
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCompanyMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/companies/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete company");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Company deleted");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["companies"] });
        queryClient.invalidateQueries({ queryKey: ["rings"] });
        queryClient.invalidateQueries({ queryKey: ["switches"] });
        queryClient.invalidateQueries({ queryKey: ["metrics"] });
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRingMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/rings/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete ring");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Branch ring deleted");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["rings"] });
        queryClient.invalidateQueries({ queryKey: ["companies"] });
        queryClient.invalidateQueries({ queryKey: ["switches"] });
        queryClient.invalidateQueries({ queryKey: ["metrics"] });
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function getRingForm(companyId: string) {
    return ringForms[companyId] ?? { name: "", label: "", location: "" };
  }
  function setRingForm(companyId: string, patch: Partial<{ name: string; label: string; location: string }>) {
    setRingForms(prev => ({ ...prev, [companyId]: { ...getRingForm(companyId), ...patch } }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Building2 className="size-5" />
            </span>
            <div>
              <DialogTitle>Companies & Branch Rings</DialogTitle>
              <DialogDescription>Create ISP customers and their branch rings.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-4 -mr-1">
          {/* Create company */}
          <div className="rounded-lg border border-border/60 p-3 bg-muted/10">
            <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Plus className="size-3.5 text-primary" /> New Company
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input placeholder="Company name" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} />
              <Input placeholder="Description (optional)" value={newCompanyDesc} onChange={(e) => setNewCompanyDesc(e.target.value)} />
              <Button
                onClick={() => { if (newCompany.trim()) createCompanyMut.mutate({ name: newCompany.trim(), description: newCompanyDesc.trim() || undefined }); }}
                disabled={!newCompany.trim() || createCompanyMut.isPending}
                className="gap-1.5"
              >
                <Plus className="size-3.5" /> Add Company
              </Button>
            </div>
          </div>

          {/* List companies */}
          {loading ? (
            <div className="space-y-2">
              {[0, 1].map(i => <div key={i} className="h-20 rounded-lg bg-muted/40 animate-pulse" />)}
            </div>
          ) : companies.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No companies yet. Create one above.</div>
          ) : (
            <div className="space-y-3">
              {companies.map((c) => (
                <div key={c.id} className="rounded-lg border border-border/60 overflow-hidden">
                  <div className="flex items-center justify-between p-3 bg-muted/20 border-b border-border/40">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="size-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{c.name}</div>
                        {c.description && <div className="text-xs text-muted-foreground truncate">{c.description}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px]">{c.rings.length} ring{c.rings.length !== 1 ? "s" : ""}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-crit hover:text-crit gap-1"
                        onClick={() => setGate({ kind: "company", id: c.id, name: c.name })}
                      >
                        <Trash2 className="size-3" /> Delete
                      </Button>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {/* rings list */}
                    {c.rings.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-1">No branch rings yet.</div>
                    ) : (
                      <div className="space-y-1">
                        {c.rings.map((r) => (
                          <div key={r.id} className="flex items-center gap-2 p-2 rounded-md border border-border/40 bg-muted/10">
                            <FolderTree className="size-3.5 text-primary shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate">{r.label ?? r.name}</div>
                              <div className="text-[10px] text-muted-foreground font-mono truncate">{r.name}{r.location ? ` · ${r.location}` : ""}</div>
                            </div>
                            <Badge variant="outline" className="text-[9px]">{r._count.switches} sw</Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs text-crit hover:text-crit gap-1 px-1.5"
                              onClick={() => setGate({ kind: "ring", id: r.id, name: r.label ?? r.name })}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* create ring */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-1.5 mt-2 pt-2 border-t border-border/30">
                      <Input placeholder="Ring name (id)" className="h-8 text-xs" value={getRingForm(c.id).name} onChange={(e) => setRingForm(c.id, { name: e.target.value })} />
                      <Input placeholder="Label" className="h-8 text-xs" value={getRingForm(c.id).label} onChange={(e) => setRingForm(c.id, { label: e.target.value })} />
                      <Input placeholder="Location" className="h-8 text-xs" value={getRingForm(c.id).location} onChange={(e) => setRingForm(c.id, { location: e.target.value })} />
                      <Button
                        size="sm"
                        className="h-8 text-xs gap-1"
                        disabled={!getRingForm(c.id).name.trim() || createRingMut.isPending}
                        onClick={() => {
                          const f = getRingForm(c.id);
                          if (f.name.trim()) createRingMut.mutate({ name: f.name.trim(), label: f.label.trim() || undefined, location: f.location.trim() || undefined, companyId: c.id });
                        }}
                      >
                        <Plus className="size-3" /> Add Ring
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button onClick={onAddSwitch} className="gap-1.5">
            <Plus className="size-3.5" />
            Add Switch
          </Button>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>

      <DestructiveGateDialog
        open={!!gate}
        onOpenChange={(o) => { if (!o) setGate(null); }}
        title={gate?.kind === "company" ? "Delete Company" : "Delete Branch Ring"}
        description={gate?.kind === "company"
          ? `This will permanently delete “${gate?.name ?? ""}” and all its branch rings. Switches will be unassigned.`
          : `This will permanently delete the branch ring “${gate?.name ?? ""}”. Switches in this ring will be unassigned.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (!gate) return;
          if (gate.kind === "company") deleteCompanyMut.mutate(gate.id);
          else deleteRingMut.mutate(gate.id);
        }}
      />
    </Dialog>
  );
}

// ===========================================================================
// SWITCH FORM DIALOG (add / edit)
// ===========================================================================

function SwitchFormDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companies: CompanyRow[];
  rings: RingRow[];
  switches: SwitchRow[];
  editing: SwitchRow | null;
  onSaved: () => void;
}) {
  const { open, onOpenChange, companies, rings, switches, editing, onSaved } = props;
  const queryClient = useQueryClient();

  const [name, setName] = React.useState("");
  const [ipAddress, setIpAddress] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [snmpVersion, setSnmpVersion] = React.useState(2);
  const [community, setCommunity] = React.useState("public");
  const [snmpPort, setSnmpPort] = React.useState(161);
  const [v3SecurityLevel, setV3SecurityLevel] = React.useState("authPriv");
  const [v3Username, setV3Username] = React.useState("");
  const [v3AuthProtocol, setV3AuthProtocol] = React.useState("SHA");
  const [v3AuthPassword, setV3AuthPassword] = React.useState("");
  const [v3PrivProtocol, setV3PrivProtocol] = React.useState("AES");
  const [v3PrivPassword, setV3PrivPassword] = React.useState("");
  const [companyId, setCompanyId] = React.useState<string>("");
  const [ringId, setRingId] = React.useState<string>("");
  const [nextSwitchId, setNextSwitchId] = React.useState<string>("");

  // inline create state
  const [inlineCompany, setInlineCompany] = React.useState("");
  const [inlineRing, setInlineRing] = React.useState("");
  const [inlineRingLabel, setInlineRingLabel] = React.useState("");
  const [showInlineCompany, setShowInlineCompany] = React.useState(false);
  const [showInlineRing, setShowInlineRing] = React.useState(false);

  const [gate, setGate] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      queueMicrotask(() => {
        setName(editing.name);
        setIpAddress(editing.ipAddress);
        setLocation(editing.location ?? "");
        setSnmpVersion(editing.snmpVersion);
        setCommunity(editing.community ?? "public");
        setSnmpPort(editing.snmpPort ?? 161);
        setV3SecurityLevel(editing.v3SecurityLevel ?? "authPriv");
        setV3Username(editing.v3Username ?? "");
        setV3AuthProtocol(editing.v3AuthProtocol ?? "SHA");
        setV3AuthPassword(editing.v3AuthPassword ?? "");
        setV3PrivProtocol(editing.v3PrivProtocol ?? "AES");
        setV3PrivPassword(editing.v3PrivPassword ?? "");
        setCompanyId(editing.ring?.company?.id ?? "");
        setRingId(editing.ringId ?? "");
        setNextSwitchId(editing.nextSwitchId ?? "");
        setShowInlineCompany(false); setShowInlineRing(false);
      });
    } else {
      queueMicrotask(() => {
        setName(""); setIpAddress(""); setLocation(""); setSnmpVersion(2);
        setCommunity("public"); setSnmpPort(161); setV3SecurityLevel("authPriv");
        setV3Username(""); setV3AuthProtocol("SHA"); setV3AuthPassword("");
        setV3PrivProtocol("AES"); setV3PrivPassword("");
        setCompanyId(""); setRingId(""); setNextSwitchId("");
        setShowInlineCompany(false); setShowInlineRing(false);
      });
    }
  }, [open, editing]);

  // reset ring when company changes
  React.useEffect(() => {
    if (!open) return;
    if (companyId && ringId) {
      const ringBelongsToCompany = rings.find(r => r.id === ringId)?.companyId === companyId;
      if (!ringBelongsToCompany) queueMicrotask(() => setRingId(""));
    }
  }, [companyId, ringId, rings, open]);

  const availableRings = rings.filter(r => !companyId || r.companyId === companyId);
  const availableNextSwitches = switches.filter(s =>
    s.id !== editing?.id &&
    (!ringId || s.ringId === ringId)
  );

  const createCompanyMut = useMutation({
    mutationFn: async (body: { name: string }) => {
      const r = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: (data) => {
      toast.success("Company created");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["companies"] });
        setCompanyId(data.id);
        setShowInlineCompany(false); setInlineCompany("");
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createRingMut = useMutation({
    mutationFn: async (body: { name: string; label?: string; companyId: string }) => {
      const r = await fetch("/api/rings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: (data) => {
      toast.success("Branch ring created");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["rings"] });
        setRingId(data.id);
        setShowInlineRing(false); setInlineRing(""); setInlineRingLabel("");
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMut = useMutation({
    mutationFn: async (body: any) => {
      const url = editing ? `/api/switches/${editing.id}` : "/api/switches";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      toast.success(editing ? "Switch updated" : "Switch added");
      queueMicrotask(() => { onSaved(); onOpenChange(false); });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function buildPayload() {
    return {
      name: name.trim(),
      ipAddress: ipAddress.trim(),
      location: location.trim() || null,
      snmpVersion,
      community: snmpVersion === 3 ? null : community,
      snmpPort,
      v3SecurityLevel: snmpVersion === 3 ? v3SecurityLevel : null,
      v3Username: snmpVersion === 3 ? v3Username : null,
      v3AuthProtocol: snmpVersion === 3 ? v3AuthProtocol : null,
      v3AuthPassword: snmpVersion === 3 ? v3AuthPassword : null,
      v3PrivProtocol: snmpVersion === 3 ? v3PrivProtocol : null,
      v3PrivPassword: snmpVersion === 3 ? v3PrivPassword : null,
      ringId: ringId || null,
      nextSwitchId: nextSwitchId || null,
    };
  }

  function handleSubmit() {
    if (!name.trim() || !ipAddress.trim()) {
      toast.error("Name and IP address are required");
      return;
    }
    if (editing) {
      // editing requires destructive gate
      setGate(true);
    } else {
      saveMut.mutate(buildPayload());
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Plus className="size-5" />
            </span>
            <div>
              <DialogTitle>{editing ? "Edit Switch" : "Add Switch"}</DialogTitle>
              <DialogDescription>Register a Cisco managed switch for SNMP polling.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 -mr-1 space-y-4">
          {/* Basic */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Switch Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mum-Core-01" />
            </div>
            <div className="space-y-1.5">
              <Label>IP Address *</Label>
              <Input value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} placeholder="10.10.1.11" className="font-mono" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Mumbai DC - Rack A1" />
            </div>
          </div>

          {/* Company / Ring */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company & Branch Ring</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Company</Label>
                  <button onClick={() => setShowInlineCompany(v => !v)} className="text-[10px] text-primary hover:underline">
                    {showInlineCompany ? "Cancel" : "+ New"}
                  </button>
                </div>
                {showInlineCompany ? (
                  <div className="flex gap-1.5">
                    <Input value={inlineCompany} onChange={(e) => setInlineCompany(e.target.value)} placeholder="Company name" className="h-8 text-xs" />
                    <Button size="sm" className="h-8 text-xs gap-1" disabled={!inlineCompany.trim() || createCompanyMut.isPending} onClick={() => createCompanyMut.mutate({ name: inlineCompany.trim() })}>
                      <Plus className="size-3" />
                    </Button>
                  </div>
                ) : (
                  <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setRingId(""); setNextSwitchId(""); }}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Branch Ring</Label>
                  <button
                    onClick={() => setShowInlineRing(v => !v)}
                    className={cn("text-[10px] text-primary hover:underline", !companyId && "pointer-events-none opacity-40")}
                  >
                    {showInlineRing ? "Cancel" : "+ New"}
                  </button>
                </div>
                {showInlineRing ? (
                  <div className="space-y-1.5">
                    <Input value={inlineRing} onChange={(e) => setInlineRing(e.target.value)} placeholder="Ring name (id)" className="h-8 text-xs" />
                    <Input value={inlineRingLabel} onChange={(e) => setInlineRingLabel(e.target.value)} placeholder="Label (optional)" className="h-8 text-xs" />
                    <Button size="sm" className="h-8 text-xs gap-1 w-full" disabled={!inlineRing.trim() || !companyId || createRingMut.isPending} onClick={() => createRingMut.mutate({ name: inlineRing.trim(), label: inlineRingLabel.trim() || undefined, companyId })}>
                      <Plus className="size-3" /> Create Ring
                    </Button>
                  </div>
                ) : (
                  <Select value={ringId} onValueChange={(v) => { setRingId(v); setNextSwitchId(""); }} disabled={!companyId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={companyId ? "Select ring" : "Select company first"} /></SelectTrigger>
                    <SelectContent>
                      {availableRings.map(r => <SelectItem key={r.id} value={r.id}>{r.label ?? r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>

          {/* SNMP version tabs */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SNMP Configuration</div>
            <Tabs value={String(snmpVersion)} onValueChange={(v) => setSnmpVersion(Number(v))}>
              <TabsList className="h-8">
                <TabsTrigger value="1" className="text-xs px-3 h-6">v1</TabsTrigger>
                <TabsTrigger value="2" className="text-xs px-3 h-6">v2c</TabsTrigger>
                <TabsTrigger value="3" className="text-xs px-3 h-6">v3</TabsTrigger>
              </TabsList>
              <TabsContent value="1" className="mt-2">
                <SnmpV1V2Fields community={community} setCommunity={setCommunity} snmpPort={snmpPort} setSnmpPort={setSnmpPort} />
              </TabsContent>
              <TabsContent value="2" className="mt-2">
                <SnmpV1V2Fields community={community} setCommunity={setCommunity} snmpPort={snmpPort} setSnmpPort={setSnmpPort} />
              </TabsContent>
              <TabsContent value="3" className="mt-2 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Security Level</Label>
                    <Select value={v3SecurityLevel} onValueChange={setV3SecurityLevel}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="noAuthNoPriv">noAuthNoPriv</SelectItem>
                        <SelectItem value="authNoPriv">authNoPriv</SelectItem>
                        <SelectItem value="authPriv">authPriv</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Username</Label>
                    <Input value={v3Username} onChange={(e) => setV3Username(e.target.value)} placeholder="nocadmin" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Auth Protocol</Label>
                    <Select value={v3AuthProtocol} onValueChange={setV3AuthProtocol} disabled={v3SecurityLevel === "noAuthNoPriv"}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SHA">SHA</SelectItem>
                        <SelectItem value="MD5">MD5</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Auth Password</Label>
                    <Input type="password" value={v3AuthPassword} onChange={(e) => setV3AuthPassword(e.target.value)} disabled={v3SecurityLevel === "noAuthNoPriv"} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Priv Protocol</Label>
                    <Select value={v3PrivProtocol} onValueChange={setV3PrivProtocol} disabled={v3SecurityLevel !== "authPriv"}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AES">AES</SelectItem>
                        <SelectItem value="DES">DES</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Priv Password</Label>
                    <Input type="password" value={v3PrivPassword} onChange={(e) => setV3PrivPassword(e.target.value)} disabled={v3SecurityLevel !== "authPriv"} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>SNMP Port</Label>
                    <Input type="number" value={snmpPort} onChange={(e) => setSnmpPort(Number(e.target.value) || 161)} className="w-32" />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Next switch */}
          <div className="space-y-1.5">
            <Label>Next Switch in Ring</Label>
            <Select value={nextSwitchId} onValueChange={setNextSwitchId} disabled={!ringId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={ringId ? "Select next switch (optional)" : "Select ring first"} /></SelectTrigger>
              <SelectContent>
                {availableNextSwitches.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.ipAddress})</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">Defines the ring direction. The selected switch becomes the next hop in this ring.</p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={saveMut.isPending} className="gap-1.5">
            {editing ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
            {editing ? "Save Changes" : "Add Switch"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <DestructiveGateDialog
        open={gate}
        onOpenChange={setGate}
        title="Edit Switch"
        description={`Confirm changes to “${name}” with the settings password.`}
        confirmLabel="Save Changes"
        onConfirm={() => saveMut.mutate(buildPayload())}
      />
    </Dialog>
  );
}

function SnmpV1V2Fields({ community, setCommunity, snmpPort, setSnmpPort }: {
  community: string; setCommunity: (v: string) => void;
  snmpPort: number; setSnmpPort: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label>Community</Label>
        <Input value={community} onChange={(e) => setCommunity(e.target.value)} placeholder="public" />
      </div>
      <div className="space-y-1.5">
        <Label>SNMP Port</Label>
        <Input type="number" value={snmpPort} onChange={(e) => setSnmpPort(Number(e.target.value) || 161)} className="w-32" />
      </div>
    </div>
  );
}

// ===========================================================================
// SWITCH DETAIL DIALOG
// ===========================================================================

function SwitchDetailDialog(props: {
  sw: SwitchSnapshot | null;
  onOpenChange: (o: boolean) => void;
  onSwitchClick: (id: string) => void;
  onEdit: (row: SwitchRow) => void;
}) {
  const { sw, onOpenChange, onSwitchClick, onEdit } = props;
  const queryClient = useQueryClient();
  const [deleteGate, setDeleteGate] = React.useState(false);
  const [editingRow, setEditingRow] = React.useState<SwitchRow | null>(null);

  // Fetch full switch row (for edit)
  const detailRowQ = useQuery<SwitchRow>({
    queryKey: ["switch", sw?.switchId],
    queryFn: async () => {
      const r = await fetch(`/api/switches/${sw!.switchId}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!sw,
  });

  // Alerts for this switch
  const switchAlerts = useQuery<AlertRow[]>({
    queryKey: ["switch-alerts", sw?.switchId],
    queryFn: async () => {
      const r = await fetch(`/api/alerts?limit=50`, { cache: "no-store" });
      if (!r.ok) throw new Error("Failed");
      const all: AlertRow[] = await r.json();
      return all.filter(a => a.switchId === sw!.switchId);
    },
    enabled: !!sw,
    refetchInterval: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/switches/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete switch");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Switch deleted");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["switches"] });
        queryClient.invalidateQueries({ queryKey: ["metrics"] });
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
      });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Walk ring
  const ringWalk = React.useMemo(() => {
    if (!sw) return [];
    // We need access to all switches in the same ring — but we only have this snapshot.
    // The dialog receives sw which has nextSwitchId/prevSwitchId, but to walk the ring
    // we'd need the full list. For simplicity, we'll show prev/next chips from the sw fields.
    return [sw];
  }, [sw]);

  if (!sw) return null;

  const sfpPorts = sw.ports.filter(p => p.txPower != null || p.rxPower != null || p.temperature != null || p.isRingPort);
  const otherPorts = sw.ports.filter(p => !sfpPorts.includes(p));
  const neighbors = sw.neighbors ?? [];
  const alerts = switchAlerts.data ?? [];

  return (
    <Dialog open={!!sw} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className={cn("size-10 rounded-lg flex items-center justify-center border shrink-0", statusDot(sw.status), "border-border/40 bg-muted/30")}>
                <Server className={cn("size-5", statusColor(sw.status))} />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate">{sw.name}</DialogTitle>
                <DialogDescription className="font-mono">{sw.ipAddress}{sw.location ? ` · ${sw.location}` : ""}</DialogDescription>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Badge variant="outline" className={cn("text-[10px]", severityBg(sw.status === "up" ? "info" : "critical"))}>{sw.status}</Badge>
                  <Badge variant="outline" className="text-[10px]">{sw.mode}</Badge>
                  <Badge variant="outline" className="text-[10px]">SNMP {snmpVersionLabel(sw.snmpVersion)}</Badge>
                  {sw.ringLabel && <Badge variant="outline" className="text-[10px]">{sw.ringLabel}</Badge>}
                  {sw.companyName && <Badge variant="outline" className="text-[10px]">{sw.companyName}</Badge>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {detailRowQ.data && (
                <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => { setEditingRow(detailRowQ.data); onEdit(detailRowQ.data); }}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              )}
              {detailRowQ.data && (
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-crit hover:text-crit" onClick={() => setDeleteGate(true)}>
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 -mr-1 space-y-4">
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <DetailKpi label="Ring In" value={fmtMbps(sw.ringInMbps ?? null)} icon={<ArrowRight className="size-3.5" />} color="text-primary" />
            <DetailKpi label="Ring Out" value={fmtMbps(sw.ringOutMbps ?? null)} icon={<ArrowRight className="size-3.5 rotate-180" />} color="text-primary" />
            <DetailKpi label="CPU" value={sw.cpuUsage != null ? `${sw.cpuUsage.toFixed(1)}%` : "—"} icon={<Cpu className="size-3.5" />} color={sw.cpuUsage != null && sw.cpuUsage > 80 ? "text-crit" : "text-ok"} />
            <DetailKpi label="Memory" value={sw.memoryUsage != null ? `${sw.memoryUsage.toFixed(1)}%` : "—"} icon={<MemoryStick className="size-3.5" />} color={sw.memoryUsage != null && sw.memoryUsage > 85 ? "text-crit" : "text-ok"} />
          </div>

          {/* Ring Position */}
          <DetailCard title="Ring Position" icon={<Network className="size-4" />}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-muted-foreground">Position in ring:</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {sw.prevSwitchId && (
                    <button
                      onClick={() => onSwitchClick(sw.prevSwitchId)}
                      className="px-2 py-1 rounded-md border border-border/60 hover:border-primary/40 hover:bg-accent/30 transition-colors flex items-center gap-1"
                    >
                      <ArrowLeft className="size-3 text-muted-foreground" />
                      <span className="font-medium">{sw.prevSwitchId}</span>
                    </button>
                  )}
                  <span className="px-2.5 py-1 rounded-md border border-primary/40 bg-primary/10 text-primary font-semibold">
                    {sw.name}
                  </span>
                  {sw.nextSwitchId && sw.nextSwitchName && (
                    <button
                      onClick={() => onSwitchClick(sw.nextSwitchId)}
                      className="px-2 py-1 rounded-md border border-border/60 hover:border-primary/40 hover:bg-accent/30 transition-colors flex items-center gap-1"
                    >
                      <span className="font-medium">{sw.nextSwitchName}</span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                    </button>
                  )}
                  {!sw.nextSwitchId && !sw.prevSwitchId && (
                    <span className="text-muted-foreground">Not part of a ring.</span>
                  )}
                </div>
              </div>
              {sw.ringPortAutoDetected && (
                <div className="text-[10px] text-ok flex items-center gap-1.5">
                  <CircleCheck className="size-3" /> Ring port auto-detected via CDP/LLDP
                </div>
              )}
              {sw.suggestedNextSwitchId && !sw.nextSwitchId && (
                <div className="rounded-md border border-warn/30 bg-warn/5 p-2 text-xs">
                  <div className="flex items-center gap-1.5 text-warn font-medium mb-0.5">
                    <CircleAlert className="size-3.5" /> Suggested next switch
                  </div>
                  <div className="text-muted-foreground">{sw.suggestedNextSwitchReason}</div>
                  {sw.suggestedNextSwitchName && (
                    <button onClick={() => onSwitchClick(sw.suggestedNextSwitchId!)} className="mt-1 text-primary hover:underline">
                      → {sw.suggestedNextSwitchName}
                    </button>
                  )}
                </div>
              )}
            </div>
          </DetailCard>

          {/* Ring Port card */}
          {sw.ringPort && (
            <DetailCard title="Ring Port" icon={<Cable className="size-4" />}>
              <RingPortCard port={sw.ringPort} />
            </DetailCard>
          )}

          {/* Discovered Neighbors */}
          <DetailCard title="Discovered Neighbors (CDP / LLDP)" icon={<RadioTower className="size-4" />}>
            {neighbors.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">No CDP/LLDP neighbors discovered.</div>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="text-xs">Local Port</TableHead>
                      <TableHead className="text-xs">Device ID</TableHead>
                      <TableHead className="text-xs">Port</TableHead>
                      <TableHead className="text-xs">Address</TableHead>
                      <TableHead className="text-xs">Protocol</TableHead>
                      <TableHead className="text-xs">Matched Switch</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {neighbors.map((n, i) => (
                      <TableRow key={i} className="text-xs">
                        <TableCell className="font-mono">{n.localIfName ?? n.localIfIndex}</TableCell>
                        <TableCell className="font-mono truncate max-w-[160px]">{n.deviceId}</TableCell>
                        <TableCell className="font-mono">{n.devicePort}</TableCell>
                        <TableCell className="font-mono">{n.address ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[9px] uppercase">{n.protocol}</Badge></TableCell>
                        <TableCell>
                          {n.matchedSwitchId ? (
                            <button onClick={() => onSwitchClick(n.matchedSwitchId)} className="text-primary hover:underline font-medium flex items-center gap-1">
                              <Link2 className="size-3" /> {n.matchedSwitchName}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </DetailCard>

          {/* SNMP Configuration */}
          <DetailCard title="SNMP Configuration" icon={<Cog className="size-4" />}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <DetailField label="Version" value={snmpVersionLabel(sw.snmpVersion)} />
              <DetailField label="Mode" value={sw.mode} />
              <DetailField label="Error" value={sw.error ?? "none"} />
              <DetailField label="Last Seen" value={timeAgo(sw.lastSeen)} />
            </div>
            {detailRowQ.data && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {detailRowQ.data.snmpVersion !== 3 && (
                  <DetailField label="Community" value={detailRowQ.data.community ?? "—"} />
                )}
                <DetailField label="Port" value={String(detailRowQ.data.snmpPort)} />
                {detailRowQ.data.snmpVersion === 3 && (
                  <>
                    <DetailField label="Security Level" value={detailRowQ.data.v3SecurityLevel ?? "—"} />
                    <DetailField label="Username" value={detailRowQ.data.v3Username ?? "—"} />
                    <DetailField label="Auth Protocol" value={detailRowQ.data.v3AuthProtocol ?? "—"} />
                    <DetailField label="Priv Protocol" value={detailRowQ.data.v3PrivProtocol ?? "—"} />
                  </>
                )}
              </div>
            )}
          </DetailCard>

          {/* System Info */}
          <DetailCard title="System Info" icon={<Info className="size-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <DetailField label="sysName" value={sw.sysName ?? "—"} mono />
              <DetailField label="Uptime" value={fmtUptime(sw.uptimeSeconds)} mono />
              <DetailField label="Memory Used / Total" value={sw.memoryUsed != null && sw.memoryTotal != null ? `${sw.memoryUsed} / ${sw.memoryTotal} MB` : "—"} mono />
              <DetailField label="Ports Up / Down" value={`${sw.portsUp} / ${sw.portsDown}`} mono />
              <div className="sm:col-span-2">
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">sysDescr</div>
                <div className="font-mono text-[11px] text-muted-foreground bg-muted/30 rounded-md p-2 border border-border/40 max-h-24 overflow-y-auto">{sw.sysDescr ?? "—"}</div>
              </div>
            </div>
          </DetailCard>

          {/* Active Alerts */}
          <DetailCard title="Active Alerts" icon={<Siren className="size-4" />} action={<Badge variant="outline" className="text-[10px]">{alerts.length}</Badge>}>
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-ok py-2">
                <CircleCheck className="size-4" /> No active alerts for this switch.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {alerts.slice(0, 10).map(a => (
                  <div key={a.id} className={cn("rounded-md border p-2 flex items-start gap-2", severityBg(a.severity))}>
                    {a.severity === "critical" ? <CircleX className="size-3.5 mt-0.5 shrink-0" /> : a.severity === "warning" ? <CircleAlert className="size-3.5 mt-0.5 shrink-0" /> : <Info className="size-3.5 mt-0.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium">{a.message}</div>
                      <div className="text-[10px] opacity-80">{timeAgo(a.timestamp)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DetailCard>

          {/* SFP / Fiber Ports table */}
          <DetailCard title="SFP / Fiber Ports" icon={<Signal className="size-4" />} action={<Badge variant="outline" className="text-[10px]">{sfpPorts.length}</Badge>}>
            {sfpPorts.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">No SFP/fiber ports with DOM readings.</div>
            ) : (
              <PortTable ports={sfpPorts} />
            )}
          </DetailCard>

          {/* Other Interfaces table */}
          <DetailCard title="Other Interfaces" icon={<LayoutGrid className="size-4" />} action={<Badge variant="outline" className="text-[10px]">{otherPorts.length}</Badge>}>
            {otherPorts.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">No other interfaces.</div>
            ) : (
              <PortTable ports={otherPorts} />
            )}
          </DetailCard>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="destructive"
            onClick={() => setDeleteGate(true)}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" />
            Delete Switch
          </Button>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>

      <DestructiveGateDialog
        open={deleteGate}
        onOpenChange={setDeleteGate}
        title="Delete Switch"
        description={`This will permanently delete “${sw.name}” and all its ports, metrics and alerts.`}
        confirmLabel="Delete Switch"
        onConfirm={() => deleteMut.mutate(sw.switchId)}
      />
    </Dialog>
  );
}

function DetailKpi({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={color}>{icon}</span>
      </div>
      <div className={cn("text-lg font-bold tabular-nums", color)}>{value}</div>
    </div>
  );
}

function DetailCard({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-3 bg-muted/20 border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">{label}</div>
      <div className={cn("text-xs font-medium truncate", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function RingPortCard({ port }: { port: PortSnapshot }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <DetailField label="Tx Power" value={fmtDbm(port.txPower)} mono />
        <DetailField label="Rx Power" value={fmtDbm(port.rxPower)} mono />
        <DetailField label="Optical Margin" value={port.opticalMargin != null ? `${port.opticalMargin.toFixed(2)} dB` : "—"} mono />
        <DetailField label="Utilization" value={port.utilization != null ? `${port.utilization.toFixed(1)}%` : "—"} mono />
        <DetailField label="Temperature" value={port.temperature != null ? `${port.temperature.toFixed(1)}°C` : "—"} mono />
        <DetailField label="Voltage" value={port.voltage != null ? `${port.voltage.toFixed(2)} V` : "—"} mono />
        <DetailField label="Bias Current" value={port.biasCurrent != null ? `${port.biasCurrent.toFixed(2)} mA` : "—"} mono />
        <DetailField label="Total Errors" value={String(port.totalErrors)} mono />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/40">
        <DetailField label="Ingress" value={fmtMbps(port.inMbps)} mono />
        <DetailField label="Egress" value={fmtMbps(port.outMbps)} mono />
        <DetailField label="Link Speed" value={port.ifHighSpeed ? `${port.ifHighSpeed} Mbps` : (port.ifSpeed ? `${Number(port.ifSpeed) / 1e9} Gbps` : "—")} mono />
        <DetailField label="Oper Status" value={port.ifOperStatus === 1 ? "up" : port.ifOperStatus === 2 ? "down" : "—"} mono />
        <DetailField label="Transceiver" value={port.transceiverType ?? "—"} />
        <DetailField label="Serial Number" value={port.serialNumber ?? "—"} mono />
        <DetailField label="Part Number" value={port.partNumber ?? "—"} mono />
        <DetailField label="Link Partner" value={port.remoteSwitchName ?? "—"} />
      </div>
      {port.totalErrors > 0 && (
        <div className="rounded-md border border-crit/30 bg-crit/5 p-2 text-xs text-crit flex items-center gap-1.5">
          <CircleAlert className="size-3.5" /> {port.totalErrors} interface errors detected on this port.
        </div>
      )}
    </div>
  );
}

function PortTable({ ports }: { ports: PortSnapshot[] }) {
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <ScrollArea className="max-h-72">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30 sticky top-0">
              <TableHead className="text-xs">Interface</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">In Mbps</TableHead>
              <TableHead className="text-xs">Out Mbps</TableHead>
              <TableHead className="text-xs">Util%</TableHead>
              <TableHead className="text-xs">Tx dBm</TableHead>
              <TableHead className="text-xs">Rx dBm</TableHead>
              <TableHead className="text-xs">Temp</TableHead>
              <TableHead className="text-xs">Errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ports.map(p => (
              <TableRow key={p.ifIndex} className="text-xs">
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono">{p.ifName}</span>
                    {p.isRingPort && <Badge className="text-[9px] px-1 py-0 h-3.5 bg-primary/15 text-primary border-primary/30">RING</Badge>}
                  </div>
                  {p.ifAlias && <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{p.ifAlias}</div>}
                </TableCell>
                <TableCell>
                  <span className={cn("font-medium", p.ifOperStatus === 1 ? "text-ok" : p.ifOperStatus === 2 ? "text-crit" : "text-muted-foreground")}>
                    {p.ifOperStatus === 1 ? "up" : p.ifOperStatus === 2 ? "down" : "—"}
                  </span>
                </TableCell>
                <TableCell className="font-mono tabular-nums text-primary">{fmtMbps(p.inMbps)}</TableCell>
                <TableCell className="font-mono tabular-nums text-primary">{fmtMbps(p.outMbps)}</TableCell>
                <TableCell className={cn("tabular-nums", (p.utilization ?? 0) > 85 ? "text-crit" : (p.utilization ?? 0) > 60 ? "text-warn" : "text-ok")}>
                  {p.utilization != null ? `${p.utilization.toFixed(1)}%` : "—"}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{fmtDbm(p.txPower)}</TableCell>
                <TableCell className={cn("font-mono tabular-nums", p.rxPower != null && p.rxAlarmLow != null && p.rxPower <= p.rxAlarmLow ? "text-crit" : p.opticalMargin != null && p.opticalMargin < 3 ? "text-warn" : "")}>
                  {fmtDbm(p.rxPower)}
                </TableCell>
                <TableCell className={cn("font-mono tabular-nums", (p.temperature ?? 0) > 70 ? "text-crit" : (p.temperature ?? 0) > 60 ? "text-warn" : "")}>
                  {p.temperature != null ? `${p.temperature.toFixed(0)}°C` : "—"}
                </TableCell>
                <TableCell className={cn("font-mono tabular-nums", p.totalErrors > 0 ? "text-crit font-bold" : "text-muted-foreground")}>{p.totalErrors}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

// ===========================================================================
// ALL ALERTS DIALOG
// ===========================================================================

function AllAlertsDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  alerts: AlertRow[];
  loading: boolean;
  onSwitchClick: (id: string) => void;
}) {
  const { open, onOpenChange, alerts, loading, onSwitchClick } = props;
  const queryClient = useQueryClient();
  const [sevFilter, setSevFilter] = React.useState<string>("all");
  const [catFilter, setCatFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<string>("active");
  const [switchFilter, setSwitchFilter] = React.useState<string>("all");
  const [search, setSearch] = React.useState("");

  const ackMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/alerts/${id}/ack`, { method: "POST" });
      if (!r.ok) throw new Error("Ack failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Alert acknowledged");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
        queryClient.invalidateQueries({ queryKey: ["alerts-all"] });
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/alerts/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Resolve failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Alert resolved");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
        queryClient.invalidateQueries({ queryKey: ["alerts-all"] });
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ackAllMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => fetch(`/api/alerts/${id}/ack`, { method: "POST" })));
    },
    onSuccess: () => {
      toast.success("All alerts acknowledged");
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
        queryClient.invalidateQueries({ queryKey: ["alerts-all"] });
      });
    },
    onError: () => toast.error("Failed to ack all"),
  });

  const categories = React.useMemo(() => {
    const s = new Set(alerts.map(a => a.category));
    return Array.from(s).sort();
  }, [alerts]);

  const switchIds = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const a of alerts) if (a.switchId && a.switch) m.set(a.switchId, a.switch.name);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [alerts]);

  const filtered = React.useMemo(() => {
    return alerts.filter(a => {
      if (sevFilter !== "all" && a.severity !== sevFilter) return false;
      if (catFilter !== "all" && a.category !== catFilter) return false;
      if (statusFilter === "active" && (a.acknowledged || a.resolved)) return false;
      if (statusFilter === "acked" && !a.acknowledged) return false;
      if (statusFilter === "resolved" && !a.resolved) return false;
      if (switchFilter !== "all" && a.switchId !== switchFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!a.message.toLowerCase().includes(q) && !(a.switch?.name ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [alerts, sevFilter, catFilter, statusFilter, switchFilter, search]);

  const quickFilters = [
    { label: "All", filter: { sev: "all", status: "active" } },
    { label: "Critical", filter: { sev: "critical", status: "active" } },
    { label: "Warnings", filter: { sev: "warning", status: "active" } },
    { label: "Unacked", filter: { sev: "all", status: "active" } },
    { label: "Resolved", filter: { sev: "all", status: "resolved" } },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Siren className="size-5" />
            </span>
            <div>
              <DialogTitle>All Alerts</DialogTitle>
              <DialogDescription>{alerts.length} total alerts · {filtered.length} matching filters</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Filters */}
        <div className="space-y-2">
          {/* Quick chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {quickFilters.map(q => (
              <button
                key={q.label}
                onClick={() => { setSevFilter(q.filter.sev); setStatusFilter(q.filter.status); }}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs border transition-colors",
                  sevFilter === q.filter.sev && statusFilter === q.filter.status
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 hover:bg-accent/30"
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
          {/* Filter row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Select value={sevFilter} onValueChange={setSevFilter}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active (unacked)</SelectItem>
                <SelectItem value="acked">Acknowledged</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={switchFilter} onValueChange={setSwitchFilter}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Switch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All switches</SelectItem>
                {switchIds.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{filtered.length} of {alerts.length} alerts</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={filtered.filter(a => !a.acknowledged && !a.resolved).length === 0 || ackAllMut.isPending}
              onClick={() => ackAllMut.mutate(filtered.filter(a => !a.acknowledged && !a.resolved).map(a => a.id))}
            >
              <ShieldCheck className="size-3" /> Ack All
            </Button>
          </div>
        </div>

        {/* Alerts list */}
        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-14 rounded-md bg-muted/40 animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">No alerts match the current filters.</div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map(a => (
                <AllAlertRow
                  key={a.id}
                  alert={a}
                  onAck={() => ackMut.mutate(a.id)}
                  onResolve={() => resolveMut.mutate(a.id)}
                  onSwitchClick={onSwitchClick}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllAlertRow({ alert, onAck, onResolve, onSwitchClick }: {
  alert: AlertRow;
  onAck: () => void;
  onResolve: () => void;
  onSwitchClick: (id: string) => void;
}) {
  const sevIcon = alert.severity === "critical" ? <CircleX className="size-3.5" />
    : alert.severity === "warning" ? <CircleAlert className="size-3.5" />
      : <Info className="size-3.5" />;
  return (
    <div className={cn(
      "rounded-md border p-2.5 flex items-start gap-2",
      alert.resolved ? "opacity-50 border-border/40 bg-muted/10" : severityBg(alert.severity)
    )}>
      <span className="mt-0.5 shrink-0">{sevIcon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium leading-snug">{alert.message}</div>
        <div className="flex items-center gap-2 mt-1 text-[10px] opacity-80 flex-wrap">
          {alert.switch && (
            <button onClick={() => onSwitchClick(alert.switchId!)} className="hover:underline font-medium">
              {alert.switch.name}
            </button>
          )}
          <span>·</span>
          <span className="uppercase">{alert.category}</span>
          <span>·</span>
          <span>{timeAgo(alert.timestamp)}</span>
          {alert.acknowledged && <Badge variant="outline" className="text-[9px] h-3.5 px-1">ACKED</Badge>}
          {alert.resolved && <Badge variant="outline" className="text-[9px] h-3.5 px-1">RESOLVED</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!alert.acknowledged && !alert.resolved && (
          <Button variant="ghost" size="sm" onClick={onAck} className="h-6 px-2 text-[10px]">Ack</Button>
        )}
        {!alert.resolved && (
          <Button variant="ghost" size="sm" onClick={onResolve} className="h-6 px-2 text-[10px]">Resolve</Button>
        )}
      </div>
    </div>
  );
}
