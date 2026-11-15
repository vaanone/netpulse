"use client";

/**
 * NETPULSE — Login page.
 *
 * The only public route (middleware lets /login and /api/auth/* through).
 * On a successful POST /api/auth/login the server sets an httpOnly session
 * cookie and we redirect to the dashboard. If a session already exists we
 * skip straight to "/".
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock, AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPwd, setShowPwd] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [checking, setChecking] = React.useState(true);

  // If already logged in, jump to the dashboard.
  React.useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(user => { if (user) router.replace("/"); else setChecking(false); })
      .catch(() => setChecking(false));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data?.error ?? "Login failed");
        setLoading(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="bg-grid min-h-screen flex items-center justify-center text-foreground">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="bg-grid min-h-screen flex flex-col items-center justify-center px-4 py-10 text-foreground">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-6">
          <span className="size-14 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-3">
            <img src="/netpulse-logo.png" alt="NETPULSE logo" className="size-10 object-contain" />
          </span>
          <div className="font-bold text-xl tracking-wider">NETPULSE</div>
          <div className="text-xs text-muted-foreground tracking-wide">ISP Network Manager — A JJ TechHub Product</div>
        </div>

        <Card className="bg-panel border-border/60 shadow-xl">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Lock className="size-4" />
              </span>
              <div>
                <div className="text-base font-semibold">Sign in</div>
                <div className="text-[11px] text-muted-foreground">Enter your credentials to access the dashboard.</div>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="username" className="text-xs font-medium text-muted-foreground">Username</label>
                <Input
                  id="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="text-xs font-medium text-muted-foreground">Password</label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
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
              </div>

              {error && (
                <div className="flex items-center gap-1.5 text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2">
                  <AlertCircle className="size-3.5 shrink-0" /> {error}
                </div>
              )}

              <Button type="submit" className="w-full gap-1.5" disabled={loading || !username || !password}>
                {loading ? "Signing in…" : <>Sign in <ArrowRight className="size-4" /></>}
              </Button>
            </form>

            <div className="text-[11px] text-muted-foreground text-center pt-1 border-t border-border/40">
              Default admin: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">admin</code> / <code className="font-mono bg-muted px-1.5 py-0.5 rounded">Hipoint@123</code>
            </div>
          </CardContent>
        </Card>

        <div className="text-center mt-4">
          <Link href="#" onClick={(e) => e.preventDefault()} className="text-[11px] text-muted-foreground/70 hover:text-muted-foreground">
            Contact your administrator if you need an account.
          </Link>
        </div>
      </div>
    </div>
  );
}
