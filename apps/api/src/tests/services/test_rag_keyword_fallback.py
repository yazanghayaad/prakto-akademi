"""
Keyword fallback for course search (src/services/ai/rag/query_service.py).

When the query embedding cannot be made (provider down, or the Cloudflare
Workers AI free quota is used up), the assistant must still answer: search
falls back to full-text search over the already indexed chunks.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.services.ai.rag import query_service
from src.services.ai.rag.query_service import keyword_terms


@pytest.fixture(autouse=True)
def _reset_embedding_cooldown():
    # Module-level state: never let one test's failure leak into another.
    query_service._embedding_down_until = 0.0
    yield
    query_service._embedding_down_until = 0.0


def test_keyword_terms_keep_content_words_once():
    assert keyword_terms("Hur fungerar en pivottabell i Excel? Excel!") == [
        "fungerar",
        "pivottabell",
        "excel",
    ]
    assert keyword_terms("What is a convolutional neural network?") == [
        "convolutional",
        "neural",
        "network",
    ]


def test_keyword_terms_are_plain_lexemes():
    # No tsquery operators or underscores can reach to_tsquery().
    assert keyword_terms("a & b | !c <-> foo_bar (x) 'drop'") == ["foo", "bar", "drop"]
    assert keyword_terms("Vilka kurser finns om cybersäkerhet?") == ["cybersäkerhet"]


def test_keyword_terms_are_capped():
    question = " ".join(f"term{i}" for i in range(30))
    assert len(keyword_terms(question)) == 12


@pytest.mark.asyncio
async def test_search_falls_back_to_keywords_when_embedding_fails():
    scope = SimpleNamespace(course_ids=[1, 2])
    with patch.object(
        query_service, "embed_single_text", new=AsyncMock(side_effect=RuntimeError("429 quota"))
    ), patch.object(
        query_service, "keyword_search_course_content", new=AsyncMock(return_value=["row"])
    ) as fallback:
        rows = await query_service.search_course_content("excel pivot", 1, None, scope, top_k=3)

    assert rows == ["row"]
    fallback.assert_awaited_once_with("excel pivot", 1, None, scope, 3)


@pytest.mark.asyncio
async def test_failing_provider_is_skipped_during_cooldown():
    scope = SimpleNamespace(course_ids=[1])
    embed = AsyncMock(side_effect=RuntimeError("429 quota"))
    with patch.object(query_service, "embed_single_text", new=embed), patch.object(
        query_service, "keyword_search_course_content", new=AsyncMock(return_value=[])
    ) as fallback:
        await query_service.search_course_content("excel", 1, None, scope)
        await query_service.search_course_content("pivot", 1, None, scope)

    assert embed.await_count == 1  # the second question went straight to keywords
    assert fallback.await_count == 2


@pytest.mark.asyncio
async def test_keyword_search_without_terms_skips_the_database():
    db = SimpleNamespace(execute=AsyncMock())
    rows = await query_service.keyword_search_course_content(
        "vad är det?", 1, db, SimpleNamespace(course_ids=[1])
    )
    assert rows == []
    db.execute.assert_not_awaited()
