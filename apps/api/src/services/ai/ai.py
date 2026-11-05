import logging
from typing import Tuple, Dict, Any
from fastapi import Depends, HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.security.features_utils.usage import (
    refund_ai_credit,
    reserve_ai_credit,
)
from src.db.courses.courses import Course, CourseRead
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.courses.activities import Activity, ActivityRead, ActivityTypeEnum
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.org_auth import enforce_org_mfa, is_org_member
from src.services.ai.base import (
    ask_ai,
    chat_session_belongs_to_user,
    get_chat_session_history,
    save_message_to_history,
)
from src.services.ai.llm import model_for_tier
from src.services.ai.llm.errors import ai_error_message, is_quota_error
from src.services.ai.rag.access import can_read_activity
from src.services.courses.activities.dynamic_context import render_for_reader

from src.services.ai.schemas.ai import (
    ActivityAIChatSessionResponse,
    SendActivityAIChatMessage,
    StartActivityAIChatSession,
)
from src.services.courses.activities.utils import (
    serialize_activity_text_to_ai_comprehensible_text,
    structure_activity_content_by_type,
)

logger = logging.getLogger(__name__)


async def _authorize_activity_ai_access(
    request: Request,
    course: CourseRead,
    activity: ActivityRead,
    org_id: int,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> None:
    """Gate activity AI chat on the owning organization and course.

    ``activity_uuid`` is client-supplied, so without this any authenticated
    user could stream another org's activity content back through the model,
    and have that org billed for the credit. Must run before rate limiting and
    credit reservation so an unauthorized caller never spends the victim's quota.
    """
    acting_user_id = resolve_acting_user_id(current_user)
    if not await is_org_member(acting_user_id, org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="You are not a member of this organization",
        )
    await enforce_org_mfa(acting_user_id, org_id, db_session)
    # Course READ alone is not enough: the activity's content goes into the
    # model context, so drafts, chapter/activity locks and paid access apply
    # exactly as they do when the activity is opened directly.
    if activity.id is None or not await can_read_activity(
        request, current_user, course, activity.id, db_session
    ):
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this activity",
        )


def _require_own_chat_session(aichat_uuid: str, current_user: PublicUser) -> None:
    """404 unless the client-supplied session belongs to the caller.

    The session uuid is echoed to the browser in every SSE event, so another
    user's uuid is easy to come by; without this a caller could read someone
    else's turns through the model and append to their history. Same rule as
    the RAG router.
    """
    if not chat_session_belongs_to_user(aichat_uuid, resolve_acting_user_id(current_user)):
        raise HTTPException(status_code=404, detail="Chat session not found")


# Hosted-video and PDF lessons keep their substance in a file, not in the page's
# text blocks, so the block serializer sees nothing and the model used to get
# only the lesson's title. Their text comes from the RAG extractors instead:
# stored captions/transcripts and the PDF's page text. Extraction only reads;
# it never starts a transcription or spends credits.
_MEDIA_LESSON_LABELS = {
    ActivityTypeEnum.TYPE_VIDEO: "the transcript of the lecture video, with timestamps",
    ActivityTypeEnum.TYPE_DOCUMENT: "the text of the lecture document (PDF), with page numbers",
}
# About 15k tokens: a whole lecture fits, a book-length PDF is cut.
_MEDIA_LESSON_MAX_CHARS = 60_000


def _format_timestamp(seconds: float) -> str:
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


