"""
Tests for "Fortsätt med Prakto-konto" (src/services/auth/prakto.py) and the
self-signup switch (LEARNHOUSE_SELF_SIGNUP_DISABLED, src/routers/users.py).

Tokens are minted here the way Prakto mints them
(src/features/akademi/sso/akademi-sso.ts in the Prakto repo): HS256, key =
HMAC-SHA256(shared secret, "prakto-akademi/access-token/v1").
"""

import hashlib
import hmac
import time
import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import jwt
import pytest
from fastapi import HTTPException, Request
from sqlmodel import select

from src.services.auth import prakto
from src.services.auth.prakto import (
    resolve_prakto_org_id,
    sign_in_with_prakto,
    verify_prakto_access_token,
)

SECRET = "prakto-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz"


def mint(secret: str = SECRET, drop: tuple = (), **overrides) -> str:
    now = int(time.time())
    claims = {
        "typ": "prakto_akademi_access",
        "sub": "prakto-user-1",
        "email": "Elev.Exempel@Skolan.se",
        "email_verified": True,
        "name": "Elev Exempel",
        "given_name": "Elev",
        "family_name": "Exempel",
        "prakto_role": "student",
        "iss": "prakto",
        "aud": "learnhouse-api",
        "iat": now,
        "exp": now + 120,
        "jti": str(uuid.uuid4()),
    }
    claims.update(overrides)
    for key in drop:
        claims.pop(key, None)
    key = hmac.new(secret.encode(), b"prakto-akademi/access-token/v1", hashlib.sha256).digest()
    return jwt.encode(claims, key, algorithm="HS256")


class FakeRedis:
    def __init__(self):
        self.store = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    def close(self):
        pass


@pytest.fixture
def prakto_env(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_PRAKTO_SSO_CLIENT_SECRET", SECRET)
    fake = FakeRedis()
    monkeypatch.setattr(prakto.redis.Redis, "from_url", lambda url: fake)
    monkeypatch.setattr(
        prakto,
        "get_learnhouse_config",
        lambda: SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string="redis://test")),
    )
    return fake


@pytest.fixture
def mock_request():
    return Request(
        {"type": "http", "method": "POST", "headers": [], "client": ("127.0.0.1", 0)}
    )


# ── Token verification ──────────────────────────────────────────────────────


def test_valid_token_is_accepted_once(prakto_env):
    token = mint()
    claims = verify_prakto_access_token(token)
    assert claims["email"] == "Elev.Exempel@Skolan.se"
    assert claims["sub"] == "prakto-user-1"

    with pytest.raises(HTTPException) as replay:
        verify_prakto_access_token(token)
    assert replay.value.status_code == 401


@pytest.mark.parametrize(
    "token_kwargs",
    [
        {"secret": "another-secret-that-is-long-enough-0123456789"},
        {"typ": "prakto_akademi_code"},
        {"aud": "someone-else"},
        {"iss": "not-prakto"},
        {"exp": int(time.time()) - 600},
        {"email_verified": False},
        {"email_verified": "true"},
        {"email": "not-an-email"},
        {"drop": ("jti",)},
        {"drop": ("email",)},
    ],
)
def test_invalid_tokens_are_rejected(prakto_env, token_kwargs):
    with pytest.raises(HTTPException) as excinfo:
        verify_prakto_access_token(mint(**token_kwargs))
    assert excinfo.value.status_code == 401


def test_unconfigured_server_fails_closed(prakto_env, monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_PRAKTO_SSO_CLIENT_SECRET", "too-short")
    with pytest.raises(HTTPException) as excinfo:
        verify_prakto_access_token(mint())
    assert excinfo.value.status_code == 401


def test_missing_redis_fails_closed(prakto_env, monkeypatch):
    monkeypatch.setattr(
        prakto,
        "get_learnhouse_config",
        lambda: SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string="")),
    )
    with pytest.raises(HTTPException) as excinfo:
        verify_prakto_access_token(mint())
    assert excinfo.value.status_code == 503


# ── Organization ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolves_configured_org(db, org, monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_PRAKTO_SSO_ORG_SLUG", org.slug)
    assert await resolve_prakto_org_id(db) == org.id


