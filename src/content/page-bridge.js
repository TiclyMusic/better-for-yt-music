// Runs in the page's MAIN world. Only used for things the isolated content
// script cannot reach: the YouTube player API and Polymer element properties.
// All messages cross the world boundary as JSON strings on CustomEvents.
(() => {
  const emit = (type, data) =>
    document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(data) }));
  const parse = (e) => {
    try {
      return JSON.parse(e.detail);
    } catch {
      return null;
    }
  };
  const player = () => {
    const p = document.getElementById("movie_player");
    return p && typeof p.getVideoData === "function" ? p : null;
  };

  // --- Keep Chrome's native Element.animate -------------------------------------
  // YTM loads the web-animations-next-lite polyfill, which swaps the native,
  // compositor-driven Element.prototype.animate for a JS wrapper that keeps a
  // requestAnimationFrame loop busy on the main thread. We run at
  // document_start, before it loads, and quietly ignore that override (its
  // extras such as GroupEffect stay available). Toggle: "Native animations".
  try {
    const native = Element.prototype.animate;
    const wanted = localStorage.getItem("bytm:native-animations") !== "0";
    if (wanted && native && /\[native code\]/.test(Function.prototype.toString.call(native))) {
      Object.defineProperty(Element.prototype, "animate", {
        configurable: true,
        get: () => native,
        set: () => {},
      });
    }
  } catch {}

  // --- Video saver ------------------------------------------------------------------
  // Decoding HD video nobody can see (player page closed, window hidden, or
  // fullscreen lyrics covering it) is the single biggest CPU/GPU cost. Cap the
  // stream to 144p while it's invisible; the audio stream is unaffected.
  let qualityCapped = false;
  function syncVideoSaver() {
    const p = player();
    if (!p || typeof p.setPlaybackQualityRange !== "function") return;
    const root = document.documentElement;
    const layout = document.querySelector("ytmusic-app-layout");
    const page = document.querySelector("ytmusic-player-page");
    const videoMode = !!page && page.hasAttribute("video-mode");
    const pageOpen =
      !!layout &&
      (layout.getAttribute("player-ui-state") === "PLAYER_PAGE_OPEN" || layout.hasAttribute("player-fullscreened"));
    const seen = !document.hidden && videoMode && pageOpen && !root.hasAttribute("data-bytm-fs-lyrics");
    const cap = root.hasAttribute("data-bytm-video-saver") && !seen;
    if (cap === qualityCapped) return;
    qualityCapped = cap;
    try {
      if (cap) p.setPlaybackQualityRange("tiny", "tiny");
      else p.setPlaybackQualityRange("tiny", "highres"); // back to adaptive
    } catch {}
  }
  document.addEventListener("visibilitychange", syncVideoSaver);
  setInterval(syncVideoSaver, 1000);

  // --- Volume (scroll over the player bar) -------------------------------------
  // The player is the source of truth. We move YTM's own slider so its UI and
  // saved volume follow, then verify: if YTM's slider mapping swallowed the step
  // (e.g. rounding a low value back down) we set the player directly. Scrolling
  // up always unmutes, so you can never get stuck at the bottom.
  document.addEventListener("bytm:volume", (e) => {
    const delta = parse(e)?.delta;
    const p = player();
    if (typeof delta !== "number" || !p) return;
    const current = p.isMuted() ? 0 : p.getVolume();
    const target = Math.max(0, Math.min(100, Math.round(current + delta)));

    const input =
      document.querySelector("ytmusic-app-layout > ytmusic-miniplayer .ytMusicMiniPlayerVolumePopup input[type=range]") ||
      document.querySelector(".ytMusicMiniPlayerVolumePopup input[type=range]");
    const legacy = document.querySelector("ytmusic-player-bar #volume-slider");
    if (input) {
      input.value = String(target);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (legacy) {
      legacy.value = target;
      legacy.dispatchEvent(new CustomEvent("change", { bubbles: true }));
    }
    if (target > 0 && p.isMuted()) p.unMute();

    setTimeout(() => {
      if (Math.abs(p.getVolume() - target) > 1) p.setVolume(target);
      if (target > 0 && p.isMuted()) p.unMute();
      emit("bytm:volume-changed", { volume: p.getVolume(), muted: p.isMuted() });
    }, 60);
  });

  // --- Seeking (click a lyric line) ---------------------------------------------
  document.addEventListener("bytm:seek", (e) => {
    const time = parse(e)?.time;
    const p = player();
    if (typeof time !== "number" || !p) return;
    p.seekTo(time, true);
    if (p.getPlayerState() === 2) p.playVideo(); // paused -> play
  });

  // --- Track metadata ---------------------------------------------------------
  let lastId = null;
  let pendingSince = 0;
  let emitted = false;

  function currentTrack() {
    const p = player();
    if (!p) return null;
    const vd = p.getVideoData();
    if (!vd || !vd.video_id) return null;
    const response = p.getPlayerResponse?.() || {};
    const details = response.videoDetails || {};
    const duration = p.getDuration() || Number(details.lengthSeconds) || 0;
    // mediaSession carries the album; trust it only once it matches this video.
    const ms = navigator.mediaSession?.metadata;
    const msFresh = ms && ms.title && ms.title === vd.title;
    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return {
      videoId: vd.video_id,
      title: vd.title || details.title || "",
      artist: (msFresh && ms.artist) || vd.author || details.author || "",
      album: (msFresh && ms.album) || "",
      duration,
      hasCaptions: tracks.some((t) => t.kind !== "asr"),
      ready: !!(duration && vd.title && (msFresh || Date.now() - pendingSince > 2500)),
    };
  }

  function poll() {
    const track = currentTrack();
    if (!track) return;
    if (track.videoId !== lastId) {
      lastId = track.videoId;
      pendingSince = Date.now();
      emitted = false;
    }
    if (!emitted && track.ready) {
      emitted = true;
      emit("bytm:track", track);
    }
  }
  setInterval(poll, 500);

  document.addEventListener("bytm:track-request", () => {
    const track = currentTrack();
    if (track && track.ready) emit("bytm:track", track);
  });

  // --- YouTube caption tracks (fallback lyrics source) ---------------------------
  document.addEventListener("bytm:captions-request", async (e) => {
    const videoId = parse(e)?.videoId;
    const reply = (lines) => emit("bytm:captions", { videoId, lines });
    try {
      const p = player();
      if (!p || p.getVideoData().video_id !== videoId) return reply(null);
      const tracks =
        p.getPlayerResponse()?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      // Human-made tracks only; auto-generated speech recognition is poor on music.
      const track = tracks.find((t) => t.kind !== "asr");
      if (!track) return reply(null);
      const url = new URL(track.baseUrl, location.origin);
      url.searchParams.set("fmt", "json3");
      const data = await (await fetch(url, { credentials: "include" })).json();
      const lines = [];
      for (const ev of data.events || []) {
        if (!ev.segs) continue;
        const text = ev.segs
          .map((s) => s.utf8 || "")
          .join("")
          .replace(/\s+/g, " ")
          .replace(/^[\s♪♫♬♩]+|[\s♪♫♬♩]+$/g, "")
          .trim();
        if (!text) continue;
        const start = (ev.tStartMs || 0) / 1000;
        lines.push({ start, end: start + (ev.dDurationMs || 0) / 1000, text });
      }
      reply(lines.length ? lines : null);
    } catch {
      reply(null);
    }
  });
})();
