// =========================
// CONFIG - chỉnh sửa nếu cần
// =========================
const sheetURL =
  "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?gid=325047141";

// OpenWeather API key của bạn (nên thay bằng key riêng)
const OPENWEATHER_API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";

// UI elements
const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resetBtn = document.getElementById("resetBtn");
const countInfo = document.getElementById("countInfo");

let globalData = [];
let markers = {}; // key -> marker
let markerGroup; // marker cluster group

// localStorage caches
let geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");
let weatherCache = JSON.parse(localStorage.getItem("weatherCache") || "{}");

// =========================
// Helper: safe parse GViz (robust)
// =========================
function parseGViz(text) {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i === -1 || j === -1) throw new Error("GViz parse fail");
  return JSON.parse(text.substring(i, j + 1));
}

// =========================
// Helper: timeout fetch
// =========================
function timeoutFetch(url, opts = {}, ms = 9000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

// =========================
// Concurrency worker pool
// =========================
function concurrencyPool(items, worker, limit = 6) {
  let i = 0;
  const results = [];
  const runners = Array.from({ length: limit }, async () => {
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

// =========================
// Map init
// =========================
const map = L.map("map", { center: [14.5, 107.5], zoom: 6, preferCanvas: true });
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
markerGroup = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
map.addLayer(markerGroup);

// =========================
// Utility
// =========================
function setStatusHTML(html) { statusDiv.innerHTML = html; }
function rowKey(row) { return `${row["Tỉnh/TP"]}__${row["Xã/Phường"]}`; }
function safe(x) { return (x === null || x === undefined) ? "" : x; }
function sanitizeId(s) { return s.replace(/[^a-z0-9_\-]/gi, "_"); }

// =========================
// Fetch Google Sheet
// =========================
async function fetchData() {
  try {
    setStatusHTML('<span class="spinner"></span> Đang tải dữ liệu từ Google Sheets...');
    const res = await timeoutFetch(sheetURL + "&t=" + Date.now(), {}, 12000);
    const text = await res.text();
    const json = parseGViz(text);

    const rows = (json.table.rows || [])
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

    globalData = rows.map((r, idx) => {
      const o = {};
      headers.forEach((h, i) => o[h] = r[i] || "");
      o["Rain"] = 0;
      o["Trạng thái ngập"] = "Chưa có";
      o._key = rowKey(o);
      o._id = `row-${sanitizeId(o._key)}`;
      o._geo = geoCache[o._key] || null;
      return o;
    });

    renderTable(globalData);
    countInfo.textContent = `${globalData.length} hàng`;

    // start geo + weather updates (concurrent)
    await updateGeoAndWeather();
  } catch (err) {
    console.error("fetchData error", err);
    setStatusHTML('❌ Không tải được Google Sheet. Kiểm tra URL/quyền (anyone with link).');
  }
}

// =========================
// Geocode via OpenWeather geo API
// =========================
async function getLatLon(province, commune) {
  const key = `${province}-${commune}`;
  if (geoCache[key]) return geoCache[key];

  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(commune + "," + province + ",VN")}&limit=1&appid=${OPENWEATHER_API_KEY}`;
    const res = await timeoutFetch(url, {}, 7000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data[0]) return null;
    const geo = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    geoCache[key] = geo;
    localStorage.setItem("geoCache", JSON.stringify(geoCache));
    return geo;
  } catch (e) {
    console.warn("getLatLon error", e);
    return null;
  }
}

// =========================
// Weather via OpenWeather current
// =========================
async function getWeatherWithCache(province, commune, lat, lon) {
  const key = `${province}-${commune}`;
  // cache valid for 30 min
  const cached = weatherCache[key];
  if (cached && (Date.now() - (cached._ts || 0) < 1000 * 60 * 30)) return cached;

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const res = await timeoutFetch(url, {}, 7000);
    if (!res.ok) return { rain: 0, status: "Bình thường" };
    const w = await res.json();
    const rain = (w.rain?.["1h"] ?? w.rain?.["3h"] ?? 0);
    let status = rain > 50 ? "Ngập nặng" : rain > 30 ? "Ngập sâu" : rain > 10 ? "Ngập nhẹ" : "Bình thường";
    const out = { rain, status, _ts: Date.now() };
    weatherCache[key] = out;
    localStorage.setItem("weatherCache", JSON.stringify(weatherCache));
    return out;
  } catch (e) {
    console.warn("getWeather error", e);
    return { rain: 0, status: "Bình thường" };
  }
}

// =========================
// Update geo + weather (concurrent, incremental UI updates)
// =========================
async function updateGeoAndWeather() {
  setStatusHTML('<span class="spinner"></span> Đang cập nhật vị trí & thời tiết...');
  const items = globalData.map((r, i) => ({ r, i }));
  let updated = 0;
  const total = items.length;

  const worker = async (item) => {
    const row = item.r;
    try {
      // geocode if not have
      if (!row._geo) {
        const g = await getLatLon(row["Tỉnh/TP"], row["Xã/Phường"]);
        row._geo = g;
      }
      if (row._geo && row._geo.lat && row._geo.lon) {
        const w = await getWeatherWithCache(row["Tỉnh/TP"], row["Xã/Phường"], row._geo.lat, row._geo.lon);
        row["Rain"] = w.rain;
        row["Trạng thái ngập"] = w.status;
        addOrUpdateMarkerForRow(row);
      } else {
        row["Rain"] = 0;
        row["Trạng thái ngập"] = "Không có vị trí";
      }
      updateRowInTable(row);
    } catch (e) {
      console.warn("worker err", e);
    } finally {
      updated++;
      setStatusHTML(`${updated}/${total} hàng đã cập nhật — Cập nhật vị trí & thời tiết...`);
    }
  };

  await concurrencyPool(items, worker, 6);
  setStatusHTML(`✔ Cập nhật hoàn tất (${updated}/${total}).`);
}

// =========================
// Render table (initial) & update functions
// =========================
function renderTable(data) {
  dataBody.innerHTML = "";
  data.forEach(row => {
    const tr = document.createElement("tr");
    tr.id = row._id;
    tr.dataset.key = row._key;
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
    // click on table row -> open popup + zoom
    tr.addEventListener("click", () => {
      onRowClick(row);
    });
    dataBody.appendChild(tr);
  });
}

// Update an existing row in DOM (live)
function updateRowInTable(row) {
  const tr = document.getElementById(row._id);
  if (!tr) return;
  const rainCell = tr.querySelector(".rain-cell");
  const statusCell = tr.querySelector(".status-cell");
  rainCell.innerHTML = `<b>${safe(row["Rain"])}</b>`;
  statusCell.textContent = safe(row["Trạng thái ngập"]);
  applyRowColor(tr, row["Trạng thái ngập"]);
}

// apply color classes
function applyRowColor(tr, status) {
  tr.classList.remove("status-flood", "status-warning", "status-safe", "status-unknown");
  if (status === "Ngập nặng") tr.classList.add("status-flood");
  else if (status === "Ngập sâu" || status === "Ngập nhẹ") tr.classList.add("status-warning");
  else if (status === "Bình thường") tr.classList.add("status-safe");
  else tr.classList.add("status-unknown");
}

// =========================
// Map marker functions
// =========================
function addOrUpdateMarkerForRow(row) {
  if (!row._geo || !row._geo.lat || !row._geo.lon) return;
  const key = row._key;
  const latlng = [row._geo.lat, row._geo.lon];

  if (markers[key]) {
    markers[key].setLatLng(latlng);
    markers[key].setStyle({ color: pickColorForStatus(row["Trạng thái ngập"]) });
    markers[key].bindPopup(makePopupHTML(row));
  } else {
    const circle = L.circleMarker(latlng, {
      radius: 7,
      weight: 1,
      fillOpacity: 0.95,
      color: pickColorForStatus(row["Trạng thái ngập"])
    });
    circle.bindPopup(makePopupHTML(row));
    circle.on("click", () => {
      highlightRow(row._id);
    });
    markers[key] = circle;
    markerGroup.addLayer(circle);
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
  if (status === "Ngập nặng") return "#b30000";
  if (status === "Ngập sâu") return "#ff6b00";
  if (status === "Ngập nhẹ") return "#ffcc00";
  if (status === "Bình thường") return "#2ecc71";
  return "#777777";
}

// click row -> zoom to marker & open popup
function onRowClick(row) {
  const key = row._key;
  const m = markers[key];
  if (m) {
    map.setView(m.getLatLng(), 12);
    m.openPopup();
    highlightRow(row._id);
  } else {
    // no marker: try to geocode quickly and add
    if (row._geo && row._geo.lat && row._geo.lon) {
      map.setView([row._geo.lat, row._geo.lon], 12);
      highlightRow(row._id);
    } else {
      alert("Chưa có vị trí cho xã này.");
    }
  }
}

// highlight row visually
function highlightRow(rowId) {
  // remove existing highlight
  document.querySelectorAll("tr.highlighted").forEach(t => t.classList.remove("highlighted"));
  const tr = document.getElementById(rowId);
  if (tr) {
    tr.classList.add("highlighted");
    // scroll into view
    tr.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// =========================
// Search & UI bindings
// =========================
searchBtn.addEventListener("click", () => {
  const kw = (searchInput.value || "").toLowerCase().trim();
  const filtered = globalData.filter(r =>
    (r["Tỉnh/TP"] || "").toLowerCase().includes(kw) ||
    (r["Xã/Phường"] || "").toLowerCase().includes(kw)
  );
  renderTable(filtered);
  countInfo.textContent = `${filtered.length}/${globalData.length} hiển thị`;
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

// =========================
// START
// =========================
fetchData();
