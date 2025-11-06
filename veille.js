/* ===== Veille concurrentielle ===== */
const API_BASE = "https://veille-production.up.railway.app";

let veilleMap;           // carte Leaflet dédiée à la veille
let veilleLayer = null;  // calque points veille
let currentRows = [];    // lignes affichées
const MAP_MAX_DEFAULT = 200;

/* UI */
const TAB_ANN     = document.querySelector('.tab-chip[data-tab="annuaire"]');
const TAB_REF     = document.querySelector('.tab-chip[data-tab="references"]');
const TAB_VEILLE  = document.querySelector('.tab-chip[data-tab="veille"]');

const MAP_ANNUAIRE = document.getElementById("map");
const PANEL        = document.getElementById("panel");
const PANEL_TOGGLE = document.getElementById("panelToggle");

const VEILLE_MAP   = document.getElementById("veilleMap");
const OVERLAY      = document.getElementById("veilleOverlay");
const V_SEARCH     = document.getElementById("veilleSearch");
const V_LIMIT      = document.getElementById("veilleLimit");
const V_GO         = document.getElementById("veilleGo");
const V_AWARD      = document.getElementById("awardeeInput");
const V_EXPORT     = document.getElementById("exportExcel");
const V_COUNT      = document.getElementById("veilleCount");
/* refs UI supplémentaires */
const V_SPIN = document.getElementById("veilleSpinner");

const VEILLE_PANEL = document.getElementById("veillePanel");
const V_TOGGLE     = document.getElementById("veillePanelToggle");

/* Cards container (remplace la table) */
const V_LIST  = document.getElementById("veilleList");
const V_EMPTY = document.getElementById("veilleEmpty");

/* Utils */
const qs = (obj)=>
  Object.entries(obj)
    .filter(([,v]) => v !== undefined && v !== null && v !== "")
    .map(([k,v]) => Array.isArray(v)
      ? v.map(x=>`${encodeURIComponent(k)}=${encodeURIComponent(x)}`).join("&")
      : `${encodeURIComponent(k)}=${encodeURIComponent(v)}` )
    .join("&");

function parseAwardees(text){
  return String(text||"")
    .split(",")
    .map(s=>s.trim())
    .filter(Boolean);
}

function ensureVeilleLayer(){
  if (!veilleMap) return;
  if (!veilleLayer){ veilleLayer = L.layerGroup().addTo(veilleMap); }
}

function clearVeille(){
  if (veilleLayer){ veilleLayer.clearLayers(); }
  currentRows = [];
  if (V_LIST) V_LIST.innerHTML = "";
  if (V_EMPTY) V_EMPTY.classList.add("hidden");
  V_COUNT.textContent = "Saisissez vos critères puis lancez la recherche.";
}

/* ---- Carte veille ---- */
function initVeilleMap(){
  if (veilleMap) return;                // ✅ une seule instanciation
  veilleMap = L.map("veilleMap", { zoomControl:false }).setView([46.71109, 1.7191036], 6);
  L.tileLayer("//{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
    attribution:'données © <a href="//osm.org/copyright">OpenStreetMap</a>/ODbL – rendu <a href="//openstreetmap.fr">OSM France</a>'
  }).addTo(veilleMap);
  L.control.zoom({position:"bottomleft"}).addTo(veilleMap);
  ensureVeilleLayer();
}

