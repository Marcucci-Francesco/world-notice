# World Notice

App personale: le notizie principali di 204 paesi su una mappa interattiva, aggiornate ogni ora.

## Com'è fatta

| File | Cosa fa |
|---|---|
| `countries.json` | Elenco dei paesi: con `ceid` = edizione nazionale, con `q` = ricerca nella stampa internazionale |
| `fetch_news.py` | Scarica e traduce le notizie: riepilogo in `site/data/news.json`, un file per paese in `site/data/c/` |
| `site/` | L'app vera e propria: `index.html`, `style.css`, `app.js` |
| `.github/workflows/aggiorna-notizie.yml` | Dice a GitHub di aggiornare le notizie ogni ora e ripubblicare il sito |

**Categorie:** In evidenza · Politica & Esteri · Economia & Tech · Cronaca & Gossip · Sport
**Preferiti:** apri un paese e tocca la stella. Il pulsante "Preferiti" mostra insieme le notizie dei tuoi paesi, e l'app si apre lì. Sono salvati sul dispositivo: Mac e telefono hanno ciascuno i propri.
**Globo 3D:** Terra con foto satellitare NASA, giorno e notte in tempo reale con le luci delle città, archi animati tra i paesi che parlano l'uno dell'altro.
**Cerca:** trova un paese oppure una parola in tutte le notizie del mondo. Ci sono anche le tendenze del momento.
**Tour:** il globo vola da solo sulle 10 notizie di politica uscite più di recente in Europa e negli Stati Uniti, una per paese, dalla più nuova. Per cambiare i paesi o la categoria modifica `TOUR_COUNTRIES` e `TOUR_CAT` in `site/app.js`. Su computer c'è il formato 9:16 per registrare un Reel. Esc per uscire.
**Fonte:** feed RSS di Google News. 72 paesi hanno un'edizione nazionale (prime pagine dei giornali locali). Per gli altri 132 si cercano le notizie che parlano di quel paese nella stampa internazionale, e la categoria si indovina dalle parole del titolo. Uso consentito solo personale e non commerciale.
**Traduzione:** gratuita, con Google Traduttore. I titoli vengono tradotti una richiesta alla volta e salvati in `cache/`, così ogni ora si traducono solo quelli nuovi. Se Google rallenta, il resto passa al giro dopo e nell'app compare il pulsante "Traduci". Il pulsante "Originale" mostra il titolo nella lingua del giornale.
Per scaricare le notizie senza tradurre: `WN_NO_TRANSLATE=1 python3 fetch_news.py`

## Provarla sul Mac

```bash
cd progetti/world-notice
python3 fetch_news.py
python3 -m http.server 8765 --directory site
```

Poi apri http://localhost:8765

## Metterla online (GitHub Pages)

1. Su github.com crea un repository nuovo chiamato `world-notice`, **pubblico** (su un account gratuito le Pages funzionano solo con repository pubblici; il codice non contiene dati personali).
2. Carica dentro il contenuto di questa cartella, **tranne** `HANDOFF.md`, `cache/` e `site/data/` (note di lavoro e dati generati: restano sul Mac).
3. Nel repository vai su **Settings → Pages** e in "Source" scegli **GitHub Actions**.
4. Vai su **Actions → Aggiorna notizie → Run workflow** per la prima pubblicazione.
5. Dopo circa un minuto il sito è su `https://TUO-NOME.github.io/world-notice/`.

Da lì in poi si aggiorna da solo ogni ora.

**Sul telefono:** apri l'indirizzo in Safari → Condividi → "Aggiungi alla schermata Home". Si apre a schermo intero come un'app.

**Attenzione:** se per 60 giorni non tocchi il repository, GitHub mette in pausa l'aggiornamento automatico e ti manda un'email. Basta cliccare per riattivarlo.
