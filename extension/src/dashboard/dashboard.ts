/**
 * dashboard.ts — Anti Brain Rot new-tab dashboard
 *
 * Reads today's DailyLogEntry array from chrome.storage.local and renders:
 *   - Stat cards (total, YouTube, Instagram, avg impact)
 *   - Hourly activity bar chart (canvas)
 *   - Emotional signal bars
 *   - Platform split
 *   - Topic cloud
 *
 * Listens to chrome.storage.onChanged for live updates.
 */

interface DailyLogEntry {
  timestamp: number;
  source: "youtube_shorts" | "instagram_reels";
  impact: number;
  emotionalIntensity: number;
  rageBait: number;
  sadness: number;
  anxietyRelated: number;
  fomo: number;
  socialComparison: number;
  relationshipDistress: number;
  humor: number;
  inspirational: number;
  topicTags: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayKey(): string {
  return `dailyLog_${new Date().toISOString().slice(0, 10)}`;
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pct(n: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

// ─── Clock ────────────────────────────────────────────────────────────────────

function startClock(): void {
  const clockEl = document.getElementById("clock")!;
  const dateEl = document.getElementById("date-str")!;

  function tick() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, "0");
    const m = now.getMinutes().toString().padStart(2, "0");
    clockEl.textContent = `${h}:${m}`;
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
  }
  tick();
  setInterval(tick, 10_000);
}

// ─── Hourly canvas chart ──────────────────────────────────────────────────────

function renderHourlyChart(entries: DailyLogEntry[]): void {
  const canvas = document.getElementById("hourly-canvas") as HTMLCanvasElement;
  if (!canvas) return;

  // Set pixel dimensions
  const W = canvas.parentElement!.clientWidth - 48; // section padding
  const H = 150;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);

  const ytCounts = new Array(24).fill(0);
  const igCounts = new Array(24).fill(0);

  entries.forEach((e) => {
    const h = new Date(e.timestamp).getHours();
    if (e.source === "youtube_shorts") ytCounts[h]++;
    else igCounts[h]++;
  });

  const totals = ytCounts.map((y, i) => y + igCounts[i]);
  const maxCount = Math.max(...totals, 1);
  const currentHour = new Date().getHours();

  const LABEL_H = 28;
  const chartH = H - LABEL_H;
  const barW = W / 24;
  const gap = 3;

  for (let h = 0; h < 24; h++) {
    const x = h * barW;
    const bw = barW - gap;

    // Highlight current hour
    if (h === currentHour) {
      ctx.fillStyle = "rgba(37,99,235,0.07)";
      ctx.fillRect(x, 0, bw + gap, chartH);
    }

    const ytH = (ytCounts[h] / maxCount) * chartH;
    const igH = (igCounts[h] / maxCount) * chartH;
    const totalH = ytH + igH;

    // Empty bar baseline
    if (totals[h] === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(x + gap / 2, chartH - 4, bw, 4);
      renderLabel(ctx, h, x + bw / 2, H);
      continue;
    }

    // YouTube segment (bottom)
    if (ytCounts[h] > 0) {
      ctx.fillStyle = "#d93025";
      ctx.beginPath();
      roundRect(ctx, x + gap / 2, chartH - totalH, bw, ytH + 4, 0, 0, 3, 3);
      ctx.fill();
    }

    // Instagram segment (top)
    if (igCounts[h] > 0) {
      ctx.fillStyle = "#9b287a";
      ctx.beginPath();
      roundRect(ctx, x + gap / 2, chartH - totalH, bw, igH + (ytCounts[h] > 0 ? 0 : 4), 3, 3, 0, 0);
      ctx.fill();
    }

    // Count label on tall bars
    if (totals[h] > 0 && totalH > 22) {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(totals[h]), x + bw / 2, chartH - totalH - 5);
    }

    renderLabel(ctx, h, x + bw / 2, H);
  }

  // Peak annotation
  const peakHour = totals.indexOf(Math.max(...totals));
  if (totals[peakHour] > 0) {
    const peakEl = document.getElementById("hourly-peak");
    if (peakEl) {
      const label = formatHour(peakHour);
      peakEl.textContent = `peak at ${label} (${totals[peakHour]} items)`;
    }
  }
}

