// Render a flowmap HTML offline in Chromium and save screenshots.
// Usage: node tests/screenshot.cjs <flowmap.html> <out.png> [--flow <id>] [--step N] [--theme light]
// Any non-file:// request is blocked and fails the run, which proves the file is offline-only.
const { launch } = require("./launch.cjs");
const path = require("path");

(async () => {
  const [, , html, out, ...rest] = process.argv;
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const external = [];
  const errors = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file://") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    external.push(url);
    return route.abort();
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  if (opt("--theme")) await page.addInitScript((t) => localStorage.setItem("flowmap-theme", t), opt("--theme"));
  await page.goto("file://" + path.resolve(html));
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  await page.waitForTimeout(800);
  const flow = opt("--flow");
  if (flow) {
    const name = await page.evaluate((id) => {
      const g = JSON.parse(document.getElementById("flowmap-data").textContent);
      return g.flows.find((f) => f.id === id).name;
    }, flow);
    await page.locator(".fm-flow-list li", { hasText: name }).first().click();
    await page.waitForTimeout(700);
    const step = Number(opt("--step") || 1);
    for (let i = 1; i < step; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1400);
  }
  await page.screenshot({ path: out });
  await browser.close();
  if (external.length) { console.error("EXTERNAL REQUESTS:", external); process.exit(2); }
  if (errors.length) { console.error("PAGE ERRORS:", errors); process.exit(3); }
  console.log("saved", out);
})();
