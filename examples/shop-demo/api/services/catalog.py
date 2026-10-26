"""Product catalog with a read-through cache."""
from api.cache import cached_get, cached_set
from api.db import Product, get_session


def list_products():
    hit = cached_get("products:all")
    if hit is not None:
        return hit
    session = get_session()
    rows = session.query(Product).filter(Product.stock > 0).all()
    products = [{"id": p.id, "name": p.name, "price": float(p.price)} for p in rows]
    cached_set("products:all", products)
    return products
