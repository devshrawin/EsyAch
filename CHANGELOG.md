# Changelog

## 0.2.0

- **Cleaner canvas.** Zoomed out, only the selected flow's edges carry labels (hover any edge for the rest), so the overview stops looking like a wall of tiny text. Maps now fit with less padding, and a map too wide to read opens on the first flow's opening nodes.
- **Works on small screens.** The top bar no longer overflows or wraps below ~1060px; under 820px the flows panel is a slide-over with a toggle, the detail drawer overlays the map, and the minimap steps aside. Tested at 1100, 800 and 390px.
- **Lightbox** no longer shows the page behind it through the overlay.
- **"Start here" card.** The first time a map is opened it shows what the project is, its size, and one button that plays the best flow. Dismiss it once and it stays away (remembered per project). The **?** button in the top bar brings it back. Automated browsers never see it, so the test suites are unaffected.
- **Deep links for presenting.** `flowmap.html#flow=<id>&step=3&play=1` opens straight into a flow, at a step, optionally playing. `#tour=1` forces the card, `#tour=0` hides it.
- **Works on Windows out of the box.** The commands and skill now say to use `python` or `py -3` when `python3` is the Microsoft Store stub, and allow those launchers.
- **Tests run on Windows.** UTF-8 is explicit everywhere the tests read or write files, the symlink test skips when symlinks cannot be created, and a test directory no longer uses the reserved name `nul`.
- **Tests find a browser without a download.** `tests/launch.cjs` falls back from Playwright's Chromium to the installed Chrome or Edge, or to `$FLOWMAP_BROWSER`.
- **Continuous integration** on Linux and Windows, and an optional GitHub Pages workflow that publishes the two example maps as a live demo.
- Docs: CHANGELOG, CONTRIBUTING, SECURITY and an "Is it safe to install?" page.

## 0.1.0

- First release: Mode A (code → architecture map with named, replayable flows), Mode B (SRS + screenshots → clickable prototype with a coverage report), editing, and PNG / SVG / Mermaid / HTML / PDF exports. 140 QA cases.
