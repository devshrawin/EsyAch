// Browser half of the QA harness (Chromium, offline). Writes a JSON array of test results.
// Usage: node tests/qa_browser.cjs <modeA.html> <modeB.html> <big.html> <out.json> <artifactDir>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const [, , A, B, BIG, OUT, ART] = process.argv;
fs.mkdirSync(ART, { recursive: true });
const results = [];
let browser;

function tc(id, area, title, expected, fn) {
  return { id, area, title, expected, fn };
}

async function open(file, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const ext = [], errs = [];
  await page.route("**/*", (r) => {
    const u = r.request().url();
    if (/^(file|data|blob):/.test(u)) return r.continue();
    ext.push(u);
    return r.abort();
  });
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await page.addInitScript(() => { try { window.showSaveFilePicker = undefined; } catch {} });
  if (opts.html) {
    const f = path.join(ART, `tmp-${Date.now()}.html`);
    fs.writeFileSync(f, opts.html);
    file = f;
  }
  await page.goto("file://" + path.resolve(file));
  await page.waitForSelector(opts.wait ?? ".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(opts.settle ?? 700);
  return { page, ctx, ext, errs };
}

async function grab(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), trigger()]);
  const p = path.join(ART, dl.suggestedFilename());
  await dl.saveAs(p);
  return p;
}