function renderLabel(
  ctx: CanvasRenderingContext2D,
  h: number,
  x: number,
  canvasH: number
): void {
  // Only show every 3 hours
  if (h % 3 !== 0) return;
  ctx.fillStyle = "rgba(107,124,147,0.75)";
  ctx.font = "10px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(formatHour(h), x, canvasH - 6);
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  tlr: number, trr: number, brr: number, blr: number
): void {
  if (h <= 0 || w <= 0) return;
  ctx.moveTo(x + tlr, y);
  ctx.lineTo(x + w - trr, y);
  ctx.arcTo(x + w, y, x + w, y + trr, trr);
  ctx.lineTo(x + w, y + h - brr);
  ctx.arcTo(x + w, y + h, x + w - brr, y + h, brr);
  ctx.lineTo(x + blr, y + h);
  ctx.arcTo(x, y + h, x, y + h - blr, blr);
  ctx.lineTo(x, y + tlr);
  ctx.arcTo(x, y, x + tlr, y, tlr);
}

// ─── Emotion bars ─────────────────────────────────────────────────────────────

interface EmotionDef {
  key: keyof DailyLogEntry;
  label: string;
  color: string;
}

const EMOTIONS: EmotionDef[] = [
  { key: "emotionalIntensity", label: "Emotional Intensity", color: "#f97316" },
  { key: "rageBait",           label: "Rage-bait",           color: "#ef4444" },
  { key: "sadness",            label: "Sadness",             color: "#818cf8" },
  { key: "anxietyRelated",     label: "Anxiety",             color: "#f59e0b" },
  { key: "fomo",               label: "FOMO",                color: "#ec4899" },
  { key: "socialComparison",   label: "Social Comparison",   color: "#a78bfa" },
  { key: "humor",              label: "Humor ✦",             color: "#34d399" },
  { key: "inspirational",      label: "Inspirational ✦",     color: "#4facfe" },
];

function renderEmotions(entries: DailyLogEntry[]): void {
  const list = document.getElementById("emotion-list")!;
  if (!list) return;
  list.innerHTML = "";

  EMOTIONS.forEach(({ key, label, color }) => {
    const vals = entries.map((e) => e[key] as number).filter((v) => typeof v === "number");
    const mean = avg(vals);
    const pctVal = Math.round(mean * 100);

    const row = document.createElement("div");
    row.className = "emotion-row";
    row.innerHTML = `
      <div class="emotion-meta">
        <span class="emotion-label">${label}</span>
        <span class="emotion-pct">${pctVal}%</span>
      </div>
      <div class="emotion-track">
        <div class="emotion-fill" style="width:${pctVal}%;background:${color}"></div>
      </div>
    `;
    list.appendChild(row);
  });
}

// ─── Platform split ───────────────────────────────────────────────────────────

function renderPlatformSplit(entries: DailyLogEntry[]): void {
  const ytEntries = entries.filter((e) => e.source === "youtube_shorts");
  const igEntries = entries.filter((e) => e.source === "instagram_reels");
  const total = entries.length || 1;

  const ytPct = Math.round((ytEntries.length / total) * 100);
  const igPct = 100 - ytPct;

  setText("yt-pct-bar", `${ytPct}%`);
  setText("ig-pct-bar", `${igPct}%`);

  const splitBar = document.getElementById("split-bar");
  if (splitBar) splitBar.style.width = `${ytPct}%`;

  setText("pc-yt", String(ytEntries.length));
  setText("pc-ig", String(igEntries.length));

  const ytAvg = avg(ytEntries.map((e) => e.impact));
  const igAvg = avg(igEntries.map((e) => e.impact));
  setText("pc-yt-avg", `avg impact ${ytEntries.length ? fmt(ytAvg) : "—"}`);
  setText("pc-ig-avg", `avg impact ${igEntries.length ? fmt(igAvg) : "—"}`);

  // Rage by platform bars
  const ytRage = avg(ytEntries.map((e) => e.rageBait));
  const igRage = avg(igEntries.map((e) => e.rageBait));
  const maxRage = Math.max(ytRage, igRage, 0.01);

  setStyle("pe-yt-rage", "width", `${Math.round((ytRage / maxRage) * 100)}%`);
  setStyle("pe-ig-rage", "width", `${Math.round((igRage / maxRage) * 100)}%`);
  setText("pe-yt-rage-val", ytEntries.length ? fmt(ytRage) : "—");
  setText("pe-ig-rage-val", igEntries.length ? fmt(igRage) : "—");
}

