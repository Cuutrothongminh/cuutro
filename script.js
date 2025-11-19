// =========================
// CONFIG
// =========================
const sheetURL =
  "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";

// 🔑 API key OpenWeather của bạn
const OPENWEATHER_API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";

const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

let globalData = [];

// Cache
let geoCache = localStorage.getItem("geoCache")
  ? JSON.parse(localStorage.getItem("geoCache"))
  : {};
let weatherCache = localStorage.getItem("weatherCache")
  ? JSON.parse(localStorage.getItem("weatherCache"))
  : {};


// =========================
// FETCH GOOGLE SHEETS
// =========================
async function fetchData() {
  try {
    const res = await fetch(sheetURL + "&t=" + Date.now());
    const text = await res.text();
    const json = JSON.parse(text.substring(47).slice(0, -2));

    const rows = json.table.rows
      .map(r => r.c?.map(c => (c && c.v ? c.v.toString().trim() : "")))
      .filter(r => r && r.some(x => x !== "") && r[0] !== "Tỉnh/TP");

    // Thêm cột Rain
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
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i] || ""));
      return obj;
    });

    await updateWeatherStatus();
  } catch (err) {
    console.error("Fetch error:", err);
    statusDiv.textContent = "❌ Không tải được dữ liệu từ Google Sheet!";
  }
}


// =========================
// GEO
// =========================
async function getLatLon(province, commune) {
  const key = `${province}-${commune}`;
  if (geoCache[key]) return geoCache[key];

  try {
    const geoRes = await fetch(
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
        commune + "," + province + ",VN"
      )}&limit=1&appid=${OPENWEATHER_API_KEY}`
    );

    const geoData = await geoRes.json();
    if (!geoData || !geoData[0]) return null;

    const { lat, lon } = geoData[0];
    geoCache[key] = { lat, lon };
    localStorage.setItem("geoCache", JSON.stringify(geoCache));
    return { lat, lon };
  } catch (err) {
    console.error("Geo fetch error:", err);
    return null;
  }
}


// =========================
// WEATHER
// =========================
async function getWeatherWithCache(province, commune, lat, lon) {
  const key = `${province}-${commune}`;
  if (weatherCache[key]) return weatherCache[key];

  try {
    const weatherRes = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`
    );
    const weatherData = await weatherRes.json();

    const rain =
      weatherData.rain?.["1h"] ??
      weatherData.rain?.["3h"] ??
      0;

    let status;
    if (rain > 50) status = "Ngập nặng";
    else if (rain > 30) status = "Ngập sâu";
    else if (rain > 10) status = "Ngập nhẹ";
    else status = "Bình thường";

    weatherCache[key] = { rain, status };
    localStorage.setItem("weatherCache", JSON.stringify(weatherCache));

    return { rain, status };
  } catch (err) {
    console.error("Weather fetch error:", err);
    return { rain: 0, status: "Bình thường" };
  }
}


// =========================
// UPDATE WEATHER
// =========================
async function updateWeatherStatus() {
  statusDiv.textContent = "🕓 Đang tải dữ liệu thời tiết...";

  const uniqueCommunes = {};
  globalData.forEach(r => {
    const key = `${r["Tỉnh/TP"]}-${r["Xã/Phường"]}`;
    if (!unique
