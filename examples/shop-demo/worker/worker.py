"""Background worker: consumes paid orders, emails the customer, marks fulfilled."""
import smtplib
from email.message import EmailMessage

from api.config import SMTP_HOST
from api.db import Order, get_session
from api.queue import ORDERS_QUEUE, dequeue


def send_confirmation(email, order_id):
    msg = EmailMessage()
    msg["To"] = email
    msg["From"] = "orders@shop.example"
    msg["Subject"] = f"Order #{order_id} confirmed"
    msg.set_content("Thanks for your order!")
    with smtplib.SMTP(SMTP_HOST) as smtp:
        smtp.send_message(msg)


def handle(job):
    send_confirmation(job["email"], job["order_id"])
    session = get_session()
    order = session.get(Order, job["order_id"])
    order.status = "fulfilled"
    session.commit()


def main():
    while True:
        job = dequeue(ORDERS_QUEUE)
        if job:
            handle(job)


if __name__ == "__main__":
    main()
