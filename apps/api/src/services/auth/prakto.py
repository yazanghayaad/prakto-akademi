"""Prakto as identity provider: "Fortsätt med Prakto-konto" (Prakto Akademi).

Prakto, the placement platform, runs an OAuth 2.0 authorization-code + PKCE
flow. The web app redeems the code at Prakto (app/api/auth/prakto/token) and
posts the resulting access token to ``POST /auth/oauth`` with provider
``"prakto"``. This module verifies that token and signs the person in or up.

The token is an HS256 JWT keyed by HMAC-SHA256(shared secret, ACCESS_KEY_LABEL),
valid for two minutes and accepted once (its ``jti`` is burned in Redis). Keep
the label, issuer, audience and claim names in sync with Prakto's
``src/features/akademi/sso/akademi-sso.ts``.

Account linking mirrors ``signWithGoogle`` (services/auth/utils.py): Prakto only
issues tokens for addresses it has verified, so an existing account with the
same email is the same person and gets the same pre-hijack guard.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import random
import time
from datetime import datetime, timezone

import jwt
import redis
from fastapi import HTTPException, Request, status
from jwt.exceptions import PyJWTError
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.db.organizations import Organization
from src.db.user_audit_events import UserAuditEventType
from src.db.users import User, UserCreate, UserRead
from src.services.audit.audit import record_audit_event
from src.services.auth.utils import _drop_unverified_sso_links
from src.services.security.account_lockout import update_login_info
from src.services.security.rate_limiting import get_client_ip
from src.services.users.users import create_user

logger = logging.getLogger(__name__)

ISSUER = "prakto"
AUDIENCE = "learnhouse-api"
ACCESS_TOKEN_TYP = "prakto_akademi_access"
ACCESS_KEY_LABEL = b"prakto-akademi/access-token/v1"
SECRET_ENV = "LEARNHOUSE_PRAKTO_SSO_CLIENT_SECRET"
ORG_SLUG_ENV = "LEARNHOUSE_PRAKTO_SSO_ORG_SLUG"
MIN_SECRET_LENGTH = 32
JTI_KEY_PREFIX = "prakto_sso_jti:"
SIGNUP_PROVIDER = "prakto"


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _access_token_key() -> bytes:
    secret = os.environ.get(SECRET_ENV) or ""
    if len(secret) < MIN_SECRET_LENGTH:
        # Fail closed: without the shared secret nothing can be verified.
        logger.error("Prakto sign-in refused: %s is not set (min %d chars)", SECRET_ENV, MIN_SECRET_LENGTH)
        raise _unauthorized("Inloggning med Prakto-konto är inte konfigurerad på den här servern")
    return hmac.new(secret.encode("utf-8"), ACCESS_KEY_LABEL, hashlib.sha256).digest()


def _burn_jti(jti: str, exp: int) -> None:
    """Accept each access token once. Fails closed when Redis is unreachable."""
    redis_url = get_learnhouse_config().redis_config.redis_connection_string
    if not redis_url:
        logger.error("Prakto sign-in refused: Redis is not configured for the replay check")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Kunde inte verifiera inloggningen just nu, försök igen.",
        )
    client = None
    try:
        client = redis.Redis.from_url(redis_url)
        ttl = max(int(exp - time.time()) + 60, 60)
        first_use = client.set(f"{JTI_KEY_PREFIX}{jti}", "1", nx=True, ex=ttl)
    except Exception as e:
        logger.error("Redis unavailable for the Prakto token replay check: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Kunde inte verifiera inloggningen just nu, försök igen.",
        )
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass
    if not first_use:
        raise _unauthorized("Inloggningen har redan använts. Försök igen.")


def verify_prakto_access_token(token: str) -> dict:
    """Return the verified claims of a Prakto access token, or raise 401."""
    key = _access_token_key()
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["HS256"],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["exp", "iat", "sub", "jti"]},
            leeway=30,
        )
    except PyJWTError:
        raise _unauthorized("Ogiltig eller utgången inloggning från Prakto")

    if claims.get("typ") != ACCESS_TOKEN_TYP:
        raise _unauthorized("Ogiltig eller utgången inloggning från Prakto")
    email = claims.get("email")
    # Identity is the email, so only an address Prakto has verified may sign in.
    if not isinstance(email, str) or "@" not in email or claims.get("email_verified") is not True:
        raise _unauthorized("Prakto returnerade ingen verifierad e-postadress")

    _burn_jti(str(claims["jti"]), int(claims["exp"]))
    return claims


async def resolve_prakto_org_id(db_session: AsyncSession) -> int:
    """The org Prakto accounts join: LEARNHOUSE_PRAKTO_SSO_ORG_SLUG (default "default")."""
    slug = (os.environ.get(ORG_SLUG_ENV) or "default").strip()
    org = (
        await db_session.execute(select(Organization).where(Organization.slug == slug))
    ).scalars().first()
    if not org or org.id is None:
        logger.error("Prakto sign-in: no organization with slug %r (%s)", slug, ORG_SLUG_ENV)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Inloggning med Prakto-konto saknar organisation",
        )
    return org.id


def _username_from(claims: dict, email: str) -> str:
    base = "".join(
        ch
        for ch in f"{claims.get('given_name') or ''}{claims.get('family_name') or ''}"
        if ch.isalnum()
    )
    if not base:
        base = "".join(ch for ch in email.split("@")[0] if ch.isalnum()) or "user"
    # Wide suffix, same reasoning as signWithGoogle: a collision on the generated
    # username would otherwise block a brand-new account from signing up.
    return f"{base}{random.randint(100000, 999999)}"


async def _secure_existing_account(user: User, db_session: AsyncSession) -> None:
    """Pre-hijack guard, as in signWithGoogle: Prakto just proved the inbox."""
    needs_update = False
    untrusted_account = not user.email_verified
    untrusted_password = bool(user.password) and (
        not user.email_verified
        or (user.signup_method == "admin_api" and user.password_changed_at is None)
    )
    if untrusted_password:
        user.password = ""
        user.password_changed_at = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
        needs_update = True
    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc).isoformat()
        needs_update = True
    if not user.signup_method:
        user.signup_method = SIGNUP_PROVIDER
        needs_update = True

    if needs_update:
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

    if untrusted_password and user.id is not None:
        from src.security.auth import revoke_user_sessions_before

        revoke_user_sessions_before(user.id)

    if (untrusted_account or untrusted_password) and user.id is not None:
        await _drop_unverified_sso_links(user.id, db_session)


async def _ensure_org_membership(
    request: Request, user: User, org_id: int, db_session: AsyncSession
) -> None:
    """Add an existing account to the Prakto org as a learner (role 4) if needed."""
    from src.db.user_organizations import UserOrganization
    from src.security.features_utils.usage import (
        check_limits_with_usage,
        increase_feature_usage,
    )

    if user.id is None:
        return
    existing = (
        await db_session.execute(
            select(UserOrganization).where(
                (UserOrganization.user_id == user.id) & (UserOrganization.org_id == org_id)
            )
        )
    ).scalars().first()
    if existing:
        return

    await check_limits_with_usage("members", org_id, db_session)
    membership = UserOrganization(
        user_id=user.id,
        org_id=org_id,
        role_id=4,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(membership)
    await db_session.commit()
    await db_session.refresh(membership)
    await increase_feature_usage("members", org_id, db_session)

    # /users/session is cached per user; bust it so the new org shows up now.
    from src.routers.users import _invalidate_session_cache
    from src.services.orgs.join_notifications import notify_user_joined_org

    _invalidate_session_cache(user.id)
    await notify_user_joined_org(request, db_session, user, org_id)


async def sign_in_with_prakto(
    request: Request,
    claims: dict,
    org_id: int,
    current_user,
    db_session: AsyncSession,
):
    """Find or create the account for verified Prakto claims, inside ``org_id``."""
    email = claims["email"].strip().lower()
    user = (
        await db_session.execute(select(User).where(func.lower(User.email) == email))
    ).scalars().first()

    if not user:
        user_object = UserCreate(
            email=email,
            username=_username_from(claims, email),
            password="",
            first_name=str(claims.get("given_name") or ""),
            last_name=str(claims.get("family_name") or ""),
            avatar_image="",
        )
        return await create_user(
            request,
            db_session,
            current_user,
            user_object,
            org_id,
            is_oauth=True,
            signup_provider=SIGNUP_PROVIDER,
        )

    await _secure_existing_account(user, db_session)
    await _ensure_org_membership(request, user, org_id, db_session)

    client_ip = get_client_ip(request)
    await update_login_info(user, client_ip, db_session)
    await record_audit_event(
        event_type=UserAuditEventType.LOGIN,
        user_id=user.id,
        org_id=org_id,
        ip=client_ip,
        user_agent=request.headers.get("user-agent"),
        metadata={"method": SIGNUP_PROVIDER},
    )
    return UserRead.model_validate(user)
