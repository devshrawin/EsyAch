// Generates the Mode B fixture screenshots (mock UI, fake data only) and _truth.json with the
// exact boxes of every element marked data-hs, normalised to 0-1. Dev tool, not part of the plugin.
// Usage: node examples/shop-spec/_make/make_screens.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "..", "screens");
const W = 1280, H = 800;

const css = `
* { box-sizing: border-box; margin: 0; }
body { font: 15px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1d2433; background: #f5f6f8; width: ${W}px; height: ${H}px; overflow: hidden; }
header { height: 64px; background: #fff; border-bottom: 1px solid #e3e6ea; display: flex; align-items: center; padding: 0 32px; gap: 28px; }
.logo { font-weight: 800; font-size: 20px; color: #4b3fd8; margin-right: 24px; }
nav a, .link { color: #4b3fd8; text-decoration: none; font-weight: 600; }
nav { display: flex; gap: 22px; flex: 1; }
.right { margin-left: auto; display: flex; gap: 18px; align-items: center; }
main { padding: 32px 48px; }
h1 { font-size: 26px; margin-bottom: 18px; }
.btn { display: inline-block; background: #4b3fd8; color: #fff; border: none; border-radius: 8px; padding: 11px 22px; font-weight: 700; font-size: 15px; }
.btn.secondary { background: #fff; color: #4b3fd8; border: 1.5px solid #4b3fd8; }
.btn.small { padding: 7px 14px; font-size: 13px; }
.field { display: block; margin-bottom: 16px; }
.field span { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #4a5263; }
.input { width: 100%; height: 42px; border: 1.5px solid #cfd4dc; border-radius: 8px; padding: 0 12px; display: flex; align-items: center; background: #fff; color: #1d2433; }
.input.empty { color: #9aa1ad; }
.hint { font-size: 12.5px; color: #6b7280; margin-top: 5px; }
.card { background: #fff; border: 1px solid #e3e6ea; border-radius: 12px; padding: 24px; }
.error { background: #fdecec; color: #a32020; border: 1px solid #f3b9b9; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-weight: 600; }
.success { color: #137a43; }
.seg { display: inline-flex; border: 1.5px solid #cfd4dc; border-radius: 8px; overflow: hidden; margin-bottom: 18px; }
.seg div { padding: 8px 20px; font-weight: 600; color: #4a5263; }
.seg .on { background: #4b3fd8; color: #fff; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.prod .img { height: 120px; border-radius: 8px; background: linear-gradient(135deg, #dcd9ff, #f1e9ff); margin-bottom: 12px; }
.prod .row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
table { width: 100%; border-collapse: collapse; background: #fff; }
td, th { text-align: left; padding: 12px 14px; border-bottom: 1px solid #edf0f3; }
th { font-size: 12.5px; color: #6b7280; text-transform: uppercase; letter-spacing: .4px; }
.pill { display: inline-block; padding: 3px 10px; border-radius: 12px; background: #eef0ff; color: #4b3fd8; font-weight: 600; font-size: 13px; }
.select { display: inline-flex; align-items: center; gap: 8px; border: 1.5px solid #cfd4dc; border-radius: 8px; padding: 6px 10px; background: #fff; }
.timeline { display: flex; gap: 0; margin: 28px 0; }
.timeline div { flex: 1; text-align: center; padding-top: 34px; position: relative; color: #6b7280; font-weight: 600; }
.timeline div::before { content: ""; position: absolute; top: 8px; left: calc(50% - 10px); width: 20px; height: 20px; border-radius: 50%; background: #cfd4dc; }
.timeline .done { color: #1d2433; }
.timeline .done::before { background: #4b3fd8; }
`;

const header = (active, cart = 2) => `
<header>
  <div class="logo">ShopDemo</div>
  <nav>
    <a data-hs="Products" data-kind="link" href="#" style="${active === "products" ? "text-decoration: underline" : ""}">Products</a>
    <a data-hs="Cart" data-kind="link" href="#">Cart (${cart})</a>
    <a data-hs="Orders" data-kind="link" href="#">Orders</a>
  </nav>
  <div class="right"><span style="color:#6b7280">jane@example.com</span><a class="link" data-hs="Sign out" data-kind="link" href="#">Sign out</a></div>
</header>`;