async def _media_lesson_text(activity: ActivityRead, db_session: AsyncSession) -> str:
    """The transcript or PDF text of a media lesson, or "" when there is none."""
    if activity.activity_type not in _MEDIA_LESSON_LABELS:
        return ""
    from src.services.ai.rag.sources import extract
    from src.services.ai.rag.types import ContentRef, SourceType

    try:
        extraction = await extract(ContentRef.activity(activity.id), db_session)
    except Exception:
        logger.exception("AI chat: could not read the media text of activity %s", activity.id)
        return ""
    if extraction is None:
        return ""

    lines = []
    for segment in extraction.segments:
        locator = segment.locator or {}
        if segment.source_type == SourceType.VIDEO and "start" in locator:
            lines.append(f"[{_format_timestamp(locator['start'])}] {segment.text}")
        elif segment.source_type == SourceType.DOCUMENT and "page" in locator:
            lines.append(f"[page {locator['page']}] {segment.text}")
    text = "\n".join(lines).strip()
    if len(text) > _MEDIA_LESSON_MAX_CHARS:
        text = text[:_MEDIA_LESSON_MAX_CHARS] + "\n[... the rest is cut for length]"
    return text


async def _activity_context_text(
    request: Request,
    activity: ActivityRead,
    course: CourseRead,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> str:
    """What the model is told about the lesson the learner has open."""
    # Activity Content Blocks, as this reader sees them: the model must not
    # quote a conditional block the learner can't see.
    content = await render_for_reader(
        request, activity.content, course=course, current_user=current_user,
        db_session=db_session, activity_name=activity.name, activity_uuid=activity.activity_uuid,
    )
    structured = structure_activity_content_by_type(content)

    media_text = await _media_lesson_text(activity, db_session)
    if media_text:
        return (
            f'Use this as a context. This is a course about "{course.name}". '
            f'This is a lecture about "{activity.name}". '
            f"Below is {_MEDIA_LESSON_LABELS[activity.activity_type]}. "
            "Base your answers on it, and point to the timestamp or page when that "
            "helps the student find the passage. It may be in another language than "
            "the student writes in; always answer in the student's language.\n"
            f'"""\n{media_text}\n"""'
        )

    return serialize_activity_text_to_ai_comprehensible_text(
        structured, course, activity, isActivityEmpty=structured == []
    )


async def ai_start_activity_chat_session(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> ActivityAIChatSessionResponse:
    """
    Start a new AI Chat session with a Course Activity
    """

    # Get the Activity
    statement = select(Activity).where(
        Activity.activity_uuid == chat_session_object.activity_uuid
    )
    activity = (await db_session.execute(statement)).scalars().first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    activity = ActivityRead.model_validate(activity)

    # Get the Course with authors
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
    )
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get course authors
    from src.db.resource_authors import ResourceAuthor
    from src.db.users import User
    from src.db.courses.courses import AuthorWithRole
    from src.db.users import UserReadAuthor

    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = (await db_session.execute(authors_statement)).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserReadAuthor.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    course = CourseRead(**course.model_dump(), authors=authors)

    # Get the Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # F5/F6: authorize the client-supplied activity before any spend.
    await _authorize_activity_ai_access(
        request, course, activity, org.id, current_user, db_session
    )

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve through helper so API tokens bucket under their creator rather
    # than all sharing user_id=0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)

    # Reserve credit atomically before the AI call; refund below on failure.
    await reserve_ai_credit(org.id, db_session)

    ai_friendly_text = await _activity_context_text(
        request, activity, course, current_user, db_session
    )

    # Get Activity Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    # Get Organization Config
    statement = select(OrganizationConfig).where(
        OrganizationConfig.org_id == org.id  # type: ignore
    )
    result = await db_session.execute(statement)
    org_config = result.scalars().first()

    org_config = OrganizationConfig.model_validate(org_config)

    # Default chat model (provider-agnostic; resolved from AI config)
    ai_model = model_for_tier("standard")

    chat_session = get_chat_session_history()

    message = "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
    message += "Use the course content provided to answer questions about the course material."
    message += "For context, this is the Course name: "
    message += course.name
    message += " and this is the Lecture name: "
    message += activity.name
    message += "."
    message += "Use your knowledge to help the student if the context is not enough."

    try:
        response = await ask_ai(
            chat_session_object.message,
            chat_session["message_history"],
            ai_friendly_text,
            message,
            ai_model,
        )
    except Exception as e:
        # Refund the credit we reserved up-front since the AI call failed.
        refund_ai_credit(org.id)
        (logger.warning if is_quota_error(e) else logger.error)(
            "AI service error in ai_start_activity_chat_session: %s", e
        )
        raise HTTPException(status_code=503, detail={"code": "AI_UNAVAILABLE", "message": ai_error_message(e, "AI service is temporarily unavailable")})

    # Save the message exchange to history (and record who owns the session)
    save_message_to_history(
        chat_session["aichat_uuid"],
        chat_session_object.message,
        response["output"],
        user_id=resolve_acting_user_id(current_user),
        course_uuid=course.course_uuid,
        org_id=course.org_id,
    )

    return ActivityAIChatSessionResponse(
        aichat_uuid=chat_session["aichat_uuid"],
        activity_uuid=activity.activity_uuid,
        message=response["output"],
    )


async def ai_send_activity_chat_message(
    request: Request,
    chat_session_object: SendActivityAIChatMessage,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> ActivityAIChatSessionResponse:
    """
    Send a message in an existing AI Chat session with a Course Activity
    """
    # Get the Activity
    statement = select(Activity).where(
        Activity.activity_uuid == chat_session_object.activity_uuid
    )
    activity = (await db_session.execute(statement)).scalars().first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    activity = ActivityRead.model_validate(activity)

    # Get the Course with authors
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
    )
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get course authors
    from src.db.resource_authors import ResourceAuthor
    from src.db.users import User
    from src.db.courses.courses import AuthorWithRole
    from src.db.users import UserReadAuthor

    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = (await db_session.execute(authors_statement)).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserReadAuthor.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    course = CourseRead(**course.model_dump(), authors=authors)

    # Get the Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    # F5/F6: authorize the client-supplied activity before any spend.
    await _authorize_activity_ai_access(
        request, course, activity, course.org_id, current_user, db_session
    )
    _require_own_chat_session(chat_session_object.aichat_uuid, current_user)

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), course.org_id)

    # Reserve credit atomically before the AI call; refund below on failure.
    await reserve_ai_credit(course.org_id, db_session)

    ai_friendly_text = await _activity_context_text(
        request, activity, course, current_user, db_session
    )

    # Get Activity Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    # Get Organization Config
    statement = select(OrganizationConfig).where(
        OrganizationConfig.org_id == org.id  # type: ignore
    )
    result = await db_session.execute(statement)
    org_config = result.scalars().first()

    org_config = OrganizationConfig.model_validate(org_config)

    # Default chat model (provider-agnostic; resolved from AI config)
    ai_model = model_for_tier("standard")

    chat_session = get_chat_session_history(chat_session_object.aichat_uuid)

    message = "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
    message += "Use the course content provided to answer questions about the course material."
    message += "For context, this is the Course name: "
    message += course.name
    message += " and this is the Lecture name: "
    message += activity.name
    message += "."
    message += "Use your knowledge to help the student if the context is not enough."

    try:
        response = await ask_ai(
            chat_session_object.message,
            chat_session["message_history"],
            ai_friendly_text,
            message,
            ai_model,
        )
    except Exception as e:
        # Refund the credit we reserved up-front since the AI call failed.
        refund_ai_credit(course.org_id)
        logger.error("AI service error in ai_send_activity_chat_message: %s", e)
        raise HTTPException(status_code=503, detail={"code": "AI_UNAVAILABLE", "message": "AI service is temporarily unavailable"})

    # Save the message exchange to history (and record who owns the session)
    save_message_to_history(
        chat_session["aichat_uuid"],
        chat_session_object.message,
        response["output"],
        user_id=resolve_acting_user_id(current_user),
        course_uuid=course.course_uuid,
        org_id=course.org_id,
    )

    return ActivityAIChatSessionResponse(
        aichat_uuid=chat_session["aichat_uuid"],
        activity_uuid=activity.activity_uuid,
        message=response["output"],
    )


