/* Config */
const SHEET_URL = window.__GSHEET_URL__;

/* Utils */
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const norm = (s)=> (s||"").toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const tokens = (q)=> norm(q).split(/\s+/).filter(Boolean);
const pravatar = (seed)=> `https://i.pravatar.cc/150?u=${encodeURIComponent(seed)}`; // placeholder libre
const parseNumber = (v)=>{
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\s/g,"").replace(",", "."); // gère 06 12 et décimaux FR
  return Number(s);
};

/* State */
let map;
let people = [];
let markers = [];
let activeCompanies = new Set();
let companyColors = new Map();

/* Color per company */
function computePalette(items){
  const uniq = [...new Set(items.map(p=>p.entite).filter(Boolean))];
  const base = [
    "#1DB5C5","#70BA7A","#EE2528","#F38331","#5C368D","#F9B832","#2ea76b","#00753B",
    "#1f8a70","#6078ea","#ffba49","#ef476f","#073b4c","#ffd166","#06d6a0"
  ];
  uniq.forEach((name,i)=> companyColors.set(name, base[i % base.length]));
  return uniq;
}

/* Map */
function initMap(){
  map = L.map("map", { zoomControl:false }).setView([46.71109, 1.7191036], 6);
  L.tileLayer("//{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
    attribution:'données © <a href="//osm.org/copyright">OpenStreetMap</a>/ODbL – rendu <a href="//openstreetmap.fr">OSM France</a>'
  }).addTo(map);
  L.control.zoom({position:"bottomleft"}).addTo(map);
}

/* Data: CSV or GViz JSON */
async function loadSheet(){
  if (!SHEET_URL) throw new Error("SHEET_URL manquant. Renseigne window.__GSHEET_URL__ dans index.html");
  const res = await fetch(SHEET_URL);
  const text = await res.text();

  if (/google.visualization.Query.setResponse/.test(text)){
    // GViz JSON
    const json = JSON.parse(text.replace(/^[^{]+/, "").replace(/;?\s*$/, ""));
    const cols = json.table.cols.map(c => c.label || c.id);
    const rows = json.table.rows.map(r => r.c.map(c => c ? c.v : ""));
    return rowsToPeople([cols, ...rows]);
  } else if (text.trim().startsWith("{") || text.trim().startsWith("[")){
    // JSON brut (peu probable ici)
    const raw = JSON.parse(text);
    return normalizePeople(raw);
  } else {
    // CSV
    return csvToPeople(text);
  }
}

function csvToPeople(csv){
  const rows = [];
  let cur = [], val = "", inQuotes = false;
  for (let i=0;i<csv.length;i++){
    const ch = csv[i];
    if (ch === '"' ){
      if (inQuotes && csv[i+1] === '"'){ val += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes){ cur.push(val); val=""; }
    else if ((ch === '\n' || ch === '\r') && !inQuotes){
      if (val !== "" || cur.length){ cur.push(val); rows.push(cur); cur=[]; val=""; }
    } else { val += ch; }
  }
  if (val !== "" || cur.length) { cur.push(val); rows.push(cur); }

  // En-têtes sur première ligne
  const headers = rows[0].map(h => String(h).trim());
  const body = rows.slice(1);
  const table = body.map(r => Object.fromEntries(headers.map((h, i)=> [h, r[i]])));
  return normalizePeople(table);
}

function rowsToPeople(rows){
  const headers = rows[0].map(h => String(h).trim());
  const body = rows.slice(1).map(r => Object.fromEntries(headers.map((h,i)=> [h, r[i]])));
  return normalizePeople(body);
}

function normalizePeople(table){
  // Essaie plusieurs variantes d'intitulés
  const pick = (row, names)=>{
    for (const n of names){
      if (n in row) return row[n];
    }
    return "";
  };

  const items = table.map(row => ({
    nom: pick(row, ["Nom","NOM"]),
    prenom: pick(row, ["Prénom","Prenom","PRENOM"]),
    entite: pick(row, ["Entité","Entreprise","ENTITE"]),
    email: pick(row, ["Adresse mail","Email","Mail","Courriel"]),
    tel: pick(row, ["Numéro de téléphone","Téléphone","Tel","Tél."]),
    poste: pick(row, ["Poste occupé","Poste","Fonction"]),
    competences: pick(row, ["Compétences clés","Compétences","Competences"]),
    lat: parseNumber(pick(row, ["latitude","Lat","lat"])),
    lon: parseNumber(pick(row, ["longitude","Lon","lon","lng"])),
  }));

  return items.filter(p => !Number.isNaN(p.lat) && !Number.isNaN(p.lon) && (p.nom || p.prenom));
}

/* Markers */
function addMarkers(){
  // Clear
  markers.forEach(m=> m.remove());
  markers = [];

  people.forEach((p)=>{
    const color = companyColors.get(p.entite) || "#2ea76b";
    const m = L.circleMarker([p.lat, p.lon], {
      radius: 6,
      color,
      fillColor: color,
      fillOpacity: .95,
      opacity: 1
    }).addTo(map);

    m.on("click", ()=> openPopup(p, m));
    markers.push(m);
  });
}

function openPopup(p, marker){
  const mail = p.email ? `<a href="mailto:${p.email}">${p.email}</a>` : "—";
  const tel  = p.tel || "—";
  const photo = pravatar(`${p.prenom} ${p.nom} ${p.entite}`);

  const html = `
    <div class="popup-card">
      <img alt="Photo de ${p.prenom} ${p.nom}" src="${photo}" />
      <div>
        <div class="name">${p.prenom} ${p.nom}</div>
        <div class="meta">${p.entite || ""} ${p.poste ? "• " + p.poste : ""}</div>
        <div class="meta">${tel} • ${mail}</div>
        <button class="btn" data-action="skills">Compétences clés</button>
      </div>
    </div>
  `;

  marker.bindPopup(html).openPopup();

  // Delegate click for 'Compétences clés'
  marker.once("popupopen", () => {
    const btn = document.querySelector('.leaflet-popup .btn[data-action="skills"]');
    if (btn){
      btn.addEventListener("click", ()=> showSkills(p), { once: true });
    }
  });
}

function showSkills(p){
  $("#modalTitle").textContent = `Compétences clés — ${p.prenom} ${p.nom}`;
  const body = $("#modalBody");
  const lines = (p.competences || "").split(/;|\n/).map(s=>s.trim()).filter(Boolean);
  if (!lines.length){
    body.innerHTML = "<p>Aucune compétence renseignée.</p>";
  } else {
    body.innerHTML = "<ul>" + lines.map(s=> `<li>${s}</li>`).join("") + "</ul>";
  }
  $("#modal").classList.remove("hidden");
}

/* List UI */
function renderList(items){
  const ul = $("#people");
  ul.innerHTML = "";
  if (!items.length){
    $("#empty").classList.remove("hidden");
    return;
  }
  $("#empty").classList.add("hidden");

  const frag = document.createDocumentFragment();
  items.forEach(p=>{
    const li = document.createElement("li");
    li.className = "person";
    li.innerHTML = `
      <img alt="" src="${pravatar(`${p.prenom} ${p.nom} ${p.entite}`)}" />
      <div>
        <div class="name">${p.prenom} ${p.nom}</div>
        <div class="meta">${p.entite || ""} ${p.poste ? "• " + p.poste : ""}</div>
        <div class="meta">${p.tel || "—"} • ${p.email ? `<a href="mailto:${p.email}">${p.email}</a>` : "—"}</div>
        <div class="actions">
          <button class="btn" data-action="focus">Voir sur la carte</button>
          <button class="btn" data-action="skills">Compétences clés</button>
        </div>
      </div>
    `;
    li.querySelector('[data-action="focus"]').addEventListener("click", ()=>{
      const idx = people.indexOf(p);
      const m = markers[idx];
      if (m){
        map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 9), { duration:.5 });
        openPopup(p, m);
      }
    });
    li.querySelector('[data-action="skills"]').addEventListener("click", ()=> showSkills(p));

    frag.appendChild(li);
  });
  ul.appendChild(frag);
}