function renderMap(rows, mapMax){
  ensureVeilleLayer();
  if (!veilleLayer) return;
  veilleLayer.clearLayers();

  const pts = rows
    .slice(0, mapMax)
    .filter(r => Number.isFinite(+r.acheteur_latitude) && Number.isFinite(+r.acheteur_longitude));

  const icon = () => L.divIcon({
    className: 'veille-marker',
    html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:#0ea5e9;
      box-shadow:0 0 0 2px rgba(255,255,255,.95) inset, 0 0 0 1px rgba(0,0,0,.45);"></span>`,
    iconSize:[18,18]
  });

  const fmtMoney = (v)=> (v==null ? "" : new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(+v));
  const fmtDate  = (d)=> (d ? new Date(d).toLocaleDateString('fr-FR') : "");

  const markers = [];
  pts.forEach(r=>{
    const lat = +r.acheteur_latitude, lon = +r.acheteur_longitude;
    const m = L.marker([lat, lon], { icon: icon(), riseOnHover:true });

    const objet = String(r.objet||"");
    const objShort = objet.length > 300 ? objet.slice(0,300) + "…" : objet;

    const html = `
      <div class="popup-veille">
        <div class="title">${r.acheteur_nom ?? ""}</div>
        <div class="subtitle">${r.titulaire_nom ?? ""}</div>

        <div class="badges">
          ${r.procedure ? `<span class="v-badge">${r.procedure}</span>` : ""}
          ${r.acheteur_region_nom ? `<span class="v-badge">${r.acheteur_region_nom}</span>` : ""}
        </div>
        <div class="badges">
             ${r.montant ? `<span class="v-badge">${fmtMoney(r.montant)}</span>` : ""}
             ${r.dateNotification ? `<span class="v-badge">${fmtDate(r.dateNotification)}</span>` : ""}
        </div>


        ${objShort ? `<div class="v-obj" title="${objet.replace(/"/g,'&quot;')}">${objShort}</div>` : ""}
      </div>`;
    m.bindPopup(html, { className:'rich-popup', autoPan:true });
    veilleLayer.addLayer(m);
    markers.push(m);
  });

  if (markers.length){
    try { veilleMap.fitBounds(L.featureGroup(markers).getBounds().pad(0.2)); } catch(e){}
  }
}
/* ---- Cartes (remplace la table/UID masqué) ---- */
function renderCards(rows){
  currentRows = rows;

  if (!rows.length){
    V_LIST.innerHTML = "";
    V_EMPTY.classList.remove("hidden");
    return;
  }
  V_EMPTY.classList.add("hidden");

  const fmtMoney = (v)=> (v==null ? "" : new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(+v));
  const fmtDate  = (d)=> (d ? new Date(d).toLocaleDateString('fr-FR') : "");

  V_LIST.innerHTML = rows.map(r => {
    const lat = r.acheteur_latitude ?? '';
    const lon = r.acheteur_longitude ?? '';
    const objet = String(r.objet||"");
    const objShort = objet.length > 300 ? objet.slice(0,300) + "…" : objet;

    return `
      <li class="v-card" data-lat="${lat}" data-lon="${lon}">
        <div class="title">${r.acheteur_nom ?? ""}</div>
        <div class="subtitle">${r.titulaire_nom ?? ""}</div>

        <div class="badges">
          ${r.procedure ? `<span class="v-badge">${r.procedure}</span>` : ""}
          ${r.acheteur_region_nom ? `<span class="v-badge">${r.acheteur_region_nom}</span>` : ""}
        </div>

        <div class="v-kv">
          <div class="k">Montant</div><div class="v"><strong>${fmtMoney(r.montant)}</strong></div>
          <div class="k">Date</div><div class="v">${fmtDate(r.dateNotification)}</div>
        </div>

        ${objShort ? `<div class="v-obj" title="${objet.replace(/"/g,'&quot;')}">${objShort}</div>` : ""}

        <div class="v-actions">
          <button class="btn" data-action="focus">Voir sur la carte</button>
        </div>
      </li>
    `;
  }).join("");


  // focus carte au clic
  Array.from(V_LIST.querySelectorAll(".v-card")).forEach(card=>{
    const go = ()=>{
      const lat = +card.dataset.lat, lon = +card.dataset.lon;
      if (Number.isFinite(lat) && Number.isFinite(lon) && veilleMap){
        veilleMap.flyTo([lat, lon], Math.max(veilleMap.getZoom(), 8), { duration:.5 });
      }
    };
    card.addEventListener("click", (e)=>{
      // évite double-clic quand on clique sur le bouton
      if (e.target && e.target.matches('[data-action="focus"]')) return;
      go();
    });
    const btn = card.querySelector('[data-action="focus"]');
    if (btn) btn.addEventListener("click", (e)=>{ e.stopPropagation(); go(); });
  });
}

/* ---- API (unique fetch pour carte + cards) ---- */
async function fetchRowsCombined({ q, awardees, limit }){
  const params = { limit: limit || 50 };
  if (q && q.trim()) params.q = q.trim();
  const aw = parseAwardees(awardees);
  if (aw.length) params.awardee = aw; // param multi

  const url = `${API_BASE}/rows?${qs(params)}`;
  const r = await fetch(url);
  if (!r.ok){
    const txt = await r.text();
    throw new Error(txt);
  }
  const data = await r.json(); // { total, limit, offset, rows }
  return data;
}

/* ---- Export ---- */
function exportExcel(){
  if (!window.XLSX){ alert("Bibliothèque XLSX absente"); return; }
  const ws = XLSX.utils.json_to_sheet(currentRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Marchés");
  const fname = `marches_filtres_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, fname);
}

