// Material 3 Expressive wavy progress indicator, drawn on a canvas under
// YouTube Music's own (now transparent) seek slider so all native input,
// keyboard and accessibility behaviour is preserved.
(() => {
  const AMPLITUDE = 3; // px
  const WAVELENGTH = 38; // px
  const WAVE_SPEED = 0.85; // wavelengths per second while playing
  const STROKE = 4;
  const GAP = 5; // space between the track segments and the thumb
  const THUMB_W = 4;

  const bars = new Map(); // slider element -> state
  let enabled = false;
  let raf = 0;
  let lastFrame = 0;
  let amp = 0;
  let phase = 0;
  let colorsDirtyUntil = 0;
  let colorsStale = true;
  let colors = null;
  let probe = null;

  const video = () => document.querySelector("video");
  const isPlaying = () => {
    const v = video();
    return !!v && !v.paused && !v.ended && v.readyState > 2;
  };

  function readColors() {
    if (!probe) {
      probe = document.createElement("span");
      probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
      document.documentElement.append(probe);
    }
    const read = (v) => {
      probe.style.color = `var(${v})`;
      return getComputedStyle(probe).color;
    };
    colors = {
      active: read("--md-primary"),
      track: read("--md-secondary-container"),
    };
  }

  function findSliders() {
    return [
      ...document.querySelectorAll("input.ytMusicMiniPlayerProgressBar"),
      ...document.querySelectorAll("ytmusic-player-bar tp-yt-paper-slider#progress-bar"),
    ];
  }

  function attach(slider) {
    const legacy = slider.tagName !== "INPUT";
    const host = legacy ? slider.querySelector("#sliderContainer") || slider : slider.parentElement;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "bytm-wave";
    canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
    const state = {
      slider, legacy, host, canvas,
      ctx: canvas.getContext("2d"),
      dragging: false,
      hover: 0,
      hovering: false,
      w: 0, h: 0, dpr: 0,
    };
    const onDown = () => { state.dragging = true; kick(); };
    const onUp = () => { if (state.dragging) { state.dragging = false; kick(); } };
    const onEnter = () => { state.hovering = true; kick(); };
    const onLeave = () => { state.hovering = false; kick(); };
    const onInput = () => kick();
    slider.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointerleave", onLeave);
    slider.addEventListener("input", onInput);
    state.detach = () => {
      slider.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointerleave", onLeave);
      slider.removeEventListener("input", onInput);
      canvas.remove();
    };
    bars.set(slider, state);
  }

  function progressOf(state) {
    const s = state.slider;
    let value, max;
    if (state.legacy) {
      value = parseFloat(s.getAttribute("aria-valuenow"));
      max = parseFloat(s.getAttribute("aria-valuemax"));
    } else {
      value = parseFloat(s.value);
      max = parseFloat(s.max);
    }
    if (!(max > 0)) return 0;
    // The slider only ticks once a second; follow the media clock for smooth
    // motion unless the user is scrubbing or the two clearly disagree (ads).
    const v = video();
    if (!state.dragging && v && Math.abs(v.currentTime - value) < 2.5) value = v.currentTime;
    return Math.min(Math.max(value / max, 0), 1);
  }

  function draw(state) {
    const { canvas, ctx } = state;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (w !== state.w || h !== state.h || dpr !== state.dpr) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      state.w = w; state.h = h; state.dpr = dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!colors) readColors();

    const mid = h / 2;
    const p = progressOf(state);
    const x = p * w;
    const start = STROKE / 2;
    const end = w - STROKE / 2;
    const thumbH = 14 + state.hover * 6;

    ctx.lineCap = "round";
    ctx.lineWidth = STROKE;

    // Active: sine wave. Amplitude eases in over the first wavelength so the
    // line starts flat at the left edge, like the Android implementation.
    const activeEnd = x - GAP - THUMB_W / 2;
    if (activeEnd > start) {
      ctx.strokeStyle = colors.active;
      ctx.beginPath();
      const k = (2 * Math.PI) / WAVELENGTH;
      for (let px = start; px <= activeEnd; px += 1.5) {
        const ramp = Math.min(1, (px - start) / WAVELENGTH, (activeEnd - px) / (WAVELENGTH / 2));
        const y = mid + amp * Math.max(ramp, 0) * Math.sin(px * k - phase);
        px === start ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
      }
      ctx.lineTo(activeEnd, mid);
      ctx.stroke();
    }

    // Inactive track + stop indicator.
    const trackStart = x + GAP + THUMB_W / 2;
    if (trackStart < end) {
      ctx.strokeStyle = colors.track;
      ctx.beginPath();
      ctx.moveTo(trackStart, mid);
      ctx.lineTo(end, mid);
      ctx.stroke();
      if (end - trackStart > 10) {
        ctx.fillStyle = colors.active;
        ctx.beginPath();
        ctx.arc(end, mid, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Thumb: vertical pill.
    ctx.fillStyle = colors.active;
    ctx.beginPath();
    ctx.roundRect(x - THUMB_W / 2, mid - thumbH / 2, THUMB_W, thumbH, THUMB_W / 2);
    ctx.fill();
  }

  function frame(now) {
    raf = 0;
    // ~30 fps is plenty for a slow wave and halves the cost while playing.
    if (lastFrame && now - lastFrame < 30) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
    lastFrame = now;
    const playing = isPlaying();
    const targetAmp = playing ? AMPLITUDE : 0;
    amp += (targetAmp - amp) * Math.min(1, dt * 7);
    if (Math.abs(targetAmp - amp) < 0.02) amp = targetAmp;
    phase = (phase + dt * WAVE_SPEED * 2 * Math.PI * (amp / AMPLITUDE)) % (Math.PI * 2);
    // Frames may not run at all while the tab is hidden, so a palette change
    // stays "stale" until at least one read happens after its transition ends.
    if (colorsStale || now < colorsDirtyUntil) {
      readColors();
      if (now >= colorsDirtyUntil) colorsStale = false;
    }

    let animating = playing || amp !== targetAmp || colorsStale;
    for (const [slider, state] of bars) {
      if (!slider.isConnected) { state.detach(); bars.delete(slider); continue; }
      const target = state.hovering || state.dragging ? 1 : 0;
      state.hover += (target - state.hover) * Math.min(1, dt * 14);
      if (Math.abs(target - state.hover) < 0.01) state.hover = target;
      else animating = true;
      if (state.dragging) animating = true;
      draw(state);
    }
    if (animating && bars.size) schedule();
    else lastFrame = 0;
  }

  function schedule() {
    if (!raf && enabled) raf = requestAnimationFrame(frame);
  }

  function kick() {
    schedule();
  }

  const MEDIA_EVENTS = ["play", "playing", "pause", "seeked", "timeupdate", "loadedmetadata", "ended"];
  const onMedia = (e) => { if (e.target instanceof HTMLMediaElement) kick(); };

  BYTM.wavy = {
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (on) {
        for (const ev of MEDIA_EVENTS) document.addEventListener(ev, onMedia, true);
        window.addEventListener("resize", kick);
        this.scan();
      } else {
        for (const ev of MEDIA_EVENTS) document.removeEventListener(ev, onMedia, true);
        window.removeEventListener("resize", kick);
        for (const state of bars.values()) state.detach();
        bars.clear();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    scan() {
      if (!enabled) return;
      for (const slider of findSliders()) if (!bars.has(slider)) attach(slider);
      kick();
    },
    paletteChanged() {
      // Colors cross-fade in CSS for ~1s; resample them while that runs.
      colorsDirtyUntil = performance.now() + 1100;
      colorsStale = true;
      kick();
    },
  };
})();
