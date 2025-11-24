// =========================
// CONFIG
// =========================
const sheetURL =
  "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";

// Thay API key của bạn nếu cần
const OPENWEATHER_API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";

const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resetBtn = document.getElementById("resetBtn");
const countInfo = document.getElementById("countInfo");

let globalData = [];
let markers = {}; // key -> marker

// Cache (localStorage)
let geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");
let weatherCache = JSON.parse(localStorage.getItem("weatherCache") || "{}");

// Leaflet map init
const map = L.map('map', { center: [14.5, 107.5], zoom: 6, preferCanvas: true });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19
}).addTo(map);

// =========================
// HELPERS
// =========================
function timeoutFetch(resource, options = {}) {
  const { timeout = 9000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(resource, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

function concurrencyPool(items, worker, limit = 5) {
  // returns promise that resolves when all done
  let i = 0;
  const results = [];
  const runners = new Array(limit).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (e) {
        results[idx] = null;
      }
    }
  });
  return Promise.all(runners).then(() => results);
}

function setStatusHTML(html) {
  statusDiv.innerHTML = html;
}

// mapping helper for row key
function rowKey(r) {
  return `${r["Tỉnh/TP"]}--${r["Xã/Phường"]}`;
}

// safe text
function safe(x) { return (x===undefined || x===null) ? "" : x; }

// =========================
// FETCH SHEET
// =========================
async function fetchData() {
  try {
    setStatusHTML('<span class="spinner"></span> Đang tải dữ liệu từ Google Sheets...');
    const res = await timeoutFetch(sheetURL + "&t=" + Date.now(), { timeout: 10000 });
    const text = await res.text();
    // gviz JSON wrapper: remove prefix/suffix
    const json = JSON.parse(text.substring(47).slice(0, -2));
    const rows = json.table.rows
      .map(r => r.c?.map(c => (c && c.v ? c.v.toString().trim() : "")))
      .filter(r => r && r.some(x => x !== ""));
    const headers = [
      "Tỉnh/TP",
      "Xã/Phường",
      "Họ và tên",
      "Chức vụ",
      "SĐT",
      "Trước sáp nhập",
      "Huyện - Tỉnh cũ",
      "Đặc điểm địa hình"
    ];
    globalData = rows.map(r => {
      const obj = {};
      headers.forEach((h,i) => obj[h] = r[i] || "");
      obj["Rain"] = 0;
      obj["Trạng thái ngập"] = "Chưa có";
      obj._key = rowKey(obj);
      obj._geo = geoCache[obj._key] || null;
      return obj;
    });

    renderTable(globalData); // render immediately
    countInfo.textContent = `${globalData.length} hàng`;

    // start background update (geocode + weather) with concurrency control
    await updateGeoAndWeather();
  } catch (err) {
    console.error("Fetch sheet err", err);
    setStatusHTML('❌ Không tải được dữ liệu từ Google Sheet. Kiểm tra quyền truy cập hoặc URL.');
  }
}

