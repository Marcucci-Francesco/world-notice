/* World Notice · mappa + pannello notizie */
(() => {
  "use strict";

  const CATS = [
    { id: "top", label: "In evidenza", short: "Evidenza" },
    { id: "pol", label: "Politica & Esteri", short: "Politica" },
    { id: "eco", label: "Economia & Tech", short: "Economia" },
    { id: "cro", label: "Cronaca & Gossip", short: "Gossip" },
    { id: "spo", label: "Sport", short: "Sport" },
  ];
  const FAV = "FAV";   // "paese" speciale: la vista dei preferiti
  const SEARCH = "Q";  // "paese" speciale: i risultati di una ricerca
  const GN_PREFIX = "https://news.google.com/rss/articles/";
  const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
  const REFRESH_MS = 10 * 60 * 1000;

  const $ = (s) => document.querySelector(s);
  const mobile = () => window.matchMedia("(max-width: 760px)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  const state = {
    data: null,
    cat: CATS.some((c) => c.id === store.get("wn-cat")) ? store.get("wn-cat") : "top",
    sel: null,
  };
  const byCode = new Map();
  const byId = new Map();
  const details = new Map();   // notizie complete per paese, scaricate al tocco

  // Preferiti: salvati su questo dispositivo
  const favs = new Set((() => { try { return JSON.parse(store.get("wn-fav") || "[]"); } catch { return []; } })());
  function toggleFav(code) {
    if (favs.has(code)) favs.delete(code); else favs.add(code);
    store.set("wn-fav", JSON.stringify([...favs]));
    toast(favs.has(code) ? "Aggiunto ai preferiti" : "Tolto dai preferiti");
    styleCountry(code); paint(); renderPanel();
  }
  const favList = () => [...favs].filter((c) => byCode.has(c));

  const toastEl = document.getElementById("toast");
  let toastT;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.hidden = true; }, 1800);
  }

  /* ───────── Tempo ───────── */
  const rtf = new Intl.RelativeTimeFormat("it", { numeric: "auto", style: "short" });
  function ago(iso) {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return "adesso";
    if (min < 60) return rtf.format(-min, "minute");
    const h = Math.round(min / 60);
    if (h < 24) return rtf.format(-h, "hour");
    return rtf.format(-Math.round(h / 24), "day");
  }
  const nNews = (n) => `${n} ${n === 1 ? "notizia" : "notizie"}`;
  const isNew = (iso) => Date.now() - Date.parse(iso) < 60 * 60 * 1000;

  /* ───────── Dati ───────── */
  async function loadData() {
    const r = await fetch("data/news.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("news.json " + r.status);
    state.data = await r.json();
    byCode.clear(); byId.clear(); details.clear();
    for (const c of state.data.countries) { byCode.set(c.code, c); byId.set(c.id, c); }
    const up = new Date(state.data.updated);
    const el = $("#updated");
    el.textContent = "Aggiornato alle " + up.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    el.classList.toggle("stale", Date.now() - up > 3 * 3600 * 1000);
  }

  const heatOf = (c) => c.h[state.cat] || 0;
  const countOf = (c) => c.n[state.cat] || 0;

  async function loadCountry(code) {
    if (details.has(code)) return details.get(code);
    const r = await fetch(`data/c/${code}.json?t=${state.data.updated}`);
    if (!r.ok) throw new Error(code + " " + r.status);
    const d = await r.json();
    details.set(code, d);
    return d;
  }

  /* ───────── Globo 3D ───────── */
  const IMG = "https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/";
  const START_VIEW = { lat: 28, lng: 12, altitude: 2.7 };
  const startAltitude = () => (mobile() ? 4.1 : START_VIEW.altitude);
  const BASE = 0.004;         // poligoni appena sopra la superficie, invisibili
  const MIN_PART = 4e-6;      // isole più piccole di ~150 km² non diventano poligoni (alleggerisce)
  let globe = null;
  let features = [];
  let parts = [];             // un poligono per ogni pezzo di paese (isole comprese)
  let hover = null;
  let invisible = null;       // materiale trasparente per i paesi "a terra"

  // Per paesi con territori lontani (Francia, USA…) usiamo la parte principale
  function mainPart(f) {
    if (f.geometry.type !== "MultiPolygon") return f;
    let best = null, area = -1;
    for (const coords of f.geometry.coordinates) {
      const p = { type: "Polygon", coordinates: coords };
      const a = d3.geoArea(p);
      if (a > area) { area = a; best = p; }
    }
    return { type: "Feature", geometry: best };
  }

  function buildParts() {
    parts = [];
    for (const f of features) {
      const c = byId.get(f.id);
      if (!c) continue;
      const main = mainPart(f);
      const [lng, lat] = d3.geoCentroid(main);
      const [[x0, y0], [x1, y1]] = d3.geoBounds(main);
      c._ll = { lat, lng, size: Math.max(Math.abs(x1 - x0) % 360, Math.abs(y1 - y0)) };
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach((coords, i) => {
        const geometry = { type: "Polygon", coordinates: coords };
        if (polys.length > 1 && geometry !== main.geometry && coords !== main.geometry.coordinates && d3.geoArea(geometry) < MIN_PART) return;
        parts.push({ code: c.code, key: `${c.code}-${i}`, geometry });
      });
    }
  }

  const noHover = () => window.matchMedia("(hover: none)").matches || mobile();
  const isUp = (code) => code === hover || code === state.sel
    || (state.sel === FAV && favs.has(code))
    || (state.sel === SEARCH && searchCodes.has(code));

  /* Evidenziazione diretta: si toccano solo i pezzi del paese interessato,
     non i 950 pezzi di tutto il mondo (ridisegnarli tutti richiedeva ~2 secondi) */
  const partObjs = new Map();   // codice paese -> oggetti 3D dei suoi pezzi
  let veilSel = null, veilHover = null;   // velature bianche: paese scelto / sotto il mouse
  const STROKE = { normal: [0xffffff, 0.13], up: [0xffffff, 0.9], fav: [0xff9f0a, 0.9] };

  function objsOf(code) {
    if (!partObjs.size) {
      globe.scene().traverse((o) => {
        if (o.__globeObjType === "polygon" && o.__data && o.__data.data) {
          const k = o.__data.data.code;
          if (!partObjs.has(k)) partObjs.set(k, []);
          partObjs.get(k).push(o);
        }
      });
    }
    return partObjs.get(code) || [];
  }

  // Velatura bianca sul paese scelto o sotto il mouse: nessun sollevamento
  function styleCountry(code) {
    if (!globe || !code || code === FAV) return;
    const up = isUp(code);
    const veil = code === hover && code !== state.sel ? veilHover : veilSel;
    const [col, op] = up ? STROKE.up : favs.has(code) ? STROKE.fav : STROKE.normal;
    for (const o of objsOf(code)) {
      const [conic, stroke] = o.children;
      conic.material[1] = up ? veil : invisible;
      stroke.material.color.setHex(col);
      stroke.material.opacity = op;
      stroke.material.transparent = op < 1;
    }
  }

  // Prepara in anticipo i materiali, così la prima selezione non ha scatti
  function prewarm() {
    const o = objsOf(parts[0] && parts[0].code)[0];
    if (!o) return;
    const conic = o.children[0];
    const tmp = new conic.constructor(conic.geometry, [veilSel, veilHover]);
    tmp.scale.setScalar(1e-4);
    o.parent.add(tmp);
    globe.renderer().compile(globe.scene(), globe.camera());
    o.parent.remove(tmp);
  }

  /* Scelta del paese sotto il dito o il mouse.
     Invece di far controllare alla libreria tutti i 950 pezzi 3D (lentissimo),
     chiediamo le coordinate del punto toccato e cerchiamo il paese che le contiene. */
  let boxes = [];
  function buildBoxes() {
    boxes = features.filter((f) => byId.has(f.id)).map((f) => {
      const [[x0, y0], [x1, y1]] = d3.geoBounds(f);
      return { f, code: byId.get(f.id).code, x0, y0, x1, y1 };
    });
  }
  function countryAt(clientX, clientY) {
    const rect = globeEl.getBoundingClientRect();
    const ll = globe.toGlobeCoords(clientX - rect.left, clientY - rect.top);
    if (!ll) return null;
    const { lat, lng } = ll;
    for (const b of boxes) {
      if (lat < b.y0 || lat > b.y1) continue;
      const inLng = b.x0 <= b.x1 ? lng >= b.x0 && lng <= b.x1 : lng >= b.x0 || lng <= b.x1;
      if (inLng && d3.geoContains(b.f, [lng, lat])) return b.code;
    }
    return null;
  }

  function setHover(code) {
    if (code === hover) return;
    const prev = hover;
    hover = code;
    styleCountry(prev);
    styleCountry(code);
    if (code) loadCountry(code).catch(() => {});   // le notizie si preparano già al passaggio
    globeEl.style.cursor = code ? "pointer" : "grab";
    paint();
  }

  function bindPointer() {
    let down = null, pending = null;
    globeEl.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; }, { passive: true });
    globeEl.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return;                 // era un trascinamento del globo, non un clic
      const code = countryAt(e.clientX, e.clientY);
      if (code) select(code);
    }, { passive: true });
    globeEl.addEventListener("pointermove", (e) => {
      if (noHover() || down) return;
      if (pending) return;                   // al massimo un controllo per fotogramma
      pending = requestAnimationFrame(() => {
        pending = null;
        setHover(countryAt(e.clientX, e.clientY));
      });
    }, { passive: true });
    globeEl.addEventListener("pointerleave", () => setHover(null), { passive: true });
  }

  function viewOffset() {
    if (!globe) return;
    const h = window.innerHeight;
    let dx = 0, dy = 0;
    if (document.body.classList.contains("touring")) {
      // Tour: globo al centro
    } else if (mobile()) {
      const top = $("#sheet").getBoundingClientRect().top;
      dy = Math.max(0, (h - top) / 2 - 40);
    } else {
      dx = ($("#sheet").offsetWidth + 16) / 2;
    }
    // La libreria applica le sue impostazioni con un attimo di ritardo: spostiamo la vista subito dopo
    setTimeout(() => {
      const cam = globe.camera();
      const w = globe.width();
      cam.setViewOffset(w, h, dx, dy, w, h);
      cam.updateProjectionMatrix();
    }, 80);
  }

  function layout() {
    if (!globe) return;
    globe.width(window.innerWidth).height(window.innerHeight);
    viewOffset();
  }

  // Riquadro fisso con bandiera e nome: sempre nello stesso punto, mai sopra il terreno
  function updateBadge() {
    const code = hover || (state.sel !== FAV ? state.sel : null);
    const c = code && byCode.get(code);
    const badge = $("#badge");
    if (!c) { badge.hidden = true; return; }
    $("#b-flag").textContent = c.flag;
    $("#b-name").textContent = c.name;
    const label = CATS.find((x) => x.id === state.cat).label;
    $("#b-sub").textContent = code === state.sel ? `${nNews(countOf(c))} · ${label}` : `${nNews(countOf(c))} · tocca per aprire`;
    badge.classList.toggle("is-selected", code === state.sel);
    badge.hidden = false;
  }

  // Anelli: azzurri sui paesi con più notizie recenti, bianco sul paese scelto
  function paint() {
    if (!globe || !state.data) return;
    const hottest = [...state.data.countries]
      .filter((c) => c._ll && heatOf(c) > 0)
      .sort((a, b) => heatOf(b) - heatOf(a))
      .slice(0, 15);
    const max = Math.max(1, ...hottest.map(heatOf));
    const rings = hottest.map((c) => ({ lat: c._ll.lat, lng: c._ll.lng, r: 1.2 + 2.8 * Math.sqrt(heatOf(c) / max) }));
    for (const code of new Set([state.sel, hover])) {
      const c = code && byCode.get(code);
      if (c && c._ll) rings.push({ lat: c._ll.lat, lng: c._ll.lng, r: 3.5, sel: true });
    }
    globe.ringsData(rings);
    updateBadge();
  }

  function initGlobe() {
    globe = Globe({ animateIn: true })(document.getElementById("globe"));
    // Materiali: invisibile per i paesi a terra (resta la foto della Terra), roccia per i lati
    const Mat = globe.globeMaterial().constructor;
    invisible = new Mat({ transparent: true, opacity: 0, depthWrite: false });
    veilSel = new Mat({ color: 0xffffff, emissive: 0x9aa3ad, transparent: true, opacity: 0.62, depthWrite: false, shininess: 0 });
    veilHover = new Mat({ color: 0xffffff, emissive: 0x7d858f, transparent: true, opacity: 0.4, depthWrite: false, shininess: 0 });
    globe
      .globeImageUrl(IMG + "earth-blue-marble.jpg")
      .bumpImageUrl(IMG + "earth-topology.png")
      .backgroundImageUrl(IMG + "night-sky.png")
      .showAtmosphere(true)
      .atmosphereColor("#7cc4ff")
      .atmosphereAltitude(0.18)
      .polygonsData(parts)
      .polygonGeoJsonGeometry("geometry")
      .polygonsTransitionDuration(0)
      .polygonAltitude(BASE)
      .polygonCapMaterial(() => invisible)
      .polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor((p) => (favs.has(p.code) ? "rgba(255,159,10,0.9)" : "rgba(255,255,255,0.13)"))
      .enablePointerInteraction(false)   // i clic li gestiamo noi (molto più veloce)
      .ringColor((d) => (t) => d.sel
        ? `rgba(255, 255, 255, ${Math.max(0, 1 - t).toFixed(3)})`
        : `rgba(120, 190, 255, ${Math.max(0, 1 - t).toFixed(3)})`)
      .ringMaxRadius("r")
      .ringPropagationSpeed((d) => (d.sel ? 3 : 1.6))
      .ringRepeatPeriod((d) => (d.sel ? 700 : 1400))
      .ringAltitude(0.006)
      .arcColor(() => ["rgba(255, 196, 110, 0.08)", "rgba(255, 196, 110, 0.95)"])
      .arcStroke("w")
      .arcAltitudeAutoScale(0.38)
      .arcDashLength(0.45)
      .arcDashGap(0.2)
      .arcDashInitialGap(() => Math.random())
      .arcDashAnimateTime(2600)
      .arcsTransitionDuration(0)
      .onGlobeReady(() => { paint(); updateLayers(); viewOffset(); setTimeout(prewarm, 300); setTimeout(setupDayNight, 200); });
    buildBoxes();
    bindPointer();

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    controls.minDistance = 130;
    controls.maxDistance = 700;
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    globe.pointOfView({ ...START_VIEW, altitude: startAltitude() });
    window.__wnGlobe = globe;   // utile per controlli dalla console
    layout();
    paint();
  }

  function zoomToCountry(code) {
    const c = byCode.get(code);
    if (!globe || !c || !c._ll) return;
    globe.controls().autoRotate = false;
    const altitude = Math.max(0.9, Math.min(2.2, 0.5 + c._ll.size / 40)) * (mobile() ? 1.4 : 1);
    globe.pointOfView({ lat: c._ll.lat - (mobile() ? 0 : 4), lng: c._ll.lng, altitude }, 650);
  }

  function resetZoom() {
    if (!globe) return;
    const pov = globe.pointOfView();
    globe.pointOfView({ lat: START_VIEW.lat, lng: pov.lng, altitude: startAltitude() }, 650);
    setTimeout(() => { if (!state.sel || state.sel === FAV) globe.controls().autoRotate = true; }, 700);
  }

  function zoomBy(f) {
    if (!globe) return;
    const pov = globe.pointOfView();
    globe.pointOfView({ ...pov, altitude: Math.max(0.35, Math.min(4, pov.altitude * f)) }, 350);
  }

  const globeEl = document.getElementById("globe");
  function hideTip() {}

  /* ───────── Giorno e notte in tempo reale ───────── */
  let sunUniform = null, sunWorld = null;

  // Punto della Terra dove il sole è a picco in questo momento
  function sunPosition(date = new Date()) {
    const day = (date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5;
    const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10));
    const b = (2 * Math.PI / 364) * (day - 81);
    const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);   // minuti
    const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const lng = -15 * (hours - 12 + eot / 60);
    return { lat: decl, lng: ((lng + 540) % 360) - 180 };
  }

  function updateSun() {
    if (!sunUniform) return;
    const p = sunPosition();
    const c = globe.getCoords(p.lat, p.lng, 0);
    sunWorld.set(c.x, c.y, c.z).normalize();
  }

  // Sul lato al buio compaiono le luci delle città (foto notturna NASA)
  function setupDayNight() {
    const mat = globe.globeMaterial();
    if (!mat.map || sunUniform) return;
    const Vec3 = globe.camera().position.constructor;
    sunWorld = new Vec3(1, 0, 0);
    sunUniform = { value: new Vec3(1, 0, 0) };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const night = new mat.map.constructor(img);
      night.colorSpace = mat.map.colorSpace;
      night.needsUpdate = true;
      const nightUniform = { value: night };
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer) => {
        prev && prev.call(mat, shader, renderer);
        shader.uniforms.uSunView = sunUniform;
        shader.uniforms.uNight = nightUniform;
        shader.fragmentShader = shader.fragmentShader
          .replace("void main() {", "uniform vec3 uSunView;\nuniform sampler2D uNight;\nvoid main() {")
          .replace("#include <opaque_fragment>", `
            float sunDot = dot(normalize(vNormal), uSunView);
            float dayF = smoothstep(-0.2, 0.18, sunDot);
            vec3 cityLights = texture2D(uNight, vMapUv).rgb;
            cityLights = pow(cityLights, vec3(1.25)) * vec3(1.9, 1.5, 1.0) * 2.6;
            vec3 nightLand = outgoingLight * vec3(0.42, 0.47, 0.6);   // terreno visibile, con una tinta notturna blu
            outgoingLight = mix(nightLand + cityLights, outgoingLight, dayF);
            #include <opaque_fragment>`);
      };
      mat.customProgramCacheKey = () => "wn-daynight";
      mat.needsUpdate = true;
      updateSun();
      setInterval(updateSun, 60 * 1000);
      (function follow() {
        sunUniform.value.copy(sunWorld).transformDirection(globe.camera().matrixWorldInverse);
        requestAnimationFrame(follow);
      })();
    };
    img.src = IMG + "earth-night.jpg";
  }

  /* ───────── Archi tra paesi ───────── */
  // Archi: "un paese parla di un altro".
  function updateLayers() {
    if (!globe || !state.data) return;
    updateArcs();
  }

  function updateArcs() {
    if (!globe || !state.data) return;
    const sel = state.sel && byCode.has(state.sel) ? state.sel : null;
    const links = (state.data.links || [])
      .filter((l) => byCode.get(l.a)?._ll && byCode.get(l.b)?._ll)
      .filter((l) => (sel ? l.a === sel || l.b === sel : true))
      .slice(0, sel ? 30 : 22);
    const max = Math.max(1, ...links.map((l) => l.n));
    globe.arcsData(links.map((l) => {
      const a = byCode.get(l.a)._ll, b = byCode.get(l.b)._ll;
      return { startLat: a.lat, startLng: a.lng, endLat: b.lat, endLng: b.lng, w: 0.25 + 0.55 * (l.n / max) };
    }));
  }

  /* ───────── Categorie ───────── */
  function renderCats() {
    const nav = $("#cats");
    nav.replaceChildren(...CATS.map((c) => {
      const b = document.createElement("button");
      const long = document.createElement("span");
      long.className = "long";
      long.textContent = c.label;
      const short = document.createElement("span");
      short.className = "short";
      short.textContent = c.short;
      b.append(long, short);
      b.setAttribute("aria-pressed", String(c.id === state.cat));
      b.onclick = () => {
        state.cat = c.id;
        store.set("wn-cat", c.id);
        renderCats(); paint(); updateLayers(); renderPanel(); renderTicker();
      };
      return b;
    }));
  }

  /* ───────── Pannello ───────── */
  function card(n, c, showFlag, i) {
    const el = document.createElement("article");
    el.className = "item";
    el.style.animationDelay = Math.min(i, 12) * 25 + "ms";

    const meta = document.createElement("div");
    meta.className = "meta";
    const src = document.createElement("span");
    src.className = "src";
    src.textContent = (showFlag ? c.flag + " " : "") + (n.s || "Fonte");
    const time = document.createElement("span");
    time.className = "time" + (isNew(n.d) ? " new" : "");
    time.textContent = "· " + ago(n.d);
    meta.append(src, time);

    const a = document.createElement("a");
    a.className = "title";
    a.href = n.u;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.lang = n.it ? "it" : c.lang;
    a.textContent = n.it || n.t;
    el.append(meta, a);

    // Titolo originale, nascosto finché non tocchi "Originale"
    if (n.it) {
      const orig = document.createElement("p");
      orig.className = "orig";
      orig.lang = c.lang;
      orig.hidden = true;
      orig.textContent = n.t;
      const btn = document.createElement("button");
      btn.className = "translate";
      btn.type = "button";
      btn.textContent = "Originale";
      btn.setAttribute("aria-expanded", "false");
      btn.onclick = () => {
        orig.hidden = !orig.hidden;
        btn.textContent = orig.hidden ? "Originale" : "Nascondi";
        btn.setAttribute("aria-expanded", String(!orig.hidden));
      };
      meta.append(btn);
      el.append(orig);
    } else if (!c.lang.startsWith("it")) {
      // Traduzione automatica non disponibile: link a Google Traduttore
      const tr = document.createElement("a");
      tr.className = "translate";
      tr.textContent = "Traduci";
      tr.target = "_blank";
      tr.rel = "noopener noreferrer";
      tr.href = "https://translate.google.com/?sl=auto&tl=it&op=translate&text=" + encodeURIComponent(n.t);
      meta.append(tr);
    }
    return el;
  }

  function message(text) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = text;
    $("#list").replaceChildren(p);
  }

  function renderPanel() {
    if (!state.data) return;
    const list = $("#list");
    const c = state.sel && byCode.get(state.sel);
    const label = CATS.find((x) => x.id === state.cat).label;
    let rows;
    $("#close").hidden = !state.sel;
    $("#fav").hidden = !c;
    $("#open-favs").setAttribute("aria-pressed", String(state.sel === FAV));
    if (c) {
      const on = favs.has(c.code);
      $("#fav").setAttribute("aria-pressed", String(on));
      $("#fav").setAttribute("aria-label", on ? "Togli dai preferiti" : "Aggiungi ai preferiti");
    }

    if (state.sel === SEARCH) {
      $("#p-flag").textContent = "🔎";
      $("#p-name").textContent = `«${searchQ}»`;
      if (!searchHits) {
        $("#p-sub").textContent = "Cerco in tutte le notizie del mondo…";
        message("Cerco…");
        return;
      }
      $("#p-sub").textContent = `${nNews(searchHits.length)} · ${searchCodes.size} paesi · tutte le categorie`;
      if (!searchHits.length) message(`Nessuna notizia contiene «${searchQ}» in questo momento.`);
      else list.replaceChildren(...searchHits.map(([n, x], i) => card(n, x, true, i)));
      list.scrollTop = 0;
      return;
    }

    if (state.sel === FAV) {
      $("#p-flag").textContent = "⭐";
      $("#p-name").textContent = "Preferiti";
      const codes = favList();
      if (!codes.length) {
        $("#p-sub").textContent = label;
        message("Non hai ancora paesi preferiti. Apri un paese e tocca la stella per aggiungerlo.");
        return;
      }
      const missing = codes.filter((x) => !details.has(x));
      if (missing.length) {
        $("#p-sub").textContent = label;
        message("Carico le notizie dei tuoi paesi…");
        Promise.allSettled(missing.map(loadCountry)).then(() => { if (state.sel === FAV) renderPanel(); });
        return;
      }
      rows = codes
        .flatMap((x) => details.get(x).news.filter((n) => n.c.includes(state.cat)).map((n) => [n, byCode.get(x)]))
        .sort((a, b) => Date.parse(b[0].d) - Date.parse(a[0].d))
        .slice(0, 120);
      $("#p-sub").textContent = `${label} · ${codes.length} paesi · ${nNews(rows.length)}`;
      list.replaceChildren(...rows.map(([n, x], i) => card(n, x, true, i)));
      if (!rows.length) message("Nessuna notizia dei tuoi preferiti in questa categoria nelle ultime 24 ore.");
      list.scrollTop = 0;
      return;
    }

    if (c) {
      $("#p-flag").textContent = c.flag;
      $("#p-name").textContent = c.name;
      const d = details.get(c.code);
      if (!d) {
        $("#p-sub").textContent = label;
        message("Carico le notizie…");
        loadCountry(c.code)
          .then(() => { if (state.sel === c.code) renderPanel(); })
          .catch(() => { if (state.sel === c.code) message("Non riesco a caricare le notizie di questo paese."); });
        return;
      }
      rows = d.news.filter((n) => n.c.includes(state.cat)).map((n) => [n, c]);
    } else {
      // Mondo: le notizie più recenti di tutti i paesi (preparate dal raccoglitore)
      $("#p-flag").textContent = "🌍";
      $("#p-name").textContent = "Mondo";
      rows = (state.data.world[state.cat] || [])
        .filter((n) => byCode.has(n.k))
        .map((n) => [n, byCode.get(n.k)]);
    }
    const extra = c && c.mode === "q" ? " · dalla stampa internazionale" : "";
    $("#p-sub").textContent = `${label} · ${nNews(rows.length)}${extra}`;

    if (!rows.length) {
      message("Nessuna notizia in questa categoria nelle ultime 24 ore.");
    } else {
      const cards = rows.map(([n, x], i) => card(n, x, !c, i));
      if (!c) list.replaceChildren(trendsRow(), ...cards);
      else list.replaceChildren(linksRow(c), ...cards);
    }
    list.scrollTop = 0;
  }

  function select(code) {
    const prev = state.sel;
    state.sel = code;
    // Prima di tutto il globo: sollevamento immediato
    const touched = new Set([prev, code]);
    if (prev === FAV || code === FAV) favs.forEach((x) => touched.add(x));
    if (prev === SEARCH || code === SEARCH) searchCodes.forEach((x) => touched.add(x));
    touched.forEach(styleCountry);
    history.replaceState(null, "", code && code !== SEARCH ? "#" + code : location.pathname + location.search);
    if (mobile()) $("#sheet").dataset.state = "peek";
    paint(); updateArcs(); renderPanel();
    if (code && byCode.has(code)) zoomToCountry(code); else resetZoom();
    hideTip();
  }

  /* ───────── Selettore paesi ───────── */
  const pickerWrap = $("#picker-wrap");
  const search = $("#picker-search");
  function renderPicker() {
    const q = search.value.trim().toLowerCase();
    const items = [...state.data.countries]
      .sort((a, b) => a.name.localeCompare(b.name, "it"))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
    const section = (t) => Object.assign(document.createElement("p"), { className: "picker-section", textContent: t });
    const fav = items.filter((c) => favs.has(c.code));
    const chip = (c) => {
      const b = document.createElement("button");
      b.className = "chip";
      if (c.code === state.sel) b.setAttribute("aria-current", "true");
      const f = document.createElement("span");
      f.className = "f";
      f.textContent = c.flag;
      b.append(f, c.name);
      if (favs.has(c.code)) b.append(Object.assign(document.createElement("span"), { className: "star-mark", textContent: "★" }));
      b.onclick = () => { closePicker(); select(c.code); };
      return b;
    };
    let nodes = fav.length && !q
      ? [section("Preferiti"), ...fav.map(chip), section("Tutti i paesi"), ...items.map(chip)]
      : items.map(chip);
    if (q.length >= 2) {
      const raw = search.value.trim();
      const go = el("button", { className: "chip search-all", type: "button" },
        el("span", { className: "f", textContent: "🔎" }), `Cerca «${raw}» in tutte le notizie`);
      go.onclick = () => runSearch(raw);
      nodes = [go, ...(items.length ? [section("Paesi")] : []), ...items.map(chip)];
    } else if (state.data.trends && state.data.trends.length) {
      nodes = [section("Di tendenza nel mondo"), ...state.data.trends.slice(0, 10).map((t) => {
        const b = el("button", { className: "chip trend", type: "button" },
          el("span", { className: "f", textContent: "↗" }), t.t);
        b.title = `Ne parlano ${t.p} paesi`;
        b.onclick = () => runSearch(t.t);
        return b;
      }), ...nodes];
    }
    $("#picker-grid").replaceChildren(...nodes);
  }
  function openPicker() {
    if (!state.data) return;
    search.value = "";
    renderPicker();
    pickerWrap.hidden = false;
    if (!mobile()) search.focus();
  }
  function closePicker() { pickerWrap.hidden = true; }

  /* ───────── Piccolo aiuto per creare elementi della pagina ───────── */
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  /* ───────── Ticker in stile telegiornale ───────── */
  function renderTicker() {
    const t = $("#ticker");
    const items = state.data ? (state.data.world[state.cat] || []).slice(0, 24) : [];
    if (!items.length) { t.hidden = true; return; }
    const make = () => items.map((n) => {
      const c = byCode.get(n.k);
      if (!c) return null;
      const b = el("button", { className: "tk-item", type: "button" },
        el("span", { className: "tk-flag", textContent: c.flag }), n.it || n.t);
      b.onclick = () => select(c.code);
      return b;
    }).filter(Boolean);
    const run = $("#ticker-run");
    run.replaceChildren(...make(), ...make());   // due copie: lo scorrimento non si interrompe mai
    run.style.animationDuration = Math.max(60, items.length * 9) + "s";
    t.hidden = false;
  }

  /* ───────── Ricerca nelle notizie di tutto il mondo ───────── */
  let searchRows = null, searchQ = "", searchHits = null;
  const searchCodes = new Set();
  const norm = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  async function loadSearch() {
    if (searchRows) return searchRows;
    const r = await fetch(`data/c/search.json?t=${state.data.updated}`);
    const year = state.data.updated.slice(0, 4);
    searchRows = (await r.json()).map(([k, t, o, s, u, d, cats]) => ({
      k,
      n: {
        t: o || t,
        it: o ? t : undefined,
        s,
        u: u.startsWith("~") ? GN_PREFIX + u.slice(1) + "?oc=5" : u,
        d: `${year}-${d}:00Z`,
        c: cats.split(","),
      },
      key: norm(t + " " + o),
    }));
    return searchRows;
  }

  async function runSearch(q) {
    q = q.trim();
    if (q.length < 2 || !state.data) return;
    closePicker();
    const old = new Set(searchCodes);
    searchQ = q;
    searchHits = null;
    searchCodes.clear();
    old.forEach(styleCountry);
    select(SEARCH);
    try {
      const rows = await loadSearch();
      const words = norm(q).split(/\s+/).filter(Boolean);
      const hits = rows
        .filter((r) => words.every((w) => r.key.includes(w)) && byCode.has(r.k))
        .sort((a, b) => (a.n.d < b.n.d ? 1 : -1))
        .slice(0, 150);
      if (state.sel !== SEARCH || searchQ !== q) return;
      searchHits = hits.map((r) => [r.n, byCode.get(r.k)]);
      hits.forEach((r) => searchCodes.add(r.k));
      searchCodes.forEach(styleCountry);
      renderPanel();
    } catch {
      message("Non riesco a fare la ricerca in questo momento.");
    }
  }

  // Riga "Di tendenza" in cima alla vista Mondo
  function trendsRow() {
    const trends = (state.data.trends || []).slice(0, 10);
    const row = el("div", { className: "chips-row" }, el("span", { className: "row-label", textContent: "Di tendenza" }));
    if (!trends.length) return document.createDocumentFragment();
    for (const t of trends) {
      const b = el("button", { className: "tag-btn", type: "button", textContent: t.t });
      b.title = `Ne parlano ${t.p} paesi`;
      b.onclick = () => runSearch(t.t);
      row.append(b);
    }
    return row;
  }

  // Riga "Collegamenti" sul paese aperto: di chi parla e chi ne parla
  function linksRow(c) {
    const links = (state.data.links || []).filter((l) => l.a === c.code || l.b === c.code);
    if (!links.length) return document.createDocumentFragment();
    const row = el("div", { className: "chips-row" }, el("span", { className: "row-label", textContent: "Collegamenti" }));
    for (const l of links.slice(0, 8)) {
      const other = byCode.get(l.a === c.code ? l.b : l.a);
      if (!other) continue;
      const b = el("button", { className: "tag-btn", type: "button", textContent: `${other.flag} ${other.name}` });
      b.title = (l.a === c.code ? `${c.name} parla di ${other.name}` : `${other.name} parla di ${c.name}`) + ` · ${nNews(l.n)}\n${l.t}`;
      b.onclick = () => select(other.code);
      row.append(b);
    }
    return row;
  }

  /* ───────── Modalità Tour ───────── */
  const tourEl = $("#tour");
  let tour = null, wakeT;
  const STOP_MS = 4200;

  function wakeTourControls() {
    tourEl.classList.remove("idle");
    clearTimeout(wakeT);
    wakeT = setTimeout(() => tourEl.classList.add("idle"), 2200);   // i pulsanti spariscono: video pulito
  }

  function tourLayout() {
    if (!globe) return;
    const vertical = document.body.classList.contains("vertical") && !mobile();
    const h = window.innerHeight;
    const w = vertical ? Math.round(Math.min(window.innerWidth, h * 9 / 16)) : window.innerWidth;
    const left = Math.round((window.innerWidth - w) / 2);
    globeEl.style.left = left + "px";
    globeEl.style.width = w + "px";
    const frame = $("#tour-frame");
    frame.style.left = left + "px";
    frame.style.width = w + "px";
    $("#tour-ratio").textContent = vertical ? "Formato schermo intero" : "Formato 9:16";
    globe.width(w).height(h);
    viewOffset();
  }

  function setTourStop(code) {
    const prev = state.sel;
    state.sel = code;
    styleCountry(prev);
    styleCountry(code);
    paint();
  }

  // Paesi del Tour: Europa e Stati Uniti (si cambia qui)
  const TOUR_TITLE = "Europa e Stati Uniti";
  const TOUR_COUNTRIES = ("US AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD "
    + "MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA FO").split(" ");
  const TOUR_STOPS = 10;
  const TOUR_CAT = "pol";              // solo Politica & Esteri
  // La sezione "nazionale" dei giornali contiene anche cronaca: il titolo deve parlare davvero di politica
  const POLITICS = /govern|elezion|elettor|\bvot[oia]|president|ministr|parlament|premier|senat|deputat|vertice|partit|opposizion|coalizion|riform|legge|decreto|manovra|sindac|cancellier|segretari[oa] (di stato|al tesoro|generale)|casa bianca|congresso|\bnato\b|\bue\b|\bonu\b|sanzion|diplomat|ambasciat|trattativ|colloqui|negoziat|accordo|tregua|guerra|dimission|dimett|referendum|leader|trump|meloni|macron|merz|starmer|zelensk|putin|von der leyen/i;

  async function startTour() {
    if (!state.data || !globe || tour) return;
    closePicker();
    // Solo paesi con edizione nazionale: la loro sezione politica è garantita (per gli altri la categoria è stimata)
    const pool = TOUR_COUNTRIES.map((k) => byCode.get(k)).filter((c) => c && c._ll && c.mode === "ed");
    await Promise.allSettled(pool.map((c) => loadCountry(c.code)));
    // Per ogni paese la notizia di politica uscita più di recente (già in italiano)
    const freshest = (c) => (details.get(c.code)?.news || [])
      .filter((x) => x.c.includes(TOUR_CAT) && (x.it || c.lang === "it") && POLITICS.test(x.it || x.t))
      .sort((a, b) => (a.d < b.d ? 1 : -1))[0] || null;
    const stops = pool
      .map((c) => ({ c, n: freshest(c) }))
      .filter((x) => x.n)
      .sort((a, b) => (a.n.d < b.n.d ? 1 : -1))      // dalla più nuova
      .slice(0, TOUR_STOPS);
    if (!stops.length) { toast("Non ci sono abbastanza notizie per il Tour"); return; }

    const prevSel = state.sel;
    state.sel = null;
    [prevSel, ...favs, ...searchCodes].forEach(styleCountry);
    tour = { stops, i: -1, timer: null };
    globe.arcsData([]);                      // video più pulito: niente archi durante il Tour
    document.body.classList.add("touring");
    tourEl.hidden = false;
    tourLayout();
    wakeTourControls();
    globe.controls().autoRotate = false;

    $("#tour-progress").replaceChildren(...stops.map(() => el("span", {}, el("i"))));
    $("#ti-title").textContent = TOUR_TITLE;
    $("#ti-date").textContent = "Le ultime notizie di politica · " + new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
    $("#tour-intro").classList.add("show");
    $("#tour-card").classList.remove("show");
    globe.pointOfView({ lat: 22, lng: stops[0].c._ll.lng - 50, altitude: 2.8 }, 1500);
    tour.timer = setTimeout(nextStop, 2600);
  }

  function nextStop() {
    if (!tour) return;
    tour.i++;
    const bars = [...$("#tour-progress").children];
    bars.forEach((b, i) => b.classList.toggle("done", i < tour.i));
    if (tour.i >= tour.stops.length) { tourOutro(); return; }
    const { c, n } = tour.stops[tour.i];
    bars[tour.i].classList.add("run");
    bars[tour.i].querySelector("i").style.animationDuration = STOP_MS + "ms";
    $("#tour-intro").classList.remove("show");
    const card = $("#tour-card");
    card.classList.remove("show");
    setTourStop(c.code);
    const altitude = Math.max(1.15, Math.min(2.3, 0.7 + c._ll.size / 38)) * (mobile() || document.body.classList.contains("vertical") ? 1.35 : 1);
    globe.pointOfView({ lat: c._ll.lat - 6, lng: c._ll.lng, altitude }, 1400);
    setTimeout(() => {
      if (!tour) return;
      $("#tc-flag").textContent = c.flag;
      $("#tc-country").textContent = c.name;
      $("#tc-title").textContent = n.it || n.t;
      $("#tc-meta").textContent = `${n.s || "Fonte"} · ${ago(n.d)}`;
      card.classList.add("show");
    }, 900);
    tour.timer = setTimeout(nextStop, STOP_MS);
  }

  function tourOutro() {
    $("#tour-card").classList.remove("show");
    setTourStop(null);
    $("#ti-title").textContent = "World Notice";
    $("#ti-date").textContent = "Aggiornato alle " + new Date(state.data.updated).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    $("#tour-intro").classList.add("show");
    globe.pointOfView({ lat: 22, lng: globe.pointOfView().lng + 40, altitude: 2.8 }, 2200);
    tour.timer = setTimeout(stopTour, 3000);
  }

  function stopTour() {
    if (!tour) return;
    clearTimeout(tour.timer);
    tour = null;
    setTourStop(null);
    document.body.classList.remove("touring", "vertical");
    tourEl.hidden = true;
    $("#tour-intro").classList.remove("show");
    $("#tour-card").classList.remove("show");
    globeEl.style.left = "";
    globeEl.style.width = "";
    layout();
    updateArcs();
    renderPanel();
    resetZoom();
  }

  /* ───────── Eventi ───────── */
  $("#open-picker").onclick = openPicker;
  $("#close-picker").onclick = closePicker;
  pickerWrap.addEventListener("click", (e) => { if (e.target === pickerWrap) closePicker(); });
  search.addEventListener("input", renderPicker);
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const chips = [...document.querySelectorAll("#picker-grid .chip:not(.search-all):not(.trend)")];
    if (chips.length === 1) chips[0].click();
    else if (search.value.trim().length >= 2) runSearch(search.value.trim());
  });
  $("#close").onclick = () => select(null);
  $("#fav").onclick = () => { if (byCode.has(state.sel)) toggleFav(state.sel); };
  $("#open-favs").onclick = () => select(state.sel === FAV ? null : FAV);
  $("#open-tour").onclick = () => startTour();
  $("#tour-exit").onclick = () => stopTour();
  $("#tour-ratio").onclick = () => { document.body.classList.toggle("vertical"); tourLayout(); };
  tourEl.addEventListener("pointermove", wakeTourControls, { passive: true });
  $("#reset").onclick = () => select(null);
  $("#zoom-in").onclick = () => zoomBy(0.65);
  $("#zoom-out").onclick = () => zoomBy(1.5);
  $("#handle").onclick = () => {
    const s = $("#sheet");
    s.dataset.state = s.dataset.state === "full" ? "peek" : "full";
    setTimeout(viewOffset, 480);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (tour) stopTour();
    else if (!pickerWrap.hidden) closePicker();
    else if (state.sel) select(null);
  });
  window.addEventListener("hashchange", () => {
    const code = location.hash.slice(1).toUpperCase();
    if (code !== (state.sel || "") && (byCode.has(code) || code === FAV || !code)) select(code || null);
  });
  let resizeT;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => (tour ? tourLayout() : layout()), 120); });

  /* ───────── Avvio ───────── */
  async function start() {
    renderCats();
    try {
      const [topo] = await Promise.all([fetch(WORLD_URL).then((r) => r.json()), loadData()]);
      features = topojson.feature(topo, topo.objects.countries).features
        .filter((f) => f.id !== "010")
        .map((f) => { if (!f.id && f.properties.name === "Kosovo") f.id = "n:Kosovo"; return f; });
      buildParts();
      initGlobe();
      renderTicker();
      renderPanel();
      // All'apertura: il paese nell'indirizzo, altrimenti i tuoi preferiti
      const code = location.hash.slice(1).toUpperCase();
      if (byCode.has(code) || code === FAV) select(code);
      else if (favList().length) select(FAV);
    } catch (err) {
      console.error(err);
      $("#updated").textContent = "Errore nel caricamento";
      $("#list").replaceChildren(Object.assign(document.createElement("p"), {
        className: "empty",
        textContent: "Non riesco a caricare le notizie. Controlla la connessione e ricarica la pagina.",
      }));
    }
    setInterval(async () => {
      try { await loadData(); searchRows = null; paint(); updateLayers(); renderPanel(); renderTicker(); } catch {}
    }, REFRESH_MS);
  }
  start();
})();
