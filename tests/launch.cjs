// Shared browser launcher for the Playwright scripts.
// Order: $FLOWMAP_BROWSER (path to an executable) -> Playwright's bundled Chromium ->
// the system Chrome -> the system Edge. So the tests also run where `npx playwright install`
// has not been run (or was run for a different Playwright version).
const { chromium } = require("playwright");

async function launch(opts = {}) {
  if (process.env.FLOWMAP_BROWSER) {
    return chromium.launch({ ...opts, executablePath: process.env.FLOWMAP_BROWSER });
  }
  const attempts = [{}, { channel: "chrome" }, { channel: "msedge" }];
  let last;
  for (const extra of attempts) {
    try {
      return await chromium.launch({ ...opts, ...extra });
    } catch (e) {
      last = e;
    }
  }
  throw new Error(
    "No browser found. Run `npx playwright install chromium`, install Chrome/Edge, " +
      "or set FLOWMAP_BROWSER to a browser executable.\n" + last.message
  );
}

module.exports = { launch };
