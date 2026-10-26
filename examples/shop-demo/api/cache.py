"""Redis-backed read-through cache."""
import json

import redis

from api.config import REDIS_URL

_client = redis.Redis.from_url(REDIS_URL)


def cached_get(key):
    raw = _client.get(key)
    return json.loads(raw) if raw else None


def cached_set(key, value, ttl=300):
    _client.setex(key, ttl, json.dumps(value))
