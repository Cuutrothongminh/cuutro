/* script.js
   Final: supports Thôn/Xóm; grouping; filters; leaflet map; cache; auto-refresh
   API key integrated below (as requested)
*/

const API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";
const SHEET_GVIZ = "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";

// Settings
const AUTO_INTERVAL = 15 * 60 * 1000; // 15 min
const WEATHER_TTL = 12 * 60 * 1000;   // reuse weather if <12min
const GEO_TTL = 24 * 60 * 60 * 1000;  // keep geocode 24h

// DOM
const sheetStatusEl = document.getElementById("sheetStatus");
const updateStatusEl = document.getElementById("updateStatus");
const provinceListEl = document.getElementById("provinceList");
const dataBody = document.getElementById("dataBody");
const mapDiv = document.getElementById("map");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const refreshBtn = document.getElementById("refreshBtn");
const rainFilter = document.getElementById("rainFilter");
const alertFilter = document.getElementById("alertFilter");
const expandAllBtn = document.getElementById("expandAll");
const collapseAllBtn = document.getElementById("collapseAll");
const pageSizeSelect = document.getElementById("pageSize");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const currentPageEl = document.getElementById("currentPage");
const totalPageEl = document.getElementById("totalPage");
const resultCountEl = document.getElementById("resultCount");
const sortSelect = document.getElementById("sortSelect");

// State
let rawRows = [];         // array of row objects (each contact)
let filteredRows = [];    // after filters/search
let currentPage = 1;
let pageSize = parseInt(pageSizeSelect.value || 50);

// caches
let geoCache = {};        // locKey -> {lat, lon, ts}
let weatherCache = {};    // locKey -> {rain,status,hasAlert,raw,ts}
let markers = {};         // locKey -> leaflet layer
let map = null;

// load caches
try { geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}"); } catch(e){ geoCache = {}; }
try { weatherCache = JSON.parse(localStorage.getItem("weatherCache") || "{}"); } catch(e){ weatherCache = {}; }

// UTIL
function normalize(s){ return (s||"").toString().normalize().toLowerCase().trim(); }
function saveGeo(){ localStorage.setItem("geoCache", JSON.stringify(geoCache)); }
function saveWeather(){ localStorage.setItem("weatherCache", JSON.stringify(weatherCache)); }
function locKeyForRow(r){
  // include thôn for accuracy
  const th = r["Thôn/Xóm"] || r.thon || "";
  const xa = r["Xã/Phường"] || r.xa || "";
  const h = r["Huyện - Tỉnh cũ"] || r.huyen || r["Huyện"] || "";
  const t = r["Tỉnh/TP"] || r.tinh || "";
  return `${th}|${xa}|${h}|${t}`.replace(/\s+/g," ").trim();
}
function buildQueryFromRow(r){
  const parts = [];
  if(r["Thôn/Xóm"]) parts.push(r["Thôn/Xóm"]);
  if(r["Xã/Phường"]) parts.push(r["Xã/Phường"]);
  if(r["Huyện - Tỉnh cũ"]) parts.push(r["Huyện - Tỉnh cũ"]);
  else if(r["Huyện"]) parts.push(r["Huyện"]);
  if(r["Tỉnh/TP"]) parts.push(r["Tỉnh/TP"]);
  parts.push("Vietnam");
  return parts.filter(Boolean).join(", ");
}

