"use client";

/**
 * NETPULSE — Settings page
 *
 * Behind the login (enforced by middleware), this page holds:
 *   • Automation (Auto Poll, Auto Refresh)
 *   • Dashboard section visibility (four detail sections hidden by default)
 *   • Header buttons (Jump To, Poll Now)
 *   • User Management — admin only: create users, change passwords, change
 *     roles, delete users
 *   • Network management shortcuts (admin only): Manage Companies, Add Switch
 *
 * Toggles persist to localStorage (shared keys with the home page). User
 * management talks to /api/users which is admin-gated server-side.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Building2, Plus, ShieldCheck, Lock, Settings as SettingsIcon,
  RefreshCw, Crosshair, LayoutGrid, LogOut, CircleUser, Trash2, KeyRound,
  UserPlus, Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LS_KEYS, TOGGLE_SECTIONS, loadSectionVisibility,
  resolveSectionVisible, loadBoolSetting, saveBoolSetting,
  loadNumSetting, saveNumSetting,
} from "@/lib/settings";

interface CurrentUser { id: string; username: string; role: "admin" | "user"; }
interface UserRow { id: string; username: string; role: string; createdAt: string; }

export default function SettingsPage() {
  const router = useRouter();

  // --- Current user (middleware guarantees a session, but we need the role) ---
  const [me, setMe] = React.useState<CurrentUser | null>(null);
  const [loadingMe, setLoadingMe] = React.useState(true);
  React.useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(u => { setMe(u); setLoadingMe(false); if (!u) router.replace("/login"); })
      .catch(() => { setLoadingMe(false); router.replace("/login"); });
  }, [router]);
  const isAdmin = me?.role === "admin";

  // --- Hydration-safe toggle state (loaded from localStorage after mount) ---
  const [sectionVisibility, setSectionVisibility] = React.useState<Record<string, boolean>>({});
  const [autoPoll, setAutoPoll] = React.useState(true);
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const [showJumpTo, setShowJumpTo] = React.useState(true);
  const [showPollNow, setShowPollNow] = React.useState(true);

  // --- Configurable intervals ---
  // Poll interval is server-wide (DB-backed via /api/settings/poll-interval).
  // Auto-refresh interval is per-browser (localStorage), like the toggles.
  const DEFAULT_POLL_SEC = 30;
  const DEFAULT_REFRESH_SEC = 15;
  const MIN_SEC = 5, MAX_SEC = 3600;
  const [pollIntervalSec, setPollIntervalSec] = React.useState(DEFAULT_POLL_SEC);
  const [pollIntervalInput, setPollIntervalInput] = React.useState(String(DEFAULT_POLL_SEC));
  const [pollSaving, setPollSaving] = React.useState(false);
  const [refreshIntervalSec, setRefreshIntervalSec] = React.useState(DEFAULT_REFRESH_SEC);
  const [refreshIntervalInput, setRefreshIntervalInput] = React.useState(String(DEFAULT_REFRESH_SEC));
  const [refreshSaving, setRefreshSaving] = React.useState(false);

  React.useEffect(() => {
    setSectionVisibility(loadSectionVisibility());
    setAutoPoll(loadBoolSetting(LS_KEYS.autoPoll));
    setAutoRefresh(loadBoolSetting(LS_KEYS.autoRefresh));
    setShowJumpTo(loadBoolSetting(LS_KEYS.jumpTo));
    setShowPollNow(loadBoolSetting(LS_KEYS.pollNow));
    // Auto-refresh interval (per-browser).
    const rs = loadNumSetting(LS_KEYS.autoRefreshInterval, DEFAULT_REFRESH_SEC);
    setRefreshIntervalSec(rs);
    setRefreshIntervalInput(String(rs));
    // Poll interval (server-wide) — fetch the current value.
    fetch("/api/settings/poll-interval", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && typeof d.intervalSeconds === "number") {
          setPollIntervalSec(d.intervalSeconds);
          setPollIntervalInput(String(d.intervalSeconds));
        }
      })
      .catch(() => {});
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

  // Save the server-wide poll interval (admin only).
  async function savePollInterval() {
    const sec = Number(pollIntervalInput);
    if (!Number.isFinite(sec) || sec < MIN_SEC || sec > MAX_SEC) {
      toast.error(`Poll interval must be between ${MIN_SEC} and ${MAX_SEC} seconds.`);
      return;
    }
    setPollSaving(true);
    try {
      const r = await fetch("/api/settings/poll-interval", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalSeconds: sec }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d?.error ?? "Failed to update poll interval"); return; }
      setPollIntervalSec(d.intervalSeconds);
      setPollIntervalInput(String(d.intervalSeconds));
      toast.success(`Poll interval set to ${d.intervalSeconds}s`);
    } catch {
      toast.error("Failed to update poll interval");
    } finally {
      setPollSaving(false);
    }
  }

  // Save the per-browser auto-refresh interval.
  function saveRefreshInterval() {
    const sec = Number(refreshIntervalInput);
    if (!Number.isFinite(sec) || sec < MIN_SEC || sec > MAX_SEC) {
      toast.error(`Auto-refresh interval must be between ${MIN_SEC} and ${MAX_SEC} seconds.`);
      return;
    }
    saveNumSetting(LS_KEYS.autoRefreshInterval, sec);
    setRefreshIntervalSec(sec);
    setRefreshIntervalInput(String(sec));
    toast.success(`Auto-refresh set to ${sec}s`, { description: "Return to the dashboard to apply." });
  }

  async function handleLogout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    window.location.href = "/login";
  }

  if (loadingMe || !me) {
    return (
      <div className="bg-grid min-h-screen flex items-center justify-center text-foreground">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
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
              <div className="text-[10px] sm:text-xs text-muted-foreground tracking-wide truncate">Dashboard preferences &amp; user management</div>
            </div>
          </div>
          <div className="flex-1" />
          {/* Current user chip + logout */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-border/60">
              <CircleUser className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium max-w-[120px] truncate">{me.username}</span>
              <Badge variant={isAdmin ? "default" : "secondary"} className="text-[9px] px-1.5 py-0 h-4">{isAdmin ? "ADMIN" : "VIEW"}</Badge>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5">
              <LogOut className="size-3.5" /> <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="px-3 sm:px-4 lg:px-6 py-5 sm:py-7 pb-20 space-y-5 max-w-[1100px] w-full mx-auto">
        {/* Hint */}
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
          <div>
            Toggle sections on or off here, then return to the dashboard to see the change. Ring Traffic, Switch Health, SFP DOM and All Interfaces are <span className="text-foreground font-medium">hidden by default</span> — enable them below when you need them.
            {!isAdmin && <span className="block mt-1">You are signed in as a view-only user. User management and network changes are restricted to administrators.</span>}
          </div>
        </div>

        {/* Automation */}
        <SettingsCard title="Automation" icon={<RefreshCw className="size-4" />}>
          <ToggleRow label="Auto Poll" description={`Automatically poll switches every ${pollIntervalSec} seconds`} on={autoPoll} onToggle={toggleAutoPoll} />
          <ToggleRow label="Auto Refresh" description={`Refresh dashboard data every ${refreshIntervalSec} seconds`} on={autoRefresh} onToggle={toggleAutoRefresh} />

          <div className="pt-3 mt-2 border-t border-border/50 space-y-3">
            <IntervalRow
              label="Poll Interval"
              description={isAdmin
                ? "How often the server polls switches via SNMP/CLI. Applies immediately."
                : "How often the server polls switches. Admins can change this."}
              value={pollIntervalInput}
              onChange={setPollIntervalInput}
              onSave={savePollInterval}
              saving={pollSaving}
              disabled={!isAdmin}
              applied={pollIntervalSec}
              min={MIN_SEC}
              max={MAX_SEC}
            />
            <IntervalRow
              label="Auto-Refresh Interval"
              description="How often your dashboard refetches data. Per-browser; return to the dashboard to apply."
              value={refreshIntervalInput}
              onChange={setRefreshIntervalInput}
              onSave={saveRefreshInterval}
              saving={refreshSaving}
              disabled={false}
              applied={refreshIntervalSec}
              min={MIN_SEC}
              max={MAX_SEC}
            />
          </div>
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
          <ToggleRow label="Poll Now" description="Show the Poll Now button in the header (admin only)" on={showPollNow} onToggle={togglePollNow} />
        </SettingsCard>

        {/* User management — admin only */}
        {isAdmin && <UserManagement currentUser={me} />}

        {/* Network management shortcuts — admin only */}
        {isAdmin && (
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
            </div>
          </SettingsCard>
        )}

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1">
          <div className="flex items-center gap-1.5">
            <Lock className="size-3.5" />
            Signed in as <span className="text-foreground font-medium">{me.username}</span> ({isAdmin ? "admin" : "view-only"}).
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/"><LayoutGrid className="size-3.5" /> Back to Dashboard</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

