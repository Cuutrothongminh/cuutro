// =========================
// CONFIG
// =========================
const sheetURL = "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?gid=325047141";

const OPENWEATHER_API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";

const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");

let globalData = [];

// CACHE
let geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");
let weatherCache = JSON.parse(localStorage.getItem("weatherCache") || "{}");

// =========================
// GOOGLE SHEET FETCH (SAFE)
// =========================
async function fetchData() {
  try {
    const res = await fetch(sheetURL + "&t=" + Date.now());
    const raw = await res.text();

    // FIX LỖI JSON GVIZ
    const jsonText = raw.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
    if (!jsonText) throw new Error("Không parse được dữ liệu gviz");

    const json = JSON.parse(jsonText[1]);

    const rows = json.table.rows.map(r =>
      r.c.map(c => (c && c.v ? c.v.toString().trim() : ""))
    );

    globalData = rows.map(r => ({
      "Tỉnh/TP": r[0] || "",
      "Xã/Phường": r[1] || "",
      "Họ và tên": r[2] || "",
      "Chức vụ": r[3] || "",
      "SĐT": r[4] || "",
      "Trước sáp nhập": r[5] || "",
      "Huyện - Tỉnh cũ": r[6] || "",
      "Địa hình": r[7] || ""
    }));

    await updateWeatherStatus();
  } catch (e) {
    console.error(e);
    statusDiv.textContent = "❌ Không tải được dữ liệu Google Sheet!";
  }
}

// =========================
// GET LAT/LON (AUTO)
// =========================
async function getLatLon(province, commune) {
  const key = `${province}-${commune}`;
  if (geoCache[key]) return geoCache[key];

  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(commune + "," + province + ",VN")}&limit=1&appid=${OPENWEATHER_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data[0]) return null;

    const { lat, lon } = data[0];
    geoCache[key] = { lat, lon };
    localStorage.setItem("geoCache", JSON.stringify(geoCache));
    return { lat, lon };
  } catch {
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
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const res = await fetch(url);
    const data = await res.json();

    const rain = data.rain?.["1h"] ?? data.rain?.["3h"] ?? 0;

    let status = "Bình thường";
    if (rain > 50) status = "Ngập nặng";
    else if (rain > 30) status = "Ngập sâu";
    else if (rain > 10) status = "Ngập nhẹ";

    weatherCache[key] = { rain, status };
    localStorage.setItem("weatherCache", JSON.stringify(weatherCache));

    return { rain, status };
  } catch {
    return { rain: 0, status: "Bình thường" };
  }
}

// =========================
// UPDATE WEATHER & BUILD TABLE + MAP
// =========================
let map;
let markers = [];

async function updateWeatherStatus() {
  statusDiv.textContent = "⏳ Đang tải thời tiết...";
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  if (!map) {
    map = L.map("map").setView([16.3, 107.5], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  }

  dataBody.innerHTML = "";

  for (const row of globalData) {
    const { "Tỉnh/TP": province, "Xã/Phường": commune } = row;

    const geo = await getLatLon(province, commune);
    if (!geo) continue;

    const weather = await getWeather(province, commune, geo.lat, geo.lon);

    // Row Color
    let colorClass = "row-green";
    if (weather.rain > 50) colorClass = "row-red";
    else if (weather.rain > 20) colorClass = "row-yellow";

    const tr = document.createElement("tr");
    tr.className = colorClass;
    tr.innerHTML = `
      <td>${province}</td>
      <td>${commune}</td>
      <td>${row["Họ và tên"]}</td>
      <td>${row["Chức vụ"]}</td>
      <td>${row["SĐT"]}</td>
      <td>${row["Trước sáp nhập"]}</td>
      <td>${row["Huyện - Tỉnh cũ"]}</td>
      <td>${row["Địa hình"]}</td>
      <td><b>${weather.rain}</b></td>
      <td>${weather.status}</td>
    `;
    dataBody.appendChild(tr);

    // MAP marker
    const marker = L.marker([geo.lat, geo.lon]).addTo(map);
    marker.bindPopup(`<b>${commune}</b><br>Mưa: ${weather.rain} mm<br>${weather.status}`);
    markers.push(marker);
  }

  statusDiv.textContent = "✔ Đã cập nhật hoàn tất!";
}

// =========================
// SEARCH
// =========================
searchBtn.onclick = () => {
  const keyword = searchInput.value.toLowerCase().trim();
  if (!keyword) return updateWeatherStatus();

  globalData = globalData.filter(
    d =>
      d["Tỉnh/TP"].toLowerCase().includes(keyword) ||
      d["Xã/Phường"].toLowerCase().includes(keyword)
  );

  updateWeatherStatus();
};

// =========================
// RUN
// =========================
fetchData();
