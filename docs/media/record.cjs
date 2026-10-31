// Records the README animations from the example HTML files (Chromium video -> GIF via ffmpeg).
// Usage: node docs/media/record.cjs            (writes docs/media/*.gif)
// Playwright videos do not show the mouse, so a fake cursor with a click ripple is injected.
const { launch } = require("../../tests/launch.cjs");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = __dirname;
const A = path.join(ROOT, "examples/shop-demo/.flowmap/flowmap.html");
const B = path.join(ROOT, "examples/shop-spec/.flowmap/flowmap.html");
const W = 1440, H = 810;

const CURSOR = () => {
  const c = document.createElement("div");
  c.id = "__cur";
  c.style.cssText = "position:fixed;left:0;top:0;width:18px;height:18px;margin:-3px 0 0 -3px;z-index:2147483647;pointer-events:none;" +
    "background:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24'%3E%3Cpath d='M4 2l16 10-7 1.5L9.5 21z' fill='white' stroke='black' stroke-width='1.6' stroke-linejoin='round'/%3E%3C/svg%3E\") no-repeat;";
  const add = () => document.body && !document.getElementById("__cur") && document.body.appendChild(c);
  document.addEventListener("DOMContentLoaded", add);
  setInterval(add, 300);
  window.addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  window.addEventListener("mousedown", (e) => {
    const r = document.createElement("div");
    r.style.cssText = `position:fixed;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;` +
      "border:3px solid #ff6d5a;z-index:2147483646;pointer-events:none;transition:all .45s ease-out;opacity:1";
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; });
    setTimeout(() => r.remove(), 600);
  }, true);
};

async function scene(name, file, fn, { speed = 1, trimStart = 1.2, fps = 10, width = 1000, colors = 128 } = {}) {
  const browser = await launch();
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "rec-"));
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  await ctx.addInitScript(CURSOR);
  await ctx.addInitScript(() => { try { localStorage.clear(); } catch {} });
  const page = await ctx.newPage();
  await page.goto("file://" + file);
  await page.waitForSelector(".react-flow__node");
  await page.mouse.move(W / 2, H / 2);
  await page.waitForTimeout(900);
  const move = async (loc, opts = {}) => {
    const b = await loc.boundingBox();
    const x = b.x + b.width * (opts.fx ?? 0.5), y = b.y + b.height * (opts.fy ?? 0.5);
    await page.mouse.move(x, y, { steps: opts.steps ?? 18 });
    await page.waitForTimeout(opts.pause ?? 250);
    return [x, y];
  };
  const click = async (loc, opts = {}) => {
    const [x, y] = await move(loc, opts);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(opts.after ?? 600);
    return [x, y];
  };
  try {
    await fn(page, { move, click });
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, `_fail-${name}.png`) });
    throw e;
  }
  await page.waitForTimeout(800);
  const video = page.video();
  await ctx.close();
  await browser.close();
  const webm = await video.path();
  const gif = path.join(OUT, `${name}.gif`);
  const pal = path.join(dir, "pal.png");
  const vf = `trim=start=${trimStart},setpts=PTS/${speed},fps=${fps},scale=${width}:-1:flags=lanczos`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf", `${vf},palettegen=max_colors=${colors}:stats_mode=diff`, pal]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-i", pal, "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`, gif]);
  console.log(`${name}.gif  ${(fs.statSync(gif).size / 1048576).toFixed(1)} MB`);
}

(async () => {
  const only = process.argv[2];
  const run = (n, ...a) => (!only || only === n) && scene(n, ...a);

  // 1. Code: replay the checkout flow
  await run("flow-replay", A, async (page, { click }) => {
    await click(page.locator(".fm-flow-list li", { hasText: "Checkout & pay" }), { after: 1200 });
    await click(page.locator("[data-testid=play]"), { after: 0 });
    await page.mouse.move(W - 260, H - 120, { steps: 20 });
    await page.waitForTimeout(1700 * 9 + 1200);
  }, { speed: 2.2, fps: 8, width: 920, colors: 96 });

  // 2. Spec: use the screenshots like a prototype
  await run("prototype", B, async (page, { click, move }) => {
    await click(page.locator('[data-id="s_signin"]'), { after: 900 });
    await move(page.locator('[data-hs="sign_in"]'), { pause: 900 });
    await click(page.locator('[data-hs="sign_in"]'), { after: 900 });
    await click(page.locator(".fm-chooser button", { hasText: "Products" }), { after: 1000 });
    await click(page.locator('[data-hs="nav_cart"]'), { after: 1000 });
    await click(page.locator('[data-hs="checkout"]'), { after: 1000 });
    await click(page.locator('[data-hs="place_order"]'), { after: 900 });
    await click(page.locator(".fm-chooser button", { hasText: "Order confirmed" }), { after: 1000 });
    await click(page.locator('[data-hs="view_status"]'), { after: 1400 });
  }, { speed: 1.25 });

  // 3. Spec: coverage catches the gaps
  await run("coverage", B, async (page, { click }) => {
    await click(page.locator("[data-testid=coverage-tab]"), { after: 1600 });
    await click(page.locator('[data-finding="F1"]'), { after: 2200 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await click(page.locator("[data-testid=reqs-tab]"), { after: 700 });
    await click(page.locator('[data-req="FR-8"]'), { after: 1600 });
    await click(page.locator('[data-req="FR-13"]'), { after: 1600 });
  }, { speed: 1.2 });

  // 4. Edit: fix the map yourself
  await run("edit", A, async (page, { click, move }) => {
    await click(page.locator("[data-testid=edit-toggle]"), { after: 700 });
    // drag a node
    const [x, y] = await move(page.locator('[data-id="ds_reports"]'));
    await page.mouse.down();
    await page.mouse.move(x + 40, y - 120, { steps: 25 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    // connect two nodes
    const [sx, sy] = await move(page.locator('[data-id="job_nightly"] .fm-handle-out'));
    await page.mouse.down();
    const d = await page.locator('[data-id="hub_worker"] .fm-handle-in').boundingBox();
    await page.mouse.move(d.x + 2, d.y + d.height / 2, { steps: 30 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const lbl = page.locator("[data-testid=edge-drawer] .fm-field", { hasText: "Label" }).locator("input");
    await click(lbl, { after: 200 });
    await page.keyboard.type("notify", { delay: 90 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    await click(page.locator("[data-testid=edge-drawer] .fm-check input").last(), { after: 900 });
    await click(page.locator("[data-testid=save-menu]"), { after: 1500 });
    void sx; void sy;
  }, { speed: 1.2 });
})();