// ===========================================================================
// USER MANAGEMENT (admin only)
// ===========================================================================

function UserManagement({ currentUser }: { currentUser: CurrentUser }) {
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Create-user form
  const [newUsername, setNewUsername] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [newRole, setNewRole] = React.useState<"admin" | "user">("user");
  const [creating, setCreating] = React.useState(false);

  // Password-change dialog
  const [pwTarget, setPwTarget] = React.useState<UserRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/users", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setUsers(await r.json());
    } catch {
      toast.error("Failed to load users");
    }
    setLoading(false);
  }

  React.useEffect(() => { refresh(); }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) return;
    setCreating(true);
    try {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: newRole }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error ?? "Failed to create user"); setCreating(false); return; }
      toast.success(`User "${data.username}" created (${data.role})`);
      setNewUsername(""); setNewPassword(""); setNewRole("user");
      refresh();
    } catch {
      toast.error("Network error");
    }
    setCreating(false);
  }

  async function changeRole(u: UserRow) {
    const next = u.role === "admin" ? "user" : "admin";
    try {
      const r = await fetch(`/api/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error ?? "Failed to change role"); return; }
      toast.success(`${u.username} is now ${next}`);
      refresh();
    } catch {
      toast.error("Network error");
    }
  }

  async function deleteUser(u: UserRow) {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error ?? "Failed to delete user"); return; }
      toast.success(`User "${u.username}" deleted`);
      refresh();
    } catch {
      toast.error("Network error");
    }
  }

  return (
    <SettingsCard title="User Management" icon={<UsersIcon className="size-4" />}>
      <div className="text-[11px] text-muted-foreground -mt-1 mb-3">
        Create users, assign roles, change passwords and remove accounts. Admins get full access; view-only users can see the dashboard but cannot edit, poll or delete.
      </div>

      {/* Create user */}
      <form onSubmit={createUser} className="rounded-lg border border-border/60 p-3 mb-3 bg-muted/20">
        <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <UserPlus className="size-3.5" /> New User
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_140px_auto] gap-2">
          <Input
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
            placeholder="Username (3-32 chars)"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-9"
          />
          <Input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Password (min 6 chars)"
            className="h-9"
          />
          <Select value={newRole} onValueChange={(v) => setNewRole(v as "admin" | "user")}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="user">View-only</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={creating || !newUsername.trim() || !newPassword} className="h-9 gap-1.5">
            <Plus className="size-3.5" /> {creating ? "…" : "Create"}
          </Button>
        </div>
      </form>

      {/* User list */}
      {loading ? (
        <div className="text-xs text-muted-foreground py-3">Loading users…</div>
      ) : users.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3">No users found.</div>
      ) : (
        <div className="space-y-1.5">
          {users.map(u => {
            const isSelf = u.id === currentUser.id;
            return (
              <div key={u.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-border/60">
                <CircleUser className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{u.username}</span>
                    {isSelf && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">you</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Created {new Date(u.createdAt).toLocaleString()}</div>
                </div>
                <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[9px]">{u.role === "admin" ? "ADMIN" : "VIEW"}</Badge>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setPwTarget(u)} title="Change password">
                    <KeyRound className="size-3.5" /> <span className="hidden sm:inline text-xs">Password</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => changeRole(u)} title={u.role === "admin" ? "Demote to view-only" : "Promote to admin"}>
                    <ShieldCheck className="size-3.5" /> <span className="hidden sm:inline text-xs">{u.role === "admin" ? "Demote" : "Promote"}</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => deleteUser(u)} disabled={isSelf} title={isSelf ? "You cannot delete your own account" : "Delete user"}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ChangePasswordDialog target={pwTarget} onClose={() => setPwTarget(null)} onDone={refresh} />
    </SettingsCard>
  );
}

function ChangePasswordDialog({ target, onClose, onDone }: {
  target: UserRow | null; onClose: () => void; onDone: () => void;
}) {
  const [pwd, setPwd] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (target) setPwd("");
  }, [target]);

  async function save() {
    if (!target || !pwd) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/users/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error ?? "Failed to change password"); setSaving(false); return; }
      toast.success(`Password updated for "${target.username}"`);
      onClose();
      onDone();
    } catch {
      toast.error("Network error");
    }
    setSaving(false);
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Change Password</DialogTitle>
          <DialogDescription>
            Set a new password for <span className="font-medium text-foreground">{target?.username}</span>. Minimum 6 characters.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <Input
            type="password"
            value={pwd}
            onChange={e => setPwd(e.target.value)}
            placeholder="New password"
            autoFocus
            onKeyDown={e => { if (e.key === "Enter" && pwd.length >= 6) save(); }}
          />
          {pwd.length > 0 && pwd.length < 6 && (
            <div className="text-[11px] text-destructive">Password must be at least 6 characters.</div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={save} disabled={saving || pwd.length < 6} className="gap-1.5">
            <KeyRound className="size-3.5" /> {saving ? "Saving…" : "Save Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Small building blocks
// ===========================================================================

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

function IntervalRow({
  label, description, value, onChange, onSave, saving, disabled, applied, min, max,
}: {
  label: string; description?: string; value: string;
  onChange: (v: string) => void; onSave: () => void;
  saving: boolean; disabled: boolean; applied: number; min: number; max: number;
}) {
  const dirty = Number(value) !== applied;
  return (
    <div className="flex flex-col gap-1.5 p-2.5 rounded-lg hover:bg-accent/20">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{label}</div>
        <div className="flex items-center gap-2 shrink-0">
          <Input
            type="number"
            min={min}
            max={max}
            value={value}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
            className="h-8 w-24 tabular-nums text-right"
          />
          <span className="text-[11px] text-muted-foreground">sec</span>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={disabled || saving || !dirty}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {description && <div className="text-[11px] text-muted-foreground">{description}</div>}
    </div>
  );
}
