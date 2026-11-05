"""Course thumbnails: a downloaded photo per course, blurred, with the PRKTO logo
in the centre and "x <company logo>" bottom right (after Pkratoxacademy.png).

Photos and logos come from Wikimedia Commons: photos only when they are CC0 or
public domain, so no attribution is required (sources are still listed in
credits.tsv). Commons requires a contact in the User-Agent, passed with
--contact. Downloads are cached in cache/, so a re-run only fetches what is new.

    apps/api/.venv/Scripts/python.exe scripts/course-thumbnails/make_thumbnails.py \\
        --contact you@example.com --prakto-logo <PRKTO logo .png>
    ... --apply     # also install them as the courses' thumbnails

See README.md.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import io
import re
import sys
import time
import uuid
from pathlib import Path

import asyncpg
import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parent.parent
API_DIR = REPO_ROOT / "apps" / "api"
CACHE = TOOL_DIR / "cache"
OUT = TOOL_DIR / "out"
DSN = "postgresql://learnhouse:learnhouse@localhost:5432/learnhouse"
COMMONS = "https://commons.wikimedia.org/w/api.php"
SERIF = r"C:\Windows\Fonts\pala.ttf"
W, H = 1280, 720

# Company → Commons logo file, or None to set the name in the serif instead.
COMPANIES: dict[str, str | None] = {
    "IBM": "File:IBM logo.svg",
    "Microsoft": "File:Microsoft logo (2012).svg",
    "Google": "File:Google 2015 logo.svg",
    "Meta": "File:Meta Platforms Inc. logo.svg",
    "Adobe": "File:Adobe Corporate logo.svg",
    "Python": "File:Python logo and wordmark.svg",
    "Anthropic": "File:Anthropic logo.svg",
    "Vanderbilt University": "File:Vanderbilt University logo.svg",
    "MathWorks": None,
    "DeepLearning.AI": None,
    "UC Davis": None,
}
# Logo height in px; wordmarks with small lettering get more room.
LOGO_HEIGHT = {"Python": 64, "Vanderbilt University": 60}

# course id → (company, or None for Prakto's own courses; photo subjects). A
# subject must appear in the photo's title on Commons; they are tried in order
# and every course gets a photo no other course uses.
COURSES: dict[int, tuple[str | None, list[str]]] = {
    2: (None, ["office", "desk", "work"]),
    39: (None, ["code", "coding", "laptop"]),
    4: ("IBM", ["code", "coding", "macbook"]),
    5: ("IBM", ["meeting", "office", "work"]),
    6: ("IBM", ["laptop", "coding", "computer"]),
    7: ("IBM", ["laptop", "screen", "statistics"]),
    8: ("IBM", ["computer", "laptop", "desk"]),
    9: ("IBM", ["neon", "light", "abstract"]),
    10: ("IBM", ["workspace", "desk", "macbook"]),
    11: ("IBM", ["statistics", "laptop", "screen"]),
    12: ("IBM", ["coding", "code", "macbook"]),
    13: ("IBM", ["colors", "pattern", "abstract"]),
    14: ("IBM", ["wires", "cables", "computer"]),
    15: ("IBM", ["post-it", "notes", "team"]),
    16: ("IBM", ["meeting", "work", "office"]),
    17: ("IBM", ["planning", "notebook", "calendar"]),
    18: ("IBM", ["study", "books", "students"]),
    19: ("IBM", ["notes", "paper", "planning"]),
    20: ("IBM", ["business", "office", "work"]),
    21: ("IBM", ["meeting", "microphone", "team"]),
    22: ("IBM", ["notebook", "pencil", "planning"]),
    37: ("IBM", ["neon", "technology", "light"]),
    50: ("IBM", ["screen", "monitor", "laptop"]),
    51: ("IBM", ["warehouse", "factory", "machine"]),
    52: ("IBM", ["wires", "cables", "machine"]),
    53: ("IBM", ["code", "terminal", "computer"]),
    66: ("IBM", ["cables", "wires", "light"]),
    67: ("IBM", ["lock", "padlock", "security"]),
    68: ("IBM", ["padlock", "door", "lock"]),
    69: ("IBM", ["documents", "paper", "files"]),
    70: ("IBM", ["light", "street", "traffic"]),
    71: ("IBM", ["coding", "code", "computer"]),
    72: ("IBM", ["cloud", "aerial", "stars"]),
    73: ("IBM", ["office", "business", "work"]),
    74: ("IBM", ["security", "lock", "door"]),
    75: ("IBM", ["computer", "screen", "machine"]),
    76: ("IBM", ["cables", "wires", "machine"]),
    77: ("IBM", ["screen", "monitor", "computer"]),
    23: ("Microsoft", ["security", "neon", "light"]),
    24: ("Microsoft", ["padlock", "lock", "security"]),
    25: ("Microsoft", ["documents", "paper", "office"]),
    26: ("Microsoft", ["lock", "padlock", "door"]),
    27: ("Microsoft", ["neon", "light", "abstract"]),
    28: ("Microsoft", ["computer", "screen", "macbook"]),
    29: ("Microsoft", ["macbook", "computer", "laptop"]),
    30: ("Microsoft", ["cloud", "cables", "wires"]),
    31: ("Microsoft", ["study", "books", "library"]),
    87: ("Microsoft", ["design", "colors", "paint"]),
    88: ("Microsoft", ["screen", "laptop", "dashboard"]),
    89: ("Microsoft", ["pattern", "abstract", "map"]),
    90: ("Microsoft", ["cloud", "aerial", "work"]),
    91: ("Microsoft", ["machine", "gears", "factory"]),
    92: ("Microsoft", ["business", "office", "laptop"]),
    93: ("Microsoft", ["computer", "laptop", "desk"]),
    105: ("Microsoft", ["study", "library", "books"]),
    32: ("DeepLearning.AI", ["pattern", "eye", "lens"]),
    33: ("DeepLearning.AI", ["gears", "machine", "technology"]),
    34: ("DeepLearning.AI", ["planning", "notebook", "map"]),
    35: ("DeepLearning.AI", ["neon", "light", "stars"]),
    36: ("DeepLearning.AI", ["typewriter", "writing", "books"]),
    38: ("Meta", ["instagram", "smartphone", "phone"]),
    40: ("Adobe", ["design", "pencil", "paint"]),
    41: ("Adobe", ["studio", "colors", "light"]),
    42: ("Adobe", ["video", "camera", "microphone"]),
    43: ("Adobe", ["smartphone", "instagram", "phone"]),
    44: ("Vanderbilt University", ["machine", "gears", "coding"]),
    45: ("Vanderbilt University", ["neon", "technology", "light"]),
    46: ("Vanderbilt University", ["laptop", "screen", "macbook"]),
    47: ("Vanderbilt University", ["phone", "smartphone", "hands"]),
    48: ("Vanderbilt University", ["writing", "typewriter", "laptop"]),
    49: ("Vanderbilt University", ["hands", "light", "door"]),
    54: ("Anthropic", ["office", "desk", "laptop"]),
    55: ("Anthropic", ["workspace", "desk", "coffee"]),
    56: ("Anthropic", ["code", "coding", "macbook"]),
    57: ("Anthropic", ["writing", "notebook", "coffee"]),
    58: ("Anthropic", ["gears", "machine", "work"]),
    59: ("Google", ["smartphone", "phone", "tablet"]),
    60: ("Google", ["cloud", "aerial", "stars"]),
    61: ("Google", ["bulb", "ideas", "post-it"]),
    62: ("Google", ["studio", "camera", "photography"]),
    63: ("Google", ["statistics", "laptop", "screen"]),
    64: ("Google", ["writing", "pencil", "typewriter"]),
    65: ("Google", ["abstract", "neon", "light"]),
    104: ("Google", ["library", "books", "study"]),
    78: ("MathWorks", ["lens", "camera", "eye"]),
    79: ("MathWorks", ["photography", "camera", "colors"]),
    80: ("MathWorks", ["street", "traffic", "city"]),
    81: ("MathWorks", ["aerial", "map", "pattern"]),
    82: ("MathWorks", ["lens", "camera", "photography"]),
    83: ("MathWorks", ["camera", "lens", "photography"]),
    84: ("MathWorks", ["colors", "paint", "photography"]),
    85: ("MathWorks", ["drone", "aerial", "machine"]),
    86: ("MathWorks", ["traffic", "street", "light"]),
    94: ("Python", ["code", "coding", "laptop"]),
    95: ("Python", ["laptop", "computer", "macbook"]),
    96: ("Python", ["colors", "pattern", "design"]),
    97: ("Python", ["wires", "cables", "computer"]),
    98: ("Python", ["cables", "wires", "map"]),
    99: ("Python", ["statistics", "screen", "laptop"]),
    100: ("Python", ["machine", "gears", "technology"]),
    101: ("Python", ["students", "study", "notebook"]),
    102: ("Python", ["design", "screen", "macbook"]),
    103: ("UC Davis", ["library", "books", "smartphone"]),
}
FALLBACK_SUBJECTS = ["work", "light", "desk", "coffee", "street", "stars", "pattern"]


# ── Commons ──────────────────────────────────────────────────────────────────

class Commons:
    def __init__(self, contact: str):
        ua = f"PraktoCourseThumbnails/1.0 ({contact}) httpx/{httpx.__version__}"
        self.client = httpx.Client(headers={"User-Agent": ua}, timeout=60, follow_redirects=True)
        self._photo_cache: dict[tuple[str, bool], list[dict]] = {}

    def _get(self, params: dict) -> dict:
        for attempt in range(4):
            r = self.client.get(COMMONS, params={"format": "json", "maxlag": 5, **params})
            if r.status_code == 200 and "error" not in r.json():
                time.sleep(0.3)  # be gentle: serial requests with a pause
                return r.json()
            time.sleep(5 * (attempt + 1))
        r.raise_for_status()
        raise RuntimeError(f"Commons API error: {r.text[:200]}")

    def photos(self, subject: str, unsplash_only: bool = True) -> list[dict]:
        """CC0/public-domain landscape photos whose title contains `subject`."""
        key = (subject, unsplash_only)
        if key in self._photo_cache:
            return self._photo_cache[key]
        search = " ".join(f"intitle:{w}" for w in subject.split())
        if unsplash_only:
            search += " intitle:unsplash"
        data = self._get({
            "action": "query", "generator": "search", "gsrsearch": f"{search} filetype:bitmap",
            "gsrnamespace": 6, "gsrlimit": 50, "prop": "imageinfo",
            "iiprop": "url|size|extmetadata", "iiurlwidth": 1600,
        })
        pages = sorted((data.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
        out = []
        for p in pages:
            ii = (p.get("imageinfo") or [{}])[0]
            meta = ii.get("extmetadata", {})
            lic = meta.get("LicenseShortName", {}).get("value", "")
            if lic not in ("CC0", "Public domain") or not ii.get("thumburl"):
                continue
            if ii["width"] < 1200 or ii["width"] / ii["height"] < 1.3:
                continue
            artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip()
            out.append({"title": p["title"], "url": ii["thumburl"], "page": ii["descriptionurl"],
                        "license": lic, "artist": artist})
        self._photo_cache[key] = out
        return out

    def logo_url(self, title: str) -> str:
        data = self._get({"action": "query", "titles": title, "prop": "imageinfo",
                          "iiprop": "url", "iiurlwidth": 1200})
        page = next(iter(data["query"]["pages"].values()))
        return page["imageinfo"][0]["thumburl"]

    def download(self, url: str) -> bytes:
        CACHE.mkdir(exist_ok=True)
        path = CACHE / hashlib.sha1(url.encode()).hexdigest()
        if path.is_file():
            return path.read_bytes()
        for attempt in range(4):
            r = self.client.get(url)
            if r.status_code == 200:
                path.write_bytes(r.content)
                time.sleep(0.3)
                return r.content
            time.sleep(5 * (attempt + 1))
        r.raise_for_status()
        return b""


# ── Composition ──────────────────────────────────────────────────────────────

def cover(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    scale = max(W / img.width, H / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left, top = (img.width - W) // 2, (img.height - H) // 2
    return img.crop((left, top, left + W, top + H))


def luminance(img: Image.Image, box: tuple[int, int, int, int]) -> float:
    return ImageStat.Stat(img.crop(box).convert("L")).mean[0] / 255


def radial_mask(cx: float, cy: float, rx: float, ry: float, strength: float) -> Image.Image:
    """An elliptical soft spot, `strength` at the centre fading to 0."""
    small = Image.new("L", (W // 8, H // 8), 0)
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            d = (((x * 8 - cx) / rx) ** 2 + ((y * 8 - cy) / ry) ** 2) ** 0.5
            px[x, y] = round(255 * strength * max(0.0, 1 - d) ** 1.6)
    return small.resize((W, H), Image.BILINEAR)


def white_logo(png: bytes, height: int, max_width: int) -> Image.Image:
    logo = Image.open(io.BytesIO(png)).convert("RGBA")
    logo = logo.crop(logo.getchannel("A").getbbox())
    scale = min(height / logo.height, max_width / logo.width)
    logo = logo.resize((round(logo.width * scale), round(logo.height * scale)), Image.LANCZOS)
    white = Image.new("RGBA", logo.size, (255, 255, 255, 255))
    white.putalpha(logo.getchannel("A"))
    return white


def compose(photo: bytes, prakto: Image.Image, company: str | None, logo_png: bytes | None) -> Image.Image:
    bg = cover(Image.open(io.BytesIO(photo))).filter(ImageFilter.GaussianBlur(12))

    # Keep the dark PRKTO logo readable on dark photos: a soft light halo
    # behind it, stronger the darker the centre is.
    centre = luminance(bg, (W // 4, H // 4, W * 3 // 4, H * 3 // 4))
    halo = min(0.6, max(0.0, (0.66 - centre) * 1.4))
    if halo > 0:
        bg = Image.composite(Image.new("RGB", (W, H), (246, 242, 236)), bg,
                             radial_mask(W / 2, H * 0.43, W * 0.42, H * 0.42, halo))

    canvas = bg.convert("RGBA")
    lw = round(W * 0.36)
    logo = prakto.resize((lw, round(prakto.height * lw / prakto.width)), Image.LANCZOS)
    canvas.alpha_composite(logo, ((W - lw) // 2, round(H * 0.43) - logo.height // 2))

    if company:
        # Keep the white "x <company>" readable on light photos.
        corner = luminance(bg, (W * 3 // 5, H * 3 // 4, W, H))
        shade = min(0.55, max(0.18, (corner - 0.35) * 1.2))
        shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        shadow.putalpha(radial_mask(W, H, W * 0.55, H * 0.42, shade))
        canvas.alpha_composite(shadow)

        draw = ImageDraw.Draw(canvas)
        font = ImageFont.truetype(SERIF, 60)
        right, baseline = W - round(W * 0.057), H - round(H * 0.08)
        if logo_png:
            mark = white_logo(logo_png, height=LOGO_HEIGHT.get(company, 48), max_width=310)
            mx = right - mark.width
            canvas.alpha_composite(mark, (mx, baseline - mark.height))
            xb = draw.textbbox((0, 0), "x", font=font, anchor="ls")
            draw.text((mx - 20 - (xb[2] - xb[0]), baseline - 2), "x", font=font, anchor="ls", fill="white")
        else:
            draw.text((right, baseline), f"x {company}", font=font, anchor="rs", fill="white")
    return canvas.convert("RGB")


# ── Main ─────────────────────────────────────────────────────────────────────

async def course_rows() -> dict[int, dict]:
    conn = await asyncpg.connect(DSN)
    try:
        rows = await conn.fetch(
            "SELECT c.id, c.name, c.course_uuid, c.thumbnail_image, o.org_uuid "
            "FROM course c JOIN organization o ON o.id = c.org_id")
    finally:
        await conn.close()
    return {r["id"]: dict(r) for r in rows}


async def install(results: list[tuple[dict, Path]]) -> None:
    conn = await asyncpg.connect(DSN)
    try:
        for course, jpg in results:
            name = f"{uuid.uuid4()}_thumbnail.jpg"
            target = (API_DIR / "content" / "orgs" / course["org_uuid"] / "courses"
                      / course["course_uuid"] / "thumbnails" / name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(jpg.read_bytes())
            await conn.execute(
                "UPDATE course SET thumbnail_image = $2, thumbnail_type = 'IMAGE' WHERE id = $1",
                course["id"], name)
    finally:
        await conn.close()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--contact", required=True, help="E-post eller webbadress till User-Agent (krav från Wikimedia).")
    p.add_argument("--prakto-logo", type=Path, required=True, help="PRKTO-loggan (PNG med transparens).")
    p.add_argument("--only", type=int, nargs="*", help="Bara dessa kurs-id.")
    p.add_argument("--apply", action="store_true", help="Installera bilderna som kursbilder.")
    args = p.parse_args()

    courses = asyncio.run(course_rows())
    missing = sorted(set(courses) - set(COURSES))
    if missing:
        print(f"Varning: kurser utan inställning hoppas över: {missing}")
    ids = [i for i in COURSES if i in courses and (not args.only or i in args.only)]

    commons = Commons(args.contact)
    prakto = Image.open(args.prakto_logo).convert("RGBA")
    logos = {name: commons.download(commons.logo_url(title)) for name, title in COMPANIES.items() if title}

    OUT.mkdir(exist_ok=True)
    used: set[str] = set()
    results, credits = [], []
    for n, cid in enumerate(ids, 1):
        company, subjects = COURSES[cid]
        photo, subject = None, ""
        attempts = ([(s, True) for s in subjects] + [(s, False) for s in subjects]
                    + [(s, True) for s in FALLBACK_SUBJECTS])
        for subject, unsplash_only in attempts:
            photo = next((c for c in commons.photos(subject, unsplash_only) if c["title"] not in used), None)
            if photo:
                break
        if not photo:
            print(f"[{n}/{len(ids)}] {courses[cid]['name']}: inget foto hittades")
            continue
        used.add(photo["title"])
        image = compose(commons.download(photo["url"]), prakto, company,
                        logos.get(company) if company else None)
        jpg = OUT / f"course_{cid}.jpg"
        image.save(jpg, quality=88, optimize=True, progressive=True)
        results.append((courses[cid], jpg))
        credits.append([str(cid), courses[cid]["name"], photo["title"][5:], photo["license"],
                        photo["artist"], photo["page"]])
        print(f"[{n}/{len(ids)}] {courses[cid]['name']}  ←  [{subject}] {photo['title'][5:]}", flush=True)

    with open(TOOL_DIR / "credits.tsv", "w", encoding="utf-8") as f:
        f.write("course_id\tcourse\tphoto\tlicense\tartist\tsource\n")
        f.writelines("\t".join(row) + "\n" for row in credits)

    if args.apply:
        asyncio.run(install(results))
        print(f"Installerade {len(results)} kursbilder.")
    else:
        print(f"Klart: {len(results)} bilder i {OUT}. Kör med --apply för att installera dem.")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
