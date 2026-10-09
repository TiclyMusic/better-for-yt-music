// Product-specific popup content for Better YT Music. popup.js is generic
// and shared with Better for YouTube (which ships its own groups.js).
var BYTM_POPUP = (() => {
  const ICONS = {
    palette:
      "M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z",
    bolt: "M7 2v11h3v9l7-12h-4l4-8z",
    lyrics:
      "M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z",
    sparkle: "M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z",
    window: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 4v10h16V8z",
  };

  const GROUPS = [
    {
      title: "Look",
      icon: "palette",
      rows: [
        { key: "theme", title: "Material 3 Expressive", sub: "Tonal surfaces, bold shapes and springy motion" },
        { key: "dynamicColor", title: "Dynamic color", sub: "Build the palette from the current album art", needsTheme: true },
        { key: "wavyProgress", title: "Wavy progress bar", sub: "Animated M3 wave that rests flat when paused", needsTheme: true },
        { key: "ambientBackdrop", title: "Ambient backdrop", sub: "Soft, blurred artwork behind the player", needsTheme: true },
        { key: "expressiveType", title: "Expressive type", sub: "Google Sans Flex with rounded display styles", needsTheme: true },
        { key: "minimalUI", title: "Minimal interface", sub: "Hide clutter; extra actions appear on hover" },
      ],
      accent: true,
    },
    {
      title: "Lyrics",
      icon: "lyrics",
      rows: [
        {
          key: "syncedLyrics",
          title: "Synced lyrics",
          sub: "Line-by-line lyrics in the Lyrics tab, from LRCLIB or YouTube captions. Click a line to jump to it",
        },
        {
          key: "lyricsKaraoke",
          title: "Karaoke fill",
          sub: "Color sweeps through each word as it's sung (exact when the source has word timing)",
          needs: "syncedLyrics",
        },
        {
          key: "fullscreenLyrics",
          title: "Fullscreen lyrics",
          sub: "Fullscreen shows only big lyrics and the controls",
          needs: "syncedLyrics",
        },
      ],
    },
    {
      title: "Speed",
      icon: "bolt",
      rows: [
        { key: "blockTelemetry", title: "Block telemetry & ad trackers", sub: "Fewer background requests; play counts still reach artists" },
        { key: "lazyRender", title: "Lazy rendering", sub: "Skip layout and paint for off-screen shelves and rows" },
        { key: "lightEffects", title: "Lightweight effects", sub: "No live background blurs or JS ripple animations" },
        { key: "videoSaver", title: "Video saver", sub: "Stream music videos at 144p while they aren't visible" },
        { key: "nativeAnimations", title: "Native animations", sub: "Use Chrome's GPU animations instead of YTM's JS polyfill (applies on reload)" },
      ],
    },
    {
      title: "Quality of life",
      icon: "sparkle",
      rows: [
        { key: "autoContinue", title: "Keep playing", sub: "Auto-dismiss “Still listening?”" },
        { key: "wheelVolume", title: "Scroll for volume", sub: "Scroll over the player bar to adjust volume" },
        { key: "hideUpsells", title: "Hide Premium upsells", sub: "Remove promo banners and pop-ups" },
      ],
    },
  ];

  return {
    hero: { lobes: 9, depth: 0.075, color: "rgb(242 22 18)" },
    icons: ICONS,
    groups: GROUPS,
    appUrl: "https://music.youtube.com/",
    openLabel: "Open YouTube Music",
    paletteFromLast: "Palette from the last track you played",
    paletteWaiting: "Play something to pick up its colors",
  };
})();
