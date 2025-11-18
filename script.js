/* Final integration:
 - API key (geocoding + weather)
 - Grouping Tỉnh -> Huyện -> Xã, collapsible
 - Advanced filters (rain thresholds, alert)
 - Colored icons / row backgrounds
 - Leaflet map with markers; click row centers marker
 - Auto-refresh every 15 minutes + manual refresh
 - Cache geocoding and weather into localStorage
*/

const API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";
const SHEET_GVIZ = "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";
const AUTO_INTERVAL = 15 * 60 * 1000;
const WEATHER_TTL = 12 * 60 * 1000; // reuse weather if < 12 min

// DOM
const provinceListEl = document.getElementById("provinceList");
const updateStatus = document.getElementById("updateStatus");
const dataBody = document.getElementById("dataBody");
const mapDiv = document.getElementById("map");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const refreshBtn = document.getElementById("refreshBtn");
const rainFilter = document.getElementById("rainFilter");
const alertFilter = document.getElementById("alertFilter");
const expandAllBtn = document.getElementById("expandAll");
const collapseAllBtn = document.getElementById("collapseAll");
const sheetText = document.getElementById("sheetText");

// state
let rawRows = []; // each row object
let uniqueLocations = {}; // key -> { lat, lon, lastGeoTs }
let weatherCache = {};    // locKey -> { rain, status, ts, raw }
let markers = {};         // locKey -> leaflet marker
let map;

// load caches from localStorage
try { uniqueLocations = JSON.parse(localStorage.getItem("geoCache") || "{}"); } catch(e){ uniqueLocations = {}; }
try { weatherCache = JSON.parse(localStorage.getItem("weatherCache") || "{}"); } catch(e){ weatherCache = {}; }

// init leaflet
function initMap(){
  map = L.map('map').setView([16.0, 108.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OSM'
  }).addTo(map);
}

// helpers
function normalize(s){ return (s||"").toString().toLowerCase().trim(); }
function saveGeo(){ localStorage.setItem("geoCache", JSON.stringify(uniqueLocations)); }
function saveWeather(){ localStorage.setItem("weatherCache", JSON.stringify(weatherCache)); }
function locKeyForRow(r){ // include thon for precision
  return `${(r["Thôn/Xóm"]||r.thon||"").trim()}|${(r["Xã/Phường"]||r.xa||"").trim()}|${(r["Huyện"]||r.huyen||r["Huyện - Tỉnh cũ"]||"").trim()}|${(r["Tỉnh/TP"]||r.tinh||"").trim()}`.replace(/\s+/g," ");
}
function buildQueryFromRow(r){
  const parts = [];
  if(r["Thôn/Xóm"]) parts.push(r["Thôn/Xóm"]);
  if(r["Xã/Phường"]) parts.push(r["Xã/Phường"]);
  if(r["Huyện"] || r["Huyện - Tỉnh cũ"]) parts.push(r["Huyện"] || r["Huyện - Tỉnh cũ"]);
  if(r["Tỉnh/TP"]) parts.push(r["Tỉnh/TP"]);
  parts.push("Vietnam");
  return parts.filter(Boolean).join(", ");
}

