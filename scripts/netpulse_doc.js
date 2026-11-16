// Netpulse — Features & Architecture client document generator.
// Cover: R1 recipe (design-system.md) with DM-1 Deep Cyan palette.
// Body: Profile A (formal), English, page numbers in footer.

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, SectionType,
} = require("docx");
const fs = require("fs");

// ── Palette ──────────────────────────────────────────────────────────────
// DM-1 Deep Cyan for the cover (dark bg, cyan accent, white title).
const COVER = {
  bg: "162235", titleColor: "FFFFFF", subtitleColor: "B0B8C0",
  metaColor: "90989F", accent: "37DCF2", footerColor: "687078",
};
// Body colours: deep navy headings, pure black text, darkened cyan for tables.
const BODY = {
  heading: "0A1628", body: "000000", accent: "1B6B7A",
  surface: "EDF3F5", innerLine: "C8DDE2", caption: "4A6575",
};

// ── Cover border constants ───────────────────────────────────────────────
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { ...noBorders, insideHorizontal: NB, insideVertical: NB };

// ── Cover title layout helpers (from design-system.md) ───────────────────
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..." \t-_/"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += " " + last;
  }
  return lines;
}

function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 11; // English chars are narrower than CJK
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false,
          hasEnglishLabel = false, metaLineCount = 0, fixedHeight = 800,
          pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 44, 26);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "),
        size: 18, color: P.accent, font: { ascii: "Arial" }, characterSpacing: 40 })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true,
        color: P.titleColor, font: { ascii: "Arial" } })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 28, color: P.subtitleColor,
        font: { ascii: "Arial" } })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 100 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 22, color: P.metaColor,
        font: { ascii: "Arial" } })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

// ── Body helpers ─────────────────────────────────────────────────────────
const FONT = { ascii: "Calibri" };
const FONT_H = { ascii: "Arial" };

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: BODY.heading, font: FONT_H })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: BODY.heading, font: FONT_H })],
  });
}
function body(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 160, line: 312 },
    children: [new TextRun({ text, size: 24, color: BODY.body, font: FONT })],
  });
}
function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 200, line: 280 },
    children: [new TextRun({ text, italics: true, size: 20, color: BODY.caption, font: FONT })],
  });
}
function tableTitle(text) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 120, after: 80, line: 312 },
    children: [new TextRun({ text, bold: true, size: 22, color: BODY.heading, font: FONT_H })],
  });
}

// Build a horizontal-only data table. headers: string[], rows: string[][], colWidths: number[] (percent, sum 100).
function dataTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: headers.map((text, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: BODY.accent },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        spacing: { line: 276 },
        children: [new TextRun({ text, bold: true, size: 21, color: "FFFFFF", font: FONT_H })],
      })],
    })),
  });
  const dataRows = rows.map((cells, ri) => new TableRow({
    cantSplit: true,
    children: cells.map((text, ci) => new TableCell({
      width: { size: colWidths[ci], type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? BODY.surface : "FFFFFF" },
      margins: { top: 70, bottom: 70, left: 120, right: 120 },
      children: [new Paragraph({
        spacing: { line: 276 },
        children: [new TextRun({ text, size: 21, color: BODY.body, font: FONT })],
      })],
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BODY.accent },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BODY.accent },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: BODY.innerLine },
      insideVertical: NB,
    },
    rows: [headerRow, ...dataRows],
  });
}

// ── Embedded diagram ─────────────────────────────────────────────────────
const imgPath = "/home/z/my-project/download/netpulse-dataflow.png";
const imgBuf = fs.readFileSync(imgPath);
// PNG is 1714x523 -> aspect 0.3052; display width 560 -> height 171
const IMG_W = 560, IMG_H = 171;
const diagram = new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 160, after: 80 },
  children: [new ImageRun({ data: imgBuf, transformation: { width: IMG_W, height: IMG_H }, type: "png" })],
});

// ── Body content ─────────────────────────────────────────────────────────
const bodyChildren = [];

// 1. Executive Summary
bodyChildren.push(h1("1. Executive Summary"));
bodyChildren.push(body("Netpulse is a purpose-built network operations dashboard for Internet Service Providers (ISPs) that run Cisco-based branch rings. It continuously polls every switch on the network, computes live traffic and health metrics, auto-detects ring topology from the switches themselves, and surfaces problems through a single real-time view, so operators see the entire network at a glance instead of logging into devices one by one."));
bodyChildren.push(body("The product is a self-contained web application: it runs on a single server, stores its data in a local database, and is reached through any modern browser on the local network. Authentication, role-based access, and a configurable polling cadence are built in, making it suitable for a 24/7 operations environment where different staff need different levels of control. This document explains what Netpulse does, how its polling and alerting logic work under the hood, and how the recently added configurability, a server-wide poll interval and a per-browser dashboard auto-refresh, lets each deployment match its own operating rhythm without any database maintenance."));

