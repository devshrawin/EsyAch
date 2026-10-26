"""Order lifecycle: create, pay, reconcile."""
from api import payments
from api.db import Order, Product, User, get_session
from api.queue import ORDERS_QUEUE, enqueue


def create_order(user_id, items):
    session = get_session()
    user = session.get(User, user_id)
    products = {p.id: p for p in session.query(Product).filter(Product.id.in_([i["product_id"] for i in items]))}
    total = sum(products[i["product_id"]].price * i["qty"] for i in items)

    order = Order(user_id=user_id, total=total, status="pending")
    session.add(order)
    session.commit()

    try:
        intent_id = payments.charge(int(total * 100), "usd", user.email)
    except payments.PaymentDeclined:
        order.status = "payment_failed"
        session.commit()
        raise

    order.payment_intent = intent_id
    order.status = "paid"
    session.commit()

    enqueue(ORDERS_QUEUE, {"order_id": order.id, "email": user.email})
    return {"id": order.id, "status": order.status, "total": float(total)}


def get_order(order_id):
    session = get_session()
    order = session.get(Order, order_id)
    if order is None:
        return None
    return {"id": order.id, "status": order.status, "total": float(order.total)}


def reconcile_payment(event):
    if event["type"] != "payment_intent.succeeded":
        return False
    session = get_session()
    intent_id = event["data"]["object"]["id"]
    order = session.query(Order).filter_by(payment_intent=intent_id).first()
    if order and order.status != "fulfilled":
        order.status = "paid"
        session.commit()
    return True


def legacy_refund(order_id):
    session = get_session()
    order = session.get(Order, order_id)
    payments.refund(order.payment_intent)
    order.status = "refunded"
    session.commit()