// geocode (with cache)
async function geocodeRow(r){
  const key = locKeyForRow(r);
  if(uniqueLocations[key] && uniqueLocations[key].lat && uniqueLocations[key].lon) return uniqueLocations[key];
  // if lat/lon present in sheet
  if(r.lat && r.lon){ uniqueLocations[key] = { lat: parseFloat(r.lat), lon: parseFloat(r.lon), ts: Date.now() }; saveGeo(); return uniqueLocations[key]; }
  const q = buildQueryFromRow(r);
  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${API_KEY}`;
    const res = await fetch(url);
    if(!res.ok) { console.warn("Geo not ok", q); uniqueLocations[key] = null; saveGeo(); return null; }
    const j = await res.json();
    if(Array.isArray(j) && j[0]){
      uniqueLocations[key] = { lat: j[0].lat, lon: j[0].lon, rawName: j[0].name, ts: Date.now() };
      saveGeo();
      return uniqueLocations[key];
    }
    uniqueLocations[key] = null;
    saveGeo();
    return null;
  } catch(e){
    console.error("geocode error", e);
    uniqueLocations[key] = null;
    saveGeo();
    return null;
  }
}

// fetch weather by coords with caching
async function fetchWeatherForLoc(key, lat, lon){
  const now = Date.now();
  if(weatherCache[key] && (now - (weatherCache[key].ts||0) < WEATHER_TTL)){
    return weatherCache[key];
  }
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
    const res = await fetch(url);
    const j = await res.json();
    const rain = j.rain?.["1h"] ?? j.rain?.["3h"] ?? 0;
    // determine alert: simple heuristic (thunderstorm or extreme rain)
    const hasAlert = (j.weather && j.weather.some(w => /(thunderstorm|storm|heavy rain|extreme)/i.test(w.description))) || (rain > 50);
    let status = "Bình thường";
    if(rain >= 50) status = "Ngập nặng";
    else if(rain >= 30) status = "Ngập sâu";
    else if(rain >= 10) status = "Ngập nhẹ";
    const out = { rain: parseFloat(rain), status, hasAlert: !!hasAlert, ts: now, raw: j };
    weatherCache[key] = out;
    saveWeather();
    return out;
  } catch(e){
    console.error("fetchWeather error", e);
    return { rain:0, status:"Bình thường", hasAlert:false, ts: now };
  }
}

// marker color by rain
function colorByRain(rain){
  if(rain < 5) return "#9fe6a6"; // green
  if(rain < 20) return "#fff6a8"; // yellow
  if(rain < 50) return "#ffd8a8"; // orange
  return "#ffb4b4"; // red
}

// build grouped tree and sidebar
function buildSidebar(groups){
  provinceListEl.innerHTML = "";
  Object.keys(groups).sort().forEach(prov => {
    const pDiv = document.createElement("div");
    pDiv.className = "group-title";
    pDiv.textContent = prov;
    const pChildren = document.createElement("div");
    pChildren.className = "group-children";
    // districts
    Object.keys(groups[prov]).sort().forEach(dist => {
      const dDiv = document.createElement("div");
      dDiv.className = "group-title";
      dDiv.textContent = dist;
      const dChildren = document.createElement("div");
      dChildren.className = "group-children";
      Object.keys(groups[prov][dist]).sort().forEach(comm => {
        const cItem = document.createElement("div");
        cItem.className = "group-title";
        cItem.textContent = comm;
        cItem.onclick = (e)=>{
          e.stopPropagation();
          // filter table to this prov/dist/comm
          applyFilters({prov, dist, comm});
        };
        dChildren.appendChild(cItem);
      });
      dDiv.onclick = (e)=>{ e.stopPropagation(); dChildren.style.display = dChildren.style.display === "block" ? "none" : "block"; };
      dDiv.appendChild(dChildren);
      pChildren.appendChild(dDiv);
    });
    pDiv.onclick = (e)=>{ e.stopPropagation(); pChildren.style.display = pChildren.style.display === "block" ? "none" : "block"; };
    pDiv.appendChild(pChildren);
    provinceListEl.appendChild(pDiv);
  });
}

// render grouped table (collapsible groups)
async function renderGroupedTable(rows){
  updateStatus.textContent = "Đang cập nhật thời tiết & bản đồ...";
  dataBody.innerHTML = "";

  // Group rows by prov -> dist -> comm
  const groups = {};
  rows.forEach(r => {
    const prov = r["Tỉnh/TP"] || r.tinh || "(Không rõ)";
    const dist = r["Huyện - Tỉnh cũ"] || r.huyen || r["Huyện"] || "(Không rõ)";
    const comm = r["Xã/Phường"] || r.xa || "(Không rõ)";
    groups[prov] = groups[prov] || {};
    groups[prov][dist] = groups[prov][dist] || {};
    groups[prov][dist][comm] = groups[prov][dist][comm] || [];
    groups[prov][dist][comm].push(r);
  });

  // Build sidebar
  buildSidebar(groups);

  // Map: clear markers
  if(map){
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};
  }

  // Prepare unique location list for parallel geocode+weather
  const uniqueKeys = {};
  for(const r of rows){
    const key = locKeyForRow(r);
    uniqueKeys[key] = uniqueKeys[key] || { sample: r };
  }
  const keys = Object.keys(uniqueKeys);

  // geocode parallel (limited concurrency)
  await parallelLimit(keys, 6, async key => {
    const sample = uniqueKeys[key].sample;
    const geo = await geocodeRow(sample);
    uniqueKeys[key].geo = geo;
  });

  // weather parallel
  await parallelLimit(keys, 6, async key => {
    const g = uniqueKeys[key].geo;
    if(g && g.lat != null){
      const w = await fetchWeatherForLoc(key, g.lat, g.lon);
      uniqueKeys[key].weather = w;
    } else {
      uniqueKeys[key].weather = { rain:0, status:"Bình thường", hasAlert:false };
    }
  });

  // Map markers and table rows
  for(const prov of Object.keys(groups).sort()){
    for(const dist of Object.keys(groups[prov]).sort()){
      for(const comm of Object.keys(groups[prov][dist]).sort()){
        const list = groups[prov][dist][comm];
        // header row for this commune (collapsible)
        const headerTr = document.createElement("tr");
        headerTr.innerHTML = `<td colspan="11" style="text-align:left; font-weight:700; background:#f0f8ff; cursor:pointer">
          ▶ ${prov} › ${dist} › ${comm} — ${list.length} liên hệ
        </td>`;
        headerTr.onclick = () => {
          // toggle visibility for subsequent rows belonging to this comm
          const nextRows = Array.from(dataBody.querySelectorAll(`tr[data-comm="${escapeCss(comm)}"]`));
          nextRows.forEach(tr => tr.classList.toggle("d-none"));
        };
        dataBody.appendChild(headerTr);

        // each contact row
        for(const r of list){
          const key = locKeyForRow(r);
          const w = uniqueKeys[key].weather || { rain:0, status:"Bình thường", hasAlert:false };
          const rain = (typeof w.rain === "number") ? w.rain : parseFloat(w.rain||0);
          // row background by rain
          let rowClass = "";
          if(rain < 5) rowClass = "row-green";
          else if(rain < 20) rowClass = "row-yellow";
          else if(rain < 50) rowClass = "row-orange";
          else rowClass = "row-red";

          const tr = document.createElement("tr");
          tr.className = `clickable-row ${rowClass}`;
          tr.setAttribute("data-comm", comm);
          tr.innerHTML = `
            <td>${prov}</td>
            <td>${dist}</td>
            <td>${comm}</td>
            <td>${r["Thôn/Xóm"]||r.thon||""}</td>
            <td>${r["Chức vụ"]||r.position||""}</td>
            <td>${r["Họ và tên"]||r.name||r.lienhe||""}</td>
            <td>${r["Số điện thoại"]||r["SĐT"]||r.phone||""}</td>
            <td>${r["Đặc điểm địa hình"]||r.diahinh||""}</td>
            <td>${(Math.round(rain*10)/10).toFixed(1)}</td>
            <td>${w.status}${w.hasAlert? ' ⚠️':''}</td>
            <td><a class="btn btn-sm btn-success" href="tel:${r["Số điện thoại"]||r["SĐT"]||r.phone||''}">Gọi</a></td>
          `;
          // row click centers map
          tr.onclick = (e) => {
            e.stopPropagation();
            const g = uniqueKeys[key].geo;
            if(g && g.lat){
              map.setView([g.lat, g.lon], 13, { animate:true });
              const m = markers[key];
              if(m) m.openPopup();
            } else {
              alert('Không có tọa độ chính xác cho vị trí này.');
            }
          };
          dataBody.appendChild(tr);

          // place marker if not exist
          const g = uniqueKeys[key].geo;
          if(g && g.lat != null){
            if(!markers[key]){
              const color = colorByRain(rain);
              const circle = L.circleMarker([g.lat, g.lon], { radius:8, color: color, fillColor: color, fillOpacity:0.9 });
              const popupHtml = `<strong>${comm}</strong><br>${r["Họ và tên"]||r.lienhe||""}<br>${r["Số điện thoại"]||r.phone||""}<br>Mưa: ${(Math.round(rain*10)/10).toFixed(1)} mm<br>${w.status}${w.hasAlert? ' <span style="color:#b30000">⚠️</span>':''}`;
              circle.bindPopup(popupHtml);
              circle.addTo(map);
              markers[key] = circle;
            }
          }
        }
      }
    }
  }

  updateStatus.textContent = `Cập nhật xong — ${new Date().toLocaleString('vi-VN')}`;
}

// simple parallel limiter
async function parallelLimit(list, limit, fn){
  let i = 0;
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while(i < list.length){
      const idx = i++;
      await fn(list[idx]);
    }
  });
  await Promise.all(workers);
}

// build rows array from sheet JSON
function buildRowsFromSheetData(sheetRows){
  const arr = sheetRows.map(r => {
    // r.c is array of cells
    const c = r.c || [];
    // try common header ordering; but we will read by header names if present later
    return {
      "Tỉnh/TP": (c[0] && c[0].v) ? c[0].v : "",
      "Huyện - Tỉnh cũ": (c[1] && c[1].v) ? c[1].v : (c[1] ? c[1].v : ""),
      "Xã/Phường": (c[2] && c[2].v) ? c[2].v : "",
      "Thôn/Xóm": (c[3] && c[3].v) ? c[3].v : "",
      "Họ và tên": (c[4] && c[4].v) ? c[4].v : (c[4] ? c[4].v : ""),
      "Số điện thoại": (c[5] && c[5].v) ? c[5].v : "",
      "Đặc điểm địa hình": (c[6] && c[6].v) ? c[6].v : "",
      // support optional lat/lon at later cols
      lat: (c[7] && c[7].v) ? c[7].v : (c[8] && c[8].v ? c[8].v : ""),
      lon: (c[8] && c[8].v) ? c[8].v : (c[9] && c[9].v ? c[9].v : ""),
      // keep original raw
      _raw: c
    };
  });
  return arr;
}

// fetch Google Sheet (gviz)
async function fetchSheet(){
  updateStatus.textContent = "Đang tải Google Sheet...";
  try {
    const res = await fetch(SHEET_GVIZ + "&t=" + Date.now());
    const txt = await res.text();
    const json = JSON.parse(txt.substring(47).slice(0,-2));
    sheetText.textContent = "Sheet (Đã kết nối)";
    const rows = (json.table.rows || []).filter(r => (r.c||[]).some(cell => cell && cell.v));
    rawRows = buildRowsFromSheetData(rows);
    return rows;
  } catch(e){
    console.error("fetchSheet", e);
    updateStatus.textContent = "Lỗi tải Sheet.";
    return [];
  }
}

// apply advanced filters & search and render grouped
async function applyFilters(context){
  // context optional: {prov, dist, comm}
  let filtered = rawRows.slice();

  // apply context selection
  if(context && context.prov) filtered = filtered.filter(r => (r["Tỉnh/TP"]||"").trim() === context.prov);
  if(context && context.dist) filtered = filtered.filter(r => (r["Huyện - Tỉnh cũ"]||"").trim() === context.dist);
  if(context && context.comm) filtered = filtered.filter(r => (r["Xã/Phường"]||"").trim() === context.comm);

  // search text
  const q = normalize(searchInput.value);
  if(q){
    filtered = filtered.filter(r => {
      return ['Tỉnh/TP','Huyện - Tỉnh cũ','Xã/Phường','Thôn/Xóm','Họ và tên','Số điện thoại','Đặc điểm địa hình'].some(k => normalize(r[k]).includes(q));
    });
  }

  // rain filter
  const rf = rainFilter.value;
  if(rf){
    filtered = filtered.filter(r => {
      const key = locKeyForRow(r);
      const w = weatherCache[key];
      const rain = w ? (w.rain || 0) : 0;
      if(rf === 'lt5') return rain < 5;
      if(rf === '5-20') return rain >=5 && rain <20;
      if(rf === '20-50') return rain >=20 && rain <50;
      if(rf === 'gt50') return rain >=50;
      return true;
    });
  }

  // alert filter
  const af = alertFilter.value;
  if(af){
    filtered = filtered.filter(r => {
      const key = locKeyForRow(r);
      const w = weatherCache[key];
      const has = w ? !!w.hasAlert : false;
      return af === 'hasAlert' ? has : !has;
    });
  }

  // render grouped table with weather updates
  await renderGroupedTable(filtered);
}

// UI events
searchBtn.onclick = ()=> { applyFilters(); };
searchInput.addEventListener('keypress', e => { if(e.key === 'Enter') applyFilters(); });
refreshBtn.onclick = async ()=> { await fullUpdate(); };
rainFilter.onchange = ()=> applyFilters();
alertFilter.onchange = ()=> applyFilters();
expandAllBtn.onclick = ()=> {
  document.querySelectorAll('.group-children').forEach(d=>d.style.display='block');
};
collapseAllBtn.onclick = ()=> {
  document.querySelectorAll('.group-children').forEach(d=>d.style.display='none');
};

// full update: fetch sheet -> render grouped table
async function fullUpdate(){
  const sheetRows = await fetchSheet();
  if(!sheetRows.length) return;
  // prefill weather for currently cached locations (so filters work)
  // We'll run applyFilters which triggers geocode+weather inside renderGroupedTable
  await applyFilters();
}

// start
initMap();
fullUpdate();

// periodic auto-refresh
setInterval(async ()=> {
  console.log("Auto refresh weather...");
  await fullUpdate();
}, AUTO_INTERVAL);

// save caches periodically
setInterval(()=> { saveGeo(); saveWeather(); }, 60*1000);

// helper: escape CSS for attr matching (simple)
function escapeCss(s){ return s.replace(/["\\]/g, "\\$&"); }
