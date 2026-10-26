"""Tiny Redis list-based job queue shared by the API and the worker."""
import json

import redis

from api.config import REDIS_URL

ORDERS_QUEUE = "queue:orders"
_client = redis.Redis.from_url(REDIS_URL)


def enqueue(queue_name, payload):
    _client.lpush(queue_name, json.dumps(payload))


def dequeue(queue_name, timeout=5):
    item = _client.brpop(queue_name, timeout=timeout)
    return json.loads(item[1]) if item else None
