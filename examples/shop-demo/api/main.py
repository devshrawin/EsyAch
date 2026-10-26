"""HTTP API for the shop."""
from fastapi import FastAPI, HTTPException, Request

from api import payments
from api.config import ENABLE_LEGACY_REFUNDS
from api.services import catalog, orders, users

app = FastAPI(title="Shop API")


@app.post("/api/users", status_code=201)
def signup(body: dict):
    try:
        return users.register_user(body["email"], body["password"])
    except users.EmailTaken:
        raise HTTPException(status_code=409, detail="email already registered")


@app.post("/api/login")
def login(body: dict):
    user = users.authenticate(body["email"], body["password"])
    if user is None:
        raise HTTPException(status_code=401, detail="invalid credentials")
    return {"token": f"user-{user['id']}"}


@app.get("/api/products")
def products():
    return catalog.list_products()


@app.post("/api/orders", status_code=201)
def checkout(body: dict):
    try:
        return orders.create_order(body["user_id"], body["items"])
    except payments.PaymentDeclined as exc:
        raise HTTPException(status_code=402, detail=str(exc))


@app.get("/api/orders/{order_id}")
def order_status(order_id: int):
    order = orders.get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404)
    return order


@app.post("/api/webhooks/stripe")
async def stripe_webhook(request: Request):
    event = payments.parse_webhook(await request.body(), request.headers.get("stripe-signature"))
    orders.reconcile_payment(event)
    return {"received": True}


if ENABLE_LEGACY_REFUNDS:
    @app.post("/api/orders/{order_id}/refund")
    def refund(order_id: int):
        orders.legacy_refund(order_id)
        return {"status": "refunded"}


# @app.delete("/api/orders/{order_id}")
# def cancel_order(order_id: int):
#     ...
