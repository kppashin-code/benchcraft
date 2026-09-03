import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
TIMEOUT = 25
UA = "Benchcraft/0.1 (research notebook; local)"

SOURCE_LABEL = {
    "MED": "peer reviewed",
    "PMC": "peer reviewed",
    "AGR": "peer reviewed",
    "CBA": "peer reviewed",
    "PPR": "preprint",
    "PAT": "patent",
    "ETH": "thesis",
}


class LookupError_(RuntimeError):
    pass


def _opener() -> urllib.request.OpenerDirector:
    proxy = os.environ.get("BENCHCRAFT_PROXY", "").strip()
    handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy} if proxy else {})
    return urllib.request.build_opener(handler)


def build_query(text: str, include_preprints: bool, reviews_only: bool) -> str:
    q = text.strip()
    if not q:
        raise LookupError_("Nothing to search for.")
    parts = [f"({q})", "HAS_ABSTRACT:Y"]
    if reviews_only:
        parts.append('PUB_TYPE:"review"')
    if include_preprints:
        parts.append("(SRC:MED OR SRC:PMC OR SRC:PPR)")
    else:
        parts.append("(SRC:MED OR SRC:PMC)")
    return " AND ".join(parts)


def _fetch(query: str, limit: int) -> list[dict]:
    url = BASE + "?" + urllib.parse.urlencode({
        "query": query,
        "format": "json",
        "pageSize": str(min(max(limit, 1), 25)),
        "resultType": "core",
        "sort": "CITED desc",
    })
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with _opener().open(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raise LookupError_(f"Europe PMC returned {e.code}.")
    except Exception as e:
        raise LookupError_(f"Could not reach Europe PMC: {e}")

    out = []
    for r in data.get("resultList", {}).get("result", []):
        src = r.get("source", "")
        journal = (r.get("journalInfo") or {}).get("journal") or {}
        authors = [a.strip() for a in (r.get("authorString") or "").split(",") if a.strip()]
        out.append({
            "id": r.get("id", ""),
            "source": src,
            "kind": SOURCE_LABEL.get(src, src.lower() or "other"),
            "title": (r.get("title") or "").rstrip("."),
            "authors": authors[:3],
            "more_authors": max(0, len(authors) - 3),
            "journal": journal.get("title") or "",
            "year": r.get("pubYear", ""),
            "doi": r.get("doi", ""),
            "pmid": r.get("pmid", ""),
            "cited_by": r.get("citedByCount", 0),
            "open_access": r.get("isOpenAccess") == "Y",
            "abstract": (r.get("abstractText") or "")[:2000],
            "url": f"https://doi.org/{r['doi']}" if r.get("doi")
                   else f"https://europepmc.org/article/{src}/{r.get('id','')}",
        })
    return out


def _clauses(text: str) -> list[str]:
    parts, buf, depth = [], "", 0
    for chunk in re.split(r"(\s+AND\s+)", text, flags=re.IGNORECASE):
        if re.fullmatch(r"\s+AND\s+", chunk, flags=re.IGNORECASE) and depth == 0:
            parts.append(buf.strip())
            buf = ""
            continue
        depth += chunk.count("(") - chunk.count(")")
        buf += chunk
    if buf.strip():
        parts.append(buf.strip())
    return [p for p in parts if p]


def search(text: str, include_preprints: bool = False, reviews_only: bool = False,
           limit: int = 12) -> dict:
    terms = _clauses(text.strip())
    if not terms:
        raise LookupError_("Nothing to search for.")

    dropped: list[str] = []
    while True:
        attempt = " AND ".join(terms)
        results = _fetch(build_query(attempt, include_preprints, reviews_only), limit)
        if results or len(terms) <= 1:
            return {
                "results": results,
                "query_used": attempt,
                "dropped": dropped,
            }
        dropped.append(terms.pop())


def suggest_query(exp: dict, terms: list[str] | None = None) -> str:
    stop = {
        "does", "did", "what", "when", "which", "with", "from", "that", "this", "than",
        "only", "change", "changes", "survive", "residual", "fresh", "give", "gives",
        "affect", "affects", "using", "used", "there", "their", "about", "into", "have",
        "been", "will", "would", "could", "still", "more", "less", "same", "other",
        "first", "second", "again", "panel", "repeat", "baseline", "run", "lot",
    }
    generic = {"passage", "readout", "wells", "well", "batch", "arm", "arms", "day", "days"}

    def is_identifier(v: str) -> bool:
        return bool(re.search(r"\d", v)) and bool(re.search(r"[-_]|^p\d", v))

    picked: list[str] = []
    for t in sorted(terms or [], key=lambda x: -len(x.split())):
        if len(t) >= 4 and t.lower() not in generic and not is_identifier(t):
            picked.append(t)

    words = re.findall(r"[A-Za-z][A-Za-z-]{5,}", exp.get("question") or exp.get("title") or "")
    for w in words:
        if w.lower() not in stop and w.lower() not in generic:
            picked.append(w.lower())

    seen, out = set(), []
    for x in picked:
        k = x.lower()
        if k not in seen:
            seen.add(k)
            out.append(f'"{x}"' if " " in x else x)
    return " AND ".join(out[:3]) or exp.get("title", "")