@pytest.mark.asyncio
async def test_unknown_org_slug_is_an_error(db, org, monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_PRAKTO_SSO_ORG_SLUG", "does-not-exist")
    with pytest.raises(HTTPException) as excinfo:
        await resolve_prakto_org_id(db)
    assert excinfo.value.status_code == 500


# ── Sign in / sign up ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_new_person_gets_an_account_in_the_org(db, org, mock_request):
    claims = {"email": "Ny.Elev@Skolan.se", "given_name": "Ny", "family_name": "Elev Åberg"}
    with patch.object(prakto, "create_user", new=AsyncMock(return_value="created")) as create:
        result = await sign_in_with_prakto(mock_request, claims, org.id, None, db)

    assert result == "created"
    args, kwargs = create.call_args
    user_object, org_id = args[3], args[4]
    assert org_id == org.id
    assert kwargs == {"is_oauth": True, "signup_provider": "prakto"}
    assert user_object.email == "ny.elev@skolan.se"
    assert user_object.password == ""
    assert (user_object.first_name, user_object.last_name) == ("Ny", "Elev Åberg")
    assert user_object.username.startswith("NyElevÅberg")


async def _add_user(db, **fields):
    from src.db.users import User

    user = User(
        id=fields.pop("id", 99),
        username=fields.pop("username", "elev"),
        first_name="Elev",
        last_name="Exempel",
        user_uuid=fields.pop("user_uuid", "user_elev"),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        **fields,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_existing_account_joins_the_org_as_learner(db, org, mock_request):
    from src.db.user_organizations import UserOrganization

    user = await _add_user(db, email="Elev.Exempel@Skolan.se", password="", email_verified=True)

    with patch.object(prakto, "update_login_info", new=AsyncMock(return_value=None)), patch(
        "src.security.features_utils.usage.check_limits_with_usage",
        new=AsyncMock(return_value=True),
    ), patch(
        "src.security.features_utils.usage.increase_feature_usage",
        new=AsyncMock(return_value=None),
    ) as increase:
        result = await sign_in_with_prakto(
            mock_request, {"email": "elev.exempel@skolan.se"}, org.id, None, db
        )

    assert result.id == user.id
    increase.assert_awaited_once()
    membership = (
        await db.execute(
            select(UserOrganization).where(
                (UserOrganization.user_id == user.id) & (UserOrganization.org_id == org.id)
            )
        )
    ).scalars().first()
    assert membership is not None and membership.role_id == 4


@pytest.mark.asyncio
async def test_untrusted_password_is_dropped(db, org, mock_request):
    """An unverified account someone else may have registered with this address
    loses its password once the real owner signs in through Prakto."""
    user = await _add_user(db, email="elev.exempel@skolan.se", password="hashed", email_verified=False)

    with patch.object(prakto, "update_login_info", new=AsyncMock(return_value=None)), patch(
        "src.security.features_utils.usage.check_limits_with_usage",
        new=AsyncMock(return_value=True),
    ), patch(
        "src.security.features_utils.usage.increase_feature_usage",
        new=AsyncMock(return_value=None),
    ), patch("src.security.auth.revoke_user_sessions_before") as revoke:
        await sign_in_with_prakto(mock_request, {"email": user.email}, org.id, None, db)

    await db.refresh(user)
    assert user.password == ""
    assert user.email_verified is True
    assert user.signup_method == "prakto"
    revoke.assert_called_once_with(user.id)


# ── Self-signup switch ──────────────────────────────────────────────────────


def test_self_signup_switch(monkeypatch):
    from src.routers.users import _enforce_self_signup_enabled

    monkeypatch.delenv("LEARNHOUSE_SELF_SIGNUP_DISABLED", raising=False)
    _enforce_self_signup_enabled()  # open by default

    monkeypatch.setenv("LEARNHOUSE_SELF_SIGNUP_DISABLED", "true")
    with pytest.raises(HTTPException) as excinfo:
        _enforce_self_signup_enabled()
    assert excinfo.value.status_code == 403
