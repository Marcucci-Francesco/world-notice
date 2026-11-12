"""
World Notice - analisi delle notizie raccolte.

Usato da fetch_news.py. Prepara:
  - links()   i collegamenti tra paesi ("una notizia del paese A parla del paese B")
  - trends()  gli argomenti più citati nel mondo nelle ultime ore
  - search_index()  l'elenco compatto di tutte le notizie, per la ricerca nell'app
Lavora solo sui titoli in italiano (tradotti o già italiani).
"""

import re
from collections import Counter, defaultdict
from datetime import timedelta

GN_PREFIX = "https://news.google.com/rss/articles/"

# Nomi, aggettivi, capitali e leader con cui i giornali citano un paese (oltre al nome italiano)
ALIASES = {
    "US": [r"Usa", r"Stati Uniti", r"american[oaie]", r"Washington", r"Casa Bianca", r"Trump", r"Pentagono"],
    "GB": [r"Regno Unito", r"Gran Bretagna", r"Londra", r"britannic[oaih]e?", r"Starmer", r"Downing Street"],
    "RU": [r"russ[oaie]", r"Mosca", r"Cremlino", r"Putin"],
    "UA": [r"ucrain[oaie]", r"Kiev", r"Kyiv", r"Zelensky", r"Zelenskyj"],
    "CN": [r"cines[ei]", r"Pechino", r"Xi Jinping"],
    "IL": [r"israelian[oaie]", r"Gerusalemme", r"Tel Aviv", r"Netanyahu"],
    "PS": [r"Gaza", r"palestines[ei]", r"Cisgiordania", r"Hamas"],
    "IR": [r"iranian[oaie]", r"Teheran"],
    "FR": [r"frances[ei]", r"Parigi", r"Macron", r"Eliseo"],
    "DE": [r"tedesc[oaih]e?", r"Berlino", r"Merz"],
    "IT": [r"italian[oaie]", r"Meloni", r"Palazzo Chigi"],
    "ES": [r"spagnol[oaie]", r"Madrid"],
    "JP": [r"giappones[ei]", r"Tokyo"],
    "IN": [r"indian[oaie]", r"Nuova Delhi", r"Modi"],
    "TR": [r"turc[oaih]e?", r"Ankara", r"Erdogan", r"Erdoğan"],
    "VE": [r"venezuelan[oaie]", r"Caracas", r"Maduro"],
    "KP": [r"nordcorean[oaie]", r"Pyongyang", r"Kim Jong"],
    "KR": [r"sudcorean[oaie]", r"Seul"],
    "SY": [r"sirian[oaie]", r"Damasco"],
    "LB": [r"libanes[ei]", r"Beirut", r"Hezbollah"],
    "SA": [r"saudit[aie]", r"Riad"],
    "EG": [r"egizian[oaie]", r"Il Cairo"],
    "QA": [r"Doha"],
    "AE": [r"Emirati", r"Abu Dhabi", r"Dubai"],
    "BR": [r"brasilian[oaie]", r"Lula"],
    "AR": [r"argentin[oaie]", r"Milei", r"Buenos Aires"],
    "MX": [r"messican[oaie]", r"Città del Messico"],
    "CU": [r"cuban[oaie]", r"L'Avana"],
    "VA": [r"Santa Sede", r"Papa Leone", r"pontefice"],
    "PL": [r"polacc[oaih]e?", r"Varsavia"],
    "HU": [r"ungheres[ei]", r"Budapest", r"Orb[aá]n"],
    "GR": [r"grec[oaih]e?", r"Atene"],
    "CA": [r"canades[ei]", r"Ottawa"],
    "AU": [r"australian[oaie]", r"Canberra"],
    "TW": [r"taiwanes[ei]", r"Taipei"],
    "IQ": [r"iachen[oaie]", r"Baghdad"],
    "AF": [r"afghan[oiea]", r"Kabul", r"talebani"],
    "PK": [r"pakistan[oiea]", r"Islamabad"],
    "NG": [r"nigerian[oaie]", r"Abuja"],
    "ZA": [r"sudafrican[oaie]", r"Pretoria", r"Johannesburg"],
}

# Parole che iniziano con la maiuscola ma non sono "argomenti" (articoli, mesi, parole da titolo…)
STOP = set("""
il lo la i gli le un una uno di da in con su per tra fra e ed ma o se che chi come dove quando perché perche
anche non più piu ecco oggi ieri domani dopo prima nel nella nello nei negli nelle del della dello dei degli
delle al alla allo ai agli alle sul sulla sullo sui sugli sulle dal dalla dallo dai dagli dalle questo questa
questi queste quello quella quei quelle ultime ultima ultimo notizie notizia video foto diretta live news
breaking ultim'ora ultimora aggiornamento aggiornamenti lunedì martedì mercoledì giovedì venerdì sabato domenica
gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre nuovo nuova nuovi
nuove tutto tutti tutta tutte ora così cosi cosa già gia sì si no mondo anni anno ex mr sig dott cos tanti molti
ecco quali quale qual quanto quanti sono è era stato stata essere ha hanno ho abbiamo dice dicono secondo
via contro sotto sopra senza verso fino dentro fuori mentre però pero poi ancora sempre mai solo già ad ai
grande grandi primo prima primi seconda secondo terzo due tre quattro cinque dieci cento mille milioni miliardi
gruppo presidente governo polizia ministro ministero premier stato stati città paese paesi capitale nazionale
nazionali internazionale tribunale corte parlamento partito esercito ufficiale ufficiali uomo donna donne uomini
bambini famiglia caso casa giorno giorni settimana mese ore minuti euro dollari dollaro sud nord est ovest
centro storia guerra pace accordo crisi legge piano progetto programma rapporto attacco morti vittime
the of and to for on at by with from an a is are
""".split())