// ─── Topic cloud ──────────────────────────────────────────────────────────────

function renderTopics(entries: DailyLogEntry[]): void {
  const cloud = document.getElementById("topics-cloud")!;
  if (!cloud) return;
  cloud.innerHTML = "";

  const counts: Record<string, number> = {};
  entries.forEach((e) => {
    e.topicTags.forEach((tag) => {
      counts[tag] = (counts[tag] ?? 0) + 1;
    });
  });

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  if (sorted.length === 0) {
    cloud.textContent = "No topics yet.";
    return;
  }

  const maxFreq = sorted[0][1];

  sorted.forEach(([tag, count], i) => {
    const pill = document.createElement("span");
    pill.className = "topic-pill" + (i === 0 ? " top1" : count >= maxFreq * 0.6 ? " top2" : "");
    pill.textContent = count > 1 ? `${tag} ×${count}` : tag;
    cloud.appendChild(pill);
  });
}

// ─── Stat cards ───────────────────────────────────────────────────────────────

function renderStats(entries: DailyLogEntry[]): void {
  const total = entries.length;
  const ytCount = entries.filter((e) => e.source === "youtube_shorts").length;
  const igCount = entries.filter((e) => e.source === "instagram_reels").length;
  const meanImpact = avg(entries.map((e) => e.impact));

  setText("stat-total", String(total));
  setText("stat-yt", String(ytCount));
  setText("stat-yt-pct", total ? `${pct(ytCount, total)} of total` : "of total");
  setText("stat-ig", String(igCount));
  setText("stat-ig-pct", total ? `${pct(igCount, total)} of total` : "of total");
  setText("stat-impact", total ? fmt(meanImpact) : "—");
}

// ─── Full render ──────────────────────────────────────────────────────────────

function render(entries: DailyLogEntry[]): void {
  const emptyEl = document.getElementById("empty-state")!;
  const hoursEl = document.getElementById("hourly-section")!;
  const bottomEls = document.querySelectorAll<HTMLElement>(".bottom-row > .section");
  const topicsEl = document.getElementById("topics-section")!;

  const hasData = entries.length > 0;
  emptyEl.style.display = hasData ? "none" : "flex";
  hoursEl.style.display = hasData ? "" : "none";
  bottomEls.forEach((el) => (el.style.display = hasData ? "" : "none"));
  topicsEl.style.display = hasData ? "" : "none";

  if (!hasData) return;

  renderStats(entries);
  renderHourlyChart(entries);
  renderEmotions(entries);
  renderPlatformSplit(entries);
  renderTopics(entries);
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setStyle(id: string, prop: string, value: string): void {
  const el = document.getElementById(id) as HTMLElement | null;
  if (el) (el.style as unknown as Record<string, string>)[prop] = value;
}

// ─── Load & live update ───────────────────────────────────────────────────────

async function loadAndRender(): Promise<void> {
  const key = todayKey();
  chrome.storage.local.get(key, (result) => {
    const entries: DailyLogEntry[] = result[key] ?? [];
    render(entries);
  });
}

// Live update: re-render whenever storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const key = todayKey();
  if (changes[key]) {
    render((changes[key].newValue as DailyLogEntry[]) ?? []);
  }
});

// Re-render chart on window resize
window.addEventListener("resize", loadAndRender);

// ─── Bootstrap ────────────────────────────────────────────────────────────────
startClock();
loadAndRender();
