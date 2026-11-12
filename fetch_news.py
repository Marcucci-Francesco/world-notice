#!/usr/bin/env python3
"""
World Notice - raccoglitore notizie.

Legge countries.json e per ogni paese scarica i feed RSS di Google News:
  - paesi con edizione nazionale ("ceid"): prima pagina + sezioni
  - tutti gli altri ("q"): ricerca delle notizie che parlano di quel paese
Poi traduce i titoli in italiano e scrive:
  - site/data/news.json      riepilogo leggero (paesi, conteggi, vista Mondo)
  - site/data/c/XX.json      le notizie di ogni paese, caricate al tocco
Usa solo librerie già incluse in Python: nessuna installazione richiesta.

Uso:  python3 fetch_news.py
"""

import json
import os
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from xml.etree import ElementTree as ET

import analisi

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "site" / "data"
CACHE = ROOT / "cache" / "traduzioni.json"   # titoli già tradotti, riusati ogni ora
TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&tl=it&sl="
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) WorldNotice/1.0 (uso personale)"

# Sezioni di Google News -> categorie dell'app
#   top = In evidenza, pol = Politica & esteri, eco = Economia & tech, cro = Cronaca & gossip, spo = Sport
SECTIONS = {"NATION": "pol", "BUSINESS": "eco", "TECHNOLOGY": "eco", "ENTERTAINMENT": "cro", "SPORTS": "spo"}
CATS = ["top", "pol", "eco", "cro", "spo"]

MAX_PER_FEED = 12       # notizie tenute per ogni feed
MAX_PER_SEARCH = 20     # notizie tenute per i paesi "a ricerca"
MAX_AGE_HOURS = 24      # finestra temporale
MIN_ITEMS = 5           # se ne restano meno, allarghiamo a 48 ore
HOT_HOURS = 6           # "calore" sulla mappa = notizie delle ultime 6 ore
WORLD_PER_COUNTRY = 2   # quante notizie per paese nella vista Mondo
WORLD_MAX = 80
CHUNK_CHARS = 2000      # caratteri per richiesta di traduzione
TRANSLATE_PAUSE = 1.2   # secondi tra una richiesta di traduzione e l'altra
TRANSLATE_BUDGET = 900  # massimo 15 minuti di traduzioni per giro: il resto al giro dopo
WORKERS = 6

# Per i paesi "a ricerca" la categoria si indovina da parole chiave nel titolo inglese
KEYWORDS = {
    "pol": r"president|prime minister|minister|government|parliament|election|vote|voters|opposition|"
           r"party|senate|congress|war|military|army|troops|soldiers|attack|rebels?|militants?|ceasefire|"
           r"peace|sanctions?|diplomat\w*|embassy|talks|protests?|coup|junta|policy|treaty|nato|un\b|"
           r"united nations|border|refugees?|migrants?|missiles?|strikes?|conflict|king|queen|ruler|"
           r"sovereign\w*|independence|foreign",
    "eco": r"econom\w*|banks?|markets?|stocks?|inflation|gdp|trade|tariffs?|exports?|imports?|invest\w*|"
           r"oil|gas|mining|minerals?|compan(y|ies)|business|startups?|tech\w*|\bai\b|digital|budget|"
           r"debt|imf|world bank|currency|prices?|tourism|energy|jobs|growth|billion|million|loan|"
           r"infrastructure|airline|port|exports?",
    "cro": r"police|killed|dead|deaths?|murder\w*|arrest\w*|court|trial|sentenced|crash|accident|fire|"
           r"floods?|storm|earthquake|cyclone|hurricane|typhoon|celebrit\w*|stars?|singer|actor|actress|"
           r"film|movie|music|festival|concert|miss |beauty|wedding|royal|prince|princess|crime|"
           r"shooting|missing|rescue|tragedy|scandal",
    "spo": r"football|soccer|match|league|cup|olympic\w*|tennis|formula (1|one)|\bf1\b|grand prix|"
           r"basketball|nba|cricket|rugby|athlet\w*|marathon|boxing|boxer|coach|striker|goals?|"
           r"champions?|championship|tournament|fifa|uefa|equestrian|horse|jockey|cycling|golf|"
           r"volleyball|swimm\w*|medal|world cup|stadium|squad|players?",
}
KEYWORDS = {k: re.compile(r"\b(" + v + r")", re.I) for k, v in KEYWORDS.items()}


# ───────── Download e lettura dei feed ─────────

