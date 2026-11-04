# NETPULSE — ISP Network Monitoring Tool

> A Creation by JJ

NETPULSE is a NOC dashboard for monitoring Cisco managed switches across multiple ISP branch rings. It provides real-time SFP DOM (Tx/Rx power, temperature, voltage, bias current), per-link traffic Mbps, switch health (CPU/memory/uptime), and automatic ring topology detection via CDP/LLDP.

## Features

- **Multi-company + branch ring support** — Each company can have multiple branch rings (Mumbai, Kochi, Pune, etc.)
- **SFP DOM monitoring** — Tx/Rx power (dBm), temperature, voltage, bias current, optical margin with alarm/warning thresholds
- **Ring traffic** — Per-link In/Out Mbps, utilization %, with click-to-sort columns
- **Switch health** — CPU, memory, uptime, port status
- **Ring topology** — Circular and Linear SVG visualizations with hover-for-Mbps popover
- **CDP/LLDP auto-detection** — Automatically discovers SFP ports and ring topology
- **Alerts** — Real-time alert generation with severity-based sound (Web Audio API)
- **Password-protected settings** — All edit/delete actions require `Hipoint@123`
- **Search** — Find switches by name, IP, location, or sysName

## Tech Stack

- Next.js 16 (App Router) + TypeScript 5
- Tailwind CSS 4 + shadcn/ui
- Prisma ORM (SQLite)
- net-snmp for Cisco switch polling
- TanStack Query for auto-refresh
- Web Audio API for alert sounds

## Getting Started

```bash
# Install dependencies
bun install

# Push database schema
bun run db:push

# Start dev server
bun run dev
```

Open http://localhost:3000

## Default Password

Settings access: `Hipoint@123`

## License

MIT