async def _get_activity_and_course_info(
    activity_uuid: str,
    db_session: AsyncSession,
    request: Request,
    current_user: PublicUser,
) -> Tuple[ActivityRead, CourseRead, Organization, str, str]:
    """
    Helper function to get activity, course, and organization info with AI model.
    Returns: (activity, course, org, ai_model, ai_friendly_text)
    """
    # Get the Activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = (await db_session.execute(statement)).scalars().first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    activity = ActivityRead.model_validate(activity)

    # Get the Course with authors
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == activity_uuid)
    )
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get course authors
    from src.db.resource_authors import ResourceAuthor
    from src.db.users import User
    from src.db.courses.courses import AuthorWithRole
    from src.db.users import UserReadAuthor

    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = (await db_session.execute(authors_statement)).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserReadAuthor.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    course = CourseRead(**course.model_dump(), authors=authors)

    # Get the Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # F5: authorize before serializing any of the activity's content into the
    # model context, and before the callers rate-limit / reserve credits.
    await _authorize_activity_ai_access(
        request, course, activity, org.id, current_user, db_session
    )

    ai_friendly_text = await _activity_context_text(
        request, activity, course, current_user, db_session
    )

    # Get Organization Config
    statement = select(OrganizationConfig).where(
        OrganizationConfig.org_id == org.id  # type: ignore
    )
    result = await db_session.execute(statement)
    org_config = result.scalars().first()

    org_config = OrganizationConfig.model_validate(org_config)

    # Default chat model (provider-agnostic; resolved from AI config)
    ai_model = model_for_tier("standard")

    return activity, course, org, ai_model, ai_friendly_text


