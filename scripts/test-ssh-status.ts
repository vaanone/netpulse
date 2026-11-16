// Quick verification: pollSwitchViaSsh returns sshStatus="error" on a
// connection that is refused instantly (127.0.0.1:1), and "connected" is the
// default on the success-path result object. Run: bun scripts/test-ssh-status.ts
import { pollSwitchViaSsh } from "@/lib/cli-poll";

(async () => {
  // Minimal SwitchRow — SSH enabled, pointing at a port that refuses instantly.
  const sw = {
    id: "test",
    name: "test-switch",
    ipAddress: "127.0.0.1",
    sshPort: 1,            // port 1 → ECONNREFUSED immediately (no 60s hang)
    sshEnabled: true,
    sshUsername: "x",
    sshPassword: "x",
    cliProtocol: "ssh",
  } as any;

  console.log("[test] calling pollSwitchViaSsh on 127.0.0.1:1 (should fail fast)...");
  const t0 = Date.now();
  const res = await pollSwitchViaSsh(sw);
  const ms = Date.now() - t0;
  console.log(`[test] returned in ${ms}ms`);
  console.log("[test] result:", {
    reachable: res?.reachable,
    sshStatus: res?.sshStatus,
    error: (res?.error ?? "").slice(0, 80),
  });

  if (res?.sshStatus === "error") {
    console.log("[test] PASS ✓ — sshStatus is 'error' on connection failure");
  } else {
    console.log("[test] FAIL ✗ — expected sshStatus='error', got:", res?.sshStatus);
    process.exit(1);
  }
})();