const login = (error) => `
<div style="display:flex;align-items:center;justify-content:center;height:${H}px">
  <div class="card" style="width:420px">
    <div class="logo" style="margin-bottom:16px">ShopDemo</div>
    <h1>Sign in</h1>
    ${error ? `<div class="error">Invalid email or password</div>` : ""}
    <div class="seg" data-hs="Role" data-kind="tab"><div class="on" data-hs="Role: Customer" data-kind="tab">Customer</div><div data-hs="Role: Admin" data-kind="tab">Admin</div></div>
    <label class="field"><span>Email</span><div class="input" data-hs="Email" data-kind="field">jane@example.com</div></label>
    <label class="field"><span>Password</span><div class="input empty" data-hs="Password" data-kind="field">${error ? "Password" : "••••••"}</div>
      <div class="hint">Minimum 6 characters</div></label>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <span class="btn" data-hs="Sign in" data-kind="button">Sign in</span>
      <a class="link" data-hs="Forgot password?" data-kind="link" href="#">Forgot password?</a>
    </div>
  </div>
</div>`;

const products = () => `${header("products")}
<main>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
    <h1 style="margin:0">Products</h1>
    <div class="input empty" style="width:320px" data-hs="Search products" data-kind="field">Search products…</div>
  </div>
  <div class="grid">
    ${[["Canvas Tote", "$18.00"], ["Desk Lamp", "$42.00"], ["Notebook Set", "$12.50"], ["Ceramic Mug", "$9.90"], ["Wireless Mouse", "$24.00"], ["Plant Pot", "$15.00"]]
      .map(([n, p], i) => `<div class="card prod"><div class="img"></div><b>${n}</b><div class="row"><span>${p}</span>
        <span class="btn small" ${i === 0 ? 'data-hs="Add to cart" data-kind="button"' : ""}>Add to cart</span></div></div>`).join("")}
  </div>
</main>`;

const cart = () => `${header("cart")}
<main style="display:flex;gap:28px">
  <div style="flex:1">
    <h1>Your cart</h1>
    <table>
      <tr><th>Item</th><th>Qty</th><th>Price</th><th></th></tr>
      <tr><td>Canvas Tote</td><td><span class="select" data-hs="Quantity" data-kind="field">− 1 +</span></td><td>$18.00</td><td><a class="link" data-hs="Remove" data-kind="link" href="#">Remove</a></td></tr>
      <tr><td>Desk Lamp</td><td><span class="select">− 1 +</span></td><td>$42.00</td><td><a class="link" href="#">Remove</a></td></tr>
    </table>
    <p style="margin-top:16px"><a class="link" data-hs="Continue shopping" data-kind="link" href="#">← Continue shopping</a></p>
  </div>
  <div class="card" style="width:340px;align-self:flex-start">
    <h2 style="font-size:18px;margin-bottom:12px">Summary</h2>
    <div style="display:flex;justify-content:space-between"><span>Subtotal</span><b>$60.00</b></div>
    <p class="success" style="margin:10px 0 18px;font-weight:600">You get free shipping (orders over $50)</p>
    <span class="btn" style="width:100%;text-align:center" data-hs="Checkout" data-kind="button">Checkout</span>
  </div>
</main>`;

const checkout = () => `${header("cart")}
<main style="display:flex;gap:28px">
  <div class="card" style="flex:1">
    <h1>Checkout</h1>
    <h2 style="font-size:16px;margin:4px 0 12px">Shipping address</h2>
    <label class="field"><span>Full name</span><div class="input" data-hs="Full name" data-kind="field">Jane Doe</div></label>
    <label class="field"><span>Address</span><div class="input" data-hs="Address" data-kind="field">1 Example Street, Springfield</div></label>
    <h2 style="font-size:16px;margin:18px 0 12px">Payment</h2>
    <div style="display:flex;gap:12px">
      <label class="field" style="flex:2"><span>Card number</span><div class="input" data-hs="Card number" data-kind="field">4242 4242 4242 4242</div></label>
      <label class="field" style="flex:1"><span>Expiry</span><div class="input" data-hs="Expiry" data-kind="field">12 / 29</div></label>
      <label class="field" style="flex:1"><span>CVC</span><div class="input" data-hs="CVC" data-kind="field">123</div></label>
    </div>
  </div>
  <div class="card" style="width:340px;align-self:flex-start">
    <div style="display:flex;justify-content:space-between;margin-bottom:18px"><span>Total</span><b>$60.00</b></div>
    <span class="btn" style="width:100%;text-align:center" data-hs="Place order" data-kind="button">Place order</span>
    <p style="margin-top:14px"><a class="link" data-hs="Back to cart" data-kind="link" href="#">← Back to cart</a></p>
  </div>
</main>`;

