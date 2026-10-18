/**
 * ig-video-capture.ts
 *
 * Runs in the PAGE'S MAIN WORLD ("world": "MAIN" in manifest).
 * Extension content scripts loaded as files bypass the page's CSP entirely.
 *
 * Patches window.fetch to intercept Instagram's internal API responses and
 * extract the direct CDN video URL ("video_url") from media info payloads.
 * Posts the URL back to the isolated-world content script via postMessage.
 */

(function () {
  if ((window as unknown as Record<string, unknown>).__ABR_VIDEO_CAPTURE) return;
  (window as unknown as Record<string, unknown>).__ABR_VIDEO_CAPTURE = true;

  console.log("[ABR-MAIN]  ig-video-capture loaded in MAIN world");

  const origFetch = window.fetch.bind(window);

  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const resp = await origFetch(...args);

    // Only inspect requests that are likely to carry media metadata.
    // Filter by URL to avoid cloning large binary/video responses.
    const reqUrl = typeof args[0] === "string"
      ? args[0]
      : (args[0] as Request)?.url ?? "";

    const looksLikeApi =
      reqUrl.includes("graphql") ||
      reqUrl.includes("/api/") ||
      reqUrl.includes("media") ||
      reqUrl.includes("reels") ||
      reqUrl.includes("query");

    if (looksLikeApi) {
      try {
        resp.clone().text().then((text) => {
          if (text.includes('"video_url"')) {
            const m = text.match(/"video_url"\s*:\s*"(https?:[^"]+)"/);
            if (m) {
              const url = m[1]
                .replace(/\\u0026/g, "&")
                .replace(/\\\//g, "/");
              console.log("[ABR-MAIN]  Found video_url:", url.slice(0, 80));
              window.postMessage({ type: "ABR_VIDEO_URL", url }, "*");
            }
          }
        }).catch(() => { /* ignore parse errors */ });
      } catch { /* ignore */ }
    }

    return resp;
  };
})();