/* Filters */
function renderCompanyChips(all){
  const wrap = $("#companies");
  wrap.innerHTML = "";
  activeCompanies = new Set(all);

  all.forEach(name=>{
    const btn = document.createElement("button");
    btn.className = "chip active";
    btn.dataset.value = name;
    btn.textContent = name;
    btn.addEventListener("click", (e)=>{
      const exclusive = !(e.ctrlKey || e.metaKey);
      if (exclusive){
        activeCompanies = new Set([name]);
        $$("#companies .chip").forEach(c=> c.classList.toggle("active", c === btn));
      }else{
        const active = !btn.classList.contains("active");
        btn.classList.toggle("active", active);
        if (active) activeCompanies.add(name); else activeCompanies.delete(name);
        if (!activeCompanies.size){
          activeCompanies = new Set(all);
          $$("#companies .chip").forEach(c=> c.classList.add("active"));
        }
      }
      applyFilters();
    });
    wrap.appendChild(btn);
  });
}

function applyFilters(){
  const q = $("#search").value || "";
  const tks = tokens(q);

  const filtered = people.filter(p=> activeCompanies.has(p.entite) && matchesQuery(p, tks));
  renderList(filtered);

  markers.forEach((m, idx)=>{
    const p = people[idx];
    const show = filtered.includes(p);
    if (show){
      m.setStyle({ fillOpacity:.95, opacity:1, radius:7 });
      m._path && (m._path.style.display = "");
    }else{
      m.setStyle({ fillOpacity:.05, opacity:.1, radius:2 });
      m._path && (m._path.style.display = "");
    }
  });
}

function matchesQuery(p, tks){
  if (!tks.length) return true;
  const hay = norm([p.nom, p.prenom, p.entite, p.poste, p.email, p.tel, p.competences].join(" "));
  return tks.every(t => hay.includes(t));
}

/* Bootstrap */
async function main(){
  initMap();
  try {
    people = await loadSheet();
  } catch (e){
    console.error(e);
    alert("Impossible de charger les données du Google Sheet. Vérifie l’URL de publication (CSV ou GViz JSON).");
    return;
  }

  const companies = computePalette(people);
  renderCompanyChips(companies);
  addMarkers();
  renderList(people);
  applyFilters();

  $("#filtersReset").addEventListener("click", ()=>{
    renderCompanyChips(companies);
    $("#search").value = "";
    applyFilters();
  });
  $("#clear").addEventListener("click", ()=>{
    $("#search").value = "";
    applyFilters();
  });
  $("#search").addEventListener("input", ()=> applyFilters());

  const toggle = $("#panelToggle");
  toggle.addEventListener("click", ()=>{
    const collapsed = document.body.classList.toggle("panel-collapsed");
    toggle.textContent = collapsed ? "⟨" : "⟩";
  });

  $("#modalClose").addEventListener("click", ()=> $("#modal").classList.add("hidden"));
  $("#modal").addEventListener("click", (e)=>{
    if (e.target.id === "modal") $("#modal").classList.add("hidden");
  });
}

document.addEventListener("DOMContentLoaded", main);
