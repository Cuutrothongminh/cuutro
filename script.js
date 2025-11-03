// script.js
// - Ghi chú: thay SHEET_ID nếu cần. Mã lấy sheet dạng gviz/tq
const SHEET_ID = "12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU"; // bạn đã cung cấp
const GID = "325047141";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}`;

// APIs
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"; // ?format=json&q=xxx&limit=1&countrycodes=vn
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"; // ?latitude=..&longitude=..&hourly=precipitation&timezone=auto
const OPENTOPO_URL = "https://api.opentopodata.org/v1/srtm90m"; // ?locations=lat,lon

// DOM
const statusEl = document.getElementById("update-status");
const tbody = document.getElementById("data-body");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const clearBtn = document.getElementById("clearBtn");
const refreshBtn = document.getElementById("refreshBtn");

let allRows = []; // array of objects {tinh, xa, thon, hoten, chucvu, sdt, truoc, diahinh, trangthai_raw}
let groupStatusCache = {}; // communeKey -> {lat,lon,elev,precip_mm,severity,label,updatedAt}

// CONFIG
const CACHE_TTL_MS = 60 * 60 * 1000; // cache geocode/elev/status 60 minutes
const UPDATE_INTERVAL_MS = 15 * 60 * 1000; // reload sheet every 15 minutes
const GEOCODE_DELAY_MS = 1200; // 1.2s between geocode requests to be polite

// ----- Utilities -----
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function safe(v){ return (v===undefined || v===null) ? "" : String(v); }
function escapeHtml(s){ if(!s) return ""; return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function tplClassForSeverity(sev){
  if(sev>=3) return "status-flood";
  if(sev===2) return "status-warning";
  return "status-safe";
}
function labelForSeverity(sev){
  if(sev>=3) return "🌊 NGẬP";
  if(sev===2) return "⚠️ CẢNH BÁO";
  return "✅ AN TOÀN";
}
function nowMs(){ return Date.now(); }

// ----- Storage helpers -----
function loadCache(){
  try{
    const raw = localStorage.getItem("ct_cache_v1");
    if(raw) groupStatusCache = JSON.parse(raw);
  }catch(e){ groupStatusCache = {}; }
}
function saveCache(){
  try{ localStorage.setItem("ct_cache_v1", JSON.stringify(groupStatusCache)); }catch(e){}
}

// ----- Parse google gviz response -> JSON -----
function parseGviz(text){
  // google returns: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if(start===-1||end===-1) throw new Error("Không parse được response từ sheet");
  const json = JSON.parse(text.slice(start, end+1));
  return json;
}

// ----- Load sheet -----
async function loadSheet(){
  statusEl.textContent = "⏳ Đang tải danh bạ từ Google Sheets...";
  try{
    const res = await fetch(SHEET_URL + "&_=" + Date.now()); // cache buster
    if(!res.ok) throw new Error("Fetch sheet lỗi " + res.status);
    const text = await res.text();
    const json = parseGviz(text);
    const rows = (json.table && json.table.rows) ? json.table.rows : [];
    // detect header row (if present)
    let headerMap = null;
    if(rows.length>0){
      const first = rows[0].c.map(c => c && c.v ? String(c.v).toLowerCase() : "");
      // if header contains expected words -> treat as header
      const headerScore = ["tỉnh","xã","phường","họ","tên","chức","điện","số","trước","địa hình","trạng"].reduce((s,k)=> s + (first.some(t=>t.includes(k))?1:0), 0);
      if(headerScore >= 3){
        headerMap = {};
        first.forEach((t,i)=>{
          if(!t) return;
          if(t.includes("tỉnh")||t.includes("tp")||t.includes("thành")) headerMap.tinh = i;
          else if(t.includes("xã")||t.includes("phường")||t.includes("huyện")) headerMap.xa = i;
          else if(t.includes("thôn")||t.includes("xóm")) headerMap.thon = i;
          else if(t.includes("họ")||t.includes("tên")) headerMap.hoten = i;
          else if(t.includes("chức")) headerMap.chucvu = i;
          else if(t.includes("điện")||t.includes("số")||t.includes("sđt")) headerMap.sdt = i;
          else if(t.includes("trước")||t.includes("sáp")) headerMap.truoc = i;
          else if(t.includes("địa hình")||t.includes("đặc")) headerMap.diahinh = i;
          else if(t.includes("trạng")||t.includes("ngập")) headerMap.trangthai = i;
        });
      }
    }
    // map rows to objects (skip header row if headerMap)
    const start = headerMap ? 1 : 0;
    allRows = [];
    for(let i=start;i<rows.length;i++){
      const c = rows[i].c || [];
      const get=(idx)=> (c[idx] && c[idx].v!==undefined? c[idx].v : "");
      // default columns if no headerMap
      const m = headerMap || {tinh:0, xa:1, thon:2, hoten:3, chucvu:4, sdt:5, truoc:6, diahinh:7, trangthai:8};
      allRows.push({
        tinh: safe(get(m.tinh)),
        xa: safe(get(m.xa)),
        thon: safe(get(m.thon)),
        hoten: safe(get(m.hoten)),
        chucvu: safe(get(m.chucvu)),
        sdt: safe(get(m.sdt)),
        truoc: safe(get(m.truoc)),
        diahinh: safe(get(m.diahinh)),
        trangthai_raw: safe(get(m.trangthai))
      });
    }
    statusEl.textContent = `✅ Đã tải ${allRows.length} bản ghi. Bắt đầu phân tích trạng thái...`;
    return true;
  }catch(err){
    console.error(err);
    statusEl.textContent = "❌ Lỗi tải Google Sheet. Kiểm tra quyền chia sẻ (Anyone with link)";
    return false;
  }
}

// ----- Geocode commune name via Nominatim -----
async function geocodePlace(name, province){
  // Try cache first
  const key = `${province}||${name}`;
  if(groupStatusCache[key] && groupStatusCache[key].lat && (nowMs() - (groupStatusCache[key].updatedAt||0) < CACHE_TTL_MS)){
    return {lat:groupStatusCache[key].lat, lon:groupStatusCache[key].lon, cached:true};
  }
  // Build query: "Xã NAME, Tỉnh, Vietnam"
  const q = encodeURIComponent(`${name}, ${province}, Vietnam`);
  const url = `${NOMINATIM_URL}?format=json&q=${q}&limit=1&addressdetails=0&countrycodes=vn`;
  try{
    // Nominatim policy: add pause between requests; we will call with delay at caller
    const res = await fetch(url, {
      headers: {"Accept":"application/json","User-Agent":"Cuutro-Demo/1.0 (+https://github.com)"},
    });
    if(!res.ok) throw new Error("Geocode lỗi " + res.status);
    const arr = await res.json();
    if(arr && arr.length>0){
      const lat = parseFloat(arr[0].lat);
      const lon = parseFloat(arr[0].lon);
      // store minimal
      if(!groupStatusCache[key]) groupStatusCache[key] = {};
      groupStatusCache[key].lat = lat;
      groupStatusCache[key].lon = lon;
      groupStatusCache[key].updatedAt = nowMs();
      saveCache();
      return {lat,lon,cached:false};
    }else{
      return null;
    }
  }catch(e){
    console.warn("Geocode error", e);
    return null;
  }
}

// ----- Get elevation via OpenTopoData SRTM90m -----
async function getElevation(lat, lon){
  // try cache by latlon key
  const k = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  // find existing cache entry with same latlon
  for(const key in groupStatusCache){
    const g = groupStatusCache[key];
    if(g.lat && Math.abs(g.lat - lat) < 0.0005 && g.lon && Math.abs(g.lon - lon) < 0.0005 && g.elevation !== undefined && (nowMs() - (g.updatedAt||0) < CACHE_TTL_MS)){
      return g.elevation;
    }
  }
  try{
    const url = `${OPENTOPO_URL}?locations=${lat},${lon}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error("Elevation API lỗi " + res.status);
    const j = await res.json();
    if(j && j.results && j.results.length>0 && j.results[0].elevation !== undefined){
      const elev = Number(j.results[0].elevation);
      return elev;
    }
    return null;
  }catch(e){
    console.warn("Elevation error", e);
    return null;
  }
}

