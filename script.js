// script.js - Smart Relief Table Optimized
const API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";
const SHEET_GVIZ = "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";
const AUTO_INTERVAL = 15*60*1000;
const WEATHER_TTL = 12*60*1000, GEO_TTL = 24*60*60*1000;

const dom = {
  sheetStatus: document.getElementById("sheetStatus"),
  updateStatus: document.getElementById("updateStatus"),
  provinceList: document.getElementById("provinceList"),
  dataBody: document.getElementById("dataBody"),
  mapDiv: document.getElementById("map"),
  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  rainFilter: document.getElementById("rainFilter"),
  alertFilter: document.getElementById("alertFilter"),
  expandAllBtn: document.getElementById("expandAll"),
  collapseAllBtn: document.getElementById("collapseAll"),
  pageSizeSelect: document.getElementById("pageSize"),
  prevPageBtn: document.getElementById("prevPage"),
  nextPageBtn: document.getElementById("nextPage"),
  currentPageEl: document.getElementById("currentPage"),
  totalPageEl: document.getElementById("totalPage"),
  resultCountEl: document.getElementById("resultCount"),
  sortSelect: document.getElementById("sortSelect"),
};

let rawRows=[], filteredRows=[], currentPage=1, pageSize=parseInt(dom.pageSizeSelect.value||50);
let geoCache=JSON.parse(localStorage.getItem("geoCache")||"{}");
let weatherCache=JSON.parse(localStorage.getItem("weatherCache")||"{}");
let markers={}, map=null;

const normalize = s => (s||"").toString().toLowerCase().trim();
const saveCache = (k,v)=>localStorage.setItem(k,JSON.stringify(v));
const locKeyForRow = r=>`${r["Thôn/Xóm"]||""}|${r["Xã/Phường"]||""}|${r["Huyện - Tỉnh cũ"]||r["Huyện"]||""}|${r["Tỉnh/TP"]||""}`.replace(/\s+/g," ").trim();
const colorByRain = rain => rain<5?"#9fe6a6":rain<20?"#fff6a8":rain<50?"#ffd8a8":"#ffb4b4";
const parallelLimit = async (list,limit,fn)=>{
  let i=0; const workers=Array(Math.min(limit,list.length)).fill(0).map(async()=>{
    while(i<list.length){ const idx=i++; await fn(list[idx]).catch(console.error); }
  });
  await Promise.all(workers);
};

// MAP INIT
function initMap(){ map=L.map('map').setView([16.0,108.0],6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map); }

