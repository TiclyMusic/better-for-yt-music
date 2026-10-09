importScripts("shared/settings.js", "shared/lyrics-lookup.js");

const RULESET = "telemetry";

async function syncTelemetryRuleset() {
  const { blockTelemetry } = await BYTM.loadSettings();
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    blockTelemetry
      ? { enableRulesetIds: [RULESET] }
      : { disableRulesetIds: [RULESET] }
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  // Persist defaults for keys the user has never touched, keep everything else.
  const stored = await chrome.storage.sync.get(null);
  const missing = {};
  for (const [key, value] of Object.entries(BYTM.DEFAULTS)) {
    if (!(key in stored)) missing[key] = value;
  }
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
  await syncTelemetryRuleset();
});

chrome.runtime.onStartup.addListener(syncTelemetryRuleset);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "blockTelemetry" in changes) syncTelemetryRuleset();
});

// ---------------------------------------------------------------------------
// Lyrics lookup (LRCLIB) for the content script, with a small in-memory cache.
// ---------------------------------------------------------------------------
const LRCLIB_CLIENT = `Better YT Music v${chrome.runtime.getManifest().version}`;
const lyricsCache = new Map();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "lyrics:lookup") return false;
  const key = msg.track.videoId;
  if (!lyricsCache.has(key)) {
    const pending = BYTM_LYRICS.lookupLyrics(msg.track, { fetch, client: LRCLIB_CLIENT }).catch((err) => {
      lyricsCache.delete(key); // allow a retry after network errors
      console.warn("[Better YTM] lyrics lookup failed", err);
      return null;
    });
    lyricsCache.set(key, pending);
    if (lyricsCache.size > 300) lyricsCache.delete(lyricsCache.keys().next().value);
  }
  lyricsCache.get(key).then(sendResponse);
  return true; // async response
});