// 2. The Dashboard at a Glance
bodyChildren.push(h1("2. The Dashboard at a Glance"));
bodyChildren.push(body("The dashboard is a single dark-themed page organised into clearly labelled sections. An operator can show or hide each section individually from the Settings page, so the view can be tailored to what matters on a given shift. At the top, six Summary KPI cards give the headline view of the network: how many switches are up, how many ring links are healthy, total ingress and egress traffic across ring ports, the number of active alerts, and the count of auto-detected ring ports. Below the KPIs, a live ring-topology diagram draws the network as it is actually wired, with colour-coded links that reflect health and utilisation."));
bodyChildren.push(body("The remaining sections present detailed tables for ring traffic and utilisation, switch health and uptime, SFP transceiver readings, the full interface list, and a live alert feed. A persistent footer summarises the current poll interval, the auto-refresh interval, and the time of the last successful poll, so the operator always knows how fresh the figures on screen are. The table below lists the principal dashboard sections and what each one shows."));
bodyChildren.push(tableTitle("Table 1: Dashboard sections"));
bodyChildren.push(dataTable(
  ["Section", "What it shows"],
  [
    ["Summary KPIs", "Six headline cards: switches up, ring links up, total ingress/egress, active alerts, ring ports detected."],
    ["Ring Topology", "Live SVG diagram of the rings (circular or linear), with per-link traffic, health colour, and utilisation weight."],
    ["Ring Traffic", "Per-link table of ingress/egress Mbps, utilisation percentage, and receive power, with sortable columns."],
    ["Switch Health", "Per-switch status, uptime, ports up/down, SFP port count, CDP neighbors, and last-seen time."],
    ["SFP DOM", "Per-switch transceiver readings: Tx/Rx power, temperature, and utilisation against alarm thresholds."],
    ["All Interfaces", "Detailed per-interface counters with filter tabs for All, Ring, SFP, and Down ports."],
    ["Alerts", "Live feed of the most recent unacknowledged alerts, with severity, category, and one-click acknowledge."],
    ["Search Switch", "Live filter by name, IP, location, ring, or company, with a per-result refresh for administrators."],
  ],
  [26, 74],
));

// 3. How Netpulse Polls Your Network
bodyChildren.push(h1("3. How Netpulse Polls Your Network"));
bodyChildren.push(body("At the heart of Netpulse is a polling engine that contacts every configured switch on a fixed cadence and turns the raw responses into the metrics shown on the dashboard. Each switch is polled primarily over SNMP, supporting versions 1, 2c, and 3, including SNMPv3 authentication and encryption, because SNMP is fast and unobtrusive. When a switch is unreachable over SNMP, or when richer data is available through the command line, the engine falls back to an SSH or Telnet session that logs in, runs the relevant Cisco IOS show commands, and parses the output into the same data shape. As a last resort, an unreachable switch is clearly marked as down rather than silently ignored."));
bodyChildren.push(body("To keep the dashboard responsive, the engine polls all switches in parallel each cycle and caches SSH results for two minutes; only the traffic counters are refreshed from SNMP on every cycle, so the screen can update in seconds instead of waiting for each SSH session to complete. Traffic rates are computed as deltas between consecutive cycles using 64-bit counters, with a 32-bit fallback, and utilisation is derived against each port's configured link speed. The poll interval itself is now configurable, anywhere from five seconds to one hour with a default of thirty seconds, and a change takes effect on the next scheduled cycle. The diagram below shows how data moves from the network to the dashboard."));
bodyChildren.push(diagram);
bodyChildren.push(caption("Figure 1: Netpulse polling and data flow, from switches to dashboard."));

// 4. Ring Topology & Auto-Detection
bodyChildren.push(h1("4. Ring Topology and Auto-Detection"));
bodyChildren.push(body("Netpulse models an ISP network as a hierarchy: a Company owns one or more Rings (branch rings), and each Ring contains a chain of Switches linked by their next-switch relationship. Rather than requiring an operator to wire this topology by hand, the engine reads each switch's CDP and LLDP neighbor tables and matches what it finds against the configured switches, by IP address, by exact name, and by name suffix. When a switch's configured next hop appears among its neighbors, the local port is confirmed as a ring port automatically."));
bodyChildren.push(body("When no next hop has been set yet, the engine suggests a same-ring directly-connected neighbor and, where two configured switches see each other over CDP and neither is linked, it pairs them and persists the relationship, closing the ring for three or more switches. The detected topology is then drawn as an SVG diagram, circular for a full ring and linear for a pair, with bidirectional arrows showing per-link ingress and egress, coloured by health and weighted by utilisation. Hovering a link reveals its traffic, health, and optical receive power, and clicking a node opens the switch detail dialog."));

