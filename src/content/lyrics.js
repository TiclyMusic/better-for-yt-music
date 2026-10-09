// Time-synced lyrics in YouTube Music's Lyrics tab, styled as M3 Expressive.
// Sources, in order: LRCLIB synced -> YouTube captions -> LRCLIB plain (only
// when YTM itself has no lyrics). With nothing found, YTM's own tab is left
// untouched.
(() => {
  const LEAD = 0.25; // s; highlight a touch early so it feels on-beat
  const DELAY = 0.25; // s; overall shift later (LRCLIB timings ran early)
  const INTERLUDE_MIN = 6; // s of silence before showing breathing dots
  const USER_SCROLL_GRACE = 4000; // ms to leave the user alone after they scroll
  const LOOKUP_TIMEOUT = 6000; // ms before falling back to YTM's lyrics
  const STATES_WITH_VIEW = ["loading", "synced", "plain"];

  let enabled = false;
  let options = { karaoke: true, fullscreenLyrics: true };
  let track = null;
  let lyrics = null; // { kind: "synced" | "plain", lines, source, href }
  let state = "none"; // "loading" | "synced" | "plain" | "none"
  let token = 0;
  const cache = new Map(); // videoId -> lyrics | null

  let view, loader, list, footer;
  let rows = [];
  let activeIndex = -1;
  let raf = 0;
  let userScrollUntil = 0;
  let observedTabs = null;
  let tabsObserver = null;
  const hookedScrollers = new WeakSet();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const parseDetail = (e) => {
    try {
      return JSON.parse(e.detail);
    } catch {
      return null;
    }
  };
  const emit = (type, data) =>
    document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(data) }));

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------
  function parseLrc(text) {
    let offset = 0;
    const entries = [];
    for (const raw of text.split(/\r?\n/)) {
      const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
      if (off) {
        offset = Number(off[1]) / 1000; // positive = lyrics come earlier
        continue;
      }
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
      if (!stamps.length) continue;
      const body = raw.replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, "");
      const timed = parseWordStamps(body, offset);
      const text = body.replace(/<\d+:\d+(?:[.:]\d+)?>/g, "").replace(/\s+/g, " ").trim();
      for (const m of stamps) {
        const start = toSeconds(m[1], m[2]) - offset;
        entries.push({ start: Math.max(0, start), text, words: stamps.length === 1 ? timed : null });
      }
    }
    entries.sort((a, b) => a.start - b.start);

    // Blank timestamps mark where the previous line stops (instrumental break).
    const lines = [];
    for (const e of entries) {
      if (!e.text) {
        const prev = lines[lines.length - 1];
        if (prev && prev.end == null) prev.end = e.start;
      } else {
        const words = e.words;
        const end = words ? words[words.length - 1].end : null;
        lines.push({ start: e.start, end, text: e.text, words });
      }
    }
    return lines;
  }

  const toSeconds = (min, sec) => Number(min) * 60 + Number(sec.replace(":", "."));

  // Enhanced LRC ("A2"): "<00:12.10>Hello <00:12.60>world<00:13.20>" -> real
  // word timings. Returns null for plain line-synced text.
  function parseWordStamps(body, offset) {
    const parts = body.split(/<(\d+):(\d+(?:[.:]\d+)?)>/);
    if (parts.length < 4) return null;
    const words = [];
    for (let i = 1; i < parts.length; i += 3) {
      const start = toSeconds(parts[i], parts[i + 1]) - offset;
      const text = parts[i + 2];
      if (words.length) words[words.length - 1].end = start;
      if (text.trim()) words.push({ text, start, end: start });
    }
    if (!words.length) return null;
    const last = words[words.length - 1];
    if (last.end <= last.start) last.end = last.start + 0.6;
    return words;
  }

  // Line-synced sources: spread the line's time over its words, weighted by
  // length, so the karaoke fill still sweeps letter by letter.
  function estimateWords(line) {
    const tokens = line.text.split(/(\s+)/).filter(Boolean);
    const weight = (t) => (/^\s+$/.test(t) ? 0 : t.length + 1.5);
    const total = tokens.reduce((sum, t) => sum + weight(t), 0) || 1;
    const span = Math.max(line.end - line.start, 0.4);
    const words = [];
    let clock = line.start;
    let pendingSpace = "";
    for (const token of tokens) {
      if (!weight(token)) {
        pendingSpace += token;
        continue;
      }
      const dur = (span * weight(token)) / total;
      words.push({ text: pendingSpace + token, start: clock, end: clock + dur });
      pendingSpace = "";
      clock += dur;
    }
    return words;
  }

  // Estimate where each line ends and insert "interlude" rows for long gaps.
  function withInterludes(lines) {
    const out = [];
    if (lines.length && lines[0].start >= INTERLUDE_MIN) {
      out.push({ interlude: true, start: 0, end: lines[0].start });
    }
    lines.forEach((line, i) => {
      const next = lines[i + 1];
      const count = line.text.split(/\s+/).length;
      let end = line.end ?? line.start + Math.min(Math.max(2.5, count * 0.45), 7);
      if (next) end = Math.min(end, next.start);
      const entry = { start: line.start, end, text: line.text, words: line.words || null };
      entry.wordSynced = !!line.words; // real word timing vs. estimated
      if (!entry.words) entry.words = estimateWords(entry);
      out.push(entry);
      if (next && next.start - end >= INTERLUDE_MIN) {
        out.push({ interlude: true, start: end, end: next.start });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------
  function requestCaptions(videoId) {
    return new Promise((resolve) => {
      const onReply = (e) => {
        const data = parseDetail(e);
        if (!data || data.videoId !== videoId) return;
        document.removeEventListener("bytm:captions", onReply);
        clearTimeout(timer);
        resolve(data.lines);
      };
      const timer = setTimeout(() => {
        document.removeEventListener("bytm:captions", onReply);
        resolve(null);
      }, 8000);
      document.addEventListener("bytm:captions", onReply);
      emit("bytm:captions-request", { videoId });
    });
  }

  async function findLyrics(t) {
    const res = await chrome.runtime
      .sendMessage({ type: "lyrics:lookup", track: t })
      .catch(() => null);

    if (res?.synced) {
      const lines = withInterludes(parseLrc(res.synced));
      if (lines.some((l) => !l.interlude)) {
        return { kind: "synced", lines, source: "LRCLIB", href: `https://lrclib.net/` };
      }
    }
    if (t.hasCaptions) {
      const lines = await requestCaptions(t.videoId);
      if (lines?.length) {
        return { kind: "synced", lines: withInterludes(lines), source: "YouTube captions", href: null };
      }
    }
    if (res?.plain) {
      const lines = res.plain.split(/\r?\n/).map((text) => ({ text: text.trim() }));
      return { kind: "plain", lines, source: "LRCLIB", href: "https://lrclib.net/" };
    }
    if (res?.instrumental) {
      return { kind: "plain", lines: [{ text: "♪ Instrumental ♪" }], source: "LRCLIB", href: "https://lrclib.net/" };
    }
    return null;
  }

  async function onTrack(t) {
    if (track && track.videoId === t.videoId) return;
    track = t;
    const my = ++token;
    lyrics = null;
    activeIndex = -1;

    let result = cache.get(t.videoId);
    if (result === undefined) {
      setState("loading");
      const timeout = setTimeout(() => {
        if (my === token && state === "loading") setState("none");
      }, LOOKUP_TIMEOUT);
      result = await findLyrics(t);
      clearTimeout(timeout);
      cache.set(t.videoId, result);
      if (cache.size > 150) cache.delete(cache.keys().next().value);
    }
    if (my !== token || !enabled) return;

    // Plain lyrics only fill a gap: prefer YTM's own when it has them.
    if (result?.kind === "plain" && !lyricsTab()?.hasAttribute("disabled")) result = null;
    lyrics = result;
    render();
    setState(result ? result.kind : "none");
  }

  // ---------------------------------------------------------------------------
  // View
  // ---------------------------------------------------------------------------
  function cookiePath(lobes = 9, depth = 0.08, radius = 22) {
    const pts = [];
    for (let i = 0; i < 360; i += 3) {
      const a = (i * Math.PI) / 180;
      const r = radius * (1 - depth + depth * Math.cos(lobes * a));
      pts.push(`${(24 + r * Math.cos(a)).toFixed(2)} ${(24 + r * Math.sin(a)).toFixed(2)}`);
    }
    return `M${pts.join("L")}Z`;
  }

  function buildView() {
    view = document.createElement("div");
    view.className = "bytm-lyrics";
    view.toggleAttribute("data-karaoke", options.karaoke);

    loader = document.createElement("div");
    loader.className = "bytm-lyrics-loader";
    loader.setAttribute("role", "progressbar");
    loader.setAttribute("aria-label", "Loading lyrics");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", cookiePath());
    svg.append(path);
    loader.append(svg);

    list = document.createElement("div");
    list.className = "bytm-lyrics-lines";

    footer = document.createElement("p");
    footer.className = "bytm-lyrics-footer";

    view.append(loader, list, footer);
  }

  function render() {
    list.replaceChildren();
    rows = [];
    footer.replaceChildren();
    if (!lyrics) return;
    view.dataset.kind = lyrics.kind;

    for (const line of lyrics.lines) {
      let el;
      if (line.interlude) {
        el = document.createElement("div");
        el.className = "bytm-line bytm-interlude";
        el.setAttribute("aria-hidden", "true");
        el.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
      } else if (lyrics.kind === "synced") {
        el = document.createElement("button");
        el.type = "button";
        el.className = "bytm-line";
        el.setAttribute("aria-label", line.text);
        for (const word of line.words) {
          const span = document.createElement("span");
          span.className = "bytm-w";
          span.textContent = word.text;
          el.append(span);
        }
        el.addEventListener("click", () => {
          userScrollUntil = 0;
          emit("bytm:seek", { time: Math.max(0, line.start - 0.05) });
        });
      } else {
        el = document.createElement("p");
        el.className = "bytm-line";
        el.textContent = line.text || " ";
      }
      rows.push(el);
      list.append(el);
    }

    const label = lyrics.kind === "synced" ? "Synced lyrics from " : "Lyrics from ";
    footer.append(label);
    if (lyrics.href) {
      const a = document.createElement("a");
      a.href = lyrics.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = lyrics.source;
      footer.append(a);
    } else {
      footer.append(lyrics.source);
    }
    kick(true);
  }

  function setState(next) {
    state = next;
    if (view) view.dataset.state = next;
    syncTabState();
    kick(true);
  }

  // ---------------------------------------------------------------------------
  // Mounting into YTM's Lyrics tab
  // ---------------------------------------------------------------------------
  const scrollerEl = () => document.querySelector("ytmusic-player-page #tab-renderer");
  const tabsEls = () => [...document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab")];
  const lyricsTab = () => tabsEls()[1] || null;
  const hasLyrics = () => state === "synced" || state === "plain";

  // If the Better Lyrics extension is installed it owns the Lyrics tab (it has
  // syllable-level sources we can't use); we step aside instead of doubling up.
  let betterLyricsActive = false;
  const detectBetterLyrics = () =>
    !!document.querySelector('ytmusic-player-page [class^="blyrics"], ytmusic-player-page [class*=" blyrics"], [id^="blyrics"]');

  function syncTabState() {
    const scroller = scrollerEl();
    if (!scroller) return;
    const active = enabled && !betterLyricsActive;
    const tab = lyricsTab();
    const onLyricsTab = !!tab && tab.getAttribute("aria-selected") === "true";
    scroller.toggleAttribute("data-bytm-lyrics-tab", active && onLyricsTab);
    scroller.dataset.bytmLyricsState = active ? state : "none";

    // YTM disables the tab for tracks it has no lyrics for; we might.
    if (active && tab && tab.hasAttribute("disabled") && hasLyrics()) {
      tab.removeAttribute("disabled");
      tab.setAttribute("aria-disabled", "false");
    }
    syncFullscreen();
  }

  // Fullscreen: hide the artwork/video and show only big lyrics + controls.
  let tabBeforeFullscreen = -1;
  function syncFullscreen() {
    const page = document.querySelector("ytmusic-player-page");
    const fullscreen = !!page && page.hasAttribute("player-fullscreened");
    const want = fullscreen && enabled && !betterLyricsActive && options.fullscreenLyrics && hasLyrics();
    const root = document.documentElement;
    const was = root.hasAttribute("data-bytm-fs-lyrics");
    root.toggleAttribute("data-bytm-fs-lyrics", want);

    const tabs = tabsEls();
    if (want && !was) {
      const current = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
      if (current !== 1 && tabs[1]) {
        tabBeforeFullscreen = current;
        tabs[1].click();
      }
      userScrollUntil = 0;
      kick(true);
    } else if (!fullscreen && tabBeforeFullscreen >= 0) {
      tabs[tabBeforeFullscreen]?.click();
      tabBeforeFullscreen = -1;
    }
    // Leaving lyrics mode: YTM sized the artwork and side panel while our
    // full-screen layout was still applied, and keeps that (tiny cover, narrow
    // lyrics). Make it measure again once our rules are gone.
    if (was && !want) relayoutSoon();
  }

  function relayoutSoon() {
    const nudge = () => window.dispatchEvent(new Event("resize"));
    requestAnimationFrame(() => requestAnimationFrame(nudge));
    setTimeout(nudge, 250);
    setTimeout(nudge, 700);
  }

  function hookScroller(scroller) {
    if (hookedScrollers.has(scroller)) return;
    hookedScrollers.add(scroller);
    const pause = () => {
      if (view && view.offsetParent) userScrollUntil = performance.now() + USER_SCROLL_GRACE;
    };
    scroller.addEventListener("wheel", pause, { passive: true });
    scroller.addEventListener("touchmove", pause, { passive: true });
    scroller.addEventListener("keydown", (e) => {
      if (/^(Arrow|Page|Home|End)/.test(e.key)) pause();
    });
  }

  function hookTabs() {
    const tabs = document.querySelector("ytmusic-player-page tp-yt-paper-tabs");
    if (!tabs || tabs === observedTabs) return;
    tabsObserver?.disconnect();
    observedTabs = tabs;
    tabsObserver = new MutationObserver(() => {
      syncTabState();
      userScrollUntil = 0;
      kick(true);
    });
    tabsObserver.observe(tabs, { subtree: true, attributes: true, attributeFilter: ["aria-selected", "disabled"] });
    const layout = document.querySelector("ytmusic-app-layout");
    if (layout) tabsObserver.observe(layout, { attributes: true, attributeFilter: ["player-ui-state"] });
    const page = document.querySelector("ytmusic-player-page");
    if (page) tabsObserver.observe(page, { attributes: true, attributeFilter: ["player-fullscreened"] });
  }

  // ---------------------------------------------------------------------------
  // Playback sync
  // ---------------------------------------------------------------------------
  const visible = () => !!view && view.isConnected && view.getClientRects().length > 0 && !document.hidden;

  function indexAt(time) {
    const lines = lyrics.lines;
    let lo = 0, hi = lines.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].start <= time + LEAD) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  let wordProgress = []; // last --wp written per word of the active line

  function setActive(index, jump) {
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("bytm-active", i === index);
      rows[i].classList.toggle("bytm-past", i < index);
    }
    activeIndex = index;
    wordProgress = [];
    scrollToActive(jump);
  }

  function scrollToActive(jump) {
    if (!jump && performance.now() < userScrollUntil) return;
    const scroller = view.parentElement;
    const row = rows[Math.max(activeIndex, 0)];
    if (!scroller || !row) return;
    const anchor = document.documentElement.hasAttribute("data-bytm-fs-lyrics") ? 0.4 : 0.3;
    const s = scroller.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const top = scroller.scrollTop + (r.top - s.top) - s.height * anchor;
    scroller.scrollTo({ top: Math.max(0, top), behavior: jump || reduceMotion.matches ? "auto" : "smooth" });
  }

  // Karaoke fill: each word's --wp goes 0 -> 1 while it is sung; the CSS turns
  // that into a soft-edged gradient sweeping through the letters.
  function paintWords(index, t) {
    const line = lyrics.lines[index];
    const spans = rows[index].children;
    for (let w = 0; w < line.words.length; w++) {
      const word = line.words[w];
      const p = Math.min(Math.max((t - word.start) / Math.max(word.end - word.start, 0.05), 0), 1);
      const rounded = Math.round(p * 200) / 200;
      if (wordProgress[w] !== rounded) {
        wordProgress[w] = rounded;
        spans[w].style.setProperty("--wp", rounded);
      }
    }
  }

  function frame(forceScroll) {
    raf = 0;
    if (!enabled || betterLyricsActive || state !== "synced" || !lyrics || !visible()) return;
    const v = document.querySelector("video");
    if (!v) return;
    const time = v.currentTime - DELAY;
    const t = time + LEAD * 0.4;
    const index = indexAt(time);
    if (index !== activeIndex || forceScroll === true) setActive(index, forceScroll === true);
    const line = lyrics.lines[index];
    if (line?.interlude) {
      const p = Math.min(Math.max((t - line.start) / (line.end - line.start), 0), 1);
      rows[index].style.setProperty("--p", p.toFixed(3));
    } else if (line && options.karaoke) {
      paintWords(index, t);
    }
    if (!v.paused) raf = requestAnimationFrame(frame);
  }

  function kick(forceScroll) {
    if (forceScroll === true) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      requestAnimationFrame(() => frame(true));
    } else if (!raf) {
      raf = requestAnimationFrame(frame);
    }
  }

  const MEDIA_EVENTS = ["play", "playing", "timeupdate", "seeked"];
  function onMedia(e) {
    if (!(e.target instanceof HTMLMediaElement)) return;
    if (e.type === "seeked") {
      userScrollUntil = 0;
      kick(true);
    } else {
      kick();
    }
  }
  const onTrackEvent = (e) => {
    const t = parseDetail(e);
    if (t && t.videoId) onTrack(t);
  };

  BYTM.lyrics = {
    configure(settings) {
      options = { karaoke: settings.lyricsKaraoke, fullscreenLyrics: settings.fullscreenLyrics };
      view?.toggleAttribute("data-karaoke", options.karaoke);
      syncFullscreen();
      kick(true);
    },
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (on) {
        document.addEventListener("bytm:track", onTrackEvent);
        for (const ev of MEDIA_EVENTS) document.addEventListener(ev, onMedia, true);
        track = null; // re-resolve the current track
        emit("bytm:track-request", {});
        this.scan();
      } else {
        document.removeEventListener("bytm:track", onTrackEvent);
        for (const ev of MEDIA_EVENTS) document.removeEventListener(ev, onMedia, true);
        token++;
        view?.remove();
        syncTabState();
      }
    },
    scan() {
      if (!enabled) return;
      const scroller = scrollerEl();
      if (!scroller) return;
      betterLyricsActive = detectBetterLyrics();
      if (!view) buildView();
      if (view.parentElement !== scroller) {
        scroller.append(view);
        view.dataset.state = state;
      }
      hookScroller(scroller);
      hookTabs();
      syncTabState();
    },
  };
})();