// ----- Get precipitation (last 3 hours) via Open-Meteo -----
async function getRecentPrecip(lat, lon){
  try{
    // request 24h hourly with timezone auto
    const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}&hourly=precipitation&timezone=auto`;
    const res = await fetch(url);
    if(!res.ok) throw new Error("Open-Meteo lỗi " + res.status);
    const j = await res.json();
    // find last 3 hourly values
    if(j && j.hourly && j.hourly.time && j.hourly.precipitation){
      const times = j.hourly.time;
      const prec = j.hourly.precipitation;
      const nowISO = new Date().toISOString().slice(0,13); // YYYY-MM-DDTHH
      // find index of last element that starts with current hour (j.hourly.time in local timezone maybe)
      let lastIdx = times.length - 1;
      // sum last 3 entries (if exist)
      let sum = 0;
      for(let i=0;i<3;i++){
        const idx = lastIdx - i;
        if(idx>=0 && prec[idx] !== undefined) sum += Number(prec[idx]);
      }
      return sum; // mm (approx)
    }
    return 0;
  }catch(e){
    console.warn("Open-Meteo error", e);
    return 0;
  }
}

// ----- Interpret severity based on elevation + precipitation -----
// return severity number (3 severe flood, 2 warning, 1 safe)
function computeSeverity(elevation_m, precip_mm){
  // rules (tunable):
  // if elevation <= 2m and precip_last3h >= 10mm -> severe
  // if elevation <=5m and precip_last3h >= 20mm -> severe
  // if precip_last3h >= 30mm -> severe
  // if precip >= 10mm -> warning
  // else safe
  const p = precip_mm || 0;
  const e = (elevation_m===null||elevation_m===undefined) ? 9999 : elevation_m;
  if(p >= 30) return 3;
  if(e <= 2 && p >= 10) return 3;
  if(e <= 5 && p >= 20) return 3;
  if(p >= 10) return 2;
  return 1;
}

// ----- For each unique commune compute unified status (geocode -> elevation -> precip -> severity) -----
async function computeStatusesForGroups(){
  statusEl.textContent = "🔎 Phân tích trạng thái ngập cho từng xã/phường (geocode + mưa + DEM)...";
  // build unique groups by province+commune
  const groups = {};
  allRows.forEach(r=>{
    const p = (r.tinh||"").trim();
    const c = (r.xa||"").trim();
    const key = `${p}||${c}`;
    if(!groups[key]) groups[key] = {province:p, commune:c, rows:[]};
    groups[key].rows.push(r);
  });

  // iterate groups and compute if not cached or cache expired
  const keys = Object.keys(groups);
  for(let i=0;i<keys.length;i++){
    const key = keys[i];
    const g = groups[key];
    // check cache
    const cacheEntry = groupStatusCache[key];
    if(cacheEntry && cacheEntry.updatedAt && (nowMs() - cacheEntry.updatedAt < CACHE_TTL_MS) && cacheEntry.label){
      // ok cached
      continue;
    }
    // geocode (respect delay)
    await sleep(GEOCODE_DELAY_MS);
    const geo = await geocodePlace(g.commune || g.province, g.province);
    if(!geo){
      // mark unknown
      groupStatusCache[key] = Object.assign({}, groupStatusCache[key] || {}, {lat:null, lon:null, elevation:null, precip:0, severity:1, label:"Chưa có tọa độ", updatedAt: nowMs()});
      saveCache();
      continue;
    }
    const lat = geo.lat, lon = geo.lon;
    // elevation
    const elev = await getElevation(lat, lon);
    // precipitation
    const precip = await getRecentPrecip(lat, lon);
    // compute severity
    const severity = computeSeverity(elev, precip);
    const label = (severity>=3) ? "NGẬP" : (severity===2 ? "CẢNH BÁO":"AN TOÀN");
    // store in cache
    groupStatusCache[key] = {
      lat, lon, elevation: elev, precip: precip, severity, label,
      updatedAt: nowMs()
    };
    saveCache();
  }
  statusEl.textContent = `✅ Phân tích xong (${Object.keys(groups).length} địa phương). Hiển thị dữ liệu...`;
}

// ----- Render table grouped (province -> commune) with unified status per commune ----- 
function renderGroupedTable(filteredRows = null){
  const rows = filteredRows || allRows;
  tbody.innerHTML = "";
  if(!rows || rows.length===0){
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:18px;color:#666">Không có dữ liệu</td></tr>`;
    return;
  }
  // group
  const groups = {};
  rows.forEach(r=>{
    const p = (r.tinh||"").trim();
    const c = (r.xa||"").trim();
    const key = `${p}||${c}`;
    if(!groups[p]) groups[p] = {};
    if(!groups[p][c]) groups[p][c] = [];
    groups[p][c].push(r);
  });

  // render
  const provinces = Object.keys(groups).sort();
  for(const prov of provinces){
    // province header row
    const trProv = document.createElement("tr");
    trProv.className = "group-province";
    const tdProv = document.createElement("td");
    tdProv.colSpan = 8;
    tdProv.textContent = prov || "(Chưa rõ tỉnh)";
    trProv.appendChild(tdProv);
    tbody.appendChild(trProv);

    const communes = Object.keys(groups[prov]).sort();
    for(const comm of communes){
      const trComm = document.createElement("tr");
      trComm.className = "group-commune";
      const tdComm = document.createElement("td");
      tdComm.colSpan = 8;
      // find unified status from cache
      const key = `${prov}||${comm}`;
      const cacheEntry = groupStatusCache[key];
      let statusLabel = "Đang cập nhật...";
      let statusClass = "";
      if(cacheEntry && cacheEntry.label){
        if(cacheEntry.severity >= 3) { statusLabel = `🌊 NGẬP — mưa ${cacheEntry.precip ?? 0}mm, cao độ ${cacheEntry.elevation ?? "?"}m`; statusClass = "status-flood";}
        else if(cacheEntry.severity === 2) { statusLabel = `⚠️ CẢNH BÁO — mưa ${cacheEntry.precip ?? 0}mm, cao độ ${cacheEntry.elevation ?? "?"}m`; statusClass = "status-warning";}
        else { statusLabel = `✅ AN TOÀN — mưa ${cacheEntry.precip ?? 0}mm, cao độ ${cacheEntry.elevation ?? "?"}m`; statusClass = "status-safe";}
      }
      tdComm.innerHTML = `${comm || "(Chưa rõ xã)"} — <span class="${statusClass}">${escapeHtml(statusLabel)}</span>`;
      trComm.appendChild(tdComm);
      tbody.appendChild(trComm);

      // rows for each officer in this commune
      groups[prov][comm].forEach(r=>{
        const tr = document.createElement("tr");
        const sdt = safe(r.sdt);
        const sdtHtml = sdt ? `<a class="call" href="tel:${sdt.replace(/\s+/g,'')}">Gọi</a> ${escapeHtml(sdt)}` : "";
        tr.innerHTML = `
          <td>${escapeHtml(r.tinh)}</td>
          <td>${escapeHtml(r.xa)}</td>
          <td>${escapeHtml(r.thon)}</td>
          <td>${escapeHtml(r.hoten)}</td>
          <td>${escapeHtml(r.chucvu)}</td>
          <td>${sdtHtml}</td>
          <td>${escapeHtml(r.diahinh)}</td>
          <td>${escapeHtml(r.trangthai_raw || '')}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }
}

// ----- filter helper -----
function filterAndRender(){
  const kw = (searchInput.value || "").toLowerCase().trim();
  if(!kw) { renderGroupedTable(); return; }
  const filtered = allRows.filter(r=>{
    return (r.tinh||"").toLowerCase().includes(kw) ||
           (r.xa||"").toLowerCase().includes(kw) ||
           (r.thon||"").toLowerCase().includes(kw) ||
           (r.hoten||"").toLowerCase().includes(kw) ||
           (r.sdt||"").toLowerCase().includes(kw) ||
           (r.chucvu||"").toLowerCase().includes(kw);
  });
  renderGroupedTable(filtered);
}

// ----- main flow -----
async function mainLoad(){
  loadCache();
  const ok = await loadSheet();
  if(!ok) return;
  // compute statuses for unique communes (with caching and polite delays)
  await computeStatusesForGroups();
  // render grouped table
  renderGroupedTable();
}

// ----- events -----
searchBtn.addEventListener("click", ()=> filterAndRender());
clearBtn.addEventListener("click", ()=>{ searchInput.value=""; filterAndRender(); });
refreshBtn.addEventListener("click", async ()=>{ await mainLoad(); });

// live search when typing
searchInput.addEventListener("input", ()=> filterAndRender());

// initial load + interval
mainLoad();
setInterval(()=> mainLoad(), UPDATE_INTERVAL_MS);