// 5. The Alert System
bodyChildren.push(h1("5. The Alert System"));
bodyChildren.push(body("Netpulse turns the data it collects into actionable alerts, so that problems are surfaced on screen, and audibly, the moment they are detected. Alerts fall into three categories: link, optical, and traffic. Link alerts cover the most serious conditions, a switch becoming unreachable, a ring link going down, or a ring port going down, and are always critical. Optical alerts watch the receive and transmit power on ring SFP ports, warning when levels drop into a marginal range and escalating to critical when they cross a port's alarm threshold. Traffic alerts flag links that are saturating and interfaces that are accumulating errors."));
bodyChildren.push(body("Each alert carries a severity, a category, the affected switch, and a timestamp, and appears in the live alert feed with a one-click acknowledge action for administrators. The engine also avoids noise: it de-duplicates alerts that share the same switch, port, and message, refreshing the existing alert's timestamp rather than creating a duplicate, and it auto-resolves alerts once the underlying condition clears. Resolved alerts drop out of the feed and are retained for thirty days for audit. The table below summarises the alert thresholds."));
bodyChildren.push(tableTitle("Table 2: Alert categories and thresholds"));
bodyChildren.push(dataTable(
  ["Category", "Condition", "Severity"],
  [
    ["Link", "Switch unreachable", "Critical"],
    ["Link", "Ring link down", "Critical"],
    ["Link", "Ring port down", "Critical"],
    ["Optical", "Rx or Tx power below -16 dBm", "Warning"],
    ["Optical", "Rx power at or below port alarm threshold", "Critical"],
    ["Traffic", "Utilisation above 80%", "Warning"],
    ["Traffic", "Utilisation above 95%", "Critical"],
    ["Traffic", "Interface errors above 0", "Warning"],
    ["Traffic", "Interface errors above 100", "Critical"],
  ],
  [16, 56, 28],
));

// 6. Configurable Poll Interval & Dashboard Auto-Refresh
bodyChildren.push(h1("6. Configurable Poll Interval and Auto-Refresh"));
bodyChildren.push(body("A common point of confusion is the difference between two independently configurable timers, so it is worth stating plainly. The poll interval is server-wide: it controls how often Netpulse contacts the switches over SNMP or SSH. It is set by an administrator on the Settings page, ranges from five seconds to one hour, defaults to thirty seconds, and applies immediately, with the next scheduled poll cycle picking up the new value. The dashboard auto-refresh interval, by contrast, is per-browser: it controls how often each operator's screen refetches the already-polled snapshot from the server."));
bodyChildren.push(body("The auto-refresh interval is set individually by each user, ranges from five seconds to one hour, defaults to fifteen seconds, and is remembered by that browser. The two are deliberately separate so that the server can poll at a steady, conservative cadence, say once a minute, while an operator who wants a livelier view can refresh their own screen more often; they simply re-read the latest cached snapshot until the next poll completes. Both values are shown in the footer status bar, so it is always clear which cadences are in effect. The poll interval persists across server restarts without any database migration: it is stored in a small server-side settings file that is read when the application starts. The table below contrasts the two timers."));
bodyChildren.push(tableTitle("Table 3: Poll interval versus dashboard auto-refresh"));
bodyChildren.push(dataTable(
  ["Aspect", "Poll Interval", "Auto-Refresh"],
  [
    ["Scope", "Server-wide (all switches)", "Per browser"],
    ["Default", "30 seconds", "15 seconds"],
    ["Range", "5 s to 3600 s", "5 s to 3600 s"],
    ["Set by", "Administrator", "Each user"],
    ["Where", "Settings, Automation card", "Settings, Automation card"],
    ["Persists", "Server settings file (survives restart)", "Browser local storage"],
    ["Takes effect", "Next poll cycle", "After returning to the dashboard"],
  ],
  [22, 39, 39],
));

