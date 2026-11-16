"""
Generate the Netpulse polling data-flow diagram for the client document.
English-only, so no CJK font concerns. Produces a clean horizontal flow
diagram saved as a PNG for embedding in the .docx.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

# Use a clean sans-serif available on the system
for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
    try:
        fm.fontManager.addfont(f)
    except Exception:
        pass
plt.rcParams["font.sans-serif"] = ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# DM-1-inspired palette (matches the document's Deep Cyan cover theme)
COL_BG = "#FFFFFF"
COL_BOX_FILL = "#EDF3F5"
COL_BOX_EDGE = "#1B6B7A"
COL_BOX_TITLE = "#0A1628"
COL_BOX_SUB = "#4A6575"
COL_ACCENT = "#37DCF2"
COL_ARROW = "#1B6B7A"

fig, ax = plt.subplots(figsize=(11.5, 3.4), dpi=150)
ax.set_xlim(0, 100)
ax.set_ylim(0, 30)
ax.axis("off")
fig.patch.set_facecolor(COL_BG)
ax.set_facecolor(COL_BG)

# (x_center, title, subtitle)
stages = [
    (10, "Network Switches", "Cisco IOS devices\nacross branch rings"),
    (32, "Polling Engine", "SNMP (v1/2c/3)\n+ SSH/Telnet fallback"),
    (54, "Processing", "Traffic deltas\nRing detection\nAlert generation"),
    (76, "Storage", "SQLite database\n+ live snapshot"),
    (95, "Dashboard", "Real-time KPIs,\ntables, topology"),
]

# Box geometry
box_w, box_h = 16.5, 11.0
y_box = 11.0

def draw_box(xc, title, sub):
    x0 = xc - box_w / 2
    p = FancyBboxPatch((x0, y_box), box_w, box_h,
                       boxstyle="round,pad=0.18,rounding_size=1.2",
                       linewidth=1.6, edgecolor=COL_BOX_EDGE,
                       facecolor=COL_BOX_FILL)
    ax.add_patch(p)
    ax.text(xc, y_box + box_h - 3.2, title, ha="center", va="center",
            fontsize=10.5, fontweight="bold", color=COL_BOX_TITLE)
    ax.text(xc, y_box + 3.4, sub, ha="center", va="center",
            fontsize=8.2, color=COL_BOX_SUB, linespacing=1.25)

for xc, title, sub in stages:
    draw_box(xc, title, sub)

# Arrows between boxes
arrow_ys = y_box + box_h / 2
for i in range(len(stages) - 1):
    x_start = stages[i][0] + box_w / 2 + 0.2
    x_end = stages[i + 1][0] - box_w / 2 - 0.2
    a = FancyArrowPatch((x_start, arrow_ys), (x_end, arrow_ys),
                        arrowstyle="-|>", mutation_scale=16,
                        linewidth=2.0, color=COL_ARROW)
    ax.add_patch(a)

# Labels above arrows (the cadence / mechanism)
arrow_labels = [
    (21, "every poll cycle\n(5s\u20131h, default 30s)"),
    (43, "parallel\nPromise.allSettled"),
    (65, "persist + cache"),
    (85.5, "auto-refresh\n(default 15s)"),
]
for xc, label in arrow_labels:
    ax.text(xc, arrow_ys + 5.0, label, ha="center", va="center",
            fontsize=7.6, color=COL_BOX_SUB, linespacing=1.2, style="italic")

# Title strip
ax.text(50, 27.5, "Netpulse \u2014 Polling & Data Flow",
        ha="center", va="center", fontsize=13, fontweight="bold",
        color=COL_BOX_TITLE)
ax.text(50, 24.3, "How switch data moves from the network to the dashboard",
        ha="center", va="center", fontsize=9, color=COL_BOX_SUB, style="italic")

plt.subplots_adjust(left=0.01, right=0.99, top=0.99, bottom=0.01)
out = "/home/z/my-project/download/netpulse-dataflow.png"
plt.savefig(out, dpi=150, facecolor=COL_BG, bbox_inches="tight", pad_inches=0.08)
plt.close()
print("saved:", out)
