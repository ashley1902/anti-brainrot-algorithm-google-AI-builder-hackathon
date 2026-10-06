/**
 * popup.ts
 *
 * Popup controller.
 * Requests a session snapshot from the service worker and updates the UI.
 * Also handles pause/resume and clear-session controls.
 */

import type { ExtensionMessage, SessionSnapshot, Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { loadSettings, saveSettings } from "../storage/settings";

let settings: Settings = DEFAULT_SETTINGS;

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setText(id: string, text: string, cls?: string): void {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  if (cls) {
    el.className = `abr-value ${cls}`;
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatImpact(value: number): { text: string; cls: string } {
  const pct = Math.round(value * 100);
  if (value < 0.35) return { text: `${pct}% — Low`, cls: "positive" };
  if (value < 0.6) return { text: `${pct}% — Moderate`, cls: "warning" };
  return { text: `${pct}% — High`, cls: "danger" };
}

const TREND_LABELS: Record<string, string> = {
  insufficient_data: "Insufficient data",
  stable: "Stable",
  increasing: "↑ Increasing",
  decreasing: "↓ Decreasing",
};

// ─── Render snapshot ──────────────────────────────────────────────────────────
function renderSnapshot(snapshot: SessionSnapshot): void {
  const { text: impactText, cls: impactCls } = formatImpact(snapshot.recentContentImpact);
  const { text: doomText, cls: doomCls } = formatImpact(snapshot.doomscrollHeuristic);
  const trendLabel = TREND_LABELS[snapshot.trajectoryState] ?? snapshot.trajectoryState;

  setText("abr-session-duration", formatDuration(snapshot.sessionDurationMs));
  setText("abr-item-count", String(snapshot.analyzedItemCount));
  setText("abr-recent-impact", snapshot.analyzedItemCount === 0 ? "No data yet" : impactText, impactCls);
  setText("abr-trend", trendLabel);
  setText("abr-doomscroll", snapshot.analyzedItemCount === 0 ? "No data yet" : doomText, doomCls);

  // Monitoring status + dot
  const dot = $("abr-status-dot");
  const stateEl = $("abr-monitoring-status");
  const state = snapshot.interventionState;

  if (state === "PAUSED") {
    stateEl && (stateEl.textContent = "Paused");
    dot?.classList.remove("active", "unsupported");
    dot?.classList.add("paused");
  } else {
    stateEl && (stateEl.textContent = "Active — " + state);
    dot?.classList.remove("paused", "unsupported");
    dot?.classList.add("active");
  }

  // Toggle button label
  const toggleBtn = $("abr-toggle-btn") as HTMLButtonElement | null;
  if (toggleBtn) {
    const isPaused = state === "PAUSED";
    toggleBtn.textContent = isPaused ? "Resume monitoring" : "Pause monitoring";
    toggleBtn.setAttribute("aria-pressed", isPaused ? "false" : "true");
  }

  // Cooldown section
  const cooldownSection = $("abr-cooldown-section");
  if (snapshot.cooldownEndsAt && Date.now() < snapshot.cooldownEndsAt) {
    const remaining = snapshot.cooldownEndsAt - Date.now();
    setText("abr-cooldown-remaining", formatDuration(remaining));
    cooldownSection && (cooldownSection.style.display = "");
  } else {
    cooldownSection && (cooldownSection.style.display = "none");
  }
}

// ─── Fetch snapshot ───────────────────────────────────────────────────────────
async function fetchSnapshot(): Promise<void> {
  try {
    const msg: ExtensionMessage = { type: "SESSION_SNAPSHOT_REQUEST" };
    const response = await chrome.runtime.sendMessage(msg) as ExtensionMessage;
    if (response && response.type === "SESSION_SNAPSHOT") {
      renderSnapshot(response.payload);
    }
  } catch (err) {
    console.warn("[ABR Popup] Could not fetch snapshot:", err);
  }
}

// ─── Site detection for label ─────────────────────────────────────────────────
async function updateSiteLabel(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? "";
    const siteLabel = $("abr-site-label");
    if (!siteLabel) return;
    if (url.includes("youtube.com/shorts")) {
      siteLabel.textContent = "YouTube Shorts — supported ✓";
    } else if (url.includes("instagram.com/reel")) {
      siteLabel.textContent = "Instagram Reels — supported ✓";
    } else if (url.includes("youtube.com")) {
      siteLabel.textContent = "YouTube — navigate to Shorts";
    } else if (url.includes("instagram.com")) {
      siteLabel.textContent = "Instagram — navigate to a Reel";
    } else {
      siteLabel.textContent = "Unsupported page";
      const dot = $("abr-status-dot");
      dot?.classList.remove("active", "paused");
      dot?.classList.add("unsupported");
    }
  } catch {
    /* permissions may not allow reading tab URL */
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────
function bindControls(): void {
  $("abr-toggle-btn")?.addEventListener("click", async () => {
    const newEnabled = !settings.enabled;
    settings = { ...settings, enabled: newEnabled };
    await saveSettings(settings);
    const msg: ExtensionMessage = {
      type: "SET_MONITORING",
      payload: { enabled: newEnabled },
    };
    await chrome.runtime.sendMessage(msg);
    await fetchSnapshot();
  });

  $("abr-clear-btn")?.addEventListener("click", async () => {
    const msg: ExtensionMessage = { type: "CLEAR_SESSION" };
    await chrome.runtime.sendMessage(msg);
    await fetchSnapshot();
  });

  const sensitivitySelect = $("abr-sensitivity") as HTMLSelectElement | null;
  sensitivitySelect?.addEventListener("change", async () => {
    settings = { ...settings, sensitivity: sensitivitySelect.value as Settings["sensitivity"] };
    await saveSettings(settings);
  });

  $("abr-privacy-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({
      url: chrome.runtime.getURL("popup/popup.html") + "#privacy",
    });
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  settings = await loadSettings();

  // Set sensitivity selector to saved value
  const sel = $("abr-sensitivity") as HTMLSelectElement | null;
  if (sel) sel.value = settings.sensitivity;

  await updateSiteLabel();
  await fetchSnapshot();
  bindControls();

  // Refresh every 3 seconds while popup is open
  setInterval(fetchSnapshot, 3000);
}

init().catch(console.error);