const confirmed = () => `${header("", 0)}
<main style="display:flex;justify-content:center;padding-top:90px">
  <div class="card" style="width:560px;text-align:center;padding:40px">
    <div style="font-size:44px">✓</div>
    <h1 class="success">Order #1042 confirmed</h1>
    <p style="margin-bottom:24px;color:#4a5263">We sent a confirmation to jane@example.com. Total charged: $60.00</p>
    <span class="btn" data-hs="View order status" data-kind="button">View order status</span>
    <p style="margin-top:18px"><a class="link" data-hs="Continue shopping" data-kind="link" href="#">Continue shopping</a></p>
  </div>
</main>`;

const status = () => `${header("orders", 0)}
<main>
  <h1>Order #1042</h1>
  <div class="card">
    <div style="display:flex;justify-content:space-between"><span>Placed on 12 Oct 2026 · 2 items · $60.00</span><span class="pill">Packed</span></div>
    <div class="timeline"><div class="done">Paid</div><div class="done">Packed</div><div>Shipped</div><div>Delivered</div></div>
  </div>
  <p style="margin-top:18px"><a class="link" data-hs="Back to products" data-kind="link" href="#">← Back to products</a></p>
</main>`;

const admin = () => `
<header>
  <div class="logo">ShopDemo <span style="font-weight:600;color:#6b7280;font-size:14px">Admin</span></div>
  <nav><a data-hs="Order Management" data-kind="link" href="#">Order Management</a></nav>
  <div class="right"><span style="color:#6b7280">admin@example.com</span><a class="link" data-hs="Sign out" data-kind="link" href="#">Sign out</a></div>
</header>
<main>
  <h1>Order Management</h1>
  <table>
    <tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th></th></tr>
    ${[["#1042", "Jane Doe", "$60.00", "Packed"], ["#1041", "John Roe", "$24.00", "Shipped"], ["#1040", "Ann Poe", "$9.90", "Paid"]]
      .map(([o, c, t, s], i) => `<tr><td>${o}</td><td>${c}</td><td>${t}</td>
        <td><span class="select" ${i === 0 ? 'data-hs="Change status" data-kind="menu"' : ""}>${s} ▾</span></td>
        <td><span class="btn small secondary" ${i === 0 ? 'data-hs="Refund" data-kind="button"' : ""}>Refund</span></td></tr>`).join("")}
  </table>
</main>`;

const SCREENS = [
  ["01-sign-in.png", login(false)],
  ["02-sign-in-error.png", login(true)],
  ["03-products.png", products()],
  ["04-cart.png", cart()],
  ["05-checkout.png", checkout()],
  ["06-order-confirmed.png", confirmed()],
  ["07-order-status.png", status()],
  ["08-admin-orders.png", admin()],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H } });
  const truth = {};
  for (const [file, body] of SCREENS) {
    await p.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`);
    truth[file] = await p.evaluate(([w, h]) => [...document.querySelectorAll("[data-hs]")].map((el) => {
      const r = el.getBoundingClientRect();
      const f = (v) => Math.round(v * 1000) / 1000;
      return { label: el.dataset.hs, kind: el.dataset.kind, box: [f(r.x / w), f(r.y / h), f(r.width / w), f(r.height / h)] };
    }), [W, H]);
    await p.screenshot({ path: path.join(OUT, file) });
  }
  fs.writeFileSync(path.join(OUT, "..", "_make", "_truth.json"), JSON.stringify(truth, null, 1));
  await b.close();
  console.log(`wrote ${SCREENS.length} screenshots to ${OUT}`);
})();
