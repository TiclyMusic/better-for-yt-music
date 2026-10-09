# Better for YouTube Music

YouTube Music (music.youtube.com) in Material 3 Expressive: re-themed, lighter, with letter-by-letter synced lyrics. The desktop app in `../better-yt-music-desktop/` is built from this same code.

## Features

**Look: Material 3 Expressive**
- **Dynamic color.** The whole UI is re-tinted from the current album art. A hue/chroma seed is sampled from the cover and a full M3 tonal scheme is derived in CSS with `oklch()`.
- **Wavy progress bar.** The M3 Expressive wavy indicator is drawn on a canvas under YTM's own slider, so seeking and keyboard control are unchanged. It flattens when paused and runs at about 30 fps to stay cheap. It works on both the new and the classic player bar.
- **Shape and motion.** Buttons morph when pressed, and the play button is a circle when paused and a squircle when playing. The player bar is a floating 28px card, and the tabs, chips, menus and dialogs all use M3 shapes. Motion uses spring curves, and `prefers-reduced-motion` is respected.
- **Ambient backdrop.** A tiny pre-blurred copy of the artwork, upscaled behind the player page. It looks like a huge blur but costs no filter work.
- **Expressive type.** Google Sans Flex with rounded display styles.
- **Minimal interface.** Hides mood chips, the giant home background, cast/history buttons, promos, badges, dislike, queue chips and the Comments/Related tabs. Secondary actions appear on hover.

**Synced lyrics** (in YTM's own Lyrics tab)
- Line-synced lyrics from [LRCLIB](https://lrclib.net), falling back to the track's YouTube captions, then to LRCLIB plain lyrics when YTM has none.
- **Karaoke fill.** The color sweeps through each word, letter by letter. It uses real word timing when the source has it (enhanced LRC); otherwise timing is spread across the line by word length.
- **Fullscreen lyrics.** YTM's fullscreen shows only huge lyrics over the blurred artwork, with the controls always visible.
- Click a line to jump to it. The view auto-scrolls and pauses when you scroll yourself. Instrumental breaks show filling dots.
- If the [Better Lyrics](https://github.com/better-lyrics/better-lyrics) extension is installed, ours steps aside. Better Lyrics has syllable-level sources from its private API, and we share no code with it.
- Privacy: song title, artist, album and duration are sent to `lrclib.net`. Turn **Synced lyrics** off to stop that.

**Speed: why YTM lags, and what's done about it**
- **Native animations.** YTM ships a Web Animations polyfill that replaces Chrome's compositor-driven `Element.animate` with a JS version that keeps a `requestAnimationFrame` loop busy. We keep the native one.
- **Lightweight effects.** Dozens of tonal buttons carry live `backdrop-filter` blurs, and clicks run JS ripples; both are removed. Off-screen spinners stop animating.
- **Video saver.** Music videos stream at 144p while you can't see them (player page closed, window hidden, or fullscreen lyrics on top). Audio is unaffected.
- **Lazy rendering.** `content-visibility` on off-screen shelves, rows, grids, queue items, and the closed player page.
- **No palette transition.** Animating the palette restyled every element on every frame at each track change, so the palette now snaps.
- **No subtree MutationObserver.** A cheap 700 ms poll replaces it, instead of observing YTM's constantly-mutating DOM.
- **Telemetry blocking.** `log_event`, QoE/ATR stats, `ptracking`, `csi_204`, `play.google.com/log`, doubleclick and pagead are blocked. Plays still count for artists, and history works.

**Quality of life**
- **Keep playing.** Auto-dismisses "Still listening?".
- **Scroll for volume.** Scroll over the player bar, with an M3 indicator. Scrolling up always unmutes, and it stays in sync with YTM's slider.
- **Hide Premium upsells.**

Every feature can be toggled live from the toolbar popup.

## Install the extension

`chrome://extensions` → Developer mode → **Load unpacked** → select this `better-for-youtube-music/` folder. It works in Chromium browsers at version 122 or later.


## Files

```
manifest.json, rules/, icons/   the extension
src/background.js               service worker: defaults, telemetry ruleset, LRCLIB lookups
src/shared/settings.js          settings schema
src/content/                    theme.css, wavy, lyrics, tweaks, main, page-bridge (MAIN world)
src/popup/                      settings popup (groups.js is this product's; popup.js is generic)
store/                          Chrome Web Store kit (see store/README.md)
```

`src/shared/m3-tokens.css`, `src/shared/lyrics-lookup.js`, `src/content/color.js` and `src/popup/popup.{js,css}` are generated copies of `../shared/`. Edit the originals there, then run `node tools/sync-shared.mjs` from the `Extensions/` folder.

## How the theming works

YouTube Music and YouTube route their colors through `--yt-sys-color-baseline--*` custom properties. The themes redefine them as M3 roles (`--md-primary`, `--md-surface-container-high`, …), which are computed from `--bytm-hue` and `--bytm-chroma`. Component rules add the shapes, state layers and motion.

YTM's compiled button styles and YouTube's newer hashed tokens (`--t4a6…`) are handled explicitly; see the comments in each `theme.css`.

Each feature is scoped to an attribute on `<html>` (`data-bytm-theme`, `data-bytm-minimal`, …), so turning a setting off removes it instantly.

## Download

Get the latest build from the [Releases page](https://github.com/TiclyMusic/better-for-yt-music/releases/latest). Unzip it, open `chrome://extensions`, enable Developer mode and use **Load unpacked**.

## Other extensions

- [Better for YouTube](https://github.com/TiclyMusic/better-for-youtube)
- [Better for Spotify](https://github.com/TiclyMusic/better-for-spotify)
