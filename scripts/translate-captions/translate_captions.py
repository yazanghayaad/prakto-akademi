"""Translate the subtitles of hosted course videos into another language.

Reads each video's finished source track (``captions/<source>.vtt``, e.g. the
English captions that came with a Coursera import), translates the cue text
with any OpenAI-compatible chat model (e.g. Kimi K3 on Modal) and writes
``captions/<lang>.vtt`` next to it, with every timestamp copied from the
source. The new track is then registered on the activity as a ready caption
language, so the video player lists it and learners can pick it.

Run with the API's Python, from the repository root:

    apps/api/.venv/Scripts/python.exe scripts/translate-captions/translate_captions.py --limit 5

Videos that already have the target language are skipped, so a run can be
stopped at any time and started again. See README.md for all options.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import asyncpg
import httpx

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parent.parent
API_DIR = REPO_ROOT / "apps" / "api"
DEFAULT_CONFIG = REPO_ROOT.parent / "ai_model_översätt"
DEFAULT_DSN = "postgresql://learnhouse:learnhouse@localhost:5432/learnhouse"

LANGUAGE_NAMES = {"sv": ("Swedish", "Svenska"), "en": ("English", "English")}

TIMING_RE = re.compile(
    r"^\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}).*$"
)
SAFE_CODE_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$")


# ── Settings ─────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Översätt videoundertexter (WebVTT) med en AI-modell.")
    p.add_argument("--lang", default="sv", help="Målspråk (kod), standard sv.")
    p.add_argument("--label", default=None, help="Namn i spelarens undertextmeny, standard 'Svenska' för sv.")
    p.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="Fil med modellinställningar.")
    p.add_argument("--concurrency", type=int, default=4, help="Antal videor som översätts samtidigt.")
    p.add_argument("--limit", type=int, default=0, help="Översätt högst så här många videor (0 = alla).")
    p.add_argument("--course", default=None, help="Bara den här kursen (course_uuid).")
    p.add_argument("--activity", default=None, help="Bara den här lektionen (activity_uuid).")
    p.add_argument("--batch-cues", type=int, default=60, help="Max antal undertextrader per anrop.")
    p.add_argument("--batch-chars", type=int, default=3500, help="Max antal tecken per anrop.")
    p.add_argument("--rounds", type=int, default=3, help="Försök per omgång innan videon räknas som misslyckad.")
    p.add_argument("--reasoning", default="low", help="reasoning_effort till modellen ('none' = skicka inte).")
    p.add_argument("--retranslate", action="store_true", help="Översätt även videor som redan har målspråket.")
    p.add_argument("--dry-run", action="store_true", help="Visa vad som skulle översättas, utan att anropa modellen.")
    args = p.parse_args()
    if not SAFE_CODE_RE.match(args.lang):
        p.error(f"ogiltig språkkod: {args.lang}")
    if args.label is None:
        args.label = LANGUAGE_NAMES.get(args.lang, (args.lang, args.lang))[1]
    return args


@dataclass
class ModelConfig:
    base_url: str
    api_key: str
    model: str


def read_kv_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip().lower()] = value.strip()
    return values


def resolve_model(config_path: Path) -> ModelConfig:
    """Env vars first, then the config file (same keys as translate-locale)."""
    cfg = read_kv_file(config_path)

    def pick(env: str, *keys: str) -> str:
        return os.environ.get(env) or next((cfg[k] for k in keys if cfg.get(k)), "")

    base_url = pick("TRANSLATE_BASE_URL", "base_url", "modal_api_url")
    api_key = pick("TRANSLATE_API_KEY", "api_key", "modal_api_key")
    model = pick("TRANSLATE_MODEL", "model", "modal_api_model")
    missing = [n for n, v in (("base_url", base_url), ("api_key", api_key), ("model", model)) if not v]
    if missing:
        sys.exit(f"Saknar modellinställningar ({', '.join(missing)}). Ange TRANSLATE_* eller --config.")
    return ModelConfig(base_url.rstrip("/"), api_key, model)


# ── WebVTT ───────────────────────────────────────────────────────────────────

@dataclass
class Cue:
    ident: str  # optional cue id line ("" when absent)
    timing: str
    text: str


def parse_vtt(raw: str) -> list[Cue]:
    text = raw.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    cues: list[Cue] = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.split("\n")
        timing_at = next((i for i, line in enumerate(lines) if TIMING_RE.match(line)), None)
        if timing_at is None:
            continue  # header, NOTE or STYLE block
        ident = lines[timing_at - 1].strip() if timing_at > 0 and not lines[0].startswith("WEBVTT") else ""
        body = " ".join(line.strip() for line in lines[timing_at + 1:] if line.strip())
        cues.append(Cue(ident=ident, timing=lines[timing_at].strip(), text=body))
    return cues


def write_vtt(cues: list[Cue], texts: list[str]) -> str:
    parts = ["WEBVTT", ""]
    for cue, text in zip(cues, texts):
        if cue.ident:
            parts.append(cue.ident)
        parts.append(cue.timing)
        parts.append(text)
        parts.append("")
    return "\n".join(parts)


def batches(cues: list[Cue], max_cues: int, max_chars: int) -> list[range]:
    out: list[range] = []
    start, chars = 0, 0
    for i, cue in enumerate(cues):
        if i > start and (i - start >= max_cues or chars + len(cue.text) > max_chars):
            out.append(range(start, i))
            start, chars = i, 0
        chars += len(cue.text)
    if start < len(cues):
        out.append(range(start, len(cues)))
    return out


# ── Model ────────────────────────────────────────────────────────────────────

def system_prompt(source_name: str, target_name: str) -> str:
    return (
        f"You translate video subtitles from {source_name} to {target_name} for an online course platform. "
        'The input is JSON. "cues" maps ids to the text of consecutive subtitle cues. The cues are fragments '
        "of continuous speech, so one sentence often runs across several cues. "
        f"Translate into natural, correct {target_name} as it would be spoken in an educational video. "
        "Return ONLY a JSON object whose keys are exactly the ids in \"cues\" and whose values are the "
        "translated text of each cue. Keep each translation aligned with the part of the speech its cue "
        "covers; when word order has to change across a cue boundary, move as little text as possible. "
        "Never merge, split, drop or add cues, and never leave a cue empty when its source has text. "
        "Keep product names, brand names, code, commands, file names, numbers and acronyms unchanged. "
        f"Use established {target_name} terms for technical concepts, and keep an English term only where "
        f"{target_name}-speaking professionals normally use it. Address the viewer informally (in Swedish: "
        '"du", never "ni"). "context_before" holds the cues just before this batch, for reference only: '
        "do not translate or return them."
    )


def parse_json_object(content: str) -> dict:
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content)
    try:
        value = json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.S)
        if not match:
            raise
        value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise ValueError("svaret är inte ett JSON-objekt")
    return value


async def call_model(
    client: httpx.AsyncClient, model: ModelConfig, args, system: str, payload: dict, approx_chars: int
) -> dict:
    body = {
        "model": model.model,
        "temperature": 0.2,
        "max_tokens": min(16000, 1000 + approx_chars),
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
    }
    if args.reasoning and args.reasoning != "none":
        body["reasoning_effort"] = args.reasoning
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            res = await client.post(
                f"{model.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {model.api_key}"},
                json=body,
            )
            if res.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError(f"HTTP {res.status_code}", request=res.request, response=res)
            res.raise_for_status()
            content = res.json()["choices"][0]["message"]["content"] or ""
            return parse_json_object(content)
        except (httpx.HTTPError, ValueError, KeyError, json.JSONDecodeError) as e:
            last_error = e
            await asyncio.sleep(2 * (attempt + 1) ** 2)
    raise RuntimeError(f"modellanropet misslyckades: {last_error}")


async def translate_cues(
    client: httpx.AsyncClient, model: ModelConfig, args, system: str, cues: list[Cue]
) -> list[str]:
    """Translate every cue; raises when some cue still fails after all rounds."""
    out: list[str | None] = [None if c.text else "" for c in cues]
    for rng in batches(cues, args.batch_cues, args.batch_chars):
        todo = [i for i in rng if out[i] is None]
        for _ in range(args.rounds):
            if not todo:
                break
            context = [cues[i].text for i in range(max(0, todo[0] - 3), todo[0])]
            payload = {"context_before": context, "cues": {str(i): cues[i].text for i in todo}}
            approx = sum(len(cues[i].text) for i in todo) * 2
            result = await call_model(client, model, args, system, payload, approx)
            for i in todo:
                value = result.get(str(i))
                if isinstance(value, str) and value.strip():
                    out[i] = " ".join(value.split())
            todo = [i for i in todo if out[i] is None]
        if todo:
            raise RuntimeError(f"{len(todo)} rader kunde inte översättas")
    return [t or "" for t in out]


# ── Videos ───────────────────────────────────────────────────────────────────

@dataclass
class Video:
    id: int
    activity_uuid: str
    name: str
    course_name: str
    source_lang: str
    source_path: Path

    @property
    def target_dir(self) -> Path:
        return self.source_path.parent


async def find_videos(conn: asyncpg.Connection, args) -> tuple[list[Video], int]:
    rows = await conn.fetch(
        """
        SELECT a.id, a.activity_uuid, a.name, c.name AS course_name, c.course_uuid, o.org_uuid,
               a.extra_metadata->'captions' AS captions
        FROM activity a
        JOIN course c ON c.id = a.course_id
        JOIN organization o ON o.id = a.org_id
        WHERE a.activity_type = 'TYPE_VIDEO'
          AND a.extra_metadata->'captions' IS NOT NULL
          AND ($1::text IS NULL OR c.course_uuid = $1)
          AND ($2::text IS NULL OR a.activity_uuid = $2)
        ORDER BY c.id, a.id
        """,
        args.course,
        args.activity,
    )
    videos: list[Video] = []
    already = 0
    for row in rows:
        captions = json.loads(row["captions"]) if isinstance(row["captions"], str) else row["captions"]
        ready = {
            l.get("code")
            for l in captions.get("languages") or []
            if isinstance(l, dict) and l.get("status") == "ready"
        }
        source = captions.get("source_language") if captions.get("source_language") in ready else None
        source = source or next((c for c in ready if c != args.lang), None)
        if not source or not SAFE_CODE_RE.match(source) or source == args.lang:
            continue
        if args.lang in ready and not args.retranslate:
            already += 1
            continue
        path = (
            API_DIR / "content" / "orgs" / row["org_uuid"] / "courses" / row["course_uuid"]
            / "activities" / row["activity_uuid"] / "video" / "captions" / f"{source}.vtt"
        )
        if path.is_file():
            videos.append(Video(row["id"], row["activity_uuid"], row["name"], row["course_name"], source, path))
    return videos, already


REGISTER_SQL = """
UPDATE activity
SET extra_metadata = jsonb_set(
    extra_metadata,
    '{captions,languages}',
    jsonb_build_array(jsonb_build_object('code', $2::text, 'label', $3::text, 'status', 'ready'))
    || COALESCE(
        (SELECT jsonb_agg(l) FROM jsonb_array_elements(extra_metadata->'captions'->'languages') l
         WHERE l->>'code' IS DISTINCT FROM $2::text),
        '[]'::jsonb)
)
WHERE id = $1
"""


@dataclass
class Stats:
    total: int
    done: int = 0
    failed: int = 0
    cues: int = 0
    started: float = field(default_factory=time.perf_counter)


async def process(video: Video, client, model, args, pool, stats: Stats, failures) -> None:
    t0 = time.perf_counter()
    try:
        cues = parse_vtt(video.source_path.read_text(encoding="utf-8", errors="replace"))
        if not cues:
            raise RuntimeError("källfilen har inga undertextrader")
        source_name = LANGUAGE_NAMES.get(video.source_lang, (video.source_lang,))[0]
        target_name = LANGUAGE_NAMES.get(args.lang, (args.lang,))[0]
        texts = await translate_cues(client, model, args, system_prompt(source_name, target_name), cues)

        target = video.target_dir / f"{args.lang}.vtt"
        tmp = target.with_suffix(".vtt.tmp")
        tmp.write_text(write_vtt(cues, texts), encoding="utf-8")
        os.replace(tmp, target)
        async with pool.acquire() as conn:
            await conn.execute(REGISTER_SQL, video.id, args.lang, args.label)
        stats.done += 1
        stats.cues += len(cues)
        status = f"ok, {len(cues)} rader, {time.perf_counter() - t0:.0f} s"
    except Exception as e:  # one video failing must not stop the run
        stats.failed += 1
        status = f"MISSLYCKADES: {e}"
        failures.write(f"{video.activity_uuid}\t{video.course_name}\t{video.name}\t{e}\n")
        failures.flush()

    finished = stats.done + stats.failed
    elapsed = time.perf_counter() - stats.started
    eta = elapsed / finished * (stats.total - finished) if finished else 0
    print(
        f"[{finished}/{stats.total}] {video.course_name} / {video.name}: {status}"
        f"  (kvar ca {eta / 60:.0f} min)",
        flush=True,
    )


async def main() -> None:
    args = parse_args()
    dsn = os.environ.get("LEARNHOUSE_SQL_CONNECTION_STRING", DEFAULT_DSN)
    dsn = re.sub(r"^postgres(ql)?(\+\w+)?://", "postgresql://", dsn)
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=4)
    try:
        async with pool.acquire() as conn:
            videos, already = await find_videos(conn, args)
        if args.limit:
            videos = videos[: args.limit]
        print(f"Att översätta till {args.label} ({args.lang}): {len(videos)} videor"
              f" ({already} har redan {args.lang} och hoppas över).", flush=True)
        if args.dry_run or not videos:
            for v in videos[:20]:
                print(f"  {v.course_name} / {v.name}  ({v.source_lang} → {args.lang})")
            return

        model = resolve_model(args.config)
        print(f"Modell: {model.model} via {httpx.URL(model.base_url).host}", flush=True)
        logs = TOOL_DIR / "logs"
        logs.mkdir(exist_ok=True)
        stats = Stats(total=len(videos))
        sem = asyncio.Semaphore(max(1, args.concurrency))
        timeout = httpx.Timeout(300.0, connect=30.0)
        with open(logs / f"failures.{args.lang}.tsv", "a", encoding="utf-8") as failures:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async def run(video: Video) -> None:
                    async with sem:
                        await process(video, client, model, args, pool, stats, failures)

                await asyncio.gather(*(run(v) for v in videos))

        minutes = (time.perf_counter() - stats.started) / 60
        print(f"\nKlart på {minutes:.0f} min: {stats.done} översatta ({stats.cues} rader),"
              f" {stats.failed} misslyckade.", flush=True)
        if stats.failed:
            print(f"Misslyckade finns i {logs / f'failures.{args.lang}.tsv'}; kör skriptet igen för att"
                  " försöka med dem.", flush=True)
    finally:
        await pool.close()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
