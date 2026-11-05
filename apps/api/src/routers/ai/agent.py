"""Atlas: the in-app course agent (chat sessions, streamed turns, proposals)."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.features_utils.usage import _role_grants_dashboard_access, check_feature_enabled
from src.security.org_auth import enforce_org_mfa
from src.services.ai.agent import runner, store

router = APIRouter()


class AgentPageContext(BaseModel):
    course_uuid: Optional[str] = None
    course_name: Optional[str] = None
    chapter_id: Optional[int] = None
    chapter_name: Optional[str] = None
    activity_uuid: Optional[str] = None
    activity_name: Optional[str] = None


class AgentReference(BaseModel):
    type: str
    uuid: str
    name: str = ""
    parent_course_uuid: str = ""
    parent_chapter_id: Optional[int] = None
    parent_chapter_name: Optional[str] = None
    activity_type: Optional[str] = None


class AgentMessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    page_context: Optional[AgentPageContext] = None
    references: list[AgentReference] = []


class AgentSessionPatch(BaseModel):
    title: Optional[str] = None
    favorite: Optional[bool] = None


async def _require_atlas_user(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> PublicUser:
    """A signed-in member with dashboard access, in an org with AI turned on."""
    if not isinstance(current_user, PublicUser):
        raise HTTPException(status_code=401, detail="Sign in to use Atlas")
    user_id = resolve_acting_user_id(current_user)
    membership = (await db_session.execute(
        select(UserOrganization).where(UserOrganization.user_id == user_id, UserOrganization.org_id == org_id)
    )).scalars().first()
    role = None
    if membership:
        role = (await db_session.execute(select(Role).where(Role.id == membership.role_id))).scalars().first()
    if not _role_grants_dashboard_access(role):
        raise HTTPException(status_code=403, detail="Atlas is available to staff with dashboard access")
    await enforce_org_mfa(user_id, org_id, db_session)
    await check_feature_enabled("ai", org_id, db_session)
    return current_user


@router.get("/agent/sessions", summary="List Atlas chats")
async def api_list_sessions(
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = await _require_atlas_user(org_id, current_user, db_session)
    return {"sessions": store.list_sessions(org_id, resolve_acting_user_id(user))}


@router.post("/agent/sessions", summary="Start an Atlas chat")
async def api_create_session(
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = await _require_atlas_user(org_id, current_user, db_session)
    session = store.create_session(org_id, resolve_acting_user_id(user))
    return {"id": session["id"], "title": session["title"], "transcript": []}


@router.get("/agent/sessions/{session_id}", summary="Read an Atlas chat")
async def api_get_session(
    session_id: str,
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = await _require_atlas_user(org_id, current_user, db_session)
    session = store.get_session(session_id, org_id, resolve_acting_user_id(user))
    return {
        "id": session["id"],
        "title": session.get("title", ""),
        "favorite": bool(session.get("favorite")),
        "transcript": session.get("transcript", []),
    }


@router.patch("/agent/sessions/{session_id}", summary="Rename or favorite an Atlas chat")
async def api_patch_session(
    session_id: str,
    org_id: int,
    body: AgentSessionPatch,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = await _require_atlas_user(org_id, current_user, db_session)
    return store.update_session_meta(session_id, org_id, resolve_acting_user_id(user),
                                     title=body.title, favorite=body.favorite)


@router.delete("/agent/sessions/{session_id}", summary="Delete an Atlas chat")
async def api_delete_session(
    session_id: str,
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = await _require_atlas_user(org_id, current_user, db_session)
    store.delete_session(session_id, org_id, resolve_acting_user_id(user))
    return {"ok": True}


@router.post("/agent/sessions/{session_id}/messages", summary="Send a message to Atlas (streamed)")
async def api_send_message(
    session_id: str,
    org_id: int,
    body: AgentMessageIn,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = await _require_atlas_user(org_id, current_user, db_session)
    from src.services.security.rate_limiting import enforce_ai_rate_limit

    user_id = resolve_acting_user_id(user)
    enforce_ai_rate_limit(user_id, org_id)
    session = store.get_session(session_id, org_id, user_id)
    return StreamingResponse(
        runner.stream_turn(
            session,
            user,
            body.text,
            page_context=body.page_context.model_dump() if body.page_context else None,
            references=[r.model_dump() for r in body.references],
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/agent/proposals/{proposal_id}/apply", summary="Apply a change Atlas proposed")
async def api_apply_proposal(
    proposal_id: str,
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = await _require_atlas_user(org_id, current_user, db_session)
    return await runner.apply_proposal(proposal_id, user, org_id)


@router.post("/agent/proposals/{proposal_id}/cancel", summary="Cancel a change Atlas proposed")
async def api_cancel_proposal(
    proposal_id: str,
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = await _require_atlas_user(org_id, current_user, db_session)
    return runner.cancel_proposal(proposal_id, user, org_id)
