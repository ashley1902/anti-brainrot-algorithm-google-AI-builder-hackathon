/**
 * intervention-ui.ts
 *
 * Renders a gentle, dismissible intervention overlay.
 *
 * UX principles (from spec §6.3):
 *   - Nonjudgmental language.
 *   - Dismissible at any time.
 *   - Rate-limited by session policy.
 *   - Never blocks content.
 *   - Respects prefers-reduced-motion.
 */

const OVERLAY_ID = "abr-intervention-overlay";
const BREAK_TIMER_MS = 2 * 60 * 1000; // 2 minutes

type ResponseCallback = (action: "take_break" | "not_now") => void;

let timerInterval: ReturnType<typeof setInterval> | null = null;

/** Show the main intervention overlay. */
export function showInterventionOverlay(onResponse: ResponseCallback): void {
  if (document.getElementById(OVERLAY_ID)) return; // already shown

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "abr-intervention-title");
  overlay.setAttribute("aria-describedby", "abr-intervention-desc");

  overlay.innerHTML = `
    <div class="abr-card" tabindex="-1">
      <div class="abr-header">
        <span class="abr-icon" aria-hidden="true">🧘</span>
        <h2 class="abr-title" id="abr-intervention-title">Your feed has become more emotionally intense</h2>
      </div>
      <p class="abr-desc" id="abr-intervention-desc">
        Your recent content and scrolling pattern may be a good moment for a short pause.
        <br><br>
        <em>This is an estimate based on content characteristics — not a diagnosis or assessment of your mood.</em>
      </p>
      <div class="abr-actions">
        <button class="abr-btn abr-btn-primary" id="abr-take-break" aria-label="Take a 2-minute break">
          Take a 2-minute break
        </button>
        <button class="abr-btn abr-btn-secondary" id="abr-not-now" aria-label="Not now, continue browsing">
          Not now
        </button>
      </div>
    </div>
  `;

  injectStyles();
  document.body.appendChild(overlay);

  // Focus trap on card
  const card = overlay.querySelector<HTMLElement>(".abr-card");
  card?.focus();

  document.getElementById("abr-take-break")?.addEventListener("click", () => {
    removeOverlay();
    showBreakTimer(onResponse);
    onResponse("take_break");
  });

  document.getElementById("abr-not-now")?.addEventListener("click", () => {
    removeOverlay();
    onResponse("not_now");
  });

  // Keyboard: Escape = dismiss
  overlay.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      removeOverlay();
      onResponse("not_now");
    }
  });
}

/** Show a 2-minute break timer screen. */
function showBreakTimer(onResponse: ResponseCallback): void {
  void onResponse; // callback already fired before this is called
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Break timer");

  let secondsLeft = BREAK_TIMER_MS / 1000;

  overlay.innerHTML = `
    <div class="abr-card abr-timer-card" tabindex="-1">
      <span class="abr-icon" aria-hidden="true">⏱️</span>
      <h2 class="abr-title">Taking a moment</h2>
      <p class="abr-timer-display" id="abr-timer-display" aria-live="polite">${formatSeconds(secondsLeft)}</p>
      <p class="abr-desc">Take a breath. Step away for a moment. You can always come back.</p>
      <button class="abr-btn abr-btn-secondary" id="abr-end-break" aria-label="End break early">
        End break early
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
  const card = overlay.querySelector<HTMLElement>(".abr-card");
  card?.focus();

  timerInterval = setInterval(() => {
    secondsLeft--;
    const display = document.getElementById("abr-timer-display");
    if (display) display.textContent = formatSeconds(secondsLeft);
    if (secondsLeft <= 0) {
      clearTimer();
      removeOverlay();
    }
  }, 1000);

  document.getElementById("abr-end-break")?.addEventListener("click", () => {
    clearTimer();
    removeOverlay();
  });
}

function clearTimer(): void {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function removeOverlay(): void {
  clearTimer();
  document.getElementById(OVERLAY_ID)?.remove();
}

function formatSeconds(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.max(0, s) % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Inject CSS once. */
let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    #abr-intervention-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(4px);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .abr-card {
      background: #1a1a2e;
      color: #e8eaf6;
      border-radius: 16px;
      padding: 32px 36px;
      max-width: 420px;
      width: 90vw;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      outline: none;
    }
    .abr-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .abr-icon {
      font-size: 28px;
    }
    .abr-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: #c5cae9;
      margin: 0;
      line-height: 1.4;
    }
    .abr-desc {
      font-size: 0.9rem;
      color: #9fa8da;
      line-height: 1.6;
      margin: 0 0 24px;
    }
    .abr-desc em {
      font-size: 0.8rem;
      color: #7986cb;
    }
    .abr-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .abr-btn {
      padding: 12px 20px;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 500;
      transition: background 0.15s ease;
      outline-offset: 3px;
    }
    .abr-btn:focus-visible {
      outline: 3px solid #7986cb;
    }
    .abr-btn-primary {
      background: #5c6bc0;
      color: #fff;
    }
    .abr-btn-primary:hover {
      background: #7986cb;
    }
    .abr-btn-secondary {
      background: rgba(255,255,255,0.08);
      color: #c5cae9;
    }
    .abr-btn-secondary:hover {
      background: rgba(255,255,255,0.14);
    }
    .abr-timer-card {
      text-align: center;
    }
    .abr-timer-display {
      font-size: 3rem;
      font-weight: 700;
      color: #7986cb;
      margin: 16px 0;
      font-variant-numeric: tabular-nums;
    }
    @media (prefers-reduced-motion: reduce) {
      #abr-intervention-overlay {
        backdrop-filter: none;
      }
    }
    @media (prefers-color-scheme: light) {
      .abr-card {
        background: #fff;
        color: #1a237e;
        box-shadow: 0 10px 40px rgba(0,0,0,0.18);
      }
      .abr-title { color: #283593; }
      .abr-desc { color: #5c6bc0; }
      .abr-desc em { color: #7986cb; }
      .abr-btn-secondary { background: #e8eaf6; color: #283593; }
      .abr-btn-secondary:hover { background: #c5cae9; }
      .abr-timer-display { color: #3949ab; }
    }
  `;
  document.head.appendChild(style);
}
