// Content-script entry point: applies settings as <html> attributes (which the
// stylesheet keys off), follows the current track for dynamic color, and
// drives the scripted features.
(() => {
  const root = document.documentElement;
  const FONT_HREF =
    "https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wdth,wght,ROND@6..144,25..151,1..1000,0..100&display=swap";

  // setting key -> <html> attribute the CSS uses
  const ATTRS = {
    theme: "data-bytm-theme",
    wavyProgress: "data-bytm-wavy",
    ambientBackdrop: "data-bytm-ambient",
    expressiveType: "data-bytm-type",
    lazyRender: "data-bytm-lazy",
    hideUpsells: "data-bytm-hide-upsells",
    syncedLyrics: "data-bytm-lyrics",
    minimalUI: "data-bytm-minimal",
    lightEffects: "data-bytm-light",
    videoSaver: "data-bytm-video-saver", // read by page-bridge.js
  };

  // Visual extras only make sense on top of the M3 theme.
  const THEME_ONLY = new Set(["wavyProgress", "ambientBackdrop", "expressiveType"]);

  let settings = { ...BYTM.DEFAULTS };
  let lastArt = null;
  let trackToken = 0;
  let restoredPalette = false;

  function applyAttributes() {
    for (const [key, attr] of Object.entries(ATTRS)) {
      root.toggleAttribute(attr, !!settings[key] && (!THEME_ONLY.has(key) || settings.theme));
    }
  }

  let fontLink = null;
  function ensureFont() {
    const want = settings.theme && settings.expressiveType;
    if (want && !fontLink) {
      for (const origin of ["https://fonts.googleapis.com", "https://fonts.gstatic.com"]) {
        const pre = document.createElement("link");
        pre.rel = "preconnect";
        pre.href = origin;
        pre.crossOrigin = "";
        (document.head || root).append(pre);
      }
      fontLink = document.createElement("link");
      fontLink.rel = "stylesheet";
      fontLink.href = FONT_HREF;
      (document.head || root).append(fontLink);
    } else if (!want && fontLink) {
      fontLink.remove();
      fontLink = null;
    }
  }

  // --- Current track / album art --------------------------------------------
  const ART_SELECTORS = [
    "ytmusic-app-layout > ytmusic-miniplayer img.ytmusicTrackInfoThumbnail",
    "img.ytmusicTrackInfoThumbnail",
    "ytmusic-player-bar img.image",
    "#song-image img",
  ];

  function currentArt() {
    for (const sel of ART_SELECTORS) {
      const img = document.querySelector(sel);
      const src = img && img.getAttribute("src") && img.src;
      // Only real artwork: an empty src resolves to the page URL itself.
      if (src && /^https:\/\/[^/]*(googleusercontent\.com|ytimg\.com)\//.test(src)) return src;
    }
    return null;
  }

  async function refreshPalette(force = false) {
    const art = currentArt();
    if (!art || (art === lastArt && !force)) return;
    lastArt = art;
    const token = ++trackToken;
    const { seed, backdrop } = await BYTM.analyzeArt(art);
    if (token !== trackToken) return; // a newer track won the race
    root.style.setProperty(
      "--bytm-backdrop",
      `url("${(backdrop || BYTM.largeArtUrl(art)).replace(/"/g, "%22")}")`
    );
    applyPalette(settings.dynamicColor ? seed : null);
  }

  function applyPalette(seed) {
    const palette = settings.dynamicColor
      ? BYTM.applySeed(seed, settings.accentHue)
      : BYTM.applySeed(null, settings.accentHue, 0.13);
    BYTM.wavy.paletteChanged();
    chrome.storage.local.set({ lastPalette: palette }).catch(() => {});
  }

  // --- Play state (drives the shape-morphing play button) --------------------
  function syncPlaying() {
    const v = document.querySelector("video");
    root.toggleAttribute("data-bytm-playing", !!v && !v.paused && !v.ended);
  }
  for (const ev of ["play", "playing", "pause", "ended", "emptied"]) {
    document.addEventListener(ev, (e) => {
      if (!(e.target instanceof HTMLMediaElement)) return;
      syncPlaying();
      if (ev === "playing") refreshPalette().catch(() => {});
    }, true);
  }
  document.addEventListener("loadedmetadata", () => setTimeout(refreshPalette, 150), true);

  // --- Housekeeping poll --------------------------------------------------------
  // A cheap 700 ms poll (a handful of querySelector calls) instead of a
  // subtree MutationObserver: YTM mutates the DOM constantly, and observing it
  // would allocate a record for every one of those changes.
  // The extension's own mark in the top bar: the red cookie with ring + play and
  // "Better for yt music", in place of the YouTube Music logo (theme only).
  function brandPath(r = 48, lobes = 9, depth = 0.075) {
    const pts = [];
    for (let i = 0; i < 360; i += 3) {
      const a = (i * Math.PI) / 180;
      const rr = r * (1 - depth + depth * Math.cos(lobes * (a - Math.PI / 2)));
      pts.push(`${(rr * Math.cos(a)).toFixed(2)} ${(rr * Math.sin(a)).toFixed(2)}`);
    }
    return `M${pts.join("L")}Z`;
  }
  function ensureBrand() {
    const link = document.querySelector("ytmusic-nav-bar ytmusic-logo a");
    if (!link || link.querySelector(".bytm-brand")) return;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "-50 -50 100 100");
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(NS, "path");
    shape.setAttribute("d", brandPath());
    shape.setAttribute("class", "bytm-brand-shape");
    const ring = document.createElementNS(NS, "circle");
    ring.setAttribute("r", "17.3");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "#fff");
    ring.setAttribute("stroke-width", "4.2");
    const play = document.createElementNS(NS, "path");
    play.setAttribute("d", "M-5 -8 9.7 0 -5 8z");
    play.setAttribute("fill", "#fff");
    play.setAttribute("stroke", "#fff");
    play.setAttribute("stroke-width", "2.4");
    play.setAttribute("stroke-linejoin", "round");
    svg.append(shape, ring, play);
    const text = document.createElement("span");
    text.className = "bytm-brand-text";
    const accent = document.createElement("b");
    accent.textContent = "yt music";
    text.append("Better for ", accent);
    const brand = document.createElement("span");
    brand.className = "bytm-brand";
    brand.append(svg, text);
    link.setAttribute("aria-label", "Better for YouTube Music");
    link.append(brand);
  }

  function poll() {
    if (!BYTM.alive()) return clearInterval(BYTM.pollTimer);
    ensureBrand();
    BYTM.wavy.scan();
    BYTM.lyrics.scan();
    BYTM.tweaks.poll();
    refreshPalette().catch(() => {});
  }

  function startObserving() {
    poll();
    BYTM.pollTimer = setInterval(poll, 700);
  }

  // --- Settings -----------------------------------------------------------------
  function applySettings(prev = {}) {
    applyAttributes();
    // Read synchronously by page-bridge.js at the next page load (document_start).
    try {
      localStorage.setItem("bytm:native-animations", settings.nativeAnimations ? "1" : "0");
    } catch {}
    ensureFont();
    BYTM.wavy.setEnabled(settings.theme && settings.wavyProgress);
    BYTM.lyrics.configure(settings);
    BYTM.lyrics.setEnabled(settings.syncedLyrics);
    BYTM.tweaks.configure(settings);
    if (prev.dynamicColor !== settings.dynamicColor || prev.accentHue !== settings.accentHue) {
      if (lastArt) {
        refreshPalette(true);
      } else if (!(settings.dynamicColor && restoredPalette)) {
        // Nothing played yet: show the accent at full strength.
        BYTM.setPalette(settings.accentHue, 0.13);
        BYTM.wavy.paletteChanged();
      }
    }
  }

  // Paint defaults synchronously so the page never flashes the stock theme.
  applyAttributes();

  Promise.all([BYTM.loadSettings(), chrome.storage.local.get("lastPalette")]).then(
    ([loaded, { lastPalette }]) => {
      const prev = settings;
      settings = loaded;
      // Until the first track resolves, reuse the palette of the last one played.
      if (settings.dynamicColor && lastPalette && !lastArt) {
        BYTM.setPalette(lastPalette.hue, lastPalette.chroma);
        restoredPalette = true;
      }
      applySettings({ ...prev, dynamicColor: undefined });
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const prev = { ...settings };
    for (const [key, { newValue }] of Object.entries(changes)) {
      settings[key] = newValue === undefined ? BYTM.DEFAULTS[key] : newValue;
    }
    applySettings(prev);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserving, { once: true });
  } else {
    startObserving();
  }
})();