async def ai_start_activity_chat_session_stream(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> Dict[str, Any]:
    """
    Start a new AI Chat session with streaming response.
    Returns context needed for streaming.
    """
    activity, course, org, ai_model, ai_friendly_text = await _get_activity_and_course_info(
        chat_session_object.activity_uuid, db_session, request, current_user
    )

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve through helper so API tokens bucket under their creator rather
    # than all sharing user_id=0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)

    # Atomic credit reservation to prevent concurrent over-use.
    await reserve_ai_credit(org.id, db_session)

    try:
        chat_session = get_chat_session_history()

        message = "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
        message += "Use the course content provided to answer questions about the course material."
        message += "For context, this is the Course name: "
        message += course.name
        message += " and this is the Lecture name: "
        message += activity.name
        message += "."
        message += "Use your knowledge to help the student if the context is not enough."
    except Exception:
        refund_ai_credit(org.id)
        raise

    return {
        "chat_session": chat_session,
        "activity": activity,
        "course": course,
        "ai_model": ai_model,
        "ai_friendly_text": ai_friendly_text,
        "message": message,
        "user_message": chat_session_object.message,
    }


async def ai_send_activity_chat_message_stream(
    request: Request,
    chat_session_object: SendActivityAIChatMessage,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> Dict[str, Any]:
    """
    Send a message in an existing AI Chat session with streaming response.
    Returns context needed for streaming.
    """
    activity, course, org, ai_model, ai_friendly_text = await _get_activity_and_course_info(
        chat_session_object.activity_uuid, db_session, request, current_user
    )
    _require_own_chat_session(chat_session_object.aichat_uuid, current_user)

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve through helper so API tokens bucket under their creator rather
    # than all sharing user_id=0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)

    # Atomic credit reservation to prevent concurrent over-use.
    await reserve_ai_credit(org.id, db_session)

    try:
        chat_session = get_chat_session_history(chat_session_object.aichat_uuid)

        message = "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
        message += "Use the course content provided to answer questions about the course material."
        message += "For context, this is the Course name: "
        message += course.name
        message += " and this is the Lecture name: "
        message += activity.name
        message += "."
        message += "Use your knowledge to help the student if the context is not enough."
    except Exception:
        refund_ai_credit(org.id)
        raise

    return {
        "chat_session": chat_session,
        "activity": activity,
        "course": course,
        "ai_model": ai_model,
        "ai_friendly_text": ai_friendly_text,
        "message": message,
        "user_message": chat_session_object.message,
    }
