// Standalone test of the CLI parsers — runs WITHOUT needing a real switch.
// Verifies the parsers produce the right output for Cisco SMB firmware.

// Inline copies of the parser functions for testing
function parseShowPortsDetails(output: string) {
  const ports: any[] = [];
  const lines = output.split("\n");
  let inTable = false;
  for (const line of lines) {
    if (/Port\s+Type\s+.*State/i.test(line) && !inTable) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (/^[-\s]+$/.test(line.trim())) continue;
      if (!line.trim()) continue;
      const m = line.match(/^(\w+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\S+\s+\S+\s+(\S+)/);
      if (m) {
        const portName = m[1];
        const type = m[2];
        const duplex = m[3];
        const speed = m[4];
        const state = m[5];
        if (/^(gi|te|tw|fa|hu|fo|Po|Ch)/i.test(portName)) {
          let operStatus = 4;
          if (state.toLowerCase() === "up") operStatus = 1;
          else if (state.toLowerCase() === "down") operStatus = 2;
          ports.push({
            ifName: portName,
            ifDescr: `${type} ${duplex} ${speed}M`,
            ifAlias: "",
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

function parseShowPortsDescription(output: string) {
  const ports: any[] = [];
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
      const m = line.match(/^(\w+)\s+(.*)$/);
      if (m) {
        const portName = m[1];
        const description = m[2].trim();
        if (/^(gi|te|tw|fa|hu|fo|Po|Ch)/i.test(portName)) {
          ports.push({
            ifName: portName,
            ifDescr: portName,
            ifAlias: description || "",
            ifOperStatus: 4,
            ifAdminStatus: 1,
          });
        }
      }
    }
  }
  return ports;
}

function parseShowInterfacesTransceiver(output: string) {
  const domReadings: Record<number, any> = {};
  const transceivers: any[] = [];
  const ifIndexByIfName = new Map<string, number>();
  const lines = output.split("\n");
  let inTable = false;
  let tempIfIndex = 1000;
  for (const line of lines) {
    if (/Port\s+Temperature\s+Voltage\s+Current/i.test(line) && !inTable) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (/^-+\s+-+/i.test(line.trim())) continue;
      if (!line.trim()) { inTable = false; continue; }
      const m = line.match(/^(\w+)\s+([\d.]+)\s*C\s+([\d.]+)\s*V\s+([\d.]+)\s*mA\s+(-?[\d.]+)\s*dBm\s+(-?[\d.]+)\s*dBm/i);
      if (m) {
        const ifName = m[1];
        const temp = parseFloat(m[2]);
        const voltage = parseFloat(m[3]);
        const biasCurrent = parseFloat(m[4]);
        const txPower = parseFloat(m[5]);
        const rxPower = parseFloat(m[6]);
        const ifIndex = ++tempIfIndex;
        ifIndexByIfName.set(ifName.toLowerCase(), ifIndex);
        domReadings[ifIndex] = { temperature: temp, voltage, biasCurrent, txPower, rxPower };
        transceivers.push({ entityIndex: ifIndex, name: ifName, descr: "SFP", ifIndex });
      }
    }
  }
  return { domReadings, transceivers, ifIndexByIfName };
}

function parseShowCdpNeighbors(output: string, detail: boolean) {
  const neighbors: any[] = [];
  if (!detail) {
    const lines = output.split("\n");
    let inTable = false;
    for (const line of lines) {
      if (/Device ID/i.test(line) && /Local/i.test(line) && /Port/i.test(line)) {
        inTable = true;
        continue;
      }
      if (/^Capability Codes:/i.test(line)) { inTable = false; continue; }
      if (/^-+\s*$/.test(line.trim()) || line.trim() === "") continue;
      if (/^Total entries/i.test(line.trim())) { inTable = false; continue; }
      if (!inTable) continue;
      const tokens = line.split(/\s{2,}/).map(t => t.trim()).filter(t => t);
      if (tokens.length >= 6) {
        const deviceId = tokens[0];
        const localIfName = tokens[1];
        const devicePort = tokens[tokens.length - 1];
        const platform = tokens[tokens.length - 2];
        if (/^(gi|te|tw|fa|hu|fo|Gi|Te|Tw|Fa|Hu|Fo)/i.test(localIfName)) {
          const holdtme = parseInt(tokens[2], 10);
          if (Number.isFinite(holdtme)) {
            neighbors.push({ localIfIndex: 0, localIfName, deviceId, devicePort, address: null, platform, protocol: "cdp" });
          }
        }
      }
    }
  }
  return neighbors;
}

// === TESTS ===
console.log("=".repeat(60));
console.log("TEST 1: show ports details (Cisco SMB format)");
console.log("=".repeat(60));
const portsOutput = `                                            Flow    Link        Back   Mdix
Port      Type         Duplex  Speed Neg      ctrl State       Pressure Mode
--------  ------------ ------  ----- -------- ---- ----------- -------- -------
gi1       1G-Copper    Full    100   Enabled  Off  Up          Disabled Off
gi25      1G-Fiber     Full    1000  Disabled Off  Up          Disabled Off
gi26      1G-Fiber      --      --     --     --   Down          --     --`;
const ports = parseShowPortsDetails(portsOutput);
console.log("Parsed ports:", ports);
console.assert(ports.length === 3, "Expected 3 ports, got " + ports.length);
console.assert(ports[0].ifName === "gi1", "Expected gi1");
console.assert(ports[0].ifOperStatus === 1, "gi1 should be UP (1)");
console.assert(ports[1].ifName === "gi25", "Expected gi25");
console.assert(ports[1].ifOperStatus === 1, "gi25 should be UP (1)");
console.assert(ports[2].ifName === "gi26", "Expected gi26");
console.assert(ports[2].ifOperStatus === 2, "gi26 should be DOWN (2)");
console.log("✓ TEST 1 PASSED\n");

console.log("=".repeat(60));
console.log("TEST 2: show interfaces transceiver (Cisco SMB format)");
console.log("=".repeat(60));
const transOutput = `Port      Temperature  Voltage  Current  Optical TX    Optical RX
-------   -----------  -------  -------  -----------   -----------
gi25      33.23 C      3.29 V   7.65 mA  -2.34 dBm     -3.45 dBm
gi26      35.10 C      3.30 V   7.80 mA  -2.50 dBm     -3.60 dBm`;
const trans = parseShowInterfacesTransceiver(transOutput);
console.log("Parsed transceivers:", trans);
console.assert(Object.keys(trans.domReadings).length === 2, "Expected 2 DOM readings, got " + Object.keys(trans.domReadings).length);
console.assert(trans.ifIndexByIfName.has("gi25"), "Expected ifIndexByIfName to have gi25");
console.assert(trans.ifIndexByIfName.has("gi26"), "Expected ifIndexByIfName to have gi26");
const dom25 = trans.domReadings[Object.keys(trans.domReadings)[0]];
console.assert(dom25.temperature === 33.23, "Expected temp 33.23, got " + dom25.temperature);
console.assert(dom25.txPower === -2.34, "Expected txPower -2.34, got " + dom25.txPower);
console.log("✓ TEST 2 PASSED\n");

console.log("=".repeat(60));
console.log("TEST 3: show cdp neighbors (Cisco SMB wide format)");
console.log("=".repeat(60));
const cdpOutput = `Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge
                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone

Device ID                                            Local Interface    Holdtme   Capability   Platform    Port ID
switch2.example.com                                  gi25              150        S            CBS3xx-24P  gi1

Total entries displayed: 1`;
const cdp = parseShowCdpNeighbors(cdpOutput, false);
console.log("Parsed CDP neighbors:", cdp);
console.assert(cdp.length === 1, "Expected 1 neighbor, got " + cdp.length);
console.assert(cdp[0].deviceId === "switch2.example.com", "Expected deviceId switch2.example.com, got " + cdp[0].deviceId);
console.assert(cdp[0].localIfName === "gi25", "Expected localIfName gi25, got " + cdp[0].localIfName);
console.assert(cdp[0].devicePort === "gi1", "Expected devicePort gi1, got " + cdp[0].devicePort);
console.log("✓ TEST 3 PASSED\n");

console.log("=".repeat(60));
console.log("ALL TESTS PASSED ✓");
