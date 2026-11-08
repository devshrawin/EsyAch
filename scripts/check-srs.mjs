import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPage } from "../plugins/esyach/kit/render.mjs";
import { coverage, imageSize, loadModel } from "../plugins/esyach/kit/srs-model.mjs";

// SRS pages (references/srs.md): the bundled example renders, its planted gaps are computed, and a broken model is refused
// with errors that name the JSON path.
const example = new URL("../examples/shop-spec/.esyach/", import.meta.url).pathname;
const source = readFileSync(join(example, "srs.src.html"), "utf8");

const ok = renderPage(source, { base: example });
assert.deepEqual(ok.errors, []);
assert.doesNotMatch(ok.html.slice(ok.html.indexOf("<body>")), /<ve-(coverage|modules|trace|gaps|screen|journey|proto|req)\b/, "every SRS tag is expanded");
assert.match(ok.report.srs, /19 requirements · 15\/16 UI on a screen · 7 screens · 3 journeys · 4 findings/);
assert.match(ok.html, /data-srs-assets/, "screenshots are embedded once, as CSS variables");
assert.equal((ok.html.match(/data:image\/webp;base64/g) ?? []).length, 8, "each image appears exactly once");

const { model } = loadModel("srs.json", example);
const c = model.coverage;
assert.deepEqual(c.withoutScreen, ["FR-3"], "planted gap: no Reset Password screen");
assert.deepEqual(c.deadControls.map((d) => `${d.screen}/${d.hotspot}`), ["sign-in/forgot"], "Forgot password? leads nowhere");
assert.deepEqual(c.nonUi.sort(), ["FR-12", "NFR-1", "NFR-2"]);
assert.deepEqual(c.unreachable, []);
assert.equal(c.inferredGroups.length, 1, "one header link inferred on five screens is one question");
assert.ok(model.findings.some((f) => f.type === "contradiction" && f.req === "FR-2"), "planted contradiction");

// A broken model: each mistake is an error naming where it is, and nothing renders.
const dir = mkdtempSync(join(tmpdir(), "esyach-srs-"));
try {
  cpSync(example, dir, { recursive: true });
  const bad = JSON.parse(readFileSync(join(dir, "srs.json"), "utf8"));
  bad.screens[0].reqs.push({ id: "FR-99", reason: "x" });
  bad.screens[0].hotspots[0].box = [0.9, 0.1, 0.2, 0.1];
  delete bad.screens[1].reqs[0].reason;
  bad.links.push({ from: "cart", hotspot: "nope", to: "checkout" });
  bad.findings.push({ id: "fx", type: "contradiction", text: "t" });
  writeFileSync(join(dir, "srs.json"), JSON.stringify(bad));
  const r = renderPage(source, { base: dir });
  const has = (s) => assert.ok(r.errors.some((e) => e.includes(s)), `expected an error containing: ${s}\n${r.errors.join("\n")}`);
  has('screen sign-in: requirement "FR-99" is not in the SRS extraction');
  has("screen sign-in hotspot tab-customer: box must be [x, y, w, h] in 0-1");
  has("screen products: requirement FR-6 needs a \"reason\"");
  has('hotspot "nope" does not exist on cart');
  has('finding fx: a contradiction needs "srs_says" and "screen_shows"');

  // No screenshots: the page still renders; coverage says it is not measured instead of 0%.
  const bare = { ...bad, screens: [], links: [], journeys: [], findings: [] };
  writeFileSync(join(dir, "srs.json"), JSON.stringify(bare));
  const doc = source.replace(/<section id="journeys">[\s\S]*?<\/section>/, "").replace(/<section id="prototype">[\s\S]*?<\/section>/, "").replace(/<ve-gaps><\/ve-gaps>[\s\S]*?<\/ve-ask>\s*<\/ve-ask>/, "<ve-gaps></ve-gaps>");
  const none = renderPage(doc.replace(/<ve-ask[\s\S]*?<\/ve-ask>/g, ""), { base: dir });
  assert.deepEqual(none.errors, []);
  assert.match(none.html, /no screenshots supplied, so coverage is not measured/);
  assert.doesNotMatch(none.html, /No screen · FR-/);

  // A page with SRS tags and no model is refused.
  const orphan = renderPage(source.replace(' data-srs="srs.json"', ""), { base: dir });
  assert.ok(orphan.errors.some((e) => e.includes('add data-srs="srs.json" to <html>')));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Image sizes come from headers, without decoding.
const png = readFileSync(new URL("../examples/shop-spec/screens/01-sign-in.png", import.meta.url));
assert.deepEqual(imageSize(png), [1280, 800]);
const webp = readFileSync(join(example, "web/01-sign-in.webp"));
assert.deepEqual(imageSize(webp), [1200, 750]);
assert.equal(typeof coverage, "function");

console.log("SRS check passed");
