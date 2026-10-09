// Shared settings schema. Loaded by the content script, the popup and the
// service worker (via importScripts), so it must stay plain global JS.
var BYTM = globalThis.BYTM || (globalThis.BYTM = {});

BYTM.DEFAULTS = Object.freeze({
  // Look
  theme: true, // Material 3 Expressive restyle
  dynamicColor: true, // palette from album art
  wavyProgress: true, // M3 wavy seek bar
  ambientBackdrop: true, // blurred album art behind the player page
  expressiveType: true, // Google Sans Flex
  minimalUI: true, // hide clutter, keep music + controls
  accentHue: 285, // fallback hue (OKLCH degrees) when dynamic color is off / art is grey

  // Lyrics
  syncedLyrics: true, // time-synced lyrics (LRCLIB / YouTube captions) in the Lyrics tab
  lyricsKaraoke: true, // word-by-word fill sweeping through the letters
  fullscreenLyrics: true, // fullscreen shows only big lyrics + controls

  // Speed
  blockTelemetry: true, // declarativeNetRequest ruleset
  lazyRender: true, // content-visibility on off-screen shelves & rows
  lightEffects: true, // no live backdrop blurs / ripple animations
  videoSaver: true, // 144p while a music video isn't actually visible
  nativeAnimations: true, // keep Chrome's native Element.animate over YTM's JS polyfill

  // Quality of life
  autoContinue: true, // dismiss "Still listening?"
  wheelVolume: true, // scroll over the player bar to change volume
  hideUpsells: true, // Premium promos & mealbars
});

BYTM.ACCENTS = Object.freeze([
  { name: "Violet", hue: 285 },
  { name: "Blue", hue: 250 },
  { name: "Teal", hue: 190 },
  { name: "Green", hue: 145 },
  { name: "Amber", hue: 75 },
  { name: "Coral", hue: 35 },
  { name: "Rose", hue: 0 },
]);

// The desktop app's settings window provides the same API as `bytmHost.chrome`.
// After the extension is reloaded or updated, the old content script keeps
// running in tabs that were already open, but every chrome.* call then throws
// "Extension context invalidated". Polls check this and stop quietly.
BYTM.alive = function alive() {
  if (globalThis.bytmHost) return true; // desktop app: no extension context
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
};

BYTM.ext = function ext() {
  return (globalThis.bytmHost && globalThis.bytmHost.chrome) || chrome;
};

BYTM.loadSettings = async function loadSettings() {
  const stored = await BYTM.ext().storage.sync.get(null);
  return { ...BYTM.DEFAULTS, ...stored };
};
