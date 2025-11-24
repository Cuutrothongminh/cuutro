// =========================
// CONFIG
// =========================
const sheetURL =
  "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?gid=325047141";

const OPENWEATHER_API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";

const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

let globalData = [];

// Cache
let geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");
let weatherCache = JSON.parse(localStorage.getItem("weatherCache") || "{}");

// =========================
// FIX PARSE GOOGLE GVIZ
// =========================
function parseGViz(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.substring(start, end + 1));
}

// =========================
// FETCH GOOGLE SHEET
// =========================
async function fetchData() {
  try {
    statusDiv.textContent = "🕓 Đang tải dữ liệu từ Google Sheet...";

    const res = await fetch(sheetURL + "&t=" + Date.now());
    const text = await res.text();
    const json = parseGViz(text);

    const rows = json.table.rows
      .map(r => r.c.map(c => (c?.v ? c.v.toString().trim() : "")))
      .filter(r => r && r.some(x => x !== "") && r[0] !== "Tỉnh/TP");

    const headers = [
      "Tỉnh/TP",
      "Xã/Phường",
      "Họ và tên",
      "Chức vụ",
      "SĐT",
      "Trước sáp nhập",
      "Huyện - Tỉnh cũ",
      "Đặc điểm địa hình",
      "Rain",
      "Trạng thái ngập"
    ];

    globalData = rows.map(r => {
      const o = {};
      headers.forEach((h, i) => (o[h] = r[i] || ""));
      return o;
    });

    updateWeatherStatus();
  } catch (err) {
    console.error(err);
    statusDiv.textContent = "❌ Lỗi tải dữ liệu!";
  }
}

// =========================
// GEO
// =========================
async function getLatLon(province, commune) {
  const key = `${province}-${commune}`;
  if (geoCache[key]) return geoCache[key];

  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
      commune + "," + province + ",VN"
    )}&limit=1&appid=${OPENWEATHER_API_KEY}`;

    const geo = await fetch(url).then(r => r.json());
    if (!geo[0]) return null;

    const { lat, lon } = geo[0];
    geoCache[key] = { lat, lon };
    localStorage.setItem("geoCache", JSON.stringify(geoCache));

    return { lat, lon };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// =========================
// WEATHER
// =========================
async function getWeather(province, commune, lat, lon) {
  const key = `${province}-${commune}`;
  if (weatherCache[key]) return weatherCache[key];

  try {
    const url =
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}` +
      `&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const res = await fetch(url);
    const w = await res.json();

    const rain = w.rain?.["1h"] ?? w.rain?.["3h"] ?? 0;

    let status =
      rain > 50 ? "Ngập nặng" :
      rain > 30 ? "Ngập sâu" :
      rain > 10 ? "Ngập nhẹ" :
                  "Bình thường";

    weatherCache[key] = { rain, status };
    localStorage.setItem("weatherCache", JSON.stringify(weatherCache));

    return { rain, status };
  } catch (err) {
    return { rain: 0, status: "Bình thường" };
  }
}

// =========================
// RENDER
// =========================
function renderTable(data) {
  dataBody.innerHTML = "";

  data.forEach(row => {
    let cls =
      row["Trạng thái ngập"] === "Ngập nặng" ? "status-flood" :
      row["Trạng thái ngập"] === "Ngập sâu"  ? "status-warning" :
      row["Trạng thái ngập"] === "Ngập nhẹ" ? "status-warning" :
                                               "status-safe";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row["Tỉnh/TP"]}</td>
      <td>${row["Xã/Phường"]}</td>
      <td>${row["Họ và tên"]}</td>
      <td>${row["Chức vụ"]}</td>
      <td>${row["SĐT"]}</td>
      <td>${row["Trước sáp nhập"]}</td>
      <td>${row["Huyện - Tỉnh cũ"]}</td>
      <td>${row["Đặc điểm địa hình"]}</td>
      <td>${row["Rain"]}</td>
      <td class="${cls}">${row["Trạng thái ngập"]}</td>
    `;
    dataBody.appendChild(tr);
  });
}

// =========================
// UPDATE WEATHER
// =========================
async function updateWeatherStatus() {
  statusDiv.textContent = "⏳ Đang cập nhật thời tiết từng xã...";

  for (let row of globalData) {
    const { lat, lon } = await getLatLon(row["Tỉnh/TP"], row["Xã/Phường"]) || {};
    if (!lat) continue;

    const { rain, status } = await getWeather(
      row["Tỉnh/TP"],
      row["Xã/Phường"],
      lat,
      lon
    );

    row["Rain"] = rain;
    row["Trạng thái ngập"] = status;
  }

  renderTable(globalData);
  statusDiv.textContent = "✅ Đã cập nhật xong!";
}

// =========================
// SEARCH
// =========================
searchBtn.addEventListener("click", () => {
  const kw = searchInput.value.toLowerCase();
  const filtered = globalData.filter(r =>
    r["Tỉnh/TP"].toLowerCase().includes(kw) ||
    r["Xã/Phường"].toLowerCase().includes(kw)
  );
  renderTable(filtered);
});

// =========================
// INIT
// =========================
fetchData();
