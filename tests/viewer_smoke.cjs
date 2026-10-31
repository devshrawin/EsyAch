// End-to-end check of the viewer in Chromium, offline.
// Usage: node tests/viewer_smoke.cjs <flowmap.html> [outDir]
// Covers: search, flow replay, detail levels, groups, edit (label, add node, connect, undo),
// save JSON, save HTML (re-opened to prove edits persist), PNG/SVG/Mermaid export, print.
const { launch } = require("./launch.cjs");
const fs = require("fs");
const path = require("path");
const os = require("os");

const html = path.resolve(process.argv[2]);
const outDir = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), "flowmap-smoke-"));
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

async function open(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  const external = [], errors = [];
  await page.route("**/*", (r) => {
    const u = r.request().url();
    if (/^(file|data|blob):/.test(u)) return r.continue();
    external.push(u);
    return r.abort();
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  // Force the download fallback instead of the native "Save as" dialog.
  await page.addInitScript(() => { try { delete window.showSaveFilePicker; } catch {} window.showSaveFilePicker = undefined; });
  await page.goto("file://" + file);
  await page.waitForSelector(".react-flow__node");
  await page.waitForTimeout(700);
  return { page, external, errors };
}

async function grab(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const p = path.join(outDir, dl.suggestedFilename());
  await dl.saveAs(p);
  return p;
}

const nodeCount = (page) => page.locator(".react-flow__node").count();

(async () => {
  const browser = await launch();
  const { page, external, errors } = await open(browser, html);
  const graph = await page.evaluate(() => JSON.parse(document.getElementById("flowmap-data").textContent));

  // flows
  ok((await page.locator(".fm-flow-list li").count()) === graph.flows.length, `flow list shows all ${graph.flows.length} flows`);
  await page.locator(".fm-flow-list li", { hasText: "Nightly" }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  ok((await page.locator(".fm-caption").innerText()).includes("3/4"), "step through a flow (caption shows 3/4)");
  ok((await page.locator(".react-flow__node .is-dim").count()) > 0, "nodes outside the flow are dimmed");
  await page.locator("[data-testid=play]").click();
  await page.waitForTimeout(2200);
  ok((await page.locator(".fm-caption").innerText()).includes("4/4"), "play advances to the last step");
  await page.keyboard.press("Escape");

  // search
  await page.keyboard.press("Control+k");
  await page.locator("[data-testid=search] input").fill("stripe api");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  ok((await page.locator("[data-testid=node-drawer]").innerText()).includes("Stripe API"), "Ctrl+K search opens the node");
  await page.screenshot({ path: path.join(outDir, "search-result.png") });
  await page.keyboard.press("Escape");

  // detail levels + groups
  const full = await nodeCount(page);
  await page.locator("[data-testid=view-tab]").click();
  await page.locator(".fm-seg button", { hasText: "Overview" }).click();
  await page.waitForTimeout(900);
  const over = await nodeCount(page);
  ok(over < full, `Overview folds circles into hubs (${full} -> ${over} nodes)`);
  await page.locator(".fm-seg button", { hasText: "Detail" }).click();
  await page.locator("button", { hasText: "Collapse all" }).click();
  await page.waitForTimeout(900);
  const groups = await page.locator(".fm-group").count();
  ok(groups === (graph.groups || []).length, `Collapse all shows ${groups} group nodes`);
  await page.screenshot({ path: path.join(outDir, "collapsed.png") });
  await page.locator(".fm-group").first().click();
  await page.waitForTimeout(900);
  ok((await page.locator(".fm-group").count()) === groups - 1, "clicking a group node expands it");
  await page.locator("button", { hasText: "Expand all" }).click();
  await page.waitForTimeout(900);

  // edit: label
  await page.locator("[data-testid=edit-toggle]").click();
  await page.locator('.react-flow__node[data-id="svc_users"]').click();
  const label = page.locator("[data-testid=node-drawer] .fm-field", { hasText: "Label" }).locator("input");
  await label.fill("Accounts Service");
  await label.press("Enter");
  await page.waitForTimeout(300);
  ok((await page.locator('.react-flow__node[data-id="svc_users"]').innerText()).includes("Accounts Service"), "edit a node label");

  // edit: add node, undo, redo
  const before = await nodeCount(page);
  await page.locator("[data-testid=add-node]").click();
  await page.waitForTimeout(300);
  ok((await nodeCount(page)) === before + 1, "add a node");
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  ok((await nodeCount(page)) === before, "Ctrl+Z undoes the add");
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(300);
  ok((await nodeCount(page)) === before + 1, "Ctrl+Shift+Z redoes it");
  await page.keyboard.press("Control+z");

  // edit: connect two nodes by dragging handles
  const edgeStat = async () => Number((await page.locator(".fm-stats").innerText()).match(/(\d+) edges/)[1]);
  const edgesBefore = await edgeStat();
  const src = await page.locator('.react-flow__node[data-id="job_nightly"] .fm-handle-out').boundingBox();
  const dst = await page.locator('.react-flow__node[data-id="hub_worker"] .fm-handle-in').boundingBox();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst.x + 2, dst.y + dst.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok((await edgeStat()) === edgesBefore + 1, "connect two nodes by dragging");
  ok(await page.locator("[data-testid=edge-drawer]").isVisible(), "new edge opens in the edge editor");
  await page.screenshot({ path: path.join(outDir, "edit-mode.png") });

  // save JSON
  await page.locator("[data-testid=save-menu]").click();
  const jsonPath = await grab(page, () => page.locator(".fm-menu-pop button", { hasText: "Download architecture.json" }).click());
  const saved = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  ok(saved.nodes.find((n) => n.id === "svc_users").label === "Accounts Service" &&
     saved.nodes.find((n) => n.id === "svc_users").edited === true, "saved JSON has the edited label (edited: true)");
  ok(saved.edges.some((e) => e.from === "job_nightly" && e.to === "hub_worker" && e.evidence[0].user), "saved JSON has the new edge with reviewer evidence");
  ok(!JSON.stringify(saved).includes("collapsedGroup"), "saved JSON has no view-only fields");

  // save HTML, re-open it
  await page.locator("[data-testid=save-menu]").click();
  const htmlPath = await grab(page, () => page.locator(".fm-menu-pop button", { hasText: "Download HTML" }).click());
  const re = await open(browser, htmlPath);
  ok((await re.page.locator('.react-flow__node[data-id="svc_users"]').innerText()).includes("Accounts Service"), "downloaded HTML re-opens with the edits");
  ok(re.external.length === 0 && re.errors.length === 0, "downloaded HTML is offline and error-free");
  await re.page.close();

  // exports
  await page.locator("[data-testid=export-menu]").click();
  const png = await grab(page, () => page.locator(".fm-menu-pop button", { hasText: "PNG" }).click());
  const pngBuf = fs.readFileSync(png);
  ok(pngBuf.slice(1, 4).toString() === "PNG" && pngBuf.length > 20000, `PNG export (${(pngBuf.length / 1024).toFixed(0)} KB)`);
  await page.locator("[data-testid=export-menu]").click();
  const svg = await grab(page, () => page.locator(".fm-menu-pop button", { hasText: "SVG" }).click());
  const svgText = fs.readFileSync(svg, "utf8");
  ok(svgText.startsWith("<svg") && svgText.includes("Order Service") && !svgText.includes("foreignObject"), "SVG export is vector with real text");
  await page.locator("[data-testid=export-menu]").click();
  const mmd = await grab(page, () => page.locator(".fm-menu-pop button", { hasText: "Mermaid" }).click());
  const mmdText = fs.readFileSync(mmd, "utf8");
  ok(mmdText.startsWith("flowchart LR") && mmdText.includes("-.->") && mmdText.includes("subgraph"), "Mermaid export");
  await page.locator("[data-testid=export-menu]").click();
  await page.locator(".fm-menu-pop button", { hasText: "Print" }).click();
  await page.waitForTimeout(500);
  const book = await page.locator("iframe[data-flowmap-print]").getAttribute("srcdoc");
  ok(book && (book.match(/<section class="flow">/g) || []).length === graph.flows.length, "print book has one section per flow");

  // start-here card, "?" button and deep links (automated browsers never see the card unless #tour=1)
  ok((await page.locator("[data-testid=welcome]").count()) === 0, "Start here card stays away in automated browsers");
  const tour = await open(browser, html + "#tour=1");
  ok((await tour.page.locator("[data-testid=welcome]").count()) === 1, "#tour=1 shows the Start here card");
  await tour.page.locator("[data-testid=welcome-play]").click();
  await tour.page.waitForTimeout(500);
  ok((await tour.page.locator("[data-testid=welcome]").count()) === 0 && (await tour.page.locator(".fm-caption").count()) === 1,
    "Play on the card closes it and starts the first flow");
  await tour.page.locator("[data-testid=help-btn]").click();
  ok((await tour.page.locator("[data-testid=welcome]").count()) === 1, "? button brings the card back");
  ok(tour.external.length === 0 && tour.errors.length === 0, "Start here card: no network, no page errors");
  const dl = await open(browser, html + `#flow=${graph.flows[1].id}&step=2`);
  ok((await dl.page.locator(".fm-caption").innerText()).startsWith("2/"), "deep link #flow=…&step=2 opens that flow at step 2");
  ok((await dl.page.locator("[data-testid=welcome]").count()) === 0, "a deep link hides the Start here card");

  ok(external.length === 0, "no network requests");
  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  console.log(`\n${failures ? "FAILED" : "ALL PASSED"} (${failures} failures). Artifacts in ${outDir}`);
  process.exit(failures ? 1 : 0);
})();