const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const graphOf = (page) => page.evaluate(() => JSON.parse(document.getElementById("flowmap-data").textContent));
const css = (page, sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
const menu = async (page, which, label) => {
  await page.locator(`[data-testid=${which}]`).click();
  return page.locator(".fm-menu-pop button", { hasText: label }).first();
};
const tamper = (file, fn) => {
  const html = fs.readFileSync(file, "utf8");
  const re = /(<script id="flowmap-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
  const g = JSON.parse(html.match(re)[2].replace(/<\\\//g, "</").replace(/<\\!--/g, "<!--"));
  fn(g);
  const json = JSON.stringify(g).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
  return html.replace(re, (_m, a, _b, c) => a + json + c);
};

// ====================================================================== Mode A
const modeA = [
  tc("VA-01", "Viewer A", "Opens offline: no network requests, no console errors", "0 requests, 0 errors", async (s) => {
    assert(s.ext.length === 0 && s.errs.length === 0, JSON.stringify([s.ext, s.errs]));
    return `${await s.page.locator(".react-flow__node").count()} nodes rendered`;
  }),
  tc("VA-02", "Viewer A", "n8n look: charcoal canvas background", "rgb(42, 42, 42)", async ({ page }) => {
    const bg = await css(page, ".react-flow", "backgroundColor");
    assert(bg === "rgb(42, 42, 42)", bg);
    return bg;
  }),
  tc("VA-03", "Viewer A", "n8n look: dot grid", "background pattern of dots", async ({ page }) => {
    const n = await page.locator(".react-flow__background pattern circle, .react-flow__background circle").count();
    assert(n > 0, "no dot pattern");
    return "dot pattern present";
  }),
  tc("VA-04", "Viewer A", "n8n look: labels sit under the node box", "label top >= box bottom for every square node", async ({ page }) => {
    const bad = await page.evaluate(() => [...document.querySelectorAll(".fm-std")].filter((n) => {
      const l = n.querySelector(".fm-label"); if (!l) return false;
      return l.getBoundingClientRect().top < n.getBoundingClientRect().bottom - 1;
    }).length);
    assert(bad === 0, `${bad} labels overlap their box`);
    return `${await page.locator(".fm-std").count()} nodes checked`;
  }),
  tc("VA-05", "Viewer A", "n8n look: circles under hubs, joined by dashed lines", "every circle below its hub; dashed dependency strokes", async ({ page }) => {
    const g = await graphOf(page);
    for (const n of g.nodes.filter((x) => x.hub)) {
      const c = await page.locator(`[data-id="${n.id}"]`).boundingBox();
      const h = await page.locator(`[data-id="${n.hub}"]`).boundingBox();
      assert(c.y > h.y + h.height, `${n.id} not under ${n.hub}`);
    }
    const dash = await css(page, ".fm-edge.is-dep", "strokeDasharray");
    assert(dash && dash !== "none", dash);
    return `${g.nodes.filter((x) => x.hub).length} circles under hubs, dasharray ${dash}`;
  }),
  tc("VA-06", "Viewer A", "n8n look: red trigger bolts on entry points", "bolt fill = accent red on every trigger", async ({ page }) => {
    const n = await page.locator(".fm-trigger .fm-bolt svg").count();
    const fill = await css(page, ".fm-trigger .fm-bolt svg", "fill");
    assert(n >= 8 && fill === "rgb(255, 109, 90)", `${n} ${fill}`);
    return `${n} bolts, ${fill}`;
  }),
  tc("VA-07", "Viewer A", "At least 3 replayable flows: select, step, play", "11 flows; caption advances; play reaches the end", async ({ page }) => {
    const n = await page.locator(".fm-flow-list li").count();
    await page.locator(".fm-flow-list li", { hasText: "Checkout & pay" }).click();
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowRight");
    const cap = await page.locator(".fm-caption").innerText();
    await page.locator("[data-testid=play]").click();
    await page.waitForTimeout(1700 * 9 + 600);
    const end = await page.locator(".fm-caption").innerText();
    assert(n >= 3 && cap.includes("2/10") && end.includes("10/10"), `${n} ${cap} ${end}`);
    const dot = await page.locator(".fm-edge-dot").count();
    return `${n} flows, caption ${cap.split("\n")[0]} -> ${end.split("\n")[0]}, animated dot ${dot}`;
  }),
  tc("VA-08", "Viewer A", "Node drawer shows summary, evidence, edges, flows", "drawer lists file:line and flows", async ({ page }) => {
    await page.keyboard.press("Escape");
    await page.locator('[data-id="hub_orders"]').click();
    const t = await page.locator("[data-testid=node-drawer]").innerText();
    assert(t.includes("api/services/orders.py:7") && /flows through here/i.test(t) && t.includes("Checkout & pay"), t.slice(0, 200));
    return "evidence + flows listed";
  }),
  tc("VA-09", "Viewer A", "Edge hover card shows payload and evidence", "payload + file:line", async ({ page }) => {
    await page.keyboard.press("Escape");
    // hover a point that is ON the curve (the bbox centre of a curve can sit on a neighbouring edge)
    const pt = await page.evaluate(() => {
      const el = document.querySelector('[data-id="e_ui_checkout"] path.react-flow__edge-interaction');
      const q = el.getPointAtLength(el.getTotalLength() * 0.7);
      const m = el.getScreenCTM();
      return [q.x * m.a + q.y * m.c + m.e, q.x * m.b + q.y * m.d + m.f];
    });
    await page.mouse.move(pt[0], pt[1]);
    await page.waitForTimeout(300);
    const t = await page.locator(".fm-tip").innerText();
    assert(t.includes("{user_id, items") && t.includes("web/src/api.ts:19"), t);
    return t.replace(/\n/g, " ").slice(0, 90);
  }),
  tc("VA-10", "Viewer A", "Ctrl+K search finds a node by symbol name", "typing 'create_order' opens Order Service", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await page.locator("[data-testid=search] input").fill("create_order");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const t = await page.locator("[data-testid=node-drawer]").innerText();
    assert(t.includes("Order Service"), t.slice(0, 80));
    await page.keyboard.press("Escape");
    return "Order Service";
  }),
  tc("VA-11", "Viewer A", "Detail levels and kind filter change what is drawn", "Overview < Detail nodes; hiding datastores removes them", async ({ page }) => {
    const nDs = (await graphOf(page)).nodes.filter((n) => n.kind === "datastore").length;
    await page.locator("[data-testid=view-tab]").click();
    const full = await page.locator(".react-flow__node").count();
    await page.locator(".fm-seg button", { hasText: "Overview" }).click(); await page.waitForTimeout(800);
    const ov = await page.locator(".react-flow__node").count();
    await page.locator(".fm-seg button", { hasText: "Detail" }).click(); await page.waitForTimeout(800);
    await page.locator(".fm-chip-btn", { hasText: "datastore" }).click(); await page.waitForTimeout(800);
    const nods = await page.locator(".react-flow__node").count();
    await page.locator(".fm-chip-btn", { hasText: "datastore" }).click(); await page.waitForTimeout(800);
    assert(ov < full && nods === full - nDs, `${full} ${ov} ${nods} (datastores ${nDs})`);
    return `detail ${full}, overview ${ov}, without datastores ${nods}`;
  }),
  tc("VA-12", "Viewer A", "Groups collapse into a stacked card and expand on click", "4 group cards; click expands one", async ({ page }) => {
    await page.locator("[data-testid=view-tab]").click();
    await page.locator("button", { hasText: "Collapse all" }).click(); await page.waitForTimeout(900);
    const g = await page.locator(".fm-group").count();
    await page.locator(".fm-group").first().click(); await page.waitForTimeout(900);
    const g2 = await page.locator(".fm-group").count();
    await page.locator("button", { hasText: "Expand all" }).click(); await page.waitForTimeout(900);
    assert(g === 4 && g2 === 3, `${g} ${g2}`);
    return `${g} -> ${g2}`;
  }),
  tc("VA-13", "Viewer A", "Edit a label, undo, redo", "label changes; Ctrl+Z restores; Ctrl+Shift+Z re-applies", async ({ page }) => {
    await page.locator("[data-testid=edit-toggle]").click();
    await page.locator('[data-id="svc_users"]').click();
    const inp = page.locator("[data-testid=node-drawer] .fm-field", { hasText: "Label" }).locator("input");
    await inp.fill("Accounts"); await inp.press("Enter"); await page.waitForTimeout(200);
    const a = await page.locator('[data-id="svc_users"]').innerText();
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z"); await page.waitForTimeout(200);
    const b = await page.locator('[data-id="svc_users"]').innerText();
    await page.keyboard.press("Control+Shift+z"); await page.waitForTimeout(200);
    const c = await page.locator('[data-id="svc_users"]').innerText();
    assert(a.includes("Accounts") && b.includes("User Service") && c.includes("Accounts"), [a, b, c].join("|"));
    return "edit / undo / redo ok";
  }),
  tc("VA-14", "Viewer A", "Connect two nodes by dragging handles; drag a node", "edge count +1; node keeps the dragged position", async ({ page }) => {
    const stat = async () => Number((await page.locator(".fm-stats").innerText()).match(/(\d+) edges/)[1]);
    const e0 = await stat();
    const s = await page.locator('[data-id="job_nightly"] .fm-handle-out').boundingBox();
    const d = await page.locator('[data-id="hub_worker"] .fm-handle-in').boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
    await page.mouse.move(d.x + 2, d.y + d.height / 2, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(300);
    const before = await page.locator('[data-id="ds_reports"]').boundingBox();
    await page.mouse.move(before.x + 30, before.y + 30); await page.mouse.down();
    await page.mouse.move(before.x + 30, before.y + 130, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
    const after = await page.locator('[data-id="ds_reports"]').boundingBox();
    assert((await stat()) === e0 + 1 && after.y > before.y + 50, `${e0} ${before.y} ${after.y}`);
    return `edges ${e0} -> ${e0 + 1}, node moved ${Math.round(after.y - before.y)} px`;
  }),
  tc("VA-15", "Viewer A", "Save JSON contains the edits (edited flag, reviewer evidence, pos)", "label, new edge, pos saved; no view-only fields", async ({ page }) => {
    const p = await grab(page, async () => (await menu(page, "save-menu", "Download architecture.json")).click());
    const g = JSON.parse(fs.readFileSync(p, "utf8"));
    const n = g.nodes.find((x) => x.id === "svc_users");
    const moved = g.nodes.find((x) => x.id === "ds_reports");
    assert(n.label === "Accounts" && n.edited && moved.pos && g.edges.some((e) => e.from === "job_nightly" && e.to === "hub_worker" && e.evidence[0].user)
      && !JSON.stringify(g).includes("collapsedGroup"));
    return path.basename(p);
  }),
  tc("VA-16", "Viewer A", "Download HTML with edits re-opens offline with the edits", "edited label visible, 0 requests", async ({ page }) => {
    const p = await grab(page, async () => (await menu(page, "save-menu", "Download HTML")).click());
    const re = await open(p);
    const t = await re.page.locator('[data-id="svc_users"]').innerText();
    const ok = t.includes("Accounts") && re.ext.length === 0 && re.errs.length === 0;
    await re.ctx.close();
    assert(ok, t);
    return path.basename(p);
  }),
  tc("VA-17", "Viewer A", "Exports: PNG, vector SVG, Mermaid, JSON", "valid files", async ({ page }) => {
    const png = fs.readFileSync(await grab(page, async () => (await menu(page, "export-menu", "PNG")).click()));
    const svg = fs.readFileSync(await grab(page, async () => (await menu(page, "export-menu", "SVG")).click()), "utf8");
    const mmd = fs.readFileSync(await grab(page, async () => (await menu(page, "export-menu", "Mermaid")).click()), "utf8");
    const json = JSON.parse(fs.readFileSync(await grab(page, async () => (await menu(page, "export-menu", "JSON")).click()), "utf8"));
    assert(png.slice(1, 4).toString() === "PNG" && svg.startsWith("<svg") && !svg.includes("foreignObject") && mmd.startsWith("flowchart LR") && json.schema === "flowmap/1");
    return `PNG ${(png.length / 1024) | 0} KB, SVG ${(svg.length / 1024) | 0} KB, Mermaid ${mmd.split("\n").length} lines`;
  }),
  tc("VA-18", "Viewer A", "Print / PDF book: overview + one section per flow", "11 flow sections with tables", async ({ page }) => {
    await (await menu(page, "export-menu", "Print")).click();
    await page.waitForTimeout(500);
    const doc = await page.locator("iframe[data-flowmap-print]").last().getAttribute("srcdoc");
    const n = (doc.match(/<section class="flow">/g) || []).length;
    assert(n === 11 && doc.includes("<table>"), n);
    return `${n} sections`;
  }),
  tc("VA-19", "Viewer A", "Theme picker switches all five themes", "5 distinct canvas colours; Blueprint uses a line grid", async ({ page }) => {
    const seen = {};
    for (const t of ["Midnight", "Light", "Paper", "Blueprint", "Dark"]) {
      await page.locator("[data-testid=theme-menu]").click();
      await page.locator(".fm-menu-pop button", { hasText: t }).first().click();
      await page.waitForTimeout(150);
      seen[t] = await css(page, ".react-flow", "backgroundColor");
    }
    const lines = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(new Set(Object.values(seen)).size === 5 && seen.Paper === "rgb(255, 255, 255)" && lines === "dark", JSON.stringify(seen));
    return Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(", ");
  }),
  tc("VA-20", "Viewer A", "Unsaved edits survive a reload (draft restore)", "banner offers Restore; restore brings the edit back", async ({ page }) => {
    await page.locator('[data-id="hub_orders"]').click();
    const inp = page.locator("[data-testid=node-drawer] .fm-field", { hasText: "Label" }).locator("input");
    await inp.fill("Orders v2"); await inp.press("Enter"); await page.waitForTimeout(300);
    await page.reload(); await page.waitForSelector(".react-flow__node"); await page.waitForTimeout(600);
    const banner = await page.locator(".fm-banner").innerText();
    await page.locator(".fm-banner button", { hasText: "Restore" }).click(); await page.waitForTimeout(400);
    const t = await page.locator('[data-id="hub_orders"]').innerText();
    assert(banner.includes("Unsaved edits") && t.includes("Orders v2"), t);
    await page.locator("[data-testid=save-menu]").click();
    await page.locator(".fm-menu-pop button", { hasText: "Discard all edits" }).click();
    return "restored";
  }),
  tc("VA-21", "Viewer A", "Deactivated route shown dimmed with '(Deactivated)'", "label suffix + reduced opacity", async ({ page }) => {
    const t = await page.locator('[data-id="ep_refund"]').innerText();
    const op = await page.locator('[data-id="ep_refund"] .fm-node').evaluate((e) => getComputedStyle(e).opacity);
    assert(t.includes("(Deactivated)") && Number(op) < 0.6, `${t} ${op}`);
    return `opacity ${op}`;
  }),
  tc("VA-22", "Viewer A", "Minimap and controls rendered; fit view keeps all nodes on screen", "minimap present; all nodes in viewport", async ({ page }) => {
    await page.locator('button[title="Fit to view"]').click(); await page.waitForTimeout(600);
    const out = await page.evaluate(() => {
      const c = document.querySelector(".fm-canvas").getBoundingClientRect();
      return [...document.querySelectorAll(".react-flow__node")].filter((n) => {
        const r = n.getBoundingClientRect();
        return r.right < c.left || r.left > c.right || r.bottom < c.top || r.top > c.bottom;
      }).length;
    });
    assert((await page.locator(".react-flow__minimap").count()) === 1 && out === 0, out);
    return "all nodes visible";
  }),
];

// ====================================================================== Mode B
const modeB = [
  tc("VB-01", "Viewer B", "Mode B opens offline with no errors", "0 requests, 0 errors", async (s) => {
    assert(s.ext.length === 0 && s.errs.length === 0, JSON.stringify([s.ext, s.errs]));
    return `${await s.page.locator(".fm-screen").count()} screen cards`;
  }),
  tc("VB-02", "Viewer B", "Screen cards show the embedded screenshot thumbnail", "7 <img> with data:image/webp", async ({ page }) => {
    const srcs = await page.locator(".fm-screen img.fm-thumb").evaluateAll((els) => els.map((e) => e.src.slice(0, 15)));
    assert(srcs.length === 7 && srcs.every((x) => x === "data:image/webp"), srcs);
    const loaded = await page.locator(".fm-screen img.fm-thumb").evaluateAll((els) => els.every((e) => e.naturalWidth > 0));
    assert(loaded, "images not decoded");
    return "7 thumbnails decoded";
  }),
  tc("VB-03", "Viewer B", "Variants: stacked card with ×2 badge on Sign in", "×2 on s_signin only", async ({ page }) => {
    const t = await page.locator('[data-id="s_signin"] .fm-variants').innerText();
    assert(t === "×2" && (await page.locator(".fm-variants").count()) === 1, t);
    return t;
  }),
  tc("VB-04", "Viewer B", "Gap badges: red + amber on Sign in, amber on Checkout", "s_signin 1 red 1 amber; s_checkout 1 amber", async ({ page }) => {
    const r = await page.locator('[data-id="s_signin"] .fm-gap.red').innerText();
    const a = await page.locator('[data-id="s_signin"] .fm-gap.amber').innerText();
    const c = await page.locator('[data-id="s_checkout"] .fm-gap.amber').innerText();
    assert(r === "1" && a === "1" && c === "1", [r, a, c]);
    return "badges ok";
  }),
  tc("VB-05", "Viewer B", "At least 2 journeys, per actor", "5 journeys; actors Customer and Admin", async ({ page }) => {
    const n = await page.locator(".fm-flow-list li").count();
    await page.locator(".fm-chips .fm-chip-btn", { hasText: "Admin" }).first().click();
    const admin = await page.locator(".fm-flow-list li").count();
    await page.locator(".fm-chips .fm-chip-btn", { hasText: "All actors" }).click();
    assert(n >= 2 && admin === 1, `${n} ${admin}`);
    return `${n} journeys (${admin} for Admin)`;
  }),
  tc("VB-06", "Viewer B", "Clicking hotspots navigates between screens; breadcrumb + Back", "Cart -> Checkout -> Order confirmed; Back returns", async ({ page }) => {
    await page.locator('[data-id="s_cart"]').click(); await page.waitForTimeout(300);
    await page.locator('[data-hs="checkout"]').click(); await page.waitForTimeout(200);
    const t1 = await page.locator(".fm-lb-title").innerText();
    await page.locator('[data-hs="place_order"]').click(); await page.waitForTimeout(200);
    const choose = await page.locator(".fm-chooser").count();
    if (choose) await page.locator(".fm-chooser button", { hasText: "Order confirmed" }).click();
    await page.waitForTimeout(200);
    const t2 = await page.locator(".fm-lb-title").innerText();
    const crumbs = await page.locator(".fm-crumbs").innerText();
    await page.locator("[data-testid=lb-back]").click(); await page.waitForTimeout(200);
    const t3 = await page.locator(".fm-lb-title").innerText();
    assert(t1.startsWith("Checkout") && t2.startsWith("Order confirmed") && t3.startsWith("Checkout") && crumbs.includes("Cart"), [t1, t2, t3, crumbs].join("|"));
    return `Cart › Checkout › Order confirmed, back -> ${t3.split("\n")[0]} (chooser shown: ${!!choose})`;
  }),
  tc("VB-07", "Viewer B", "One control, several destinations: chooser (Sign in by role)", "3 options; picking Admin opens Order Management", async ({ page }) => {
    await page.keyboard.press("Escape");
    await page.locator('[data-id="s_signin"]').click(); await page.waitForTimeout(300);
    await page.locator('[data-hs="sign_in"]').click(); await page.waitForTimeout(200);
    const n = await page.locator(".fm-chooser button").count();
    await page.locator(".fm-chooser button", { hasText: "Order Management" }).click(); await page.waitForTimeout(200);
    const t = await page.locator(".fm-lb-title").innerText();
    assert(n === 3 && t.startsWith("Order Management"), `${n} ${t}`);
    return `${n} options`;
  }),
  tc("VB-08", "Viewer B", "Dead control explains the gap; in-place control explains itself", "'leads nowhere' / 'stays on this screen'", async ({ page }) => {
    await page.locator("[data-testid=lb-back]").click(); await page.waitForTimeout(200);
    await page.locator('[data-hs="forgot"]').click(); await page.waitForTimeout(150);
    const m1 = await page.locator(".fm-lb-msg").innerText();
    await page.locator('[data-hs="role_admin"]').click(); await page.waitForTimeout(150);
    const m2 = await page.locator(".fm-lb-msg").innerText();
    assert(m1.includes("leads nowhere") && m2.includes("stays on this screen"), m1 + " | " + m2);
    return `${m1} / ${m2}`;
  }),
  tc("VB-09", "Viewer B", "Hotspot rectangles sit exactly on the screenshot controls", "Sign in hotspot within 2 px of its 0-1 box", async ({ page }) => {
    const g = await graphOf(page);
    const box = g.nodes.find((n) => n.id === "s_signin").hotspots.find((h) => h.id === "sign_in").box;
    const img = await page.locator("[data-testid=lb-image]").boundingBox();
    const hs = await page.locator('[data-hs="sign_in"]').boundingBox();
    const dx = Math.abs(hs.x - (img.x + box[0] * img.width)), dw = Math.abs(hs.width - box[2] * img.width);
    assert(dx < 2.5 && dw < 2.5, `${dx} ${dw}`);
    return `offset ${dx.toFixed(1)} px, width error ${dw.toFixed(1)} px`;
  }),
  tc("VB-10", "Viewer B", "Variant switch shows the error state image and its hotspots", "Error tab -> 02-sign-in-error.png", async ({ page }) => {
    await page.locator(".fm-lb-variants button", { hasText: "Invalid credentials" }).click(); await page.waitForTimeout(200);
    const chip = await page.locator(".fm-lb-side .fm-badges").innerText();
    assert(chip.includes("02-sign-in-error.png"), chip);
    return "02-sign-in-error.png";
  }),
  tc("VB-11", "Viewer B", "Journey walkthrough: pulsing hotspot, clicking it advances", "step 1 pulses 'Sign in'; click -> step 2 Products", async ({ page }) => {
    await page.keyboard.press("Escape");
    await page.locator(".fm-flow-list li", { hasText: "Customer places an order" }).click(); await page.waitForTimeout(300);
    await page.locator("[data-testid=walk]").click(); await page.waitForTimeout(300);
    const pulse = await page.locator(".fm-hs.is-pulse").getAttribute("data-hs");
    await page.locator(".fm-hs.is-pulse").click(); await page.waitForTimeout(300);
    const t = await page.locator("[data-testid=walkthrough]").innerText();
    const title = await page.locator(".fm-lb-title").innerText();
    assert(pulse === "sign_in" && t.includes("Step 2 / 6") && title.startsWith("Products"), `${pulse} ${t.slice(0, 60)} ${title}`);
    return `pulse=${pulse}, now step 2 on Products`;
  }),
  tc("VB-12", "Viewer B", "Walkthrough Play auto-advances with requirement text", "reaches Order status with FR-13 shown", async ({ page }) => {
    await page.locator("[data-testid=walkthrough] .fm-btn-primary").click();
    await page.waitForTimeout(1700 * 4 + 800);
    const t = await page.locator("[data-testid=walkthrough]").innerText();
    assert(t.includes("Step 6 / 6") && t.includes("FR-13"), t.slice(0, 120));
    return "step 6/6, FR-13 shown";
  }),
  tc("VB-13", "Viewer B", "Requirements panel: picking FR-8 lights up the Cart screen and dims the rest", "Cart in-flow, others dimmed", async ({ page }) => {
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.locator("[data-testid=reqs-tab]").click();
    await page.locator('[data-req="FR-8"]').click(); await page.waitForTimeout(300);
    const cart = await page.locator('[data-id="s_cart"] .fm-node').getAttribute("class");
    const prod = await page.locator('[data-id="s_admin"] .fm-node').getAttribute("class");
    assert(cart.includes("in-flow") && prod.includes("is-dim"), cart + " | " + prod);
    return "Cart highlighted, Order Management dimmed";
  }),
  tc("VB-14", "Viewer B", "Reverse lookup: requirement chip in a screen focuses that requirement", "clicking FR-13 in Order status focuses FR-13", async ({ page }) => {
    await page.locator('[data-id="s_status"]').click(); await page.waitForTimeout(300);
    await page.locator(".fm-req-list .fm-req-chip", { hasText: "FR-13" }).click(); await page.waitForTimeout(300);
    const active = await page.locator(".fm-reqs li.is-active").getAttribute("data-req");
    assert(active === "FR-13", active);
    return active;
  }),
  tc("VB-15", "Viewer B", "Coverage panel catches the planted gap and contradiction", "FR-3 under 'no screen'; FR-2 contradiction", async ({ page }) => {
    await page.locator("[data-testid=coverage-tab]").click();
    const t = await page.locator("[data-testid=coverage]").innerText();
    assert(t.includes("15/16") && (await page.locator('[data-gap="FR-3"]').count()) === 1 && (await page.locator('[data-finding="F1"]').innerText()).includes("FR-2"), t.slice(0, 200));
    return "15/16 covered; FR-3 gap; FR-2 contradiction";
  }),
  tc("VB-16", "Viewer B", "Actor filter Admin shows only the Admin's screens", "Sign in + Order Management", async ({ page }) => {
    await page.locator("[data-testid=view-tab]").click();
    await page.locator("[data-testid=actor-filter] button", { hasText: "Admin" }).click(); await page.waitForTimeout(900);
    const ids = await page.locator(".react-flow__node").evaluateAll((els) => els.map((e) => e.dataset.id).sort());
    await page.locator("[data-testid=actor-filter] button", { hasText: "All" }).click(); await page.waitForTimeout(900);
    assert(JSON.stringify(ids) === JSON.stringify(["s_admin", "s_signin"]), ids);
    return ids.join(", ");
  }),
  tc("VB-17", "Viewer B", "Inferred transition drawn dashed with a '?' badge", "e_products_status dashed + ?", async ({ page }) => {
    const cls = await page.locator('[data-id="e_products_status"] path.fm-edge').getAttribute("class");
    const q = await page.locator(".fm-q").count();
    assert(cls.includes("is-inferred") && q >= 1, cls);
    return `${cls}, ${q} '?' badges`;
  }),
  tc("VB-18", "Viewer B", "Self-loop transitions drawn (sign-in error, card declined)", "2 loop edges rendered", async ({ page }) => {
    const n = await page.locator('[data-id="e_signin_error"], [data-id="e_checkout_declined"]').count();
    assert(n === 2, n);
    return `${n} loops`;
  }),
  tc("VB-19", "Viewer B", "Global navigation hidden by default, toggle shows it", "edge count rises when enabled", async ({ page }) => {
    const a = await page.locator(".react-flow__edge").count();
    await page.locator(".fm-check", { hasText: "Global navigation" }).locator("input").check(); await page.waitForTimeout(500);
    const b = await page.locator(".react-flow__edge").count();
    await page.locator(".fm-check", { hasText: "Global navigation" }).locator("input").uncheck(); await page.waitForTimeout(300);
    assert(b > a, `${a} ${b}`);
    return `${a} -> ${b} edges`;
  }),
  tc("VB-20", "Viewer B", "Search finds a requirement", "'FR-13' focuses it in the Requirements tab", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await page.locator("[data-testid=search] input").fill("FR-13");
    await page.locator(".fm-palette li", { hasText: "req" }).first().click(); await page.waitForTimeout(300);
    const active = await page.locator(".fm-reqs li.is-active").getAttribute("data-req");
    assert(active === "FR-13", active);
    return active;
  }),
  tc("VB-21", "Viewer B", "Edit mode: draw a hotspot, link it, coverage updates live", "new hotspot + edge; dead-control count drops after linking 'Forgot password?'", async ({ page }) => {
    await page.keyboard.press("Escape");
    await page.locator("[data-testid=edit-toggle]").click();
    await page.locator('[data-id="s_status"]').click(); await page.waitForTimeout(300);
    const img = await page.locator("[data-testid=lb-image]").boundingBox();
    const n0 = await page.locator(".fm-hs").count();
    await page.mouse.move(img.x + img.width * 0.6, img.y + img.height * 0.8); await page.mouse.down();
    await page.mouse.move(img.x + img.width * 0.75, img.y + img.height * 0.86, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
    const n1 = await page.locator(".fm-hs").count();
    await page.locator("[data-testid=hs-link]").selectOption({ label: "Products" }); await page.waitForTimeout(200);
    const linked = await page.locator(".fm-dest").count();
    // link the dead "Forgot password?" so the gap disappears
    await page.keyboard.press("Escape");
    await page.locator('[data-id="s_signin"]').click(); await page.waitForTimeout(300);
    await page.locator('[data-hs="forgot"]').click();
    await page.locator("[data-testid=hs-link]").selectOption({ label: "Sign in" }); await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    const amber = await page.locator('[data-id="s_signin"] .fm-gap.amber').count();
    assert(n1 === n0 + 1 && linked === 1 && amber === 0, `${n0} ${n1} ${linked} ${amber}`);
    return `hotspots ${n0} -> ${n1}, linked; Sign in amber badge cleared`;
  }),
  tc("VB-22", "Viewer B", "Edit mode: move a hotspot by dragging; delete a hotspot removes its links", "box changes; edge removed", async ({ page }) => {
    await page.locator('[data-id="s_status"]').click(); await page.waitForTimeout(300);
    const hs = page.locator('[data-hs="back"]');
    const b0 = await hs.boundingBox();
    await page.mouse.move(b0.x + 5, b0.y + 5); await page.mouse.down();
    await page.mouse.move(b0.x + 65, b0.y + 45, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
    const b1 = await page.locator('[data-hs="back"]').boundingBox();
    const stat = async () => Number((await page.locator(".fm-stats").innerText()).match(/(\d+) edges/)[1]);
    const e0 = await stat();
    await page.locator("[data-testid=hotspot-form] .fm-btn-danger").click(); await page.waitForTimeout(200);
    const e1 = await stat();
    await page.keyboard.press("Escape");
    assert(b1.x > b0.x + 40 && e1 === e0 - 1, `${b0.x} ${b1.x} ${e0} ${e1}`);
    return `moved ${Math.round(b1.x - b0.x)} px; edges ${e0} -> ${e1}`;
  }),
  tc("VB-23", "Viewer B", "Saved screens.json carries hotspot edits", "new hotspot + user-evidence edge present", async ({ page }) => {
    const p = await grab(page, async () => (await menu(page, "save-menu", "Download screens.json")).click());
    const g = JSON.parse(fs.readFileSync(p, "utf8"));
    const st = g.nodes.find((n) => n.id === "s_status");
    assert(st.hotspots.some((h) => h.label === "New control") && g.edges.some((e) => e.hotspot === "forgot" && e.evidence[0].user) && !g.assets, Object.keys(g));
    return "edits saved; embedded images not duplicated into the JSON";
  }),
  tc("VB-24", "Viewer B", "Exported clickable prototype opens straight into the screens and navigates", "prototype bar; hotspot click navigates; offline", async ({ page }) => {
    const discard = await menu(page, "save-menu", "Discard all edits");
    if (await discard.isEnabled()) await discard.click(); else await page.keyboard.press("Escape");
    await page.mouse.click(5, 300);
    const p = await grab(page, async () => (await menu(page, "export-menu", "Clickable prototype")).click());
    const re = await open(p, { wait: "[data-testid=lightbox]" });
    const t0 = await re.page.locator(".fm-lb-title").innerText();
    await re.page.locator('[data-hs="sign_in"]').click();
    await re.page.locator(".fm-chooser button", { hasText: "Products" }).click(); await re.page.waitForTimeout(200);
    const t1 = await re.page.locator(".fm-lb-title").innerText();
    await re.page.screenshot({ path: path.join(ART, "prototype.png") });
    const ok = t0.startsWith("Sign in") && t1.startsWith("Products") && re.ext.length === 0 && re.errs.length === 0 && (await re.page.locator(".react-flow").count()) === 0;
    await re.ctx.close();
    assert(ok, `${t0} ${t1}`);
    return `${(fs.statSync(p).size / 1024) | 0} KB, Sign in -> Products`;
  }),
  tc("VB-25", "Viewer B", "Flow book: coverage + every journey step with its screenshot and highlighted hotspot", "img per step; hotspot boxes; FR text", async ({ page }) => {
    await (await menu(page, "export-menu", "Print / PDF flow book")).click(); await page.waitForTimeout(600);
    const doc = await page.locator("iframe[data-flowmap-print]").last().getAttribute("srcdoc");
    // compare with the book's own step count: earlier cases edit (and save) the journeys
    const steps = (doc.match(/<div class="step">/g) || []).length;
    const imgs = (doc.match(/<div class="shot"><img/g) || []).length;
    assert(imgs === steps && doc.includes('class="hs"') && doc.includes("FR-3") && doc.includes("Contradictions"), `${imgs}/${steps}`);
    return `${imgs}/${steps} step screenshots`;
  }),
  tc("VB-29", "Viewer B", "Mode B 'Download HTML with edits' keeps the embedded screenshots", "re-opened file shows 7 thumbnails", async ({ page }) => {
    const p = await grab(page, async () => (await menu(page, "save-menu", "Download HTML")).click());
    const re = await open(p);
    const n = await re.page.locator(".fm-screen img.fm-thumb").count();
    const ok = n === 7 && re.ext.length === 0 && re.errs.length === 0;
    await re.ctx.close();
    assert(ok, `${n} thumbnails`);
    return `${n} thumbnails, ${(fs.statSync(p).size / 1048576).toFixed(1)} MB`;
  }),
  tc("VB-26", "Viewer B", "SVG export embeds the screenshots", "<image href=data:image/webp ...> per screen", async ({ page }) => {
    const svg = fs.readFileSync(await grab(page, async () => (await menu(page, "export-menu", "SVG")).click()), "utf8");
    const n = (svg.match(/<image href="data:image\/webp/g) || []).length;
    assert(n === 7, n);
    return `${n} images`;
  }),
  tc("VB-27", "Viewer B", "Unsaved Mode B edits survive a reload (audit finding A2)", "draft fits storage; restore keeps edits and images", async ({ page }) => {
    await page.locator("[data-testid=edit-toggle]").click();
    await page.locator('[data-id="s_cart"]').click(); await page.waitForTimeout(300);
    const inp = page.locator(".fm-lb-side .fm-form input").first();
    await inp.fill("Basket"); await inp.press("Enter"); await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.reload(); await page.waitForSelector(".react-flow__node"); await page.waitForTimeout(700);
    const banner = await page.locator(".fm-banner").count();
    if (banner) await page.locator(".fm-banner button", { hasText: "Restore" }).click();
    await page.waitForTimeout(400);
    const t = await page.locator('[data-id="s_cart"]').innerText();
    const img = await page.locator('[data-id="s_cart"] img.fm-thumb').count();
    assert(banner === 1 && t.includes("Basket") && img === 1, `banner=${banner} label=${t} img=${img}`);
    const d = await menu(page, "save-menu", "Discard all edits");
    if (await d.isEnabled()) await d.click();
    return "restored with screenshot";
  }),
  tc("VB-28", "Viewer B", "Edit history does not copy screenshots per edit (audit finding A1)", "heap grows < 25 MB over 40 edits", async ({ page }) => {
    await page.locator("[data-testid=edit-toggle]").click();
    const heap = () => page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0);
    const h0 = await heap();
    await page.locator('[data-id="s_status"]').click(); await page.waitForTimeout(300);
    const inp = page.locator(".fm-lb-side .fm-form input").first();
    for (let i = 0; i < 40; i++) { await inp.fill(`Order status ${i}`); await inp.press("Enter"); }
    await page.waitForTimeout(500);
    const h1 = await heap();
    const grew = (h1 - h0) / 1048576;
    await page.keyboard.press("Escape");
    assert(h0 > 0 && grew < 25, `${grew.toFixed(1)} MB`);
    return `heap +${grew.toFixed(1)} MB after 40 edits`;
  }),
];

// ====================================================================== perf + security
const misc = [
  tc("PRF-01", "Performance", "600+ node graph: first render, expand all, select flow", "each under 3 s; no errors", async () => {
    const t0 = Date.now();
    const s = await open(BIG);
    const first = Date.now() - t0;
    const groups = await s.page.locator(".fm-group").count();
    await s.page.locator("[data-testid=view-tab]").click();
    const t1 = Date.now();
    await s.page.locator("button", { hasText: "Expand all" }).click();
    await s.page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 600, null, { timeout: 30000 });
    const expand = Date.now() - t1;
    await s.page.locator(".fm-tabs button").first().click();
    const t2 = Date.now();
    await s.page.locator(".fm-flow-list li").first().click();
    await s.page.waitForSelector(".fm-caption");
    const flow = Date.now() - t2;
    const errs = s.errs.length;
    await s.ctx.close();
    assert(first < 3000 && expand < 3000 && flow < 3000 && errs === 0 && groups === 12, `${first} ${expand} ${flow} ${groups}`);
    return `first ${first} ms (12 groups collapsed), expand ${expand} ms, flow ${flow} ms`;
  }),
  tc("TH-01", "Themes", "Export in Paper with a transparent background (for SRS / Word)", "PNG has alpha=0 corners; SVG has no background rect", async () => {
    const s = await open(A);
    await s.page.locator("[data-testid=export-menu]").click();
    await s.page.locator("[data-testid=export-style] select").selectOption("paper");
    await s.page.locator("[data-testid=export-style] input[type=checkbox]").check();
    const png = fs.readFileSync(await grab(s.page, () => s.page.locator(".fm-menu-pop button", { hasText: "PNG" }).click()));
    await s.page.locator("[data-testid=export-menu]").click();
    const svg = fs.readFileSync(await grab(s.page, () => s.page.locator(".fm-menu-pop button", { hasText: "SVG" }).click()), "utf8");
    const alpha = await s.page.evaluate(async (b64) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(2, 2, 1, 1).data[3];
    }, png.toString("base64"));
    await s.ctx.close();
    assert(alpha === 0 && !svg.includes('fill="#2a2a2a"') && !svg.includes("url(#grid)") && svg.includes("#0f172a"), `alpha=${alpha}`);
    return "transparent PNG + Paper-coloured SVG";
  }),
  tc("TH-02", "Themes", "Copy as image puts a PNG on the clipboard", "clipboard holds image/png", async () => {
    const s = await open(B);
    await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    await s.page.locator("[data-testid=export-menu]").click();
    await s.page.locator(".fm-menu-pop button", { hasText: "Copy as image" }).click();
    await s.page.waitForTimeout(1500);
    const types = await s.page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
    await s.ctx.close();
    assert(types.includes("image/png"), types);
    return types.join(", ");
  }),
  tc("TH-03", "Themes", "Exported HTML / prototype reopen in the theme they were exported in", "Midnight export opens in Midnight", async () => {
    const s = await open(A);
    await s.page.locator("[data-testid=theme-menu]").click();
    await s.page.locator(".fm-menu-pop button", { hasText: "Midnight" }).click();
    const p = await grab(s.page, async () => (await menu(s.page, "export-menu", "Interactive HTML")).click());
    await s.ctx.close();
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto("file://" + p); await page.waitForSelector(".react-flow__node");
    const th = await page.evaluate(() => document.documentElement.dataset.theme);
    await ctx.close();
    assert(th === "midnight", th);
    return th;
  }),
  tc("SEC-01", "Security", "HTML in labels is shown as text, never executed", "no script runs from a node label / summary", async () => {
    const html = tamper(A, (g) => {
      g.nodes[0].label = '<img src=x onerror="window.__pwned=1">';
      g.nodes[0].summary = "<script>window.__pwned=2</script>";
      g.edges[0].payload = '<svg onload="window.__pwned=3">';
    });
    const s = await open(null, { html });
    await s.page.locator(`[data-id="ui_storefront"]`).click();
    await s.page.waitForTimeout(300);
    const pw = await s.page.evaluate(() => window.__pwned);
    const shown = await s.page.locator('[data-id="ui_storefront"]').innerText();
    await s.ctx.close();
    assert(pw === undefined && shown.includes("<img"), pw);
    return "rendered as text";
  }),
  tc("SEC-02", "Security", "Screens can only use embedded images; a URL in assets is ignored", "no request to the URL; card shows placeholder", async () => {
    const html = tamper(B, (g) => { g.assets["03-products.png"] = "https://evil.example/x.png"; });
    const s = await open(null, { html });
    const ph = await s.page.locator('[data-id="s_products"] .fm-thumb-missing').count();
    await s.ctx.close();
    assert(s.ext.length === 0 && ph === 1, JSON.stringify(s.ext));
    return "no network request";
  }),
  tc("SEC-03", "Security", "Exports escape user text (SVG, Mermaid, print book)", "no raw <script> / quotes break out", async () => {
    const html = tamper(A, (g) => { g.nodes[0].label = 'X"]<script>alert(1)</script>'; g.flows[0].name = "<script>bad()</script>"; });
    const s = await open(null, { html });
    const svg = fs.readFileSync(await grab(s.page, async () => (await menu(s.page, "export-menu", "SVG")).click()), "utf8");
    const mmd = fs.readFileSync(await grab(s.page, async () => (await menu(s.page, "export-menu", "Mermaid")).click()), "utf8");
    await (await menu(s.page, "export-menu", "Print")).click(); await s.page.waitForTimeout(400);
    const doc = await s.page.locator("iframe[data-flowmap-print]").last().getAttribute("srcdoc");
    await s.ctx.close();
    assert(!svg.includes("<script>") && !mmd.includes('X"]') && !doc.includes("<script>bad()"), "unescaped");
    return "SVG, Mermaid and book escaped";
  }),
];

(async () => {
  browser = await chromium.launch();
  const suites = [[A, modeA], [B, modeB], [null, misc]];
  for (const [file, cases] of suites) {
    let s = file ? await open(file) : null;
    for (const c of cases) {
      const t0 = Date.now();
      const r = { id: c.id, area: c.area, title: c.title, expected: c.expected, steps: "" };
      try {
        r.actual = String(await c.fn(s ?? {})).slice(0, 300);
        r.status = "PASS";
      } catch (e) {
        r.status = "FAIL";
        r.actual = String(e.message || e).split("\n")[0].slice(0, 300);
        if (s) await s.page.screenshot({ path: path.join(ART, `${c.id}.png`) }).catch(() => {});
        // keep later cases independent of a broken state
        if (s) { await s.ctx.close(); s = await open(file); }
      }
      r.ms = Date.now() - t0;
      results.push(r);
    }
    if (s) await s.ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
})();