// 7. Settings & Access Control
bodyChildren.push(h1("7. Settings and Access Control"));
bodyChildren.push(body("The Settings page gathers everything an operator or administrator might want to adjust into one place. The Automation card holds the auto-poll and auto-refresh toggles and the two interval inputs. The Dashboard Sections card lets each user choose which sections appear on the dashboard. The Header Buttons card toggles the Jump-to dropdown and the Poll-Now button. Administrators additionally see a User Management card, to create users, change passwords, and promote or demote between roles, and a Network Management card with shortcuts to add switches and manage companies."));
bodyChildren.push(body("Access is role-based: an administrator has full control, while a view-only user can see everything and adjust their own display preferences but cannot change the server-wide poll interval, acknowledge alerts, poll on demand, or manage the network or users. Login is session-based: a signed, HttpOnly cookie is issued on login and re-checked against the database on sensitive actions, so a user who is demoted or removed is locked out immediately without waiting for their session to expire. A default administrator account is seeded automatically when the system first starts, so the deployment is usable from the first run."));

// 8. Data Persistence & Reliability
bodyChildren.push(h1("8. Data Persistence and Reliability"));
bodyChildren.push(body("Netpulse stores its operational data, companies, rings, switches, neighbors, SFP readings, metrics, alerts, and users, in a local SQLite database that lives alongside the application. This keeps deployment simple: there is no external database server to install, secure, or back up separately, and the entire system can be moved by copying the application directory. Server-wide settings that need to survive a restart but change rarely, such as the poll interval, are kept in a separate small settings file rather than a database table; this means adjusting the poll interval never requires a database migration or a maintenance window."));
bodyChildren.push(body("The engine also manages its own data growth: metric rows older than twenty-four hours are pruned each cycle, and resolved alerts older than thirty days are deleted, so the database stays compact over time without manual cleanup. Unreachable switches are skipped for port and metric persistence, which avoids filling the database with empty rows during an outage. Together these choices mean the system can run unattended for long periods while remaining responsive and easy to maintain."));

// 9. Technology Stack
bodyChildren.push(h1("9. Technology Stack"));
bodyChildren.push(body("Netpulse is built on a modern, widely supported web stack, chosen for reliability and a small operational footprint. All of the components are open source and run on a single server, which keeps licensing and infrastructure costs predictable. The table below summarises the principal components and the role each plays."));
bodyChildren.push(tableTitle("Table 4: Principal technology components"));
bodyChildren.push(dataTable(
  ["Layer", "Technology", "Role"],
  [
    ["Framework", "Next.js (App Router)", "Web application and API server"],
    ["Language", "TypeScript", "Type-safe codebase end to end"],
    ["Data", "Prisma + SQLite", "Local operational database"],
    ["Polling", "net-snmp, ssh2", "SNMP and SSH/Telnet switch access"],
    ["Frontend", "React, TanStack Query, shadcn/ui", "Dashboard UI and client data caching"],
    ["Auth", "scrypt + HMAC session cookie", "Login and role-based access control"],
  ],
  [22, 32, 46],
));

// 10. Summary of Benefits
bodyChildren.push(h1("10. Summary of Benefits"));
bodyChildren.push(body("Netpulse gives an ISP operations team a single, always-on view of a Cisco-based branch-ring network, replacing a routine of serial device logins with a live dashboard. The polling engine does the heavy lifting, contacting every switch over SNMP with a secure SSH/Telnet fallback, computing traffic deltas, auto-detecting ring topology, and generating alerts, while the dashboard presents the results in sections an operator can tailor to the moment."));
bodyChildren.push(body("Configurability is built in: the server-wide poll interval and each browser's auto-refresh are independently adjustable, and both are reflected in the footer so the freshness of the figures is never in doubt. Role-based access, session-based authentication, self-managed data retention, and a self-contained SQLite deployment keep the system secure and low-maintenance. The result is a network monitoring tool that is real-time, customisable, and straightforward to operate."));

// ── Document assembly ────────────────────────────────────────────────────
const coverConfig = {
  palette: COVER,
  englishLabel: "PRODUCT OVERVIEW",
  title: "Netpulse",
  subtitle: "ISP Network Manager",
  metaLines: [
    "A JJ TechHub Product",
    "Features & Architecture",
    "Version 1.0  ·  November 2026",
  ],
  footerLeft: "JJ TechHub",
  footerRight: "Netpulse — ISP Network Manager",
};

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 24, color: BODY.body },
        paragraph: { spacing: { line: 312 } },
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
        },
      },
      children: buildCoverR1(coverConfig),
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "Netpulse — Features & Architecture", size: 18, color: "888888", font: FONT })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT })],
          })],
        }),
      },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = "/home/z/my-project/download/Netpulse_Features_and_Technical_Overview.docx";
  fs.writeFileSync(out, buf);
  console.log("saved:", out, "(" + buf.length + " bytes)");
});
