"""Redis persistence for Atlas chats and proposals.

Keys (all JSON):
    atlas:index:{org_id}:{user_id}   hash   session_id -> session summary
    atlas:session:{session_id}       string full session (model history, transcript)
    atlas:proposal:{proposal_id}     string a change waiting for the user's yes/no

A session belongs to one member in one organization; every read checks both.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from src.core.redis import get_redis_client

SESSION_TTL = 90 * 24 * 3600
PROPOSAL_TTL = 7 * 24 * 3600
MAX_SESSIONS = 200


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _redis():
    r = get_redis_client()
    if r is None:
        raise HTTPException(status_code=503, detail="Atlas needs Redis, which is not available.")
    return r


def _loads(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def _index_key(org_id: int, user_id: int) -> str:
    return f"atlas:index:{org_id}:{user_id}"


def _session_key(session_id: str) -> str:
    return f"atlas:session:{session_id}"


def _proposal_key(proposal_id: str) -> str:
    return f"atlas:proposal:{proposal_id}"


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(12)}"


# ── Sessions ──────────────────────────────────────────────────────────────────
def _summary(session: dict) -> dict:
    return {
        "id": session["id"],
        "title": session.get("title") or "",
        "favorite": bool(session.get("favorite")),
        "created_at": session["created_at"],
        "updated_at": session["updated_at"],
    }


def create_session(org_id: int, user_id: int, title: str = "") -> dict:
    now = _now()
    session = {
        "id": new_id("atlas"),
        "org_id": org_id,
        "user_id": user_id,
        "title": title,
        "favorite": False,
        "created_at": now,
        "updated_at": now,
        "messages": [],  # pydantic-ai model history (JSON)
        "transcript": [],  # what the chat shows (see runner.py for block types)
        "notes": [],  # approvals/cancellations to tell the model on the next turn
    }
    save_session(session)
    return session


def save_session(session: dict) -> None:
    r = _redis()
    session["updated_at"] = _now()
    pipe = r.pipeline()
    pipe.set(_session_key(session["id"]), json.dumps(session, ensure_ascii=False, default=str), ex=SESSION_TTL)
    pipe.hset(_index_key(session["org_id"], session["user_id"]), session["id"],
              json.dumps(_summary(session), ensure_ascii=False))
    pipe.expire(_index_key(session["org_id"], session["user_id"]), SESSION_TTL)
    pipe.execute()


def get_session(session_id: str, org_id: int, user_id: int) -> dict:
    session = _loads(_redis().get(_session_key(session_id)))
    if not session or session.get("org_id") != org_id or session.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Chat not found")
    return session


def list_sessions(org_id: int, user_id: int) -> list[dict]:
    r = _redis()
    key = _index_key(org_id, user_id)
    items = [_loads(v) for v in r.hgetall(key).values()]
    # Drop index entries whose session expired.
    alive = []
    for item in items:
        if item and r.exists(_session_key(item["id"])):
            alive.append(item)
        elif item:
            r.hdel(key, item["id"])
    alive.sort(key=lambda s: s["updated_at"], reverse=True)
    return alive[:MAX_SESSIONS]


def update_session_meta(session_id: str, org_id: int, user_id: int,
                        title: Optional[str] = None, favorite: Optional[bool] = None) -> dict:
    session = get_session(session_id, org_id, user_id)
    if title is not None:
        session["title"] = title.strip()[:120]
    if favorite is not None:
        session["favorite"] = favorite
    save_session(session)
    return _summary(session)


def delete_session(session_id: str, org_id: int, user_id: int) -> None:
    get_session(session_id, org_id, user_id)
    r = _redis()
    r.delete(_session_key(session_id))
    r.hdel(_index_key(org_id, user_id), session_id)


# ── Proposals ─────────────────────────────────────────────────────────────────
def save_proposal(proposal: dict) -> None:
    _redis().set(_proposal_key(proposal["id"]), json.dumps(proposal, ensure_ascii=False, default=str),
                 ex=PROPOSAL_TTL)


def get_proposal(proposal_id: str, org_id: int, user_id: int) -> dict:
    proposal = _loads(_redis().get(_proposal_key(proposal_id)))
    if not proposal or proposal.get("org_id") != org_id or proposal.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="This proposal no longer exists.")
    return proposal
