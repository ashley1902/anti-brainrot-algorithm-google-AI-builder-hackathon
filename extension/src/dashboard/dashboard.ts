/**
 * dashboard.ts — Anti Brain Rot dashboard
 *
 * Data pipeline is unchanged — reads DailyLogEntry[] from chrome.storage.local.
 * Rendering is completely redesigned to match the new amber glass UI.
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

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function fmt2(n: number): string {
  return n.toFixed(2);
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// SVG helper
const NS = "http://www.w3.org/2000/svg";
function svgEl<T extends SVGElement>(tag: string, attrs: Record<string, string | number>, parent?: SVGElement | HTMLElement): T {
  const el = document.createElementNS(NS, tag) as T;
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(el);
  return el;
}

// ─── Date subtitle ────────────────────────────────────────────────────────────

function initDateSubtitle(): void {
  const el = document.getElementById("date-str");
  if (!el) return;
  const now = new Date();
  const dayStr = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  el.textContent = `Your scroll activity · ${dayStr} · live tracking`;

  // Profile avatar — first letter of the weekday
  const avatarEl = document.getElementById("avatar-letter");
  if (avatarEl) {
    const letter = now.toLocaleDateString(undefined, { weekday: "short" })[0].toUpperCase();
    avatarEl.childNodes[0].nodeValue = letter;
  }
  const pnameEl = document.getElementById("pname-date");
  if (pnameEl) {
    pnameEl.textContent = now.toLocaleDateString(undefined, { weekday: "long" });
  }
}

// ─── Stat strip ───────────────────────────────────────────────────────────────

function renderStats(entries: DailyLogEntry[]): void {
  const total   = entries.length;
  const ytCount = entries.filter(e => e.source === "youtube_shorts").length;
  const igCount = entries.filter(e => e.source === "instagram_reels").length;
  const impact  = avg(entries.map(e => e.impact));

  setText("stat-total", String(total));
  setText("stat-yt",    String(ytCount));
  setText("stat-ig",    String(igCount));

  // Impact card (right column)
  setText("stat-impact", total ? fmt2(impact) : "—");
  const status = !total ? "—" : impact < 0.15 ? "Calm" : impact < 0.30 ? "Moderate" : "Elevated";
  setText("impact-status", status);
}

// ─── Hourly activity — smooth SVG curve ──────────────────────────────────────

function renderHourlyChart(entries: DailyLogEntry[]): void {
  const container = document.getElementById("chart");
  if (!container) return;

  const ytH = new Array(24).fill(0);
  const igH = new Array(24).fill(0);
  entries.forEach(e => {
    const h = new Date(e.timestamp).getHours();
    if (e.source === "youtube_shorts") ytH[h]++;
    else igH[h]++;
  });

  const totals = ytH.map((y, i) => y + igH[i]);
  const yMax   = Math.max(...totals, 8);
  const peakH  = totals.indexOf(Math.max(...totals));
  if (totals[peakH] > 0) {
    const lbl = formatHour(peakH);
    setText("hourly-peak", `Peak ${totals[peakH]} items at ${lbl} · avg ${Math.round(totals.reduce((a,b)=>a+b,0)/24)}/hr`);
  }

  const W = 680, H = 230, L = 12, R = 12, T = 32, B = 28, base = H - B;
  const step = (W - L - R) / 23;
  const X = (i: number) => L + i * step;
  const Y = (v: number) => T + (1 - v / yMax) * (base - T);

  const svg = svgEl<SVGSVGElement>("svg", { viewBox: `0 0 ${W} ${H}`, id: "svgc" }, container);
  container.innerHTML = "";
  container.appendChild(svg);

  // Defs — gradients
  const defs = svgEl("defs", {}, svg);
  const mkGrad = (id: string, c1: string, c2: string) => {
    const g = svgEl("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svgEl("stop", { offset: "0%", "stop-color": c1 }, g);
    svgEl("stop", { offset: "100%", "stop-color": c2 }, g);
  };
  mkGrad("gIG", "rgba(245,122,42,.32)", "rgba(245,122,42,0)");
  mkGrad("gYT", "rgba(255,255,255,.12)", "rgba(255,255,255,0)");

  // Grid lines
  for (const v of [yMax, yMax * 0.75, yMax * 0.5, yMax * 0.25, 0]) {
    svgEl("line", {
      x1: L, x2: W - R, y1: Y(v), y2: Y(v),
      stroke: `rgba(255,255,255,${v === 0 ? 0.1 : 0.05})`,
      "shape-rendering": "crispEdges",
    }, svg);
  }

  // Hour labels every 3 hours
  const lbls = ["12am","3am","6am","9am","12pm","3pm","6pm","9pm"];
  [0,3,6,9,12,15,18,21].forEach((h, i) => {
    const t = svgEl<SVGTextElement>("text", {
      x: X(h), y: H - 8,
      "text-anchor": "middle",
      fill: "#857a6c",
      "font-size": 10.5,
      "font-family": "inherit",
    }, svg);
    t.textContent = lbls[i];
  });

  // Smooth catmull-rom curve helper
  const smooth = (pts: [number, number][]): string => {
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cl = (v: number) => Math.max(T - 2, Math.min(base + 2, v));
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = cl(p1[1] + (p2[1] - p0[1]) / 6);
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = cl(p2[1] - (p3[1] - p1[1]) / 6);
      d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  };

  const P = (src: number[]): [number, number][] => src.map((v, i) => [X(i), Y(v)]);
  const igPts = P(igH), ytPts = P(ytH);
  const igLine = smooth(igPts), ytLine = smooth(ytPts);

  // Fill areas
  svgEl("path", { d: `${ytLine}L${X(23)} ${base}L${X(0)} ${base}Z`, fill: "url(#gYT)" }, svg);
  svgEl("path", { d: `${igLine}L${X(23)} ${base}L${X(0)} ${base}Z`, fill: "url(#gIG)" }, svg);

  // Lines
  svgEl("path", { d: ytLine, fill: "none", stroke: "#efe9df", "stroke-width": 2, "stroke-linecap": "round", opacity: 0.9 }, svg);
  const igPath = svgEl("path", { d: igLine, fill: "none", "stroke-width": 2.6, "stroke-linecap": "round" }, svg);
  igPath.setAttribute("stroke", "#f57a2a");

  // Peak tooltip
  if (totals[peakH] > 0) {
    const px = X(peakH), py = Y(totals[peakH]);
    svgEl("circle", { cx: px, cy: py, r: 4.5, fill: "#171310", stroke: "#fff", "stroke-width": 2 }, svg);
    svgEl("rect", { x: px - 33, y: py - 36, width: 66, height: 22, rx: 8, fill: "rgba(12,10,8,.92)", stroke: "rgba(255,255,255,.14)" }, svg);
    const t = svgEl<SVGTextElement>("text", {
      x: px, y: py - 21.5,
      "text-anchor": "middle",
      fill: "#f7f2ea",
      "font-size": 10.5,
      "font-weight": 700,
      "font-family": "inherit",
    }, svg);
    t.textContent = `${totals[peakH]} items`;
  }
}

function formatHour(h: number): string {
  if (h === 0) return "12 am";
  if (h === 12) return "12 pm";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

// ─── Emotional signals — full bar list ───────────────────────────────────────

interface EmotionDef {
  key: keyof DailyLogEntry;
  label: string;
  color: string;
  positive?: boolean;
}

const EMOTIONS: EmotionDef[] = [
  { key: "emotionalIntensity", label: "Emotional Intensity", color: "#f97316" },
  { key: "rageBait",           label: "Rage-bait",           color: "#ef4444" },
  { key: "sadness",            label: "Sadness",             color: "#818cf8" },
  { key: "anxietyRelated",     label: "Anxiety",             color: "#f59e0b" },
  { key: "fomo",               label: "FOMO",                color: "#ec4899" },
  { key: "socialComparison",   label: "Social Comparison",   color: "#a78bfa" },
  { key: "humor",              label: "Humor ✦",             color: "#34d399", positive: true },
  { key: "inspirational",      label: "Inspirational ✦",     color: "#4facfe", positive: true },
];

function renderEmotions(entries: DailyLogEntry[]): void {
  const grid = document.getElementById("emotion-grid");
  if (!grid) return;
  grid.innerHTML = "";

  EMOTIONS.forEach(({ key, label, color }) => {
    const vals   = entries.map(e => e[key] as number).filter(v => typeof v === "number");
    const mean   = avg(vals);
    const pctVal = Math.round(mean * 100);

    const row = document.createElement("div");
    row.className = "emo-row";
    row.innerHTML = `
      <div class="emo-meta">
        <span class="emo-label">${label}</span>
        <span class="emo-pct">${pctVal}%</span>
      </div>
      <div class="emo-track">
        <div class="emo-fill" style="width:${pctVal}%;background:${color}"></div>
      </div>
    `;
    grid.appendChild(row);
  });
}

// ─── Platform breakdown ───────────────────────────────────────────────────────

function renderPlatformSplit(entries: DailyLogEntry[]): void {
  const ytEntries = entries.filter(e => e.source === "youtube_shorts");
  const igEntries = entries.filter(e => e.source === "instagram_reels");
  const total = entries.length || 1;

  const igPct = pct(igEntries.length, total);
  const ytPct = 100 - igPct;
  const ytAvg = avg(ytEntries.map(e => e.impact));
  const igAvg = avg(igEntries.map(e => e.impact));

  // Labels
  setText("ig-pct-label", `${igPct}%`);
  setText("pc-ig", String(igEntries.length));

  const ytBreak = document.getElementById("yt-breakdown");
  if (ytBreak) ytBreak.textContent = `${ytEntries.length} · ${ytPct}%`;

  // Bars
  const igBar = document.getElementById("ig-bar") as HTMLElement | null;
  const ytBar = document.getElementById("yt-bar") as HTMLElement | null;
  if (igBar) igBar.style.width = `${igPct}%`;
  if (ytBar) ytBar.style.width = `${ytPct}%`;

  // Footer
  setText("platform-foot",
    `Avg impact — Instagram ${igEntries.length ? fmt2(igAvg) : "—"} · YouTube ${ytEntries.length ? fmt2(ytAvg) : "—"}`
  );

  // Donut SVG
  const donutEl = document.getElementById("donut");
  if (!donutEl) return;
  donutEl.innerHTML = "";
  const S = 100, r = 40, c = 2 * Math.PI * r;
  const svg = svgEl<SVGSVGElement>("svg", { viewBox: `0 0 ${S} ${S}`, width: 96, height: 96 }, donutEl);
  svgEl("circle", { cx: 50, cy: 50, r, fill: "none", stroke: "rgba(255,255,255,.13)", "stroke-width": 10 }, svg);
  svgEl("circle", {
    cx: 50, cy: 50, r, fill: "none", stroke: "#f57a2a", "stroke-width": 10,
    "stroke-linecap": "round",
    "stroke-dasharray": `${(c * igPct / 100).toFixed(1)} ${c.toFixed(1)}`,
    transform: "rotate(-90 50 50)",
  }, svg);
  const t = svgEl<SVGTextElement>("text", {
    x: 50, y: 55, "text-anchor": "middle",
    fill: "#f7f2ea", "font-size": 17, "font-weight": 800, "font-family": "inherit",
  }, svg);
  t.textContent = `${igPct}%`;
}

// ─── Topics — list view + bubble view ────────────────────────────────────────

// Gradient pairs for topic avatars (cycles through)
const GRAD_PAIRS: [string, string][] = [
  ["#f2a35e", "#b5541c"],
  ["#e07bd0", "#8e3f7e"],
  ["#f5d06f", "#c2842a"],
  ["#6ec6f5", "#2472a4"],
  ["#7be0a0", "#2a7a4c"],
  ["#f57a8c", "#a4293c"],
  ["#a07be0", "#4c2aa4"],
  ["#e0b87b", "#a4722a"],
];

let allTopicsSorted: [string, number][] = [];
let topicsViewMode: "list" | "bubble" = "list";

function buildTopicData(entries: DailyLogEntry[]): [string, number][] {
  const counts: Record<string, number> = {};
  entries.forEach(e => e.topicTags.forEach(tag => { counts[tag] = (counts[tag] ?? 0) + 1; }));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function renderTopicsListView(sorted: [string, number][], maxShow = 5): void {
  const el = document.getElementById("topics-list");
  if (!el) return;
  el.innerHTML = "";

  const top = sorted.slice(0, maxShow);
  if (top.length === 0) {
    el.textContent = "No topics yet.";
    return;
  }

  top.forEach(([tag, count], i) => {
    const [g1, g2] = GRAD_PAIRS[i % GRAD_PAIRS.length];
    const row = document.createElement("div");
    row.className = "txrow";
    row.innerHTML = `
      <span class="tav" style="--g1:${g1};--g2:${g2}">${tag[0]}</span>
      <div>
        <div class="tn">${tag}</div>
        <div class="ts">${count} mention${count !== 1 ? "s" : ""} today</div>
      </div>
      <span class="pill solid">×${count}</span>
    `;
    el.appendChild(row);
  });
}

function renderTopicsBubbleView(sorted: [string, number][]): void {
  const el = document.getElementById("topics-bubble");
  if (!el) return;
  el.innerHTML = "";

  if (sorted.length === 0) {
    el.textContent = "No topics yet.";
    return;
  }

  const maxCount = sorted[0][1];
  const top = sorted.slice(0, 25); // show up to 25 in bubble view

  top.forEach(([tag, count], i) => {
    const ratio = count / maxCount;
    // Size: 44px (smallest) → 90px (largest)
    const size = Math.round(44 + ratio * 46);
    // Opacity: 0.35 (dimmest) → 1.0 (brightest)
    const opacity = (0.35 + ratio * 0.65).toFixed(2);
    const [g1, g2] = GRAD_PAIRS[i % GRAD_PAIRS.length];

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.title = `${tag}: ${count} mentions`;
    bubble.style.cssText = `
      width:${size}px; height:${size}px;
      background: linear-gradient(135deg, ${g1}, ${g2});
      opacity: ${opacity};
      font-size: ${Math.max(9, Math.round(10 * ratio + 8))}px;
    `;
    const lbl = document.createElement("div");
    lbl.className = "bubble-label";
    lbl.textContent = count > 1 ? `${tag}\n×${count}` : tag;
    bubble.appendChild(lbl);
    el.appendChild(bubble);
  });
}

function renderTopics(entries: DailyLogEntry[]): void {
  allTopicsSorted = buildTopicData(entries);

  // Show list view (5 rows) + bubble view (hidden)
  renderTopicsListView(allTopicsSorted, 5);
  renderTopicsBubbleView(allTopicsSorted);

  // "See all" button
  const seeall = document.getElementById("topics-seeall");
  if (seeall) {
    if (allTopicsSorted.length > 5) {
      seeall.style.display = "";
      (seeall as HTMLButtonElement).onclick = () => {
        const listEl = document.getElementById("topics-list");
        if (!listEl) return;
        if (listEl.children.length > 5) {
          renderTopicsListView(allTopicsSorted, 5);
          seeall.childNodes[0].nodeValue = `See all ${allTopicsSorted.length} topics`;
        } else {
          renderTopicsListView(allTopicsSorted, allTopicsSorted.length);
          seeall.childNodes[0].nodeValue = `Show less`;
        }
      };
      seeall.childNodes[0].nodeValue = `See all ${allTopicsSorted.length} topics`;
    } else {
      seeall.style.display = "none";
    }
  }
}

// ─── Topic view toggle ────────────────────────────────────────────────────────

function initTopicToggle(): void {
  const btnList   = document.getElementById("btn-list");
  const btnBubble = document.getElementById("btn-bubble");
  const listEl    = document.getElementById("topics-list");
  const bubbleEl  = document.getElementById("topics-bubble");
  const seeall    = document.getElementById("topics-seeall");

  if (!btnList || !btnBubble || !listEl || !bubbleEl) return;

  btnList.addEventListener("click", () => {
    topicsViewMode = "list";
    btnList.classList.add("active");
    btnBubble.classList.remove("active");
    listEl.style.display = "";
    bubbleEl.style.display = "none";
    if (seeall) seeall.style.display = allTopicsSorted.length > 5 ? "" : "none";
  });

  btnBubble.addEventListener("click", () => {
    topicsViewMode = "bubble";
    btnBubble.classList.add("active");
    btnList.classList.remove("active");
    listEl.style.display = "none";
    bubbleEl.style.display = "";
    if (seeall) seeall.style.display = "none"; // bubble view shows all
  });
}

// ─── Full render ──────────────────────────────────────────────────────────────

function render(entries: DailyLogEntry[]): void {
  const hasData   = entries.length > 0;
  const emptyEl   = document.getElementById("empty-state")!;
  const gridEl    = document.querySelector<HTMLElement>(".grid");

  emptyEl.style.display = hasData ? "none" : "flex";
  if (gridEl) gridEl.style.display = hasData ? "" : "none";

  if (!hasData) return;

  renderStats(entries);
  renderHourlyChart(entries);
  renderEmotions(entries);
  renderPlatformSplit(entries);
  renderTopics(entries);
}

// ─── Load & live update ───────────────────────────────────────────────────────

async function loadAndRender(): Promise<void> {
  const key = todayKey();
  chrome.storage.local.get(key, (result) => {
    const entries: DailyLogEntry[] = result[key] ?? [];
    render(entries);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const key = todayKey();
  if (changes[key]) {
    render((changes[key].newValue as DailyLogEntry[]) ?? []);
  }
});

window.addEventListener("resize", loadAndRender);

// ─── Bootstrap ────────────────────────────────────────────────────────────────
initDateSubtitle();
initTopicToggle();
loadAndRender();