def edition_url(country, section=None):
    q = f"hl={country['hl']}&gl={country['code']}&ceid={country['ceid']}"
    if section is None:
        return f"https://news.google.com/rss?{q}"
    return f"https://news.google.com/rss/headlines/section/topic/{section}?{q}"


def search_url(country):
    q = urllib.parse.quote(f"{country['q']} when:2d")
    return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


def download(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read()
        except Exception as e:  # rete instabile o limite temporaneo: riprova
            if attempt == tries - 1:
                print(f"  ! errore su {url[:90]}: {e}")
                return None
            time.sleep(3 * (attempt + 1))


def parse(xml_bytes):
    """Restituisce una lista di notizie {t, s, u, d} nell'ordine del feed."""
    items = []
    if not xml_bytes:
        return items
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return items
    for it in root.iter("item"):
        title = unescape((it.findtext("title") or "").strip())
        link = (it.findtext("link") or "").strip()
        src_el = it.find("source")
        source = (src_el.text or "").strip() if src_el is not None else ""
        try:
            date = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except Exception:
            continue
        # Google aggiunge " - Testata" alla fine del titolo: lo togliamo
        if source and title.endswith(" - " + source):
            title = title[: -len(" - " + source)].strip()
        title = re.sub(r"\s+", " ", title)
        if title and link:
            items.append({"t": title, "s": source, "u": link, "d": date})
    return items


def recent(items, now, limit):
    fresh = [i for i in items if i["d"] >= now - timedelta(hours=MAX_AGE_HOURS)]
    if len(fresh) < MIN_ITEMS:
        fresh = [i for i in items if i["d"] >= now - timedelta(hours=48)]
    return fresh[:limit]


# ───────── Traduzione ─────────

def source_lang(country):
    if "q" in country:
        return "en"
    hl = country["hl"]
    return hl if hl.startswith("zh") else hl.split("-")[0]


class Throttled(Exception):
    """Google Traduttore ci chiede di rallentare troppo a lungo: si riprova al giro dopo."""


def translate_batch(titles, lang):
    """Traduce più titoli con una sola richiesta. None se qualcosa va storto."""
    body = urllib.parse.urlencode({"q": "\n".join(titles)}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(TRANSLATE_URL + lang, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
            text = "".join(seg[0] for seg in data[0] if seg and seg[0])
            lines = [l.strip() for l in text.split("\n")]
            return lines if len(lines) == len(titles) else None
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                if e.code == 429:
                    raise Throttled()
                print(f"  ! traduzione non riuscita ({lang}): {e}")
                return None
            wait = 20 * (attempt + 1)
            print(f"  … Google chiede di rallentare, aspetto {wait}s")
            time.sleep(wait)
        except Exception as e:
            if attempt == 3:
                print(f"  ! traduzione non riuscita ({lang}): {e}")
                return None
            time.sleep(3)


def translate_all(groups, cache):
    """groups = {lingua: [titoli]}. Traduce in sequenza quello che manca in cache."""
    started = time.time()
    chunks = []
    for lang, titles in groups.items():
        chunk, size = [], 0
        for t in dict.fromkeys(titles):
            if t in cache:
                continue
            if chunk and size + len(t) > CHUNK_CHARS:
                chunks.append((lang, chunk))
                chunk, size = [], 0
            chunk.append(t)
            size += len(t) + 1
        if chunk:
            chunks.append((lang, chunk))
    print(f"Traduco {sum(len(c) for _, c in chunks)} titoli nuovi in {len(chunks)} richieste…")
    for i, (lang, chunk) in enumerate(chunks):
        if time.time() - started > TRANSLATE_BUDGET:
            print(f"  Tempo finito: {len(chunks) - i} richieste rimandate al prossimo giro.")
            return
        try:
            result = translate_batch(chunk, lang)
        except Throttled:
            print(f"  Google Traduttore ci blocca per ora: {len(chunks) - i} richieste rimandate.")
            return
        if result:
            cache.update(zip(chunk, result))
        time.sleep(TRANSLATE_PAUSE)


# ───────── Raccolta per paese ─────────

def collect_country(country, now):
    news = {}   # chiave = titolo normalizzato, per togliere i doppioni

    def add(item, cats):
        key = re.sub(r"\W+", "", item["t"].lower())[:80]
        if key not in news:
            news[key] = {**item, "c": [], "o": len(news)}
        for cat in cats:
            if cat not in news[key]["c"]:
                news[key]["c"].append(cat)

    if "ceid" in country:
        jobs = [(None, "top")] + list(SECTIONS.items())
        for section, cat in jobs:
            for item in recent(parse(download(edition_url(country, section))), now, MAX_PER_FEED):
                add(item, [cat])
            time.sleep(0.3)
    else:
        for item in recent(parse(download(search_url(country))), now, MAX_PER_SEARCH):
            add(item, ["top"] + [cat for cat, rx in KEYWORDS.items() if rx.search(item["t"])])

    out = sorted(news.values(), key=lambda n: n["o"])
    for n in out:
        n["d"] = n["d"].strftime("%Y-%m-%dT%H:%M:%SZ")
        del n["o"]
    return out


def main():
    started = time.time()
    countries = json.loads((ROOT / "countries.json").read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)
    try:
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
    except Exception:
        cache = {}

    print(f"Raccolgo notizie per {len(countries)} paesi…")

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda c: collect_country(c, now), countries))

    total = sum(len(n) for n in results)
    if total == 0:
        raise SystemExit("Nessuna notizia scaricata: tengo i file precedenti.")
    print(f"Scaricate {total} notizie in {time.time() - started:.0f}s.")

    # Traduzione: titoli raggruppati per lingua, una richiesta alla volta
    groups = {}
    for c, news in zip(countries, results):
        lang = source_lang(c)
        if lang != "it":
            groups.setdefault(lang, []).extend(n["t"] for n in news)
    if os.environ.get("WN_NO_TRANSLATE"):
        print("Traduzione saltata (WN_NO_TRANSLATE).")
    else:
        translate_all(groups, cache)
    for c, news in zip(countries, results):
        if source_lang(c) != "it":
            for n in news:
                if cache.get(n["t"]):
                    n["it"] = cache[n["t"]]

    # File per paese
    tmp = DATA / "c.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    hot_cut = now - timedelta(hours=HOT_HOURS)
    fresh_cut = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    summary, world = [], {cat: [] for cat in CATS}
    for c, news in zip(countries, results):
        lang = "it" if source_lang(c) == "it" else ("en" if "q" in c else c["hl"])
        (tmp / f"{c['code']}.json").write_text(
            json.dumps({"lang": lang, "news": news}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8")
        counts, heat, fresh = {}, {}, {}
        for cat in CATS:
            items = [n for n in news if cat in n["c"]]
            counts[cat] = len(items)
            fresh[cat] = sum(1 for n in items if n["d"] >= fresh_cut)   # uscite nell'ultima ora
            heat[cat] = sum(1 for n in items if n["d"] >= hot_cut.strftime("%Y-%m-%dT%H:%M:%SZ"))
            # Vista Mondo: solo dalle edizioni nazionali (le loro prime pagine sono
            # ordinate per importanza); i paesi "a ricerca" si vedono toccandoli
            if "ceid" in c:
                for n in items[:WORLD_PER_COUNTRY]:
                    world[cat].append({**n, "k": c["code"]})
        summary.append({
            "code": c["code"], "id": c["id"], "name": c["name"], "flag": c["flag"], "lang": lang,
            "mode": "ed" if "ceid" in c else "q", "n": counts, "h": heat, "f": fresh,
        })
    for cat in CATS:
        world[cat] = sorted(world[cat], key=lambda n: n["d"], reverse=True)[:WORLD_MAX]

    # Collegamenti tra paesi, tendenze e indice per la ricerca
    langs = [s["lang"] for s in summary]
    links = analisi.links(countries, results, langs)
    trends = analisi.trends(countries, results, langs, now)
    (tmp / "search.json").write_text(
        json.dumps(analisi.search_index(countries, results, langs), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")

    # Sostituisce i vecchi file solo a lavoro finito
    shutil.rmtree(DATA / "c", ignore_errors=True)
    tmp.rename(DATA / "c")
    (DATA / "news.json").write_text(json.dumps({
        "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "countries": summary,
        "world": world,
        "links": links,
        "trends": trends,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # In cache teniamo solo i titoli ancora in uso, così il file non cresce all'infinito
    used = {n["t"] for news in results for n in news}
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({k: v for k, v in cache.items() if k in used}, ensure_ascii=False),
                     encoding="utf-8")

    translated = sum(1 for news in results for n in news if "it" in n)
    empty = [c["name"] for c, n in zip(countries, results) if not n]
    print(f"Fatto in {time.time() - started:.0f}s: {total} notizie, {translated} tradotte.")
    print(f"Collegamenti tra paesi: {len(links)} · Tendenze: {', '.join(t['t'] for t in trends[:8])}")
    if empty:
        print(f"Paesi senza notizie ({len(empty)}): {', '.join(empty)}")


if __name__ == "__main__":
    main()