WORD = r"[A-ZÀ-ÖØ-Ý][\wÀ-ÿ'’\-]+"


def italian_text(n, lang):
    """Il titolo in italiano, se c'è (tradotto o già italiano)."""
    if n.get("it"):
        return n["it"]
    if lang == "it":
        return n["t"]
    return None


def build_matchers(countries):
    matchers = {}
    for c in countries:
        pats = [re.escape(c["name"])] + ALIASES.get(c["code"], [])
        matchers[c["code"]] = re.compile(r"(?<![\wÀ-ÿ])(" + "|".join(pats) + r")(?![\wÀ-ÿ])")
    return matchers


def links(countries, results, langs, max_links=45):
    """Coppie (paese che scrive, paese di cui si parla) con conteggio e un titolo d'esempio."""
    matchers = build_matchers(countries)
    pairs = Counter()
    sample = {}
    # Lo stesso articolo ripreso da 3+ paesi è un'agenzia o un giornale straniero ripubblicato: non conta
    spread = Counter()
    for c, news in zip(countries, results):
        if "ceid" in c:
            for t in {n["t"] for n in news}:
                spread[t] += 1
    for c, news, lang in zip(countries, results, langs):
        if "ceid" not in c:          # solo i giornali nazionali: le ricerche internazionali confondono
            continue
        own = matchers[c["code"]]
        for n in news:
            if spread[n["t"]] >= 3:
                continue
            text = italian_text(n, lang)
            if not text:
                continue
            text = own.sub(" ", text)   # "Papua Nuova Guinea" non deve contare come "Guinea"
            for code, rx in matchers.items():
                if code != c["code"] and rx.search(text):
                    key = (c["code"], code)
                    pairs[key] += 1
                    if key not in sample or n["d"] > sample[key]["d"]:
                        sample[key] = n
    out = []
    for (a, b), cnt in pairs.most_common(max_links):
        if cnt < 2:
            break
        s = sample[(a, b)]
        out.append({"a": a, "b": b, "n": cnt, "t": s.get("it") or s["t"]})
    return out


def trends(countries, results, langs, now, hours=6, top=14):
    """Argomenti più citati: nomi propri presenti nei titoli di più paesi diversi."""
    cut = (now - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    where = defaultdict(set)      # argomento -> paesi che ne parlano
    count = Counter()
    matchers = build_matchers(countries)
    for c, news, lang in zip(countries, results, langs):
        if "ceid" not in c:
            continue
        for n in news:
            if n["d"] < cut:
                continue
            text = italian_text(n, lang)
            if not text:
                continue
            for rx in matchers.values():          # i paesi si vedono già sul globo: non sono "tendenze"
                text = rx.sub(" | ", text)
            text = re.sub(r"\b[LDdl]'|\b[LDdl]’|\b(Dell|Nell|Sull|All|Dall)['’]", " ", text)
            seen = set()
            for m in re.finditer(r"(?:" + WORD + r")(?:\s+" + WORD + r"){0,2}", text):
                words = [w for w in m.group(0).split() if w.lower().strip("'’") not in STOP]
                if not words:
                    continue
                term = " ".join(words)
                if len(term) < 3 or term.isupper() and len(term) > 5:
                    continue
                if term not in seen:
                    seen.add(term)
                    where[term].add(c["code"])
                    count[term] += 1
    ranked = sorted(where, key=lambda t: (len(where[t]), count[t]), reverse=True)
    return [{"t": t, "p": len(where[t]), "n": count[t]} for t in ranked[:top] if len(where[t]) >= 2]


def search_index(countries, results, langs):
    """Tutte le notizie in forma compatta: [paese, titolo, originale, fonte, link, data, categorie]."""
    rows = []
    for c, news, lang in zip(countries, results, langs):
        for n in news:
            u = n["u"]
            if u.startswith(GN_PREFIX):
                u = "~" + u[len(GN_PREFIX):].replace("?oc=5", "")
            title = n.get("it") or n["t"]
            orig = n["t"] if n.get("it") else ""
            rows.append([c["code"], title, orig, n.get("s", ""), u, n["d"][5:16], ",".join(n["c"])])
    return rows
