"""User registration and login."""
import hashlib

from api.db import User, get_session


class EmailTaken(Exception):
    pass


def _hash(password):
    return hashlib.sha256(password.encode()).hexdigest()


def register_user(email, password):
    session = get_session()
    if session.query(User).filter_by(email=email).first():
        raise EmailTaken(email)
    user = User(email=email, password_hash=_hash(password))
    session.add(user)
    session.commit()
    return {"id": user.id, "email": user.email}


def authenticate(email, password):
    session = get_session()
    user = session.query(User).filter_by(email=email).first()
    if not user or user.password_hash != _hash(password):
        return None
    return {"id": user.id, "email": user.email}
