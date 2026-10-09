// Quality-of-life features that need a bit of script.
(() => {
  // ---------------------------------------------------------------------------
  // "Still listening?" — click Yes as soon as the dialog appears.
  let autoContinue = false;

  function dismissStillListening() {
    if (!autoContinue) return;
    const dialog = document.querySelector("ytmusic-you-there-renderer");
    if (!dialog || !dialog.offsetParent) return;
    const button = dialog.querySelector("button, tp-yt-paper-button, yt-button-renderer");
    if (!button) return;
    button.click();
    const v = document.querySelector("video");
    if (v && v.paused) v.play().catch(() => {});
    console.info("[Better YTM] Dismissed 'Still listening?'");
  }

  // ---------------------------------------------------------------------------
  // Scroll the player bar to change volume.
  const STEP = 5;
  let wheelVolume = false;
  let toast, toastLevel, toastLabel, toastTimer;

  function showVolumeToast(volume, muted) {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "bytm-volume-toast";
      toast.setAttribute("role", "status");
      const track = document.createElement("div");
      track.className = "bytm-volume-track";
      toastLevel = document.createElement("div");
      toastLevel.className = "bytm-volume-level";
      track.append(toastLevel);
      toastLabel = document.createElement("span");
      toastLabel.className = "bytm-volume-label";
      toast.append(track, toastLabel);
      document.body.append(toast);
    }
    const shown = muted ? 0 : volume;
    toastLevel.style.width = `${shown}%`;
    toastLabel.textContent = muted ? "Muted" : `${Math.round(volume)}%`;
    toast.classList.add("bytm-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("bytm-visible"), 1100);
  }

  function nudgeVolume(delta) {
    // Handled in the page world (page-bridge.js), which owns the player API and
    // reports the resulting volume back via "bytm:volume-changed".
    document.dispatchEvent(new CustomEvent("bytm:volume", { detail: JSON.stringify({ delta }) }));
  }

  document.addEventListener("bytm:volume-changed", (e) => {
    try {
      const { volume, muted } = JSON.parse(e.detail);
      if (typeof volume === "number") showVolumeToast(volume, muted);
    } catch {}
  });

  function onWheel(e) {
    if (!wheelVolume || e.ctrlKey) return;
    const bar = e.target.closest?.("ytmusic-app-layout > ytmusic-miniplayer, ytmusic-player-bar");
    if (!bar) return;
    // Let scrollable popups inside the bar (e.g. menus) scroll normally.
    if (e.target.closest("tp-yt-iron-dropdown, ytmusic-menu-popup-renderer")) return;
    const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!dy) return;
    e.preventDefault();
    nudgeVolume(dy < 0 ? STEP : -STEP);
  }
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });

  BYTM.tweaks = {
    configure(settings) {
      autoContinue = settings.autoContinue;
      wheelVolume = settings.wheelVolume;
      dismissStillListening();
    },
    poll() {
      dismissStillListening();
    },
  };
})();