/* ---- Flux “Rechercher” ---- */
/* ---- Flux “Rechercher” ---- */
async function runSearch(){
  const q = V_SEARCH.value || "";
  const awardees = V_AWARD.value || "";
  const limit = parseInt(V_LIMIT.value || "50", 10);
  const mapMax = Math.min(limit, MAP_MAX_DEFAULT);

  V_COUNT.textContent = "Chargement…";
  if (V_SPIN) V_SPIN.classList.remove("hidden");

  try{
    const data = await fetchRowsCombined({ q, awardees, limit });
    const rows = Array.isArray(data.rows) ? data.rows : [];

    const total = Number.isFinite(+data.total) ? +data.total : rows.length;
    const shown = Math.min(limit, total, rows.length);
    V_COUNT.textContent = `${total.toLocaleString('fr-FR')} résultats (affichage des ${rows.length.toLocaleString('fr-FR')} premiers)`;

    renderCards(rows);
    renderMap(rows, mapMax);
  }catch(e){
    console.error("[Veille] runSearch error:", e);
    V_COUNT.textContent = "Erreur de chargement";
    clearVeille();
  } finally {
    if (V_SPIN) V_SPIN.classList.add("hidden");
  }
}

/* ---- Navigation onglets : masquer/afficher éléments Annuaire ---- */
function switchToVeille(){
  // cacher Annuaire
  if (PANEL)        PANEL.classList.add("hidden");
  if (PANEL_TOGGLE) PANEL_TOGGLE.classList.add("hidden");
  if (MAP_ANNUAIRE) MAP_ANNUAIRE.classList.add("hidden");

  // montrer Veille
  VEILLE_MAP.classList.remove("hidden");
  OVERLAY.classList.remove("hidden");
  VEILLE_PANEL.classList.remove("hidden");

  initVeilleMap();
  setTimeout(() => { try { veilleMap.invalidateSize(); } catch(e){} }, 30);

  clearVeille(); // carte vide tant que pas “Rechercher”
}

function switchToAnnuaireOrRefs(){
  // ré-afficher Annuaire
  if (PANEL)        PANEL.classList.remove("hidden");
  if (PANEL_TOGGLE) PANEL_TOGGLE.classList.remove("hidden");
  if (MAP_ANNUAIRE) MAP_ANNUAIRE.classList.remove("hidden");

  // masquer Veille
  VEILLE_MAP.classList.add("hidden");
  OVERLAY.classList.add("hidden");
  VEILLE_PANEL.classList.add("hidden");

  setTimeout(() => {
    try { if (window.map && window.map.invalidateSize) window.map.invalidateSize(); } catch(e){}
  }, 30);
}

function initVeille(){
  if (!TAB_VEILLE) return;

  TAB_VEILLE.addEventListener("click", switchToVeille);
  if (TAB_ANN) TAB_ANN.addEventListener("click", switchToAnnuaireOrRefs);
  if (TAB_REF) TAB_REF.addEventListener("click", switchToAnnuaireOrRefs);

  V_GO.addEventListener("click", runSearch);
  V_EXPORT.addEventListener("click", exportExcel);

  // Enter ↵ déclenche la recherche depuis q ET awardee
  const handleEnter = (e)=>{ if (e.key === "Enter") runSearch(); };
  V_SEARCH.addEventListener("keydown", handleEnter);
  V_AWARD.addEventListener("keydown", handleEnter);

  if (V_TOGGLE){
    V_TOGGLE.addEventListener("click", ()=>{
      const collapsed = document.body.classList.toggle("veille-collapsed");
      V_TOGGLE.textContent = collapsed ? "⟨" : "⟩";
      V_TOGGLE.setAttribute("aria-expanded", String(!collapsed));
    });
  }
}

document.addEventListener("DOMContentLoaded", initVeille);