// GEOCODE + WEATHER
async function geocodeRow(r){
  const key=locKeyForRow(r), now=Date.now();
  if(geoCache[key]?.lat!=null && now-geoCache[key].ts<GEO_TTL) return geoCache[key];
  if(r.lat && r.lon){ geoCache[key]={lat:parseFloat(r.lat),lon:parseFloat(r.lon),ts:now}; saveCache("geoCache",geoCache); return geoCache[key]; }
  const q=[r["Thôn/Xóm"],r["Xã/Phường"],r["Huyện - Tỉnh cũ"]||r["Huyện"],r["Tỉnh/TP"],"Vietnam"].filter(Boolean).join(", ");
  try{
    const res=await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${API_KEY}`);
    const j=await res.json();
    geoCache[key]=j[0]?{lat:j[0].lat,lon:j[0].lon,ts:now}:{lat:null,lon:null,ts:now};
  }catch(e){ geoCache[key]={lat:null,lon:null,ts:now}; console.error(e); }
  saveCache("geoCache",geoCache); return geoCache[key];
}

async function fetchWeatherForLoc(key,lat,lon){
  const now=Date.now();
  if(weatherCache[key]?.ts && now-weatherCache[key].ts<WEATHER_TTL) return weatherCache[key];
  try{
    const res=await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);
    const j=await res.json();
    const rain=j.rain?.["1h"]??j.rain?.["3h"]??0;
    const status=rain>=50?"Ngập nặng":rain>=30?"Ngập sâu":rain>=10?"Ngập nhẹ":"Bình thường";
    const hasAlert=(j.weather?.some(w=>/(thunderstorm|storm|heavy|extreme)/i.test(w.description)))||rain>=50;
    weatherCache[key]={rain:parseFloat(rain),status,hasAlert,raw:j,ts:now};
  }catch(e){ weatherCache[key]={rain:0,status:"Bình thường",hasAlert:false,ts:now}; console.error(e); }
  saveCache("weatherCache",weatherCache);
  return weatherCache[key];
}

// FETCH SHEET
async function fetchSheet(){
  dom.sheetStatus.textContent="Đang tải dữ liệu...";
  try{
    const res=await fetch(SHEET_GVIZ);
    let txt=await res.text(); txt=txt.replace("/*O_o*/","").replace("google.visualization.Query.setResponse(","").slice(0,-2);
    const data=JSON.parse(txt);
    const sheetRows=data.table.rows||[];
    rawRows=sheetRows.map(r=>{
      const c=r.c||[];
      return {
        "Tỉnh/TP":c[0]?.v||"", "Xã/Phường":c[1]?.v||"", "Chức vụ":c[2]?.v||"",
        "Họ và tên":c[3]?.v||"", "Số điện thoại":c[4]?.v||"", "Trước sáp nhập":c[5]?.v||"",
        "Huyện - Tỉnh cũ":c[6]?.v||"", "Đặc điểm địa hình":c[7]?.v||"", "Thôn/Xóm":c[8]?.v||"",
        lat:c[9]?.v||"", lon:c[10]?.v||"", _raw:c
      };
    });
    dom.sheetStatus.textContent="Đã tải dữ liệu";
    applyFilters();
  }catch(e){ dom.sheetStatus.textContent="Lỗi tải dữ liệu"; console.error(e); }
}

// FILTER + RENDER
async function applyFilters(context={}){
  filteredRows=rawRows.slice();
  if(context.prov) filteredRows=filteredRows.filter(r=>r["Tỉnh/TP"]===context.prov);
  if(context.dist) filteredRows=filteredRows.filter(r=>r["Huyện - Tỉnh cũ"]===context.dist);
  if(context.comm) filteredRows=filteredRows.filter(r=>r["Xã/Phường"]===context.comm);
  const q=normalize(dom.searchInput.value);
  if(q) filteredRows=filteredRows.filter(r=>['Tỉnh/TP','Huyện - Tỉnh cũ','Xã/Phường','Thôn/Xóm','Họ và tên','Số điện thoại','Chức vụ','Đặc điểm địa hình'].some(k=>normalize(r[k]).includes(q)));
  await renderGrouped(filteredRows);
}

// RENDER GROUP + TABLE + MAP
async function renderGrouped(rows){
  dom.updateStatus.textContent="Đang cập nhật bản đồ & thời tiết...";
  dom.dataBody.innerHTML="";
  if(!map) initMap();
  Object.values(markers).forEach(m=>map.removeLayer(m)); markers={};

  const flatList=rows;
  const keys=[...new Set(flatList.map(locKeyForRow))];
  await parallelLimit(keys,6,key=>geocodeRow(flatList.find(r=>locKeyForRow(r)===key)));
  await parallelLimit(keys,6,async key=>{ const g=geoCache[key]; if(g?.lat!=null) await fetchWeatherForLoc(key,g.lat,g.lon); });

  pageSize=parseInt(dom.pageSizeSelect.value||50);
  const total=flatList.length, totalPage=Math.max(1,Math.ceil(total/pageSize));
  if(currentPage>totalPage) currentPage=totalPage;
  dom.currentPageEl.textContent=currentPage; dom.totalPageEl.textContent=totalPage; dom.resultCountEl.textContent=total;

  const pageSlice=flatList.slice((currentPage-1)*pageSize,(currentPage-1)*pageSize+pageSize);
  pageSlice.forEach(r=>{
    const key=locKeyForRow(r), geo=geoCache[key]||{}, w=weatherCache[key]||{rain:0,status:"Bình thường",hasAlert:false};
    const rain=w.rain||0;
    const tr=document.createElement("tr");
    tr.className=rain<5?"row-green":rain<20?"row-yellow":rain<50?"row-orange":"row-red";
    tr.innerHTML=`
      <td>${r["Tỉnh/TP"]}</td><td>${r["Huyện - Tỉnh cũ"]}</td><td>${r["Xã/Phường"]}</td><td>${r["Thôn/Xóm"]}</td><td>${r["Chức vụ"]}</td>
      <td>${r["Họ và tên"]}</td><td><a href="tel:${r["Số điện thoại"]}">${r["Số điện thoại"]}</a></td>
      <td>${r["Đặc điểm địa hình"]}</td><td>${rain.toFixed(1)}</td><td>${w.status}${w.hasAlert?' ⚠️':''}</td>
      <td><a class="btn btn-sm btn-success" href="tel:${r["Số điện thoại"]}">Gọi</a></td>`;
    tr.addEventListener('click',()=>{ if(geo?.lat!=null){ map.setView([geo.lat,geo.lon],13); markers[key]?.openPopup?.(); } });
    dom.dataBody.appendChild(tr);

    if(geo?.lat!=null && !markers[key]){
      const circle=L.circleMarker([geo.lat,geo.lon],{radius:7,color:colorByRain(rain),fillColor:colorByRain(rain),fillOpacity:0.9});
      circle.bindPopup(`<strong>${r["Xã/Phường"]}</strong><br>${r["Họ và tên"]}<br>${r["Số điện thoại"]}<br>Mưa: ${rain.toFixed(1)} mm<br>${w.status}${w.hasAlert?' ⚠️':''}`);
      circle.addTo(map); markers[key]=circle;
    }
  });
  dom.updateStatus.textContent=`Cập nhật: ${new Date().toLocaleString('vi-VN')}`;
}

// EVENT LISTENERS
dom.searchBtn.addEventListener('click',()=>applyFilters());
dom.refreshBtn.addEventListener('click',()=>fetchSheet());
dom.prevPageBtn.addEventListener('click',()=>{ if(currentPage>1){ currentPage--; applyFilters(); }});
dom.nextPageBtn.addEventListener('click',()=>{ currentPage++; applyFilters(); });
dom.pageSizeSelect.addEventListener('change',()=>{ currentPage=1; applyFilters(); });
dom.sortSelect.addEventListener('change',()=>applyFilters());

// INIT
fetchSheet();
setInterval(fetchSheet,AUTO_INTERVAL);
