#!/usr/bin/env python3
"""The Mode B analysis of the shop-spec fixture, written as a script so it can be regenerated.

In normal use Claude writes spec.json / screens.json directly after viewing every screenshot. For this
fixture the hotspot boxes come from _truth.json (exact element boxes measured by make_screens.cjs).
Everything else is the analysis: which screen satisfies which requirement and why, where each
control leads, which transitions are inferred, the journeys and the findings.
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC_DIR = HERE.parent
ROOT = SPEC_DIR.parent.parent
OUT = SPEC_DIR / ".flowmap"
truth = json.loads((HERE / "_truth.json").read_text())

subprocess.run([sys.executable, str(ROOT / "scripts" / "spec_extract.py"), str(SPEC_DIR / "srs.md"), "-o", str(OUT / "spec_text.json")], check=True)
text = json.loads((OUT / "spec_text.json").read_text())
REQ = {r["id"]: r for r in text["requirements"]}


def hs(file, label, hid, **kw):
    t = next(h for h in truth[file] if h["label"] == label)
    return {"id": hid, "label": label.replace("Role: ", ""), "kind": t["kind"], "box": t["box"], **kw}


def header(file):
    return [hs(file, "Products", "nav_products"), hs(file, "Cart", "nav_cart"), hs(file, "Orders", "nav_orders"), hs(file, "Sign out", "sign_out")]


def r(rid, conf, reason):
    return {"id": rid, "confidence": conf, "reason": reason}


SIGNIN = "01-sign-in.png"
signin_hs = lambda f: [
    hs(f, "Role: Customer", "role_customer", in_place=True, note="selects the Customer role"),
    hs(f, "Role: Admin", "role_admin", in_place=True, note="selects the Admin role"),
    hs(f, "Email", "email"), hs(f, "Password", "password"),
    hs(f, "Sign in", "sign_in"), hs(f, "Forgot password?", "forgot"),
]

nodes = [
    {"id": "s_signin", "label": "Sign in", "subtitle": SIGNIN, "kind": "screen", "image": SIGNIN, "image_size": [1280, 800],
     "entry": True, "actors": ["customer", "admin"], "state": "filled", "group": "auth",
     "purpose": "Sign in with e-mail, password and role.",
     "requirements": [r("FR-1", "high", "E-mail and password fields with a Sign in button"),
                      r("FR-2", "med", "Shows a password rule under the field, but the rule shown differs from the SRS (see finding)"),
                      r("FR-4", "high", "Error variant shows 'Invalid email or password', e-mail kept, password cleared"),
                      r("FR-5", "high", "Customer / Admin role tabs")],
     "hotspots": signin_hs(SIGNIN),
     "variants": [{"id": "error", "label": "Invalid credentials", "image": "02-sign-in-error.png", "state": "error",
                   "hotspots": signin_hs("02-sign-in-error.png")}],
     "evidence": [{"screen": SIGNIN}, {"screen": "02-sign-in-error.png"}]},
    {"id": "s_products", "label": "Products", "subtitle": "03-products.png", "kind": "screen", "image": "03-products.png", "image_size": [1280, 800],
     "actors": ["customer"], "state": "filled", "group": "shop", "purpose": "Browse and search products, add to cart.",
     "requirements": [r("FR-6", "high", "Cards show name, price and 'Add to cart'"), r("FR-7", "high", "'Search products…' field above the grid"),
                      r("FR-16", "high", "'Sign out' link in the header")],
     "hotspots": header("03-products.png") + [hs("03-products.png", "Search products", "search"),
                                             hs("03-products.png", "Add to cart", "add_to_cart", in_place=True, note="adds the item; cart count updates")],
     "evidence": [{"screen": "03-products.png"}]},
    {"id": "s_cart", "label": "Cart", "subtitle": "04-cart.png", "kind": "screen", "image": "04-cart.png", "image_size": [1280, 800],
     "actors": ["customer"], "state": "filled", "group": "shop", "purpose": "Review items, change quantities, go to checkout.",
     "requirements": [r("FR-8", "high", "Items with − / + quantity, Remove and Subtotal"), r("BR-1", "high", "'You get free shipping (orders over $50)'"),
                      r("FR-9", "high", "'Checkout' button"), r("FR-16", "high", "'Sign out' in the header")],
     "hotspots": header("04-cart.png") + [hs("04-cart.png", "Quantity", "qty"), hs("04-cart.png", "Remove", "remove", in_place=True, note="removes the line"),
                                         hs("04-cart.png", "Continue shopping", "continue"), hs("04-cart.png", "Checkout", "checkout")],
     "evidence": [{"screen": "04-cart.png"}]},
    {"id": "s_checkout", "label": "Checkout", "subtitle": "05-checkout.png", "kind": "screen", "image": "05-checkout.png", "image_size": [1280, 800],
     "actors": ["customer"], "state": "filled", "group": "shop", "purpose": "Enter shipping address and card, place the order.",
     "requirements": [r("FR-10", "high", "Shipping address and Payment sections"), r("FR-11", "med", "'Place order' button; the declined-card state is not shown"),
                      r("FR-16", "high", "'Sign out' in the header")],
     "hotspots": header("05-checkout.png") + [hs("05-checkout.png", x, x.lower().replace(" ", "_")) for x in ("Full name", "Address", "Card number", "Expiry", "CVC")]
     + [hs("05-checkout.png", "Place order", "place_order"), hs("05-checkout.png", "Back to cart", "back")],
     "evidence": [{"screen": "05-checkout.png"}]},
    {"id": "s_confirmed", "label": "Order confirmed", "subtitle": "06-order-confirmed.png", "kind": "screen", "image": "06-order-confirmed.png",
     "image_size": [1280, 800], "actors": ["customer"], "state": "success", "group": "orders", "purpose": "Confirms the order and its number.",
     "requirements": [r("FR-11", "high", "'Order #1042 confirmed' with the order number"), r("FR-16", "high", "'Sign out' in the header")],
     "hotspots": header("06-order-confirmed.png") + [hs("06-order-confirmed.png", "View order status", "view_status"),
                                                    hs("06-order-confirmed.png", "Continue shopping", "continue")],
     "evidence": [{"screen": "06-order-confirmed.png"}]},
    {"id": "s_status", "label": "Order status", "subtitle": "07-order-status.png", "kind": "screen", "image": "07-order-status.png", "image_size": [1280, 800],
     "actors": ["customer"], "state": "filled", "group": "orders", "purpose": "Timeline of one order.",
     "requirements": [r("FR-13", "high", "Timeline Paid → Packed → Shipped → Delivered"), r("FR-16", "high", "'Sign out' in the header")],
     "hotspots": header("07-order-status.png") + [hs("07-order-status.png", "Back to products", "back")],
     "evidence": [{"screen": "07-order-status.png"}]},
    {"id": "s_admin", "label": "Order Management", "subtitle": "08-admin-orders.png", "kind": "screen", "image": "08-admin-orders.png", "image_size": [1280, 800],
     "actors": ["admin"], "state": "filled", "group": "admin", "purpose": "All orders, change status, refund.",
     "requirements": [r("FR-14", "high", "Orders table with a status menu per row"), r("FR-15", "high", "'Refund' button per order"),
                      r("FR-5", "high", "Admins land here after signing in"), r("FR-16", "high", "'Sign out' in the header")],
     "hotspots": [hs("08-admin-orders.png", "Order Management", "nav_orders", in_place=True, note="current page"),
                  hs("08-admin-orders.png", "Sign out", "sign_out"),
                  hs("08-admin-orders.png", "Change status", "status_menu", in_place=True, note="changes the order status in the table"),
                  hs("08-admin-orders.png", "Refund", "refund", in_place=True, note="the refund result is not shown in the screenshots")],
     "evidence": [{"screen": "08-admin-orders.png"}]},
]
for n in nodes:  # the current page's own nav link stays in place
    for h in n["hotspots"]:
        if (n["id"], h["id"]) in {("s_products", "nav_products"), ("s_cart", "nav_cart")}:
            h["in_place"] = True
            h["note"] = "current page"

edges = []


def edge(eid, a, b, hotspot, label, reqs, ev, condition=None, inferred=False, reason=None, conf="high", glob=False, to_variant=None):
    e = {"id": eid, "from": a, "to": b, "kind": "main", "mechanism": "navigate", "hotspot": hotspot, "label": label,
         "reqs": reqs, "confidence": conf, "evidence": ev}
    if condition:
        e["condition"] = condition
    if inferred:
        e.update(inferred=True, reason=reason)
    if glob:
        e["global"] = True
    if to_variant:
        e["to_variant"] = to_variant
    edges.append(e)


S = lambda f, note=None: {"screen": f, **({"note": note} if note else {})}
edge("e_signin_products", "s_signin", "s_products", "sign_in", "Click Sign in", ["FR-1", "FR-5"],
     [{"req": "FR-5", "note": "customers land on the product list"}, S(SIGNIN)], condition="role = Customer")
edge("e_signin_admin", "s_signin", "s_admin", "sign_in", "Click Sign in", ["FR-5"],
     [{"req": "FR-5", "note": "admins land on Order Management"}, S(SIGNIN)], condition="role = Admin")
edge("e_signin_error", "s_signin", "s_signin", "sign_in", "Click Sign in", ["FR-4"],
     [{"req": "FR-4"}, S("02-sign-in-error.png", "error banner")], condition="invalid credentials", to_variant="error")
edge("e_products_cart", "s_products", "s_cart", "nav_cart", "Click Cart", ["FR-8"], [S("03-products.png", "header 'Cart (2)'")])
edge("e_products_status", "s_products", "s_status", "nav_orders", "Click Orders", ["FR-13"], [{"req": "FR-13"}],
     inferred=True, conf="low", reason="No orders-list screen exists; 'Orders' most likely opens the order status (FR-13). Not shown in the screenshots.")
edge("e_cart_checkout", "s_cart", "s_checkout", "checkout", "Click Checkout", ["FR-9"], [{"req": "FR-9"}, S("04-cart.png")])
edge("e_cart_products", "s_cart", "s_products", "continue", "Continue shopping", ["FR-6"], [S("04-cart.png")])
edge("e_checkout_confirmed", "s_checkout", "s_confirmed", "place_order", "Click Place order", ["FR-11"],
     [{"req": "FR-11"}, S("06-order-confirmed.png")], condition="card accepted")
edge("e_checkout_declined", "s_checkout", "s_checkout", "place_order", "Click Place order", ["FR-11"], [{"req": "FR-11", "note": "decline shows an error on checkout"}],
     condition="card declined", inferred=True, conf="low", reason="FR-11 describes the decline error on the checkout screen, but no screenshot shows that state.")
edge("e_checkout_cart", "s_checkout", "s_cart", "back", "Back to cart", ["FR-8"], [S("05-checkout.png")])
edge("e_confirmed_status", "s_confirmed", "s_status", "view_status", "View order status", ["FR-13"], [S("06-order-confirmed.png")])
edge("e_confirmed_products", "s_confirmed", "s_products", "continue", "Continue shopping", ["FR-6"], [S("06-order-confirmed.png")])
edge("e_status_products", "s_status", "s_products", "back", "Back to products", ["FR-6"], [S("07-order-status.png")])
edge("e_admin_signout", "s_admin", "s_signin", "sign_out", "Sign out", ["FR-16"], [{"req": "FR-16"}, S("08-admin-orders.png")], glob=True)
# Header links on every customer screen: global navigation (hidden on the canvas unless a journey uses them).
targets = {"nav_products": "s_products", "nav_cart": "s_cart", "nav_orders": "s_status", "sign_out": "s_signin"}
for n in nodes:
    if n["id"] in ("s_signin", "s_admin"):
        continue
    for h in n["hotspots"]:
        t = targets.get(h["id"])
        if not t or h.get("in_place") or any(e["from"] == n["id"] and e["hotspot"] == h["id"] for e in edges):
            continue
        inferred = h["id"] == "nav_orders"
        edge(f"e_{n['id'][2:]}_{h['id']}", n["id"], t, h["id"], f"Click {h['label']}", ["FR-16"] if h["id"] == "sign_out" else [],
             [S(n["image"], f"header '{h['label']}'")] if not inferred else [{"req": "FR-13"}], glob=True,
             inferred=inferred, conf="low" if inferred else "high",
             reason="No orders-list screen; assumed to open the order status (FR-13)." if inferred else None)

st = lambda node, desc, edge=None, req=None, **kw: {"node": node, **({"edge": edge} if edge else {}), "description": desc,
                                                    **({"evidence": {"req": req}} if req else {}), **kw}
flows = [
    {"id": "j_order", "name": "Customer places an order", "kind": "happy", "actor": "Customer", "trigger": "s_signin",
     "description": "Sign in, open the cart, check out and follow the order.",
     "steps": [st("s_signin", "Customer signs in with role Customer.", req="FR-1", hotspot="sign_in"),
               st("s_products", "Lands on the product list.", "e_signin_products", "FR-5", hotspot="nav_cart"),
               st("s_cart", "Opens the cart from the header and reviews items; free shipping applies.", "e_products_cart", "FR-8", hotspot="checkout"),
               st("s_checkout", "Enters address and card.", "e_cart_checkout", "FR-10", hotspot="place_order"),
               st("s_confirmed", "Card accepted: order #1042 confirmed.", "e_checkout_confirmed", "FR-11", hotspot="view_status"),
               st("s_status", "Follows the order timeline.", "e_confirmed_status", "FR-13")]},
    {"id": "j_signin_fail", "name": "Sign-in fails, then succeeds", "kind": "failure", "actor": "Customer", "trigger": "s_signin",
     "description": "Wrong password shows the error state; the second attempt works.",
     "steps": [st("s_signin", "Customer enters a wrong password.", req="FR-1", hotspot="sign_in"),
               st("s_signin", "'Invalid email or password'; e-mail kept, password cleared.", "e_signin_error", "FR-4", variant="error", hotspot="sign_in"),
               st("s_products", "Second attempt succeeds.", "e_signin_products", "FR-5")]},
    {"id": "j_declined", "name": "Card declined at checkout", "kind": "failure", "actor": "Customer", "trigger": "s_signin",
     "description": "The bank declines the card; checkout shows an error and keeps the data. Inferred: no screenshot of that state.",
     "steps": [st("s_signin", "Customer signs in.", req="FR-1", hotspot="sign_in"),
               st("s_products", "Product list.", "e_signin_products", "FR-5", hotspot="nav_cart"),
               st("s_cart", "Cart.", "e_products_cart", "FR-8", hotspot="checkout"),
               st("s_checkout", "Enters a card that will be declined.", "e_cart_checkout", "FR-10", hotspot="place_order"),
               st("s_checkout", "Error shown on checkout, data kept (inferred from FR-11).", "e_checkout_declined", "FR-11")]},
    {"id": "j_status", "name": "Customer checks an order", "kind": "alternate", "actor": "Customer", "trigger": "s_signin",
     "description": "Uses the header 'Orders' link (destination inferred).",
     "steps": [st("s_signin", "Customer signs in.", req="FR-1", hotspot="sign_in"),
               st("s_products", "Product list.", "e_signin_products", "FR-5", hotspot="nav_orders"),
               st("s_status", "Opens 'Orders' and sees the timeline (inferred destination).", "e_products_status", "FR-13", hotspot="back"),
               st("s_products", "Back to products.", "e_status_products", "FR-6")]},
    {"id": "j_admin", "name": "Admin manages orders", "kind": "happy", "actor": "Admin", "trigger": "s_signin",
     "description": "Admin signs in, changes a status, issues a refund, signs out.",
     "steps": [st("s_signin", "Admin selects the Admin role and signs in.", req="FR-5", hotspot="role_admin"),
               st("s_admin", "Lands on Order Management.", "e_signin_admin", "FR-14", hotspot="status_menu"),
               st("s_admin", "Changes order #1042's status.", None, "FR-14", hotspot="status_menu", action=True),
               st("s_admin", "Issues a refund for order #1042 (result not shown in the screenshots).", None, "FR-15", hotspot="refund", action=True),
               st("s_signin", "Signs out.", "e_admin_signout", "FR-16")]},
]
for f in flows:  # a step's hotspot is the control used to leave that screen
    for i, s in enumerate(f["steps"]):
        if i + 1 < len(f["steps"]) and f["steps"][i + 1].get("edge"):
            s["hotspot"] = next(e for e in edges if e["id"] == f["steps"][i + 1]["edge"])["hotspot"]

findings = [
    {"id": "F1", "type": "contradiction", "severity": "high", "req": "FR-2", "screen": "s_signin", "hotspot": "password",
     "text": "Password rule: the SRS says at least 8 characters, the sign-in screen says 'Minimum 6 characters'.",
     "srs_says": "Passwords shall be at least 8 characters long. The sign-in form shall state this rule.",
     "screen_shows": "Hint under the Password field: 'Minimum 6 characters'.",
     "evidence": [{"req": "FR-2"}, {"screen": SIGNIN, "note": "hint under Password"}], "confidence": "high"},
    {"id": "F2", "type": "missing_state", "severity": "med", "req": "FR-11", "screen": "s_checkout",
     "text": "No screenshot of the declined-card error on Checkout (FR-11). The transition is inferred.",
     "evidence": [{"req": "FR-11"}], "confidence": "high"},
]

reqs = [{k: v for k, v in x.items() if k in ("id", "text", "priority", "section", "kind", "ui")} for x in text["requirements"]]
graph = {
    "schema": "flowmap/1", "mode": "spec",
    "project": {"name": "ShopDemo (from SRS + screenshots)", "source": "examples/shop-spec", "srs": "srs.md", "screens_dir": "../screens",
                "summary": "8 screenshots of a web store mapped to an SRS with 19 requirements.", "generated_at": "2026-10-26T00:00:00Z"},
    "actors": [{"id": "customer", "label": "Customer"}, {"id": "admin", "label": "Admin"}],
    "groups": [{"id": "auth", "label": "Sign in"}, {"id": "shop", "label": "Shopping"}, {"id": "orders", "label": "Orders"}, {"id": "admin", "label": "Admin"}],
    "requirements": reqs, "nodes": nodes, "edges": edges, "flows": flows, "findings": findings,
}
spec = {
    "schema": "flowmap-spec/1", "source": "srs.md", "title": "ShopDemo Web Store: Software Requirements Specification", "version": "1.2",
    "actors": [{"id": "customer", "label": "Customer", "description": "A registered shopper who buys products."},
               {"id": "admin", "label": "Admin", "description": "Store staff who manage orders and issue refunds."}],
    "modules": [{"id": "auth", "label": "Authentication", "requirements": ["FR-1", "FR-2", "FR-3", "FR-4", "FR-5"]},
                {"id": "catalog", "label": "Catalog", "requirements": ["FR-6", "FR-7"]},
                {"id": "cart", "label": "Cart and checkout", "requirements": ["FR-8", "BR-1", "FR-9", "FR-10", "FR-11", "FR-12"]},
                {"id": "orders", "label": "Orders", "requirements": ["FR-13", "FR-14", "FR-15", "FR-16"]}],
    "user_stories": [], "requirements": text["requirements"],
    "business_rules": ["BR-1"], "validations": [{"req": "FR-2", "rule": "password length >= 8"}, {"req": "FR-4", "rule": "invalid credentials message"}],
    "notifications": [{"req": "FR-12", "channel": "email", "event": "order confirmed"}],
    "integrations": [{"req": "FR-11", "system": "card payment provider"}],
    "nonfunctional": ["NFR-1", "NFR-2"],
}
(OUT / "screens.json").write_text(json.dumps(graph, indent=2, ensure_ascii=False) + "\n")
(OUT / "spec.json").write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n")
print(f"screens.json: {len(nodes)} screens, {len(edges)} edges, {len(flows)} journeys, {len(findings)} findings")
