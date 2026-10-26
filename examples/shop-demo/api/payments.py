"""Stripe payment gateway wrapper."""
import stripe

from api.config import STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

stripe.api_key = STRIPE_SECRET_KEY


class PaymentDeclined(Exception):
    pass


def charge(amount_cents, currency, customer_email):
    try:
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            receipt_email=customer_email,
            confirm=True,
        )
    except stripe.error.CardError as exc:
        raise PaymentDeclined(str(exc)) from exc
    return intent["id"]


def parse_webhook(body, signature):
    return stripe.Webhook.construct_event(body, signature, STRIPE_WEBHOOK_SECRET)


def refund(payment_intent):
    return stripe.Refund.create(payment_intent=payment_intent)