// =========================
// GEO (OpenWeather geocoding)
// =========================
async function getLatLon(province, commune) {
  const key = `${province}-${commune}`;
  if (geoCache[key]) return geoCache[key];

  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(commune + "," + province + ",VN")}&limit=1&appid=${OPENWEATHER_API_KEY}`;
    const res = await timeoutFetch(url, { timeout: 7000 });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data[0]) return null;
    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    geoCache[key] = { lat, lon };
    localStorage.setItem("geoCache", JSON.stringify(geoCache));
    return geoCache[key];
  } catch (e) {
    console.warn("Geo error", e);
    return null;
  }
}

// =========================
// WEATHER
// =========================
async function getWeatherWithCache(province, commune, lat, lon) {
  const key = `${province}-${commune}`;
  if (weatherCache[key] && (Date.now() - (weatherCache[key]._ts || 0) < 1000 * 60 * 60)) {
    // cache valid 1 hour
    return weatherCache[key];
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const res = await timeoutFetch(url, { timeout: 7000 });
    if (!res.ok) return { rain: 0, status: "Bình thường" };
    const w = await res.json();
    const rain = (w.rain?.["1h"] ?? w.rain?.["3h"] ?? 0);
    let status;
    if (rain > 50) status = "Ngập nặng";
    else if (rain > 30) status = "Ngập sâu";
    else if (rain > 10) status = "Ngập nhẹ";
    else status = "Bình thường";
    const out = { rain, status, _ts: Date.now() };
    weatherCache[key] = out;
    localStorage.setItem("weatherCache", JSON.stringify(weatherCache));
    return out;
  } catch (e) {
    console.warn("Weather error", e);
    return { rain: 0, status: "Bình thường" };
  }
}

// =========================
// UPDATE GEO + WEATHER (concurrent, incremental updates)
// =========================
async function updateGeoAndWeather() {
  setStatusHTML('<span class="spinner"></span> Cập nhật vị trí & thời tiết...');

  // prepare items to update (only those with commune & province)
  const items = globalData.map((r, idx) => ({ r, idx }));

  let updatedCount = 0;
  const total = items.length;

  // worker for each item
  const worker = async (item) => {
    const row = item.r;
    const key = row._key;

    // get geo
    let geo = row._geo;
    if (!geo) {
      geo = await getLatLon(row["Tỉnh/TP"], row["Xã/Phường"]);
      row._geo = geo;
    }

    // if have geo, add marker and fetch weather
    if (geo && geo.lat && geo.lon) {
      // fetch weather
      const w = await getWeatherWithCache(row["Tỉnh/TP"], row["Xã/Phường"], geo.lat, geo.lon);
      row["Rain"] = w.rain;
      row["Trạng thái ngập"] = w.status;

      // update marker on map
      updateMarkerForRow(row, geo);
    } else {
      // no geo -> leave defaults
      row["Rain"] = 0;
      row["Trạng thái ngập"] = "Không có vị trí";
    }

    // update row in table live
    updateRowInTable(row);

    updatedCount++;
    setStatusHTML(`${updatedCount}/${total} hàng đã cập nhật — Cập nhật vị trí & thời tiết...`);
  };

  // run with concurrency limit 6
  await concurrencyPool(items, worker, 6);

  setStatusHTML(`✔ Cập nhật hoàn tất (${updatedCount}/${total}).`);
}

// =========================
// RENDER & UPDATE ROWS
// =========================
function renderTable(data) {
  dataBody.innerHTML = "";
  data.forEach(row => {
    const tr = document.createElement("tr");
    tr.id = `row-${sanitizeId(row._key)}`;
    tr.innerHTML = `
      <td>${safe(row["Tỉnh/TP"])}</td>
      <td>${safe(row["Xã/Phường"])}</td>
      <td>${safe(row["Họ và tên"])}</td>
      <td>${safe(row["Chức vụ"])}</td>
      <td>${safe(row["SĐT"])}</td>
      <td>${safe(row["Đặc điểm địa hình"])}</td>
      <td class="rain-cell">${safe(row["Rain"])}</td>
      <td class="status-cell">${safe(row["Trạng thái ngập"])}</td>
    `;
    applyRowColor(tr, row["Trạng thái ngập"]);
    dataBody.appendChild(tr);

    // if there is geo from cache, show marker now
    if (row._geo && row._geo.lat && row._geo.lon) {
      updateMarkerForRow(row, row._geo);
    }
  });
}

function updateRowInTable(row) {
  const id = `row-${sanitizeId(row._key)}`;
  const tr = document.getElementById(id);
  if (!tr) return;
  const rainCell = tr.querySelector(".rain-cell");
  const statusCell = tr.querySelector(".status-cell");
  rainCell.innerHTML = `<b>${safe(row["Rain"])}</b>`;
  statusCell.textContent = safe(row["Trạng thái ngập"]);
  applyRowColor(tr, row["Trạng thái ngập"]);
}

function applyRowColor(tr, status) {
  tr.classList.remove("status-flood","status-warning","status-safe","status-unknown");
  if (status === "Ngập nặng") tr.classList.add("status-flood");
  else if (status === "Ngập sâu" || status === "Ngập nhẹ") tr.classList.add("status-warning");
  else if (status === "Bình thường") tr.classList.add("status-safe");
  else tr.classList.add("status-unknown");
}

function sanitizeId(s) {
  return s.replace(/[^a-z0-9_\-]/gi, "_");
}

// =========================
// MAP: markers update
// =========================
function updateMarkerForRow(row, geo) {
  if (!geo || !geo.lat || !geo.lon) return;
  const key = row._key;
  const pos = [geo.lat, geo.lon];
  // if exists, update popup/content
  if (markers[key]) {
    markers[key].setLatLng(pos);
    markers[key].setPopupContent(makePopupHTML(row));
  } else {
    const marker = L.circleMarker(pos, {
      radius: 6,
      weight: 1,
      fillOpacity: 0.9,
      color: pickColorForStatus(row["Trạng thái ngập"])
    }).addTo(map);
    marker.bindPopup(makePopupHTML(row));
    markers[key] = marker;
  }
}

function makePopupHTML(row) {
  return `<strong>${safe(row["Xã/Phường"])} — ${safe(row["Tỉnh/TP"])}</strong><br/>
    ${safe(row["Họ và tên"])} (${safe(row["Chức vụ"])})<br/>
    SĐT: ${safe(row["SĐT"])}<br/>
    Mưa: <b>${safe(row["Rain"])}</b> mm<br/>
    Trạng thái: <b>${safe(row["Trạng thái ngập"])}</b>`;
}

function pickColorForStatus(status) {
  if (status === "Ngập nặng") return "#c70000";
  if (status === "Ngập sâu") return "#ff6b00";
  if (status === "Ngập nhẹ") return "#ffcc00";
  if (status === "Bình thường") return "#2ecc71";
  return "#999999";
}

// =========================
// SEARCH & UI
// =========================
searchBtn.addEventListener("click", () => {
  const kw = searchInput.value.toLowerCase().trim();
  const filtered = globalData.filter(r =>
    (r["Tỉnh/TP"] || "").toLowerCase().includes(kw) ||
    (r["Xã/Phường"] || "").toLowerCase().includes(kw)
  );
  renderTable(filtered);
  countInfo.textContent = `${filtered.length}/${globalData.length} hiển thị`;
  // zoom map to markers of filtered entries
  zoomMapToFiltered(filtered);
});

resetBtn.addEventListener("click", () => {
  renderTable(globalData);
  countInfo.textContent = `${globalData.length} hàng`;
  map.setView([14.5, 107.5], 6);
});

function zoomMapToFiltered(list) {
  const latlngs = list
    .map(r => r._geo)
    .filter(g => g && g.lat && g.lon)
    .map(g => [g.lat, g.lon]);
  if (latlngs.length === 0) return;
  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { maxZoom: 12, padding: [30,30] });
}

// START
fetchData();