// MAP init
function initMap(){
  map = L.map('map').setView([16.0, 108.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
}

// GEOCODING (OWM direct) with cache
async function geocodeRow(r){
  const key = locKeyForRow(r);
  const now = Date.now();
  if(geoCache[key] && (now - geoCache[key].ts < GEO_TTL) && geoCache[key].lat != null) return geoCache[key];
  // if sheet contains lat/lon columns, honor them
  if(r.lat && r.lon){ geoCache[key] = { lat: parseFloat(r.lat), lon: parseFloat(r.lon), ts: now }; saveGeo(); return geoCache[key]; }

  const q = buildQueryFromRow(r);
  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${API_KEY}`;
    const res = await fetch(url);
    if(!res.ok){ geoCache[key] = { lat:null, lon:null, ts:now }; saveGeo(); return geoCache[key]; }
    const j = await res.json();
    if(Array.isArray(j) && j[0]) {
      geoCache[key] = { lat: j[0].lat, lon: j[0].lon, ts: now };
    } else {
      geoCache[key] = { lat:null, lon:null, ts: now };
    }
    saveGeo();
    return geoCache[key];
  } catch (e){
    console.error("geocode error", e);
    geoCache[key] = { lat:null, lon:null, ts: now };
    saveGeo();
    return geoCache[key];
  }
}

// WEATHER fetch by coords (current) + cache TTL
async function fetchWeatherForLoc(key, lat, lon){
  const now = Date.now();
  if(weatherCache[key] && (now - (weatherCache[key].ts || 0) < WEATHER_TTL)) return weatherCache[key];
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
    const res = await fetch(url);
    if(!res.ok) {
      weatherCache[key] = { rain:0, status:"Bình thường", hasAlert:false, ts: now };
      saveWeather();
      return weatherCache[key];
    }
    const j = await res.json();
    const rain = j.rain?.["1h"] ?? j.rain?.["3h"] ?? 0;
    let status = "Bình thường";
    if(rain >= 50) status = "Ngập nặng";
    else if(rain >= 30) status = "Ngập sâu";
    else if(rain >= 10) status = "Ngập nhẹ";
    const hasAlert = (j.weather && j.weather.some(w => /(thunderstorm|storm|heavy|extreme)/i.test(w.description))) || (rain >= 50);
    weatherCache[key] = { rain: parseFloat(rain), status, hasAlert: !!hasAlert, raw: j, ts: now };
    saveWeather();
    return weatherCache[key];
  } catch(e){
    console.error("fetchWeatherForLoc error", e);
    return { rain:0, status:"Bình thường", hasAlert:false, ts: Date.now() };
  }
}

// Color helper
function colorByRain(rain){
  if(rain < 5) return "#9fe6a6";
  if(rain < 20) return "#fff6a8";
  if(rain < 50) return "#ffd8a8";
  return "#ffb4b4";
}

// Parallel limiter
async function parallelLimit(list, limit, fn){
  let i = 0;
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async ()=>{
    while(i < list.length){
      const idx = i++;
      try { await fn(list[idx]); } catch(e){ console.error(e); }
    }
  });
  await Promise.all(workers);
}

// Build objects from sheet rows (dynamic mapping)
function buildRowsFromSheetJSON(jsonRows){
  const rows = (jsonRows || []).map(r => {
    const c = r.c || [];
    // Map by likely header order or fallback to positions; support extra "Thôn/Xóm" if present in headers handled earlier
    return {
      "Tỉnh/TP": (c[0] && c[0].v) ? c[0].v : "",
      "Xã/Phường": (c[1] && c[1].v) ? c[1].v : "",
      "Chức vụ": (c[2] && c[2].v) ? c[2].v : "",
      "Họ và tên": (c[3] && c[3].v) ? c[3].v : "",
      "Số điện thoại": (c[4] && c[4].v) ? c[4].v : "",
      "Trước sáp nhập": (c[5] && c[5].v) ? c[5].v : "",
      "Huyện - Tỉnh cũ": (c[6] && c[6].v) ? c[6].v : "",
      "Đặc điểm địa hình": (c[7] && c[7].v) ? c[7].v : "",
      // Optional columns later (Thôn/Xóm, lat, lon) — try to detect if present
      "Thôn/Xóm": (c[8] && c[8].v) ? c[8].v : "",
      lat: (c[9] && c[9].v) ? c[9].v : "",
      lon: (c[10] && c[10].v) ? c[10].v : "",
      _raw: c
    };
  });
  return rows;
}

// Build grouping for sidebar
function buildGrouping(rows){
  const groups = {};
  rows.forEach(r => {
    const prov = r["Tỉnh/TP"] || "(Không rõ)";
    const dist = r["Huyện - Tỉnh cũ"] || "(Không rõ)";
    const comm = r["Xã/Phường"] || "(Không rõ)";
    groups[prov] = groups[prov] || {};
    groups[prov][dist] = groups[prov][dist] || {};
    groups[prov][dist][comm] = groups[prov][dist][comm] || 0;
    groups[prov][dist][comm] += 1;
  });
  return groups;
}

// Build sidebar DOM
function renderSidebar(groups){
  provinceListEl.innerHTML = "";
  Object.keys(groups).sort().forEach(prov=>{
    const pDiv = document.createElement("div");
    pDiv.className = "province-item";
    pDiv.innerHTML = `<span>${prov}</span><span class="small-pill">${Object.values(groups[prov]).reduce((a,b)=>a+Object.values(b).reduce((x,y)=>x+y,0),0)}</span>`;
    const children = document.createElement("div");
    children.className = "group-children";
    children.style.display = "none";
    Object.keys(groups[prov]).sort().forEach(dist=>{
      const dDiv = document.createElement("div");
      dDiv.className = "province-item";
      dDiv.style.marginLeft = "8px";
      dDiv.innerHTML = `<span>${dist}</span><span class="small-pill">${Object.values(groups[prov][dist]).reduce((a,b)=>a+b,0)}</span>`;
      const dChildren = document.createElement("div");
      dChildren.className = "group-children";
      dChildren.style.display = "none";
      Object.keys(groups[prov][dist]).sort().forEach(comm=>{
        const cDiv = document.createElement("div");
        cDiv.className = "province-item";
        cDiv.style.marginLeft = "16px";
        cDiv.textContent = `${comm} (${groups[prov][dist][comm]})`;
        cDiv.onclick = (e)=>{
          e.stopPropagation();
          // filter to prov/dist/comm
          applyFilters({prov, dist, comm});
        };
        dChildren.appendChild(cDiv);
      });
      dDiv.onclick = (e)=>{ e.stopPropagation(); dChildren.style.display = dChildren.style.display === "block" ? "none" : "block"; };
      dDiv.appendChild(dChildren);
      children.appendChild(dDiv);
    });
    pDiv.onclick = (e)=>{ e.stopPropagation(); children.style.display = children.style.display === "block" ? "none" : "block"; };
    pDiv.appendChild(children);
    provinceListEl.appendChild(pDiv);
  });
}

// Render grouped table with geocode+weather + markers (main renderer)
async function renderGrouped(rows){
  updateStatusEl.textContent = "Đang cập nhật thời tiết & bản đồ...";
  dataBody.innerHTML = "";

  // grouping structure
  const groups = {};
  rows.forEach(r => {
    const prov = r["Tỉnh/TP"] || "(Không rõ)";
    const dist = r["Huyện - Tỉnh cũ"] || "(Không rõ)";
    const comm = r["Xã/Phường"] || "(Không rõ)";
    groups[prov] = groups[prov] || {};
    groups[prov][dist] = groups[prov][dist] || {};
    groups[prov][dist][comm] = groups[prov][dist][comm] || [];
    groups[prov][dist][comm].push(r);
  });

  // render sidebar
  renderSidebar(groups);

  // prepare unique locKeys
  const uniqueKeys = {};
  rows.forEach(r=>{
    const key = locKeyForRow(r);
    if(!uniqueKeys[key]) uniqueKeys[key] = r;
  });
  const keys = Object.keys(uniqueKeys);

  // geocode in parallel (concurrency 6)
  await parallelLimit(keys, 6, async key => {
    const sample = uniqueKeys[key];
    await geocodeRow(sample);
  });

  // fetch weather in parallel
  await parallelLimit(keys, 6, async key => {
    const geo = geoCache[key];
    if(geo && geo.lat != null){
      await fetchWeatherForLoc(key, geo.lat, geo.lon);
    } else {
      // set default if no coords
      weatherCache[key] = weatherCache[key] || { rain:0, status:"Bình thường", hasAlert:false, ts: Date.now() };
    }
  });

  // clear old markers
  if(map){
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};
  }

  // compute pagination & sorting
  let flatList = [];
  Object.keys(groups).sort().forEach(prov=>{
    Object.keys(groups[prov]).sort().forEach(dist=>{
      Object.keys(groups[prov][dist]).sort().forEach(comm=>{
        groups[prov][dist][comm].forEach(r => flatList.push(r));
      });
    });
  });

  // apply sorting option
  const sortOpt = sortSelect?.value || "prov";
  if(sortOpt === "rain_desc" || sortOpt === "rain_asc"){
    flatList.sort((a,b)=>{
      const ak = locKeyForRow(a), bk = locKeyForRow(b);
      const ar = weatherCache[ak]?.rain || 0, br = weatherCache[bk]?.rain || 0;
      return sortOpt === "rain_desc" ? br - ar : ar - br;
    });
  }

  // apply pagination
  pageSize = parseInt(pageSizeSelect.value || 50);
  const total = flatList.length;
  const totalPage = Math.max(1, Math.ceil(total / pageSize));
  if(currentPage > totalPage) currentPage = totalPage;
  currentPageEl.textContent = currentPage;
  totalPageEl.textContent = totalPage;
  resultCountEl.textContent = total;

  const start = (currentPage -1) * pageSize;
  const pageSlice = flatList.slice(start, start + pageSize);

  // render header rows grouped visually: we'll show per row but include group header rows for first of each commune visible in page slice
  let lastKey = "";
  for(const r of pageSlice){
    const prov = r["Tỉnh/TP"] || "(Không rõ)";
    const dist = r["Huyện - Tỉnh cũ"] || "(Không rõ)";
    const comm = r["Xã/Phường"] || "(Không rõ)";
    const groupKey = `${prov}||${dist}||${comm}`;
    if(groupKey !== lastKey){
      const headerTr = document.createElement("tr");
      headerTr.innerHTML = `<td colspan="11" style="text-align:left; font-weight:700; background:#f0f8ff; cursor:default">
        ${prov} › ${dist} › ${comm} — ${ (groups[prov] && groups[prov][dist] && groups[prov][dist][comm]) ? groups[prov][dist][comm].length : 0 } liên hệ
      </td>`;
      dataBody.appendChild(headerTr);
      lastKey = groupKey;
    }

    const key = locKeyForRow(r);
    const geo = geoCache[key] || {};
    const w = weatherCache[key] || { rain:0, status:"Bình thường", hasAlert:false };

    const rain = Number.isFinite(w.rain) ? w.rain : parseFloat(w.rain || 0);
    // row color
    let rowCls = "";
    if(rain < 5) rowCls = "row-green";
    else if(rain < 20) rowCls = "row-yellow";
    else if(rain < 50) rowCls = "row-orange";
    else rowCls = "row-red";

    const tr = document.createElement("tr");
    tr.className = rowCls;
    tr.innerHTML = `
      <td>${prov}</td>
      <td>${dist}</td>
      <td>${comm}</td>
      <td>${r["Thôn/Xóm"] || r.thon || ""}</td>
      <td>${r["Chức vụ"] || ""}</td>
      <td>${r["Họ và tên"] || ""}</td>
      <td><a href="tel:${r["Số điện thoại"] || ''}">${r["Số điện thoại"] || ''}</a></td>
      <td>${r["Đặc điểm địa hình"] || ""}</td>
      <td>${(Math.round(rain*10)/10).toFixed(1)}</td>
      <td>${w.status}${w.hasAlert ? ' ⚠️' : ''}</td>
      <td><a class="btn btn-sm btn-success" href="tel:${r["Số điện thoại"]||''}">Gọi</a></td>
    `;
    // clicking row centers map to location
    tr.addEventListener('click', (e)=> {
      e.stopPropagation();
      if(geo && geo.lat != null){
        map.setView([geo.lat, geo.lon], 13, { animate:true });
        if(markers[key]) markers[key].openPopup?.();
      } else {
        alert("Không có tọa độ chính xác cho vị trí này.");
      }
    });

    dataBody.appendChild(tr);

    // add marker for this loc if geo present and not already added
    if(geo && geo.lat != null){
      if(!markers[key]){
        const color = colorByRain(rain);
        const circle = L.circleMarker([geo.lat, geo.lon], { radius:7, color: color, fillColor: color, fillOpacity:0.9 });
        const popup = `<strong>${comm}</strong><br>${r["Họ và tên"]||""}<br>${r["Số điện thoại"]||""}<br>Mưa: ${(Math.round(rain*10)/10).toFixed(1)} mm<br>${w.status}${w.hasAlert ? ' ⚠️' : ''}`;
        circle.bindPopup(popup);
        circle.addTo(map);
        markers[key] = circle;
      }
    }
  }

  updateStatusEl.textContent = `Cập nhật: ${new Date().toLocaleString('vi-VN')}`;
}

// Apply filters (search, rain, alert, optional context)
async function applyFilters(context){
  // context: {prov, dist, comm}
  filteredRows = rawRows.slice();
  if(context && context.prov) filteredRows = filteredRows.filter(r => (r["Tỉnh/TP"]||"").trim() === context.prov);
  if(context && context.dist) filteredRows = filteredRows.filter(r => (r["Huyện - Tỉnh cũ"]||"").trim() === context.dist);
  if(context && context.comm) filteredRows = filteredRows.filter(r => (r["Xã/Phường"]||"").trim() === context.comm);

  // search
  const q = normalize(searchInput.value);
  if(q){
    filteredRows = filteredRows.filter(r => {
      return ['Tỉnh/TP','Huyện - Tỉnh cũ','Xã/Phường','Thôn/Xóm','Họ và tên','Số điện thoại','Chức vụ','Đặc điểm địa hình']
        .some(k => normalize(r[k]).includes(q));
    });
  }

  // ensure geocode + weather for filtered set (unique locKeys)
  const unique = {};
  filteredRows.forEach(r => { unique[locKeyForRow(r)] = unique[locKeyForRow(r)] || r; });
  const keys = Object.keys(unique);
  // geocode
  await parallelLimit(keys, 6, async key => {
    await geocodeRow(unique[key]);
  });
  // weather
  await parallelLimit(keys, 6, async key => {
    const g = geoCache[key];
    if(g && g.lat != null) await fetchWeatherForLoc(key, g.lat, g.lon);
    else weatherCache[key] = weatherCache[key] || { rain:0, status:"Bình thường", hasAlert:false, ts: Date.now() };
  });

  // apply rain & alert filters
  const rf = rainFilter.value;
  if(rf){
    filteredRows = filteredRows.filter(r => {
      const k = locKeyForRow(r);
      const w = weatherCache[k] || { rain:0, hasAlert:false };
      const rain = w.rain || 0;
      if(rf === 'lt5') return rain < 5;
      if(rf === '5-20') return rain >=5 && rain <20;
      if(rf === '20-50') return rain >=20 && rain <50;
      if(rf === 'gt50') return rain >=50;
      return true;
    });
  }
  const af = alertFilter.value;
  if(af){
    filteredRows = filteredRows.filter(r => {
      const k = locKeyForRow(r);
      const w = weatherCache[k] || { hasAlert:false };
      return af === 'hasAlert' ? !!w.hasAlert : !w.hasAlert;
    });
  }

  // sort option handled inside renderGrouped by reading sortSelect
  currentPage = 1;
  await renderGrouped(filteredRows);
}

// Fetch sheet (gviz)
async function fetchSheet(){
  updateStatusEl.textContent = "Đang tải Google Sheet...";
  try {
    const res = await fetch(SHEET_GVIZ + "&t=" + Date.now());
    const txt = await res.text();
    const json = JSON.parse(txt.substring(47).slice(0,-2));
    sheetStatusEl.textContent = "Sheet (Đã kết nối)";
    const rows = (json.table.rows || []).filter(r => (r.c||[]).some(cell => cell && cell.v));
    rawRows = buildRowsFromSheetJSON(rows);
    updateStatusEl.textContent = `Đã tải ${rawRows.length} liên hệ`;
    return rows;
  } catch(e){
    console.error("fetchSheet error", e);
    updateStatusEl.textContent = "Lỗi khi tải Sheet";
    return [];
  }
}

// buildRowsFromSheetJSON (detect dynamic column placement if user has different order)
function buildRowsFromSheetJSON(sheetRows){
  // Try to detect headers: first row might be header row if script earlier used full mapping.
  // But our sheet is standard (the image you provided). Use mapping by known header names if headers present.
  if(!sheetRows || !sheetRows.length) return [];
  // check first row content: if it's header names, use them
  const first = sheetRows[0].c || [];
  const headerNames = first.map(c=>c && c.v ? c.v.toString().trim() : "");
  const lowerHeaders = headerNames.map(h=>h.toLowerCase());
  const isHeaderRow = lowerHeaders.some(h => /tỉnh|xã|huyện|họ và tên|số điện thoại/i.test(h));
  let dataRows = sheetRows;
  if(isHeaderRow){
    dataRows = sheetRows.slice(1);
    // map header indices
    const idx = {};
    lowerHeaders.forEach((h,i)=>{
      if(/tỉnh/.test(h)) idx.tinh = i;
      if(/xã|phường/.test(h)) idx.xa = i;
      if(/thôn|xóm|bản|đội/.test(h)) idx.thon = i;
      if(/chức vụ/.test(h)) idx.chucvu = i;
      if(/họ và tên/.test(h)) idx.name = i;
      if(/số điện thoại|điện thoại|sdt/.test(h)) idx.phone = i;
      if(/trước sáp nhập/.test(h)) idx.presapnhap = i;
      if(/huyện|tỉnh cũ/.test(h)) idx.huyen = i;
      if(/đặc điểm|địa hình/.test(h)) idx.diahinh = i;
      if(/lat/i.test(h)) idx.lat = i;
      if(/lon/i.test(h)) idx.lon = i;
    });
    // map using idx
    return dataRows.map(r => {
      const c = r.c || [];
      return {
        "Tỉnh/TP": c[idx.tinh]?.v || "",
        "Xã/Phường": c[idx.xa]?.v || "",
        "Thôn/Xóm": c[idx.thon]?.v || "",
        "Chức vụ": c[idx.chucvu]?.v || "",
        "Họ và tên": c[idx.name]?.v || "",
        "Số điện thoại": c[idx.phone]?.v || "",
        "Trước sáp nhập": c[idx.presapnhap]?.v || "",
        "Huyện - Tỉnh cũ": c[idx.huyen]?.v || "",
        "Đặc điểm địa hình": c[idx.diahinh]?.v || "",
        lat: c[idx.lat]?.v || "",
        lon: c[idx.lon]?.v || "",
        _raw: c
      };
    });
  } else {
    // fallback to positional mapping (as earlier)
    return buildRowsFromSheetJSON_positional(sheetRows);
  }
}

function buildRowsFromSheetJSON_positional(jsonRows){
  return (jsonRows || []).map(r => {
    const c = r.c || [];
    return {
      "Tỉnh/TP": (c[0] && c[0].v) ? c[0].v : "",
      "Xã/Phường": (c[1] && c[1].v) ? c[1].v : "",
      "Chức vụ": (c[2] && c[2].v) ? c[2].v : "",
      "Họ và tên": (c[3] && c[3].v) ? c[3].v : "",
      "Số điện thoại": (c[4] && c[4].v) ? c[4].v : "",
      "Trước sáp nhập": (c[5] && c[5].v) ? c[5].v : "",
      "Huyện - Tỉnh cũ": (c[6] && c[6].v) ? c[6].v : "",
      "Đặc điểm địa hình": (c[7] && c[7].v) ? c[7].v : "",
      "Thôn/Xóm": (c[8] && c[8].v) ? c[8].v : "",
      lat: (c[9] && c[9].v) ? c[9].v : "",
      lon: (c[10] && c[10].v) ? c[10].v : "",
      _raw: c
    };
  });
}

// EVENTS wiring
searchBtn.onclick = ()=> applyFilters();
searchInput.addEventListener('keypress', e => { if(e.key === 'Enter') applyFilters(); });
refreshBtn.onclick = async ()=> { await fullRefresh(); };
rainFilter.onchange = ()=> applyFilters();
alertFilter.onchange = ()=> applyFilters();
expandAllBtn.onclick = ()=> document.querySelectorAll('.group-children').forEach(d=>d.style.display='block');
collapseAllBtn.onclick = ()=> document.querySelectorAll('.group-children').forEach(d=>d.style.display='none');
pageSizeSelect.onchange = ()=> { currentPage = 1; applyFilters(); };
prevPageBtn.onclick = ()=> { if(currentPage>1){ currentPage--; applyFilters(); } };
nextPageBtn.onclick = ()=> { currentPage++; applyFilters(); };
sortSelect?.addEventListener('change', ()=> applyFilters());

// top-level refresh that fetches sheet & then applies filters
async function fullRefresh(){
  const sheetRows = await fetchSheet();
  if(!sheetRows || !sheetRows.length) return;
  // pre-load map & caches for filtered set inside applyFilters
  await applyFilters();
}

// start
initMap();
fullRefresh();
setInterval(fullRefresh, AUTO_INTERVAL);

// periodically save caches
setInterval(()=> { saveGeo(); saveWeather(); }, 60*1000);
