/**
 * CLI-based Cisco switch polling — used as a fallback when SNMP returns no data.
 *
 * Many Cisco SMB switches (Catalyst 1000/1300/1400, SG/SE series) don't fully
 * support SNMP GETBULK on tables, or have SNMP views that restrict access to
 * IF-MIB / CISCO-CDP-MIB / CISCO-PROCESS-MIB. CLI access (SSH or Telnet) always works.
 *
 * This module logs into the switch via SSH OR Telnet, runs Cisco IOS CLI commands,
 * and parses the output into the same shape as the SNMP PollResult.
 *
 * Telnet is added because many Catalyst SMB switches ship with telnet enabled
 * by default (and SSH not configured). Telnet also works on older IOS versions
 * that don't support modern SSH crypto algorithms.
 */

import { Client } from "ssh2";
import { Telnet } from "telnet-client";
import type { Switch as SwitchRow } from "@prisma/client";
import type { PollResult, CdpNeighbor, PowerSupply, PowerSummary } from "./snmp";

export type CliProtocol = "ssh" | "telnet";

interface CliConfig {
  protocol: CliProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
  timeout?: number;
}

/** Run a single command on the switch via SSH. Returns the stdout string. */
function runSshCommand(config: CliConfig, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = "";
    const timeoutMs = config.timeout ?? 8000;
    const timer = setTimeout(() => {
      try { conn.end(); } catch {}
      reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${command.slice(0, 50)}`));
    }, timeoutMs);

    conn.on("ready", () => {
      // Disable paging so output isn't interrupted by "--More--" prompts.
      // Different Cisco devices use different commands — try all.
      conn.shell((err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); reject(err); return; }
        let buf = "";
        let cmdSent = false;
        let collectedOutput = "";
        const finalTimeout = setTimeout(() => {
          try { conn.end(); } catch {}
          clearTimeout(timer);
          resolve(collectedOutput);
        }, timeoutMs - 1000);

        stream.on("data", (data: Buffer) => {
          buf += data.toString("utf8");
          // Send paging-disable commands first, then our actual command
          if (!cmdSent) {
            // Wait for prompt
            if (/[>#]\s*$/.test(buf)) {
              stream.write("terminal length 0\n");
              setTimeout(() => {
                stream.write("terminal datadump\n");
                setTimeout(() => {
                  stream.write(command + "\n");
                  cmdSent = true;
                }, 200);
              }, 200);
            }
          } else {
            collectedOutput += data.toString("utf8");
            // Wait for prompt to come back — means command finished
            if (/[>#]\s*$/.test(collectedOutput.slice(-50))) {
              clearTimeout(finalTimeout);
              clearTimeout(timer);
              try { stream.end(); } catch {}
              try { conn.end(); } catch {}
              // Strip the command echo and trailing prompt
              const lines = collectedOutput.split("\n").filter(l =>
                !l.includes(command) &&
                !/[a-zA-Z0-9-]+[#>]\s*$/.test(l.trim()) &&
                !l.includes("terminal length") &&
                !l.includes("terminal datadump")
              );
              resolve(lines.join("\n"));
            }
          }
        });
        stream.stderr.on("data", (d: Buffer) => { /* ignore stderr */ });
        stream.on("close", () => {
          clearTimeout(finalTimeout);
          clearTimeout(timer);
          try { conn.end(); } catch {}
          resolve(collectedOutput);
        });
      });
    });
    conn.on("error", (err: any) => { clearTimeout(timer); reject(err); });
    conn.on("end", () => { clearTimeout(timer); });
    conn.on("handshake", (info: any) => {
      console.warn(`[ssh] ${config.host}: handshake done — kex=${info?.kex}, cipher=${info?.cipher}, serverHostKey=${info?.serverHostKey}`);
    });
    conn.on("close", () => { clearTimeout(timer); });
    // Handle keyboard-interactive auth (required by some IOS versions)
    conn.on("keyboard-interactive", (name: string, instructions: string, lang: string, prompts: Array<{ prompt: string; echo: boolean }>, finish: (answers: string[]) => void) => {
      console.warn(`[ssh] ${config.host}: keyboard-interactive auth requested — name="${name}", prompts=${prompts.length}`);
      // Answer all prompts with the password
      finish(prompts.map(() => config.password));
    });
    conn.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      readyTimeout: timeoutMs,
      // Be very permissive with algorithms — Cisco SMB switches (Catalyst 1000/1300/1400)
      // and older IOS versions often only support deprecated crypto.
      algorithms: {
        // Key exchange (KEX) — order matters: most-secure first, but include the
        // legacy ones at the end so old switches can still negotiate.
        kex: [
          "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
          "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1",
          "diffie-hellman-group1-sha1",
          "diffie-hellman-group-exchange-sha256", "diffie-hellman-group-exchange-sha1",
        ],
        serverHostKey: [
          "ssh-rsa", "rsa-sha2-256", "rsa-sha2-512",
          "ssh-ed25519", "ecdsa-sha2-nistp256",
        ],
        cipher: [
          "aes128-ctr", "aes192-ctr", "aes256-ctr",
          "aes128-gcm@openssh.com", "aes256-gcm@openssh.com",
          "aes128-cbc", "aes256-cbc",
          "3des-cbc",
        ],
        hmac: [
          "hmac-sha2-256", "hmac-sha2-512",
          "hmac-sha1", "hmac-md5",
        ],
        // Don't compress — switches don't support it
        compress: ["none"],
      },
      // Try keyboard-interactive auth if password auth fails (some IOS versions require it)
      tryKeyboard: true,
      // Allow weaker host key verification
      hostVerifier: () => true,
    });
  });
}

/**
 * Open ONE persistent SSH session and run multiple commands on the same shell.
 * Much faster than opening a new SSH connection per command (which is what
 * runSshCommand does). Use this when running the full poll cycle.
 *
 * Returns an array of strings — one per command, in the same order.
 */
async function runSshCommandsBatch(config: CliConfig, commands: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    // Allow up to 90 seconds for the whole batch (idle timeout on switches is
    // typically 60s, but as long as we keep sending commands the session stays
    // active). 13 commands × ~3s each = ~40s, plus handshake + login ~10s.
    const timeoutMs = 90000;
    const results: string[] = new Array(commands.length).fill("");
    let currentCmdIdx = 0;
    let collectedOutput = "";
    let cmdSentForCurrent = false;
    let promptReady = false;
    let shellStream: any = null;

    const overallTimer = setTimeout(() => {
      try { conn.end(); } catch {}
      reject(new Error(`SSH batch timed out after ${timeoutMs}ms (ran ${currentCmdIdx}/${commands.length} commands)`));
    }, timeoutMs);

    conn.on("ready", () => {
      console.warn(`[ssh] ${config.host}: connected, opening shell...`);
      conn.shell((err, stream) => {
        if (err) { clearTimeout(overallTimer); conn.end(); reject(err); return; }
        shellStream = stream;
        let buf = "";
        let promptWaitStart = Date.now();
        let loginHandled = false;  // have we sent credentials in response to "User Name:" prompt?

        stream.on("data", (data: Buffer) => {
          buf += data.toString("utf8");

          // Log raw output for debugging (first 200 chars per data chunk)
          const text = data.toString("utf8");
          if (text.trim() && text.length < 500) {
            console.warn(`[ssh] ${config.host} << ${JSON.stringify(text.slice(0, 100))}`);
          }

          // ─── Handle post-SSH login prompts ───
          // Some Catalyst SMB switches (1300/1000/1400) send a "User Name:" prompt
          // AFTER SSH auth succeeds, requiring interactive login on the shell itself.
          // We answer with the same credentials already provided.
          if (!loginHandled) {
            const lower = buf.toLowerCase();
            // Match "User Name:" / "Username:" / "Login:" prompts (case-insensitive)
            if (/user\s*name\s*:\s*$/.test(lower) || /username\s*:\s*$/.test(lower) || /login\s*:\s*$/.test(lower)) {
              console.warn(`[ssh] ${config.host}: login prompt detected, sending username "${config.username}"`);
              stream.write(config.username + "\n");
              buf = "";  // clear buffer so we don't re-match
              return;
            }
            // Match "Password:" prompt
            if (/password\s*:\s*$/.test(lower)) {
              console.warn(`[ssh] ${config.host}: password prompt detected, sending password`);
              stream.write(config.password + "\n");
              buf = "";
              loginHandled = true;  // we've now handled both prompts
              return;
            }
          }

          // Send paging-disable commands first, then our actual command
          if (!promptReady) {
            // Try various Cisco prompt patterns:
            //   "Switch#" or "Switch>"   (standard)
            //   "hostname#"               (with hostname)
            //   "(enable)#"               (CatOS-style)
            //   "Switch: "                (ROMMON)
            //   End with # or > optionally followed by space
            const promptMatch = buf.match(/[a-zA-Z0-9._-]*(\([^)]*\))?[>#]\s*$/);
            if (promptMatch) {
              console.warn(`[ssh] ${config.host}: prompt detected — "${promptMatch[0].trim()}"`);
              promptReady = true;
              // Send newline first to get a fresh prompt, then disable paging + echo
              stream.write("\n");
              setTimeout(() => {
                // Disable paging
                stream.write("terminal length 0\n");
                setTimeout(() => {
                  stream.write("terminal datadump\n");
                  setTimeout(() => {
                    // Try to disable character echo on SMB switches.
                    // Standard IOS: "no terminal monitor" (not quite the same)
                    // Cisco SMB: "no terminal echo" or just live with it
                    stream.write("terminal no echo\n");
                    setTimeout(() => {
                      // Start first command
                      currentCmdIdx = 0;
                      cmdSentForCurrent = true;
                      collectedOutput = "";
                      stream.write(commands[0] + "\n");
                    }, 200);
                  }, 200);
                }, 200);
              }, 200);
            } else if (Date.now() - promptWaitStart > 8000 && !promptReady) {
              // 8 seconds passed without detecting a prompt — maybe the prompt is unusual.
              // Force-start commands anyway. The shell might just be at a blank line or
              // the banner is taking too long.
              console.warn(`[ssh] ${config.host}: no prompt detected after 8s, forcing command start. Buffer so far: ${JSON.stringify(buf.slice(-200))}`);
              promptReady = true;
              stream.write("\nterminal length 0\nterminal datadump\nterminal no echo\n");
              setTimeout(() => {
                currentCmdIdx = 0;
                cmdSentForCurrent = true;
                collectedOutput = "";
                stream.write(commands[0] + "\n");
              }, 500);
            }
            return;
          }

          // We have a command in flight
          collectedOutput += data.toString("utf8");

          // Check if we got the prompt back — command finished.
          // Match more loosely: any line ending in # or > (optionally followed by whitespace)
          // OR a "--More--" prompt (which means paging wasn't disabled, send space to continue)
          if (/--\s*[Mm]ore\s*--/.test(collectedOutput.slice(-20))) {
            // Send space to page through (shouldn't happen but just in case)
            stream.write(" ");
            collectedOutput = collectedOutput.replace(/--\s*[Mm]ore\s*--\s*/, "");
            return;
          }
          if (/[a-zA-Z0-9._-]*(\([^)]*\))?[>#]\s*$/.test(collectedOutput.slice(-100))) {
            // Strip command echo and trailing prompt
            const cmd = commands[currentCmdIdx];
            const lines = collectedOutput.split("\n").filter(l =>
              !l.includes(cmd) &&
              !/[a-zA-Z0-9._-]*(\([^)]*\))?[>#]\s*$/.test(l.trim()) &&
              !l.includes("terminal length") &&
              !l.includes("terminal datadump") &&
              l.trim() !== ""
            );
            results[currentCmdIdx] = lines.join("\n");
            console.warn(`[ssh] ${config.host}: command ${currentCmdIdx + 1}/${commands.length} done (${results[currentCmdIdx].length} bytes) — "${cmd.slice(0, 30)}"`);

            // Move to next command
            currentCmdIdx++;
            if (currentCmdIdx >= commands.length) {
              // All done
              clearTimeout(overallTimer);
              try { stream.end(); } catch {}
              try { conn.end(); } catch {}
              resolve(results);
              return;
            }
            // Send next command
            cmdSentForCurrent = true;
            collectedOutput = "";
            stream.write(commands[currentCmdIdx] + "\n");
          }
        });
        stream.stderr.on("data", () => { /* ignore */ });
        stream.on("close", () => {
          clearTimeout(overallTimer);
          try { conn.end(); } catch {}
          // Resolve with what we have so far
          resolve(results);
        });
      });
    });
    conn.on("error", (err: any) => {
      clearTimeout(overallTimer);
      console.warn(`[ssh] ${config.host}: ERROR — ${err.message}`);
      // Don't reject if we already got partial results — return what we have
      if (results.some(r => r.length > 0)) {
        console.warn(`[ssh] ${config.host}: returning ${results.filter(r => r.length > 0).length}/${results.length} partial results`);
        resolve(results);
      } else {
        reject(err);
      }
    });
    conn.on("close", () => {
      clearTimeout(overallTimer);
      console.warn(`[ssh] ${config.host}: connection closed (got ${results.filter(r => r.length > 0).length}/${results.length} results)`);
      // If we got at least some results, return them — don't reject
      if (results.some(r => r.length > 0)) {
        resolve(results);
      } else {
        reject(new Error("SSH connection closed before any command completed"));
      }
    });
    conn.on("handshake", (info: any) => {
      console.warn(`[ssh] ${config.host}: handshake done — kex=${info?.kex}, cipher=${info?.cipher}, serverHostKey=${info?.serverHostKey}`);
    });
    conn.on("keyboard-interactive", (name: string, instructions: string, lang: string, prompts: Array<{ prompt: string; echo: boolean }>, finish: (answers: string[]) => void) => {
      console.warn(`[ssh] ${config.host}: keyboard-interactive auth — prompts=${prompts.length}`);
      finish(prompts.map(() => config.password));
    });
    conn.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      readyTimeout: timeoutMs,
      keepaliveInterval: 5000,    // send keepalive every 5s — prevents idle timeout
      keepaliveCountMax: 3,        // allow 3 missed keepalives before disconnecting
      algorithms: {
        kex: [
          "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
          "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1",
          "diffie-hellman-group1-sha1",
          "diffie-hellman-group-exchange-sha256", "diffie-hellman-group-exchange-sha1",
        ],
        serverHostKey: [
          "ssh-rsa", "rsa-sha2-256", "rsa-sha2-512",
          "ssh-ed25519", "ecdsa-sha2-nistp256",
        ],
        cipher: [
          "aes128-ctr", "aes192-ctr", "aes256-ctr",
          "aes128-gcm@openssh.com", "aes256-gcm@openssh.com",
          "aes128-cbc", "aes256-cbc",
          "3des-cbc",
        ],
        hmac: [
          "hmac-sha2-256", "hmac-sha2-512",
          "hmac-sha1", "hmac-md5",
        ],
        compress: ["none"],
      },
      tryKeyboard: true,
      hostVerifier: () => true,
    });
  });
}

/**
 * Open ONE persistent Telnet session and run multiple commands.
 * Handles "User Name:" / "Password:" login prompts that some Catalyst SMB
 * switches (1300/1000/1400) send after the Telnet banner.
 *
 * Returns an array of strings — one per command, in the same order.
 */
async function runTelnetCommandsBatch(config: CliConfig, commands: string[]): Promise<string[]> {
  const timeoutMs = (config.timeout ?? 15000) * 2;
  const results: string[] = new Array(commands.length).fill("");
  const net = await import("net");

  return new Promise((resolve) => {
    const socket = new net.Socket();
    const resultsLocal: string[] = new Array(commands.length).fill("");
    let buf = "";
    let currentCmdIdx = 0;
    let promptReady = false;
    let loginHandled = false;
    let collectedOutput = "";
    const startTime = Date.now();

    const overallTimer = setTimeout(() => {
      try { socket.destroy(); } catch {}
      console.warn(`[telnet] ${config.host}: batch timed out after ${timeoutMs}ms (${currentCmdIdx}/${commands.length} done)`);
      resolve(resultsLocal);
    }, timeoutMs);

    socket.on("connect", () => {
      console.warn(`[telnet] ${config.host}: TCP connected, waiting for banner...`);
    });

    socket.on("data", (data: Buffer) => {
      buf += data.toString("latin1");  // latin1 preserves bytes — important for telnet IAC

      // Log raw output for debugging
      const text = data.toString("utf8");
      if (text.trim() && text.length < 500) {
        console.warn(`[telnet] ${config.host} << ${JSON.stringify(text.slice(0, 100))}`);
      }

      const lower = buf.toLowerCase();

      // ─── Handle login prompts ───
      if (!loginHandled) {
        if (/user\s*name\s*:\s*$/.test(lower) || /username\s*:\s*$/.test(lower) || /login\s*:\s*$/.test(lower)) {
          console.warn(`[telnet] ${config.host}: login prompt detected, sending username "${config.username}"`);
          socket.write(config.username + "\r\n");
          buf = "";
          return;
        }
        if (/password\s*:\s*$/.test(lower)) {
          console.warn(`[telnet] ${config.host}: password prompt detected, sending password`);
          socket.write(config.password + "\r\n");
          buf = "";
          loginHandled = true;
          // Wait a bit for prompt to appear
          setTimeout(() => {
            if (!promptReady) {
              console.warn(`[telnet] ${config.host}: post-login, sending newline to elicit prompt`);
              socket.write("\r\n");
            }
          }, 1000);
          return;
        }
      }

      // ─── Detect prompt ───
      if (!promptReady && loginHandled) {
        // Match prompt patterns: "Switch#", "hostname>", "Switch(config)#", etc.
        const promptMatch = buf.match(/[a-zA-Z0-9._-]*(\([^)]*\))?[>#]\s*$/);
        if (promptMatch) {
          console.warn(`[telnet] ${config.host}: prompt detected — "${promptMatch[0].trim()}"`);
          promptReady = true;
          // Disable paging
          socket.write("terminal length 0\r\n");
          setTimeout(() => {
            socket.write("terminal datadump\r\n");
            setTimeout(() => {
              // Start first command
              currentCmdIdx = 0;
              collectedOutput = "";
              socket.write(commands[0] + "\r\n");
            }, 300);
          }, 300);
        } else if (Date.now() - startTime > 8000) {
          // 8 seconds passed — force start
          console.warn(`[telnet] ${config.host}: no prompt after 8s, force-starting. Buffer: ${JSON.stringify(buf.slice(-200))}`);
          promptReady = true;
          socket.write("\r\nterminal length 0\r\nterminal datadump\r\n");
          setTimeout(() => {
            currentCmdIdx = 0;
            collectedOutput = "";
            socket.write(commands[0] + "\r\n");
          }, 500);
        }
        return;
      }

      // ─── We have a command in flight ───
      if (promptReady) {
        collectedOutput += data.toString("utf8");

        // Handle paging prompts
        if (/--\s*[Mm]ore\s*--/.test(collectedOutput.slice(-20))) {
          socket.write(" ");
          collectedOutput = collectedOutput.replace(/--\s*[Mm]ore\s*--\s*/, "");
          return;
        }

        // Check if prompt came back — command finished
        if (/[a-zA-Z0-9._-]*(\([^)]*\))?[>#]\s*$/.test(collectedOutput.slice(-100))) {
          const cmd = commands[currentCmdIdx];
          const lines = collectedOutput.split("\n").filter(l =>
            !l.includes(cmd) &&
            !/[a-zA-Z0-9._-]*(\([^)]*\))?[>#]\s*$/.test(l.trim()) &&
            !l.includes("terminal length") &&
            !l.includes("terminal datadump") &&
            l.trim() !== ""
          );
          resultsLocal[currentCmdIdx] = lines.join("\n");
          console.warn(`[telnet] ${config.host}: command ${currentCmdIdx + 1}/${commands.length} done (${resultsLocal[currentCmdIdx].length} bytes) — "${cmd.slice(0, 30)}"`);

          currentCmdIdx++;
          if (currentCmdIdx >= commands.length) {
            clearTimeout(overallTimer);
            try { socket.end(); } catch {}
            resolve(resultsLocal);
            return;
          }
          // Send next command
          collectedOutput = "";
          socket.write(commands[currentCmdIdx] + "\r\n");
        }
      }
    });

    socket.on("error", (err: any) => {
      clearTimeout(overallTimer);
      console.warn(`[telnet] ${config.host}: ERROR — ${err.message}`);
      resolve(resultsLocal);
    });

    socket.on("close", () => {
      clearTimeout(overallTimer);
      console.warn(`[telnet] ${config.host}: connection closed (ran ${currentCmdIdx}/${commands.length})`);
      resolve(resultsLocal);
    });

    // Connect
    socket.connect(config.port, config.host);
    // Set a connect timeout
    socket.setTimeout(8000);
    socket.on("timeout", () => {
      console.warn(`[telnet] ${config.host}: socket timeout`);
      // Don't destroy — let the overall timer handle it
      socket.setTimeout(0);  // clear timeout
    });
  });
}

/** Dispatch to SSH or Telnet based on config.protocol. */
async function runCliCommand(config: CliConfig, command: string): Promise<string> {
  if (config.protocol === "telnet") {
    return runTelnetCommand(config, command);
  }
  return runSshCommand(config, command);
}

/** Parse "show version" output. */
function parseShowVersion(output: string): Partial<PollResult> {
  const out: Partial<PollResult> = {};
  const lines = output.split("\n");
  for (const line of lines) {
    // "Cisco IOS Software, C1300 Software (C1300-UNIVERSALK9-M), Version 15.2(7)E3..."
    if (line.includes("Cisco IOS Software") && !out.sysDescr) {
      out.sysDescr = line.trim();
    }
    // "...uptime is 1 hour, 23 minutes" or "uptime is 2 days, 3 hours, 4 minutes"
    const upMatch = line.match(/uptime is (.+?)$/i);
    if (upMatch) {
      const str = upMatch[1].toLowerCase();
      let seconds = 0;
      const daysMatch = str.match(/(\d+)\s*day/);
      const hoursMatch = str.match(/(\d+)\s*hour/);
      const minMatch = str.match(/(\d+)\s*minute/);
      const secMatch = str.match(/(\d+)\s*second/);
      if (daysMatch) seconds += parseInt(daysMatch[1]) * 86400;
      if (hoursMatch) seconds += parseInt(hoursMatch[1]) * 3600;
      if (minMatch) seconds += parseInt(minMatch[1]) * 60;
      if (secMatch) seconds += parseInt(secMatch[1]);
      out.uptimeSeconds = seconds;
    }
    // "System image file is \"flash:/...\""
    // "cisco C1300-24P-4X (ARM) processor"
    if (line.match(/cisco\s+\S+\s+\(.*processor/i) && !out.sysDescr) {
      out.sysDescr = line.trim();
    }
  }
  return out;
}

/** Parse "show processes cpu" — first line has the CPU usage percentage. */
function parseShowCpu(output: string): number | null {
  // Output looks like:
  // CPU utilization for five seconds: 5%/0%; one minute: 4%; five minutes: 4%
  for (const line of output.split("\n")) {
    const m = line.match(/five minutes:\s*(\d+)%/i);
    if (m) return parseInt(m[1]);
  }
  // Fallback: one minute
  for (const line of output.split("\n")) {
    const m = line.match(/one minute:\s*(\d+)%/i);
    if (m) return parseInt(m[1]);
  }
  // Last resort: first percentage on the line
  for (const line of output.split("\n")) {
    if (line.toLowerCase().includes("cpu utilization")) {
      const m = line.match(/(\d+)%/);
      if (m) return parseInt(m[1]);
    }
  }
  return null;
}

/** Parse "show memory statistics" or "show memory" output. */
function parseShowMemory(output: string): { used: number; free: number } | null {
  // Catalyst 1300 / IOS XE: "show memory statistics" produces a table with rows like:
  //   Processor Pool   512000000  300000000  200000000 ...
  // Look for the largest pool
  let best: { used: number; free: number } | null = null;
  for (const line of output.split("\n")) {
    // Match: Name Total Used Free
    const m = line.match(/^\s*(\S+)\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (m) {
      const total = parseInt(m[2]);
      const used = parseInt(m[3]);
      const free = parseInt(m[4]);
      if (total > 0 && !Number.isNaN(used) && !Number.isNaN(free)) {
        if (!best || total > (best.used + best.free)) {
          best = { used, free };
        }
      }
    }
  }
  return best;
}

interface ParsedInterface {
  ifIndex: number | null;
  ifName: string;
  ifDescr: string;
  ifAlias: string;
  ifOperStatus: number;  // 1=up, 2=down, 4=unknown
  ifAdminStatus: number;  // 1=up, 2=down
  ifSpeed: bigint | null;
  ifHighSpeed: number | null;
  ifInOctets: bigint | null;
  ifOutOctets: bigint | null;
  ifHCInOctets: bigint | null;
  ifHCOutOctets: bigint | null;
  ifInErrors: bigint;
  ifOutErrors: bigint;
  ifInDiscards: bigint;
  ifOutDiscards: bigint;
  ifInUcastPkts: bigint | null;
  ifOutUcastPkts: bigint | null;
}

/** Parse "show interfaces status" — port status table.
 * Format:
 *   Port      Name               Status       Vlan       Duplex  Speed Type
 *   Gi1/0/1   Uplink to core     connected    trunk      full    1000 10/100/1000BaseTX
 */
function parseShowInterfacesStatus(output: string): Array<Partial<ParsedInterface>> {
  const ports: Array<Partial<ParsedInterface>> = [];
  for (const line of output.split("\n")) {
    // Match: Port Name Status Vlan Duplex Speed Type
    // Port can be Gi1/0/1, Te1/0/1, Tw1/0/1, Fa0/1, etc.
    const m = line.match(/^(\S+(?:\/\d+)*?)\s+(\S.*?|)\s+(connected|notconnect|disabled|err-disabled|no?(?: operational)?|down|up)\b/i);
    if (m) {
      const ifName = m[1];
      const name = m[2]?.trim() ?? "";
      const statusStr = m[3].toLowerCase();
      let operStatus = 4; // unknown
      if (statusStr === "connected" || statusStr === "up") operStatus = 1;
      else if (statusStr === "notconnect" || statusStr === "down" || statusStr === "disabled" || statusStr === "err-disabled") operStatus = 2;
      ports.push({
        ifName,
        ifAlias: name,
        ifOperStatus: operStatus,
        ifAdminStatus: statusStr === "disabled" ? 2 : 1,
      });
    }
  }
  return ports;
}

/** Parse "show interfaces description" — has port + description + status.
 * Format:
 *   Interface                      Status         Protocol Description
 *   Gi1/0/1                        up             up       Ring uplink
 *   Gi1/0/2                        admin down     down     Spare port
 */
function parseShowInterfacesDescription(output: string): Array<Partial<ParsedInterface>> {
  const ports: Array<Partial<ParsedInterface>> = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^(\S+(?:\/\d+)*)\s+(\S+(?:\s\S+)?)\s+(\S+)\s*(.*)$/);
    if (m && (m[1].startsWith("Gi") || m[1].startsWith("Te") || m[1].startsWith("Tw") ||
              m[1].startsWith("Fa") || m[1].startsWith("Hu") || m[1].startsWith("Fo") ||
              m[1].startsWith("Ten"))) {
      const ifName = m[1];
      const statusStr = m[2].toLowerCase();
      const protoStr = m[3].toLowerCase();
      const desc = m[4]?.trim() ?? "";
      let operStatus = 4;
      if (protoStr === "up") operStatus = 1;
      else if (protoStr === "down") operStatus = 2;
      let adminStatus = 1;
      if (statusStr.includes("admin") && statusStr.includes("down")) adminStatus = 2;
      ports.push({
        ifName,
        ifDescr: ifName, // will be overridden by actual ifDescr if we have it
        ifAlias: desc,
        ifOperStatus: operStatus,
        ifAdminStatus: adminStatus,
      });
    }
  }
  return ports;
}

/** Parse "show cdp neighbors" / "show cdp neighbors detail".
 * Format (basic):
 *   Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID
 *   Switch2          Gi1/0/1           150              R S   C1300     Gi1/0/2
 * Format (detail):
 *   Device ID: Switch2
 *   Entry address(es):
 *     IP address: 10.10.1.12
 *   Platform: Cisco C1300,  Capabilities: Switch
 *   Interface: Gi1/0/1,  Port ID (outgoing port): Gi1/0/2
 */

/**
 * Parse Cisco SMB "show ports details" output.
 * Format:
 *                                            Flow    Link        Back   Mdix
 * Port      Type         Duplex  Speed Neg   ctrl    State       Pressure Mode
 * --------  ------------ ------  ----- -----  ----   ----------- -------- -------
 * gi1       1G-Copper    Full    100   Enabled Off   Up          Disabled Off
 * gi2       1G-Copper      --     --    --    --     Down          --     --
 */
function parseShowPortsDetails(output: string): Array<Partial<ParsedInterface>> {
  const ports: Array<Partial<ParsedInterface>> = [];
  const lines = output.split("\n");
  let inTable = false;
  for (const line of lines) {
    // Detect table start — line containing "Port" and "Type" and "State"
    if (/Port\s+Type\s+.*State/i.test(line) && !inTable) {
      inTable = true;
      continue;
    }
    if (inTable) {
      // Skip separator lines like "-------- ------------ ------"
      if (/^[-\s]+$/.test(line.trim())) continue;
      // Skip empty lines
      if (!line.trim()) continue;
      // Try to match a port line: "gi1       1G-Copper    Full    100   Enabled  Off  Up          Disabled Off"
      // Allow port names like: gi1, gi10, te1, te2, etc.
      const m = line.match(/^(\w+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\S+\s+\S+\s+(\S+)/);
      if (m) {
        const portName = m[1];
        const type = m[2];
        const duplex = m[3];
        const speed = m[4];
        const state = m[5];
        // Only accept if it looks like a port (gi1, te1, Po1, etc.)
        if (/^(gi|te|tw|fa|hu|fo|Po|Ch)/i.test(portName)) {
          let operStatus = 4;  // unknown
          if (state.toLowerCase() === "up") operStatus = 1;
          else if (state.toLowerCase() === "down") operStatus = 2;
          ports.push({
            ifName: portName,
            ifDescr: `${type} ${duplex} ${speed}M`,
            ifAlias: "",  // descriptions come from a different command
            ifOperStatus: operStatus,
            ifAdminStatus: 1,
            ifHighSpeed: speed === "--" ? null : (parseInt(speed) || null),
          });
        }
      }
    }
  }
  return ports;
}

/**
 * Parse Cisco SMB "show ports description" output.
 * Format:
 * Port      Description
 * -------   -----------
 * gi1       Uplink to core
 * gi2
 */
function parseShowPortsDescription(output: string): Array<Partial<ParsedInterface>> {
  const ports: Array<Partial<ParsedInterface>> = [];
  const lines = output.split("\n");
  let inTable = false;
  for (const line of lines) {
    if (/Port\s+Description/i.test(line) && !inTable) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (/^[-\s]+$/.test(line.trim())) continue;
      if (!line.trim()) continue;
      // Match: "gi1       Uplink to core" or just "gi1" with empty description
      const m = line.match(/^(\w+)\s+(.*)$/);
      if (m) {
        const portName = m[1];
        const description = m[2].trim();
        if (/^(gi|te|tw|fa|hu|fo|Po|Ch)/i.test(portName)) {
          ports.push({
            ifName: portName,
            ifDescr: portName,
            ifAlias: description || "",
            ifOperStatus: 4,  // unknown — show ports description doesn't have status
            ifAdminStatus: 1,
          });
        }
      }
    }
  }
  return ports;
}

function parseShowCdpNeighbors(output: string, detail: boolean): CdpNeighbor[] {
  const neighbors: CdpNeighbor[] = [];
  if (detail) {
    // Parse detail blocks
    const blocks = output.split(/--------------------------/);
    for (const block of blocks) {
      const devIdMatch = block.match(/Device ID:\s*(.+)/i);
      if (!devIdMatch) continue;
      const deviceId = devIdMatch[1].trim();
      const ipMatch = block.match(/IP(?:v4)? address:\s*(\d+\.\d+\.\d+\.\d+)/i);
      const address = ipMatch ? ipMatch[1] : null;
      const platMatch = block.match(/Platform:\s*([^,]+)/i);
      const platform = platMatch ? platMatch[1].trim() : null;
      const ifMatch = block.match(/Interface:\s*(\S+),\s*Port ID[^:]*:\s*(\S+)/i);
      if (ifMatch) {
        neighbors.push({
          localIfIndex: 0, // will be set later by matching ifName
          localIfName: ifMatch[1],
          deviceId,
          devicePort: ifMatch[2],
          address,
          platform,
          protocol: "cdp",
        });
      }
    }
  } else {
    // Parse table format — handle both IOS and Cisco SMB formats.
    // IOS format:    "Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID"
    //                "Switch2          Gi1/0/1           150              R S   C1300     Gi1/0/2"
    // SMB format:    "Device ID                                            Local Interface    Holdtme   Capability   Platform    Port ID"
    //                "switch2.example.com                                  gi1               150        S            CBS3xx-24P  gi25"
    const lines = output.split("\n");
    let inTable = false;
    let headerColumns: string[] = [];
    for (const line of lines) {
      // Detect header — line containing "Device ID" and "Local" and "Port"
      if (/Device ID/i.test(line) && /Local/i.test(line) && /Port/i.test(line)) {
        inTable = true;
        // Try to detect column positions from header
        headerColumns = [];
        const headerRegex = /(Device\s+ID|Local\s+Int\S*|Hold\S*|Capab\S*|Platform|Port\s+ID)/gi;
        let hm;
        while ((hm = headerRegex.exec(line)) !== null) {
          headerColumns.push(hm[0].replace(/\s+/g, " ").trim());
        }
        continue;
      }
      // Skip capability codes block (lines starting with "Capability Codes:")
      if (/^Capability Codes:/i.test(line) || /^\s+R\s*-\s*Router/i.test(line)) {
        inTable = false;
        continue;
      }
      // Skip separator lines
      if (/^-+\s*$/.test(line.trim()) || line.trim() === "") {
        if (inTable && line.trim() === "") {
          // Empty line might end the table
          // But continue scanning for more entries below
        }
        continue;
      }
      // Skip Total entries line: "Total entries displayed: 1"
      if (/^Total entries/i.test(line.trim())) {
        inTable = false;
        continue;
      }
      if (!inTable) continue;
      // Try to parse a port line.
      // Strategy: split by 2+ spaces, find columns matching expected positions.
      const tokens = line.split(/\s{2,}/).map(t => t.trim()).filter(t => t);
      // We expect at least 6 tokens: DeviceID, LocalIntf, Holdtme, Capability, Platform, PortID
      if (tokens.length >= 6) {
        const deviceId = tokens[0];
        const localIfName = tokens[1];
        const devicePort = tokens[tokens.length - 1];  // last token is Port ID
        const platform = tokens[tokens.length - 2];
        // Validate: local interface should look like a port name (gi1, Gi1/0/1, Te1, etc.)
        if (/^(gi|te|tw|fa|hu|fo|Gi|Te|Tw|Fa|Hu|Fo)/i.test(localIfName)) {
          // Validate: holdtme should be a number
          const holdtme = parseInt(tokens[2], 10);
          if (Number.isFinite(holdtme)) {
            neighbors.push({
              localIfIndex: 0,
              localIfName: localIfName,
              deviceId,
              devicePort,
              address: null,
              platform,
              protocol: "cdp",
            });
          }
        }
      } else if (tokens.length >= 3) {
        // Some SMB firmware has compact format with just: DeviceID, LocalIntf, PortID
        const deviceId = tokens[0];
        const localIfName = tokens[1];
        const devicePort = tokens[2];
        if (/^(gi|te|tw|fa|hu|fo|Gi|Te|Tw|Fa|Hu|Fo)/i.test(localIfName)) {
          neighbors.push({
            localIfIndex: 0,
            localIfName,
            deviceId,
            devicePort,
            address: null,
            platform: null,
            protocol: "cdp",
          });
        }
      }
    }
  }
  return neighbors;
}

/** Parse "show lldp neighbors" — similar table format.
 * Format:
 *   Device ID        Local Intf      Hold-time  Capability      Port ID
 *   Switch2          Gi1/0/1         120        B,R             Gi1/0/2
 */
function parseShowLldpNeighbors(output: string): CdpNeighbor[] {
  const neighbors: CdpNeighbor[] = [];
  const lines = output.split("\n");
  let inTable = false;
  for (const line of lines) {
    if (line.match(/Device ID.*Local\s*Intf/i)) { inTable = true; continue; }
    if (inTable) {
      if (line.trim() === "" || line.startsWith("---")) { inTable = false; continue; }
      const m = line.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/);
      if (m) {
        neighbors.push({
          localIfIndex: 0,
          localIfName: m[2],
          deviceId: m[1],
          devicePort: m[5],
          address: null,
          platform: null,
          protocol: "lldp",
        });
      }
    }
  }
  return neighbors;
}

/** Parse "show power inline" — PoE consumption per port + total. */
function parseShowPowerInline(output: string): { totalPoeWatts: number | null; perPort: Map<string, number> } {
  let totalPoeWatts: number | null = null;
  const perPort = new Map<string, number>();
  for (const line of output.split("\n")) {
    // Look for total wattage in lines like:
    //   "Totals:          4   196.0 Watts"
    const totalMatch = line.match(/(\d+(?:\.\d+)?)\s*Watts?\s*$/i);
    if (totalMatch && line.toLowerCase().includes("total")) {
      totalPoeWatts = parseFloat(totalMatch[1]);
      continue;
    }
    // Per-port lines:
    //   Gi1/0/1   auto   on       30.0  15.4  ...
    const portMatch = line.match(/^(\S+(?:\/\d+)*)\s+.*?(\d+(?:\.\d+)?)\s*W/i);
    if (portMatch) {
      const ifName = portMatch[1];
      const watts = parseFloat(portMatch[2]);
      if (watts > 0) perPort.set(ifName, watts);
    }
  }
  return { totalPoeWatts, perPort };
}

/** Parse "show environment power" — PSU status. */
function parseShowEnvironmentPower(output: string): PowerSupply[] {
  const psus: PowerSupply[] = [];
  let idx = 1000;
  for (const line of output.split("\n")) {
    // Look for lines with PSU status keywords
    if (line.match(/PSU|Power Supply|PWR/i)) {
      const isOk = /ok|on|operational|active/i.test(line) && !/fail|off|down|fault/i.test(line);
      const isFailed = /fail|fault|down/i.test(line);
      const isOff = /\boff\b|standby/i.test(line) && !/ok|on|operational/i.test(line);
      psus.push({
        index: idx++,
        status: isOk ? 1 : isFailed ? 3 : isOff ? 2 : 4,
        statusText: isOk ? "on" : isFailed ? "failed" : isOff ? "off" : "unknown",
        type: /AC/i.test(line) ? "AC" : /DC/i.test(line) ? "DC" : null,
      });
    }
  }
  return psus;
}

/** Main entry point — log into the switch via SSH and collect all data. */
export async function pollSwitchViaSsh(row: SwitchRow): Promise<PollResult | null> {
  if (!row.sshEnabled || !row.sshUsername || !row.sshPassword) {
    return null;
  }
  // Determine protocol — default SSH, but if cliProtocol field exists and is "telnet", use that
  let protocol: CliProtocol = (row as any).cliProtocol === "telnet" ? "telnet" : "ssh";
  let defaultPort = protocol === "telnet" ? 23 : 22;
  let config: CliConfig = {
    protocol,
    host: row.ipAddress,
    port: row.sshPort ?? defaultPort,
    username: row.sshUsername,
    password: row.sshPassword,
    timeout: 15000,
  };

  // First-attempt result. We may retry with the other protocol if this one fails.
  let result = await tryPollWithConfig(config, row);
  if (result && result.reachable && (result.cpuUsage != null || result.memoryUsed != null || result.interfaces.length > 0 || result.neighbors.length > 0)) {
    return result;
  }

  // If the first protocol failed entirely AND user is using SSH (not telnet),
  // automatically retry with Telnet — many Catalyst SMB switches have SSH misconfigured
  // (missing RSA keys, old ciphers) but Telnet just works.
  if (protocol === "ssh" && row.sshPort == null) {
    console.warn(`[cli] ${row.ipAddress}: SSH failed (${result?.error ?? "no data"}), auto-retrying with Telnet on port 23`);
    protocol = "telnet";
    defaultPort = 23;
    config = { ...config, protocol, port: defaultPort };
    const retryResult = await tryPollWithConfig(config, row);
    if (retryResult && (retryResult.cpuUsage != null || retryResult.memoryUsed != null || retryResult.interfaces.length > 0 || retryResult.neighbors.length > 0)) {
      retryResult.error = `SSH failed — auto-fell back to Telnet. ${retryResult.error ?? ""}`;
      return retryResult;
    }
    // Return whichever gave us more info
    return retryResult ?? result;
  }

  return result;
}

/** Helper — runs the poller with the given config and returns the PollResult. */
async function tryPollWithConfig(config: CliConfig, row: SwitchRow): Promise<PollResult | null> {
  const result: PollResult = {
    reachable: true,
    mode: "snmp",
    error: undefined,
    sysDescr: null,
    sysName: row.name,
    uptimeSeconds: null,
    cpuUsage: null,
    memoryUsed: null,
    memoryFree: null,
    power: null,
    interfaces: [] as any[],
    domReadings: {},
    thresholds: {},
    transceivers: [],
    neighbors: [],
    ringPortIfIndex: null,
    polledAt: new Date(),
  };

  // Run all commands in ONE persistent SSH/telnet session (much faster than
  // opening a new connection per command, which causes handshake timeouts).
  // Commands ordered with primary first, fallbacks after.
  // Note: We include both IOS and SMB commands because we don't know which
  // firmware the switch has until we try. Failed commands return
  // "% Unrecognized" which we filter out during parsing.
  const commands = [
    "show version",
    "show processes cpu",
    "show memory statistics",
    "show memory",                              // fallback if "statistics" not supported
    "show ports details",                       // Cisco SMB (Catalyst 1000/1300/1400) — port status
    "show ports description",                   // Cisco SMB — port descriptions
    "show cdp neighbors detail",
    "show cdp neighbors",                       // fallback if "detail" not supported
    "show lldp neighbors",
    "show power inline",
    "show environment power",
  ];

  let outputs: string[];
  try {
    if (config.protocol === "telnet") {
      // Telnet — use the persistent-session batch method (one TCP connection for all commands)
      outputs = await runTelnetCommandsBatch(config, commands);
    } else {
      // SSH — use the batch method (one connection for all commands)
      outputs = await runSshCommandsBatch(config, commands);
    }
  } catch (e: any) {
    // Whole batch failed — connection couldn't be established at all
    return {
      ...result,
      reachable: false,
      mode: "simulate",
      error: `${config.protocol.toUpperCase()} connection failed: ${e.message}`,
    };
  }

  // Parse each command's output
  let commandsRun = 0;
  let sshError: string | null = null;

  // 0: show version
  if (outputs[0]) {
    const parsed = parseShowVersion(outputs[0]);
    Object.assign(result, parsed);
    if (result.sysDescr || result.uptimeSeconds) commandsRun++;
    else sshError = "show version: didn't parse";
  } else sshError = "show version: empty output";

  // 1: show processes cpu
  if (outputs[1]) {
    const cpu = parseShowCpu(outputs[1]);
    if (cpu != null) { result.cpuUsage = cpu; commandsRun++; }
  }

  // 2: show memory statistics (or 3: show memory fallback)
  const memOut = outputs[2] || outputs[3];
  if (memOut) {
    const mem = parseShowMemory(memOut);
    if (mem) {
      result.memoryUsed = mem.used;
      result.memoryFree = mem.free;
      commandsRun++;
    }
  }

  // 4: show ports details (Cisco SMB), 5: show ports description (Cisco SMB)
  let ports: any[] = [];
  // Cisco SMB: "show ports details" (output 4) — has Port, Type, Duplex, Speed, State
  if (outputs[4] && !outputs[4].includes("% Unrecognized")) {
    ports = parseShowPortsDetails(outputs[4]);
  }
  // Cisco SMB: "show ports description" (output 5) — has Port + Description
  if (ports.length === 0 && outputs[5] && !outputs[5].includes("% Unrecognized")) {
    ports = parseShowPortsDescription(outputs[5]);
  }
  // Merge: if we got ports from status but no descriptions, try the description commands
  if (ports.length > 0) {
    let descMap = new Map<string, string>();
    if (outputs[5] && !outputs[5].includes("% Unrecognized")) {
      // SMB description: "show ports description"
      // Format: gi1       <description>
      for (const line of outputs[5].split("\n")) {
        const m = line.match(/^(\S+)\s+(.+)$/);
        if (m && m[1].match(/^(gi|te|tw|fa|hu|fo|po|ch)/i)) {
          descMap.set(m[1].toLowerCase(), m[2].trim());
        }
      }
    }
    // Apply descriptions to ports
    for (const p of ports) {
      const ifNameLower = (p.ifName || "").toLowerCase();
      if (descMap.has(ifNameLower) && !p.ifAlias) {
        p.ifAlias = descMap.get(ifNameLower);
      }
    }
  }
  let ifIndex = 1;
  for (const p of ports) {
    p.ifIndex = ifIndex++;
    result.interfaces.push(p as any);
  }
  if (ports.length > 0) commandsRun++;

  // 6: show cdp neighbors detail, 7: show cdp neighbors fallback
  const cdpOut = outputs[6] || outputs[7];
  if (cdpOut) {
    let cdp = parseShowCdpNeighbors(outputs[6] || "", true);
    if (cdp.length === 0 && outputs[7]) {
      cdp = parseShowCdpNeighbors(outputs[7], false);
    }
    result.neighbors.push(...cdp);
    if (cdp.length > 0) commandsRun++;
  }

  // 8: show lldp neighbors
  if (outputs[8]) {
    const lldp = parseShowLldpNeighbors(outputs[8]);
    result.neighbors.push(...lldp);
  }

  // 9: show power inline
  if (outputs[9]) {
    const { totalPoeWatts } = parseShowPowerInline(outputs[9]);
    if (totalPoeWatts != null) {
      if (!result.power) result.power = { powerSupplies: [], totalPoeMilliWatts: totalPoeWatts * 1000, totalPoeWatts };
      else { result.power.totalPoeWatts = totalPoeWatts; result.power.totalPoeMilliWatts = totalPoeWatts * 1000; }
    }
  }

  // 10: show environment power
  if (outputs[10]) {
    const psus = parseShowEnvironmentPower(outputs[10]);
    if (psus.length > 0) {
      if (!result.power) result.power = { powerSupplies: psus, totalPoeMilliWatts: null, totalPoeWatts: null };
      else result.power.powerSupplies = psus;
    }
  }

  // If we got no useful data at all, mark as unreachable
  const hasAnyData =
    result.sysDescr != null || result.uptimeSeconds != null ||
    result.cpuUsage != null || result.memoryUsed != null ||
    result.interfaces.length > 0 || result.neighbors.length > 0 ||
    result.power != null;

  if (!hasAnyData) {
    return {
      ...result,
      reachable: false,
      mode: "simulate",
      error: sshError ?? `${config.protocol.toUpperCase()} connection succeeded but no data was parsed`,
    };
  }

  // If at least some commands worked, mark as reachable but include any error
  if (sshError) {
    result.error = `Partial: ${commandsRun}/${commands.length} commands succeeded. Last error: ${sshError}`;
  }

  console.warn(`[${config.protocol}] ${row.name}: ${commandsRun}/${commands.length} cmds OK. ` +
               `interfaces=${result.interfaces.length} neighbors=${result.neighbors.length} cpu=${result.cpuUsage} mem=${result.memoryUsed}`);
  return result;
}
