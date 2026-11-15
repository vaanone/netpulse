"use client";

/**
 * NETPULSE — Settings page
 *
 * Houses all dashboard preferences behind a password gate:
 *   • Automation (Auto Poll, Auto Refresh)
 *   • Dashboard section visibility (the four detail sections are hidden by
 *     default and can be enabled here)
 *   • Header buttons (Jump To, Poll Now)
 *   • Shortcuts to Manage Companies and Add Switch (which open on the home
 *     page via a ?action= query parameter)
 *
 * All toggles persist to localStorage using the same keys the home page reads,
 * so changes are reflected on `/` the moment you navigate back.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Building2, Plus, ShieldCheck, Lock, Settings as SettingsIcon,
  Cpu, RefreshCw, Crosshair, LayoutGrid, Eye, EyeOff, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  SETTINGS_PASSWORD, LS_KEYS, TOGGLE_SECTIONS, loadSectionVisibility,
  resolveSectionVisible, loadBoolSetting, saveBoolSetting,
} from "@/lib/settings";

export default function SettingsPage() {
  const router = useRouter();
  const [unlocked, setUnlocked] = React.useState(false);

  // Hydration-safe: start with defaults, load real values after mount.
  const [sectionVisibility, setSectionVisibility] = React.useState<Record<string, boolean>>({});
  const [autoPoll, setAutoPoll] = React.useState(true);
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const [showJumpTo, setShowJumpTo] = React.useState(true);
  const [showPollNow, setShowPollNow] = React.useState(true);

  React.useEffect(() => {
    setSectionVisibility(loadSectionVisibility());
    setAutoPoll(loadBoolSetting(LS_KEYS.autoPoll));
    setAutoRefresh(loadBoolSetting(LS_KEYS.autoRefresh));
    setShowJumpTo(loadBoolSetting(LS_KEYS.jumpTo));
    setShowPollNow(loadBoolSetting(LS_KEYS.pollNow));
  }, []);

  function toggleSection(id: string) {
    setSectionVisibility(prev => {
      const current = resolveSectionVisible(prev, id);
      const next = { ...prev, [id]: !current };
      try { localStorage.setItem(LS_KEYS.sectionVisibility, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function toggleAutoPoll() {
    setAutoPoll(prev => { const n = !prev; saveBoolSetting(LS_KEYS.autoPoll, n); return n; });
  }
  function toggleAutoRefresh() {
    setAutoRefresh(prev => { const n = !prev; saveBoolSetting(LS_KEYS.autoRefresh, n); return n; });
  }
  function toggleJumpTo() {
    setShowJumpTo(prev => { const n = !prev; saveBoolSetting(LS_KEYS.jumpTo, n); return n; });
  }
  function togglePollNow() {
    setShowPollNow(prev => { const n = !prev; saveBoolSetting(LS_KEYS.pollNow, n); return n; });
  }

  if (!unlocked) {
    return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div className="bg-grid min-h-screen flex flex-col text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-panel/95 backdrop-blur supports-[backdrop-filter]:bg-panel/80">
        <div className="max-w-[1100px] mx-auto px-3 sm:px-4 lg:px-6 h-14 sm:h-16 flex items-center gap-3">
          <Button variant="outline" size="icon" asChild className="size-9 shrink-0">
            <Link href="/" aria-label="Back to dashboard"><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="size-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              <SettingsIcon className="size-4 text-primary" />
            </span>
            <div className="min-w-0">
              <div className="font-bold text-base sm:text-lg tracking-wider leading-none">SETTINGS</div>
              <div className="text-[10px] sm:text-xs text-muted-foreground tracking-wide truncate">Dashboard preferences &amp; layout</div>
            </div>
          </div>
        </div>
      </header>

      <main className="px-3 sm:px-4 lg:px-6 py-5 sm:py-7 pb-20 space-y-5 max-w-[1100px] w-full mx-auto">
        {/* Hint */}
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
          <div>
            Toggle sections on or off here, then return to the dashboard to see the change. Ring Traffic, Switch Health, SFP DOM and All Interfaces are <span className="text-foreground font-medium">hidden by default</span> — enable them below when you need them.
          </div>
        </div>

        {/* Automation */}
        <SettingsCard title="Automation" icon={<RefreshCw className="size-4" />}>
          <ToggleRow
            label="Auto Poll"
            description="Automatically poll switches every 30 seconds"
            on={autoPoll}
            onToggle={toggleAutoPoll}
          />
          <ToggleRow
            label="Auto Refresh"
            description="Refresh dashboard data every 15 seconds"
            on={autoRefresh}
            onToggle={toggleAutoRefresh}
          />
        </SettingsCard>

        {/* Dashboard sections */}
        <SettingsCard title="Dashboard Sections" icon={<LayoutGrid className="size-4" />}>
          <div className="text-[11px] text-muted-foreground -mt-1 mb-1">
            Show or hide sections on the home page.
          </div>
          {TOGGLE_SECTIONS.map(s => {
            const on = resolveSectionVisible(sectionVisibility, s.id);
            const hiddenByDefault = !resolveSectionVisible({}, s.id);
            return (
              <ToggleRow
                key={s.id}
                label={
                  <span className="flex items-center gap-2">
                    {s.label}
                    {hiddenByDefault && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60">default off</span>
                    )}
                  </span>
                }
                description={s.description}
                on={on}
                onToggle={() => toggleSection(s.id)}
              />
            );
          })}
        </SettingsCard>

        {/* Header buttons */}
        <SettingsCard title="Header Buttons" icon={<Crosshair className="size-4" />}>
          <ToggleRow label="Jump To" description="Show the Jump To dropdown in the header" on={showJumpTo} onToggle={toggleJumpTo} />
          <ToggleRow label="Poll Now" description="Show the Poll Now button in the header" on={showPollNow} onToggle={togglePollNow} />
        </SettingsCard>

        {/* Network management shortcuts */}
        <SettingsCard title="Network Management" icon={<Building2 className="size-4" />}>
          <div className="text-[11px] text-muted-foreground -mt-1 mb-2">
            These open on the dashboard.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="default" className="gap-1.5" onClick={() => router.push("/?action=manage-companies")}>
              <Building2 className="size-4" /> Manage Companies
            </Button>
            <Button variant="default" className="gap-1.5" onClick={() => router.push("/?action=add-switch")}>
              <Plus className="size-4" /> Add Switch
            </Button>
            <Button variant="outline" className="gap-1.5" asChild>
              <Link href="/"><LayoutGrid className="size-4" /> Back to Dashboard</Link>
            </Button>
          </div>
        </SettingsCard>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1">
          <Lock className="size-3.5" />
          Settings are protected by the settings password.
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Password gate (full-page, not a dialog — this is a dedicated route)
// ---------------------------------------------------------------------------

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pwd, setPwd] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [attempts, setAttempts] = React.useState(0);
  const [showPwd, setShowPwd] = React.useState(false);

  function submit() {
    if (pwd === SETTINGS_PASSWORD) {
      setError(null);
      onUnlock();
    } else {
      const n = attempts + 1;
      setAttempts(n);
      setError(n >= 3 ? "Hint: the default password is shown below." : "Incorrect password. Try again.");
    }
  }

  return (
    <div className="bg-grid min-h-screen flex flex-col text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-panel/95 backdrop-blur supports-[backdrop-filter]:bg-panel/80">
        <div className="max-w-[1100px] mx-auto px-3 sm:px-4 lg:px-6 h-14 sm:h-16 flex items-center gap-3">
          <Button variant="outline" size="icon" asChild className="size-9 shrink-0">
            <Link href="/" aria-label="Back to dashboard"><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="font-bold text-base tracking-wider">SETTINGS</div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-sm bg-panel border-border/60 shadow-xl">
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-col items-center text-center gap-2">
              <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Lock className="size-6" />
              </span>
              <div className="text-lg font-semibold">Settings Locked</div>
              <div className="text-xs text-muted-foreground">
                Enter the settings password to manage dashboard preferences.
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="relative">
                <Input
                  type={showPwd ? "text" : "password"}
                  value={pwd}
                  onChange={e => { setPwd(e.target.value); setError(null); }}
                  onKeyDown={e => { if (e.key === "Enter") submit(); }}
                  placeholder="Password"
                  autoFocus
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? <EyeOff className="size-3.5 text-muted-foreground" /> : <Eye className="size-3.5 text-muted-foreground" />}
                </button>
              </div>
              {error && (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="size-3.5" /> {error}
                </div>
              )}
              {attempts >= 3 && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Default password: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{SETTINGS_PASSWORD}</code>
                </div>
              )}
            </div>

            <Button className="w-full gap-1.5" onClick={submit}>
              <ShieldCheck className="size-4" /> Unlock Settings
            </Button>

            <Button variant="ghost" size="sm" asChild className="w-full">
              <Link href="/"><ArrowLeft className="size-3.5" /> Cancel</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function SettingsCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="bg-panel border-border/60 shadow-lg shadow-black/20">
      <CardContent className="pt-5 space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
            {icon}
          </span>
          <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label, description, on, onToggle,
}: {
  label: React.ReactNode; description?: string; on: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-accent/20">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-[11px] text-muted-foreground mt-0.5">{description}</div>}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "relative w-11 h-6 rounded-full transition-colors shrink-0",
          on ? "bg-ok" : "bg-muted-foreground/30",
        )}
        aria-pressed={on}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform", on && "translate-x-5")} />
      </button>
    </div>
  );
}
