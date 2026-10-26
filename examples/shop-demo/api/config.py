"""Runtime settings, read once from the environment."""
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://shop:shop@localhost:5432/shop")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
STRIPE_SECRET_KEY = os.environ["STRIPE_SECRET_KEY"]
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
SMTP_HOST = os.getenv("SMTP_HOST", "localhost")

# Feature flags
ENABLE_LEGACY_REFUNDS = os.getenv("ENABLE_LEGACY_REFUNDS", "false") == "true"
