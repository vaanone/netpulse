import { db } from "@/lib/db";

(async () => {
  const alerts = await db.alert.findMany({
    where: { acknowledged: false, resolved: false },
    orderBy: { timestamp: "desc" },
    take: 10,
    select: { id: true, message: true, severity: true, category: true, timestamp: true, acknowledged: true },
  });
  console.log(`Active unacknowledged alerts: ${alerts.length}`);
  for (const a of alerts) {
    console.log(`  [${a.severity}] ${a.category}: ${a.message.slice(0, 80)}`);
    console.log(`    time: ${a.timestamp.toISOString()} ack: ${a.acknowledged}`);
  }
  
  // Check if there are duplicate messages
  const allActive = await db.alert.findMany({
    where: { acknowledged: false, resolved: false },
    select: { message: true },
  });
  const messages = allActive.map(a => a.message);
  const unique = new Set(messages);
  console.log(`\nTotal active: ${messages.length}, Unique messages: ${unique.size}`);
  
  // Show message frequency
  const freq: Record<string, number> = {};
  for (const m of messages) freq[m] = (freq[m] || 0) + 1;
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log("Top duplicates:");
  for (const [msg, count] of sorted) {
    console.log(`  ${count}x: ${msg.slice(0, 80)}`);
  }
})().finally(() => db.$disconnect());
