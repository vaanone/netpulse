import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ensureSeedSwitches } from "@/lib/seed";
import { Providers } from "./providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NETPULSE — ISP Network Monitoring Tool",
  description: "NETPULSE — ISP network monitoring tool for Cisco managed switches: SFP DOM, per-link traffic Mbps, switch health, multi-branch ring topology, CDP/LLDP auto-detection and alerts.",
  keywords: ["NETPULSE", "ISP", "network monitoring", "Cisco", "SFP", "DOM", "SNMP", "ring topology", "NOC dashboard", "Mbps", "CDP", "LLDP"],
  icons: { icon: "/netpulse-logo.png", apple: "/netpulse-logo.png" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  try { await ensureSeedSwitches(); } catch (e) { console.error("Seed error:", e); }
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <Providers>{children}</Providers>
        <Toaster />
        <SonnerToaster />
      </body>
    </html>
  );
}
