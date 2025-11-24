// =========================
// CONFIG
// =========================
const sheetURL =
  "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";

const OPENWEATHER_API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";

const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

let globalData = [];

// CACHE
let geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");
let weatherCache = JSON.parse(localStorage.getItem("weatherCache") || "{}");


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
      headers.forEach((h, i) => (obj[h] = r[i] || ""));
      obj["Rain"] = 0;
      obj["Trạng thái ngập"] = "Đang cập nhật";
      return obj;
    });

    await updateWeatherStatus();
  } catch (err) {
    console.error(err);
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

    const data = await geoRes.json();
    if (!data || !data[0]) return null;

    const { lat, lon } = data[0];
    geoCache[key] = { lat, lon };
    localStorage.setItem("geoCache", JSON.stringify(geoCache));
    return { lat, lon };
  } catch (e) {
    console.error("Geo error:", e);
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
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`
    );
    const w = await res.json();

    const rain =
      w.rain?.["1h"] ??
      w.rain?.["3h"] ??
      0;

    let status;
    if (rain > 50) status = "Ngập nặng";
    else if (rain > 30) status = "Ngập sâu";
    else if (rain > 10) status = "Ngập nhẹ";
    else status = "Bình thường";

    weatherCache[key] = { rain, status };
    localStorage.setItem("weatherCache", JSON.stringify(weatherCache));

    return { rain, status };
  } catch (e) {
    console.error("Weather error:", e);
    return { rain: 0, status: "Bình thường" };
  }
}


// =========================
// UPDATE WEATHER
// =========================
async function updateWeatherStatus() {
  statusDiv.textContent = "🕓 Đang tải dữ liệu thời tiết...";

  for (let row of globalData) {
    const province = row["Tỉnh/TP"];
    const commune = row["Xã/Phường"];

    const geo = await getLatLon(province, commune);
    if (!geo) continue;

    const weather = await getWeatherWithCache(province, commune, geo.lat, geo.lon);

    row["Rain"] = weather.rain;
    row["Trạng thái ngập"] = weather.status;
  }

  renderTable(globalData);
  statusDiv.textContent = "✔ Đã cập nhật xong!";
}


// =========================
// RENDER TABLE
// =========================
function renderTable(data) {
  dataBody.innerHTML = "";

  data.forEach(row => {
    const tr = document.createElement("tr");

    const colorClass =
      row["Trạng thái ngập"] === "Ngập nặng" ? "status-flood" :
      row["Trạng thái ngập"] === "Ngập sâu" ? "status-warning" :
      "status-safe";

    tr.innerHTML = `
      <td>${row["Tỉnh/TP"]}</td>
      <td>${row["Xã/Phường"]}</td>
      <td>${row["Họ và tên"]}</td>
      <td>${row["Chức vụ"]}</td>
      <td>${row["SĐT"]}</td>
      <td>${row["Trước sáp nhập"]}</td>
      <td>${row["Huyện - Tỉnh cũ"]}</td>
      <td>${row["Đặc điểm địa hình"]}</td>
      <td><b>${row["Rain"]}</b></td>
      <td class="${colorClass}">${row["Trạng thái ngập"]}</td>
    `;

    dataBody.appendChild(tr);
  });
}


// =========================
// SEARCH
// =========================
searchBtn.addEventListener("click", () => {
  const kw = searchInput.value.toLowerCase().trim();
  const f = globalData.filter(
    r =>
      r["Tỉnh/TP"].toLowerCase().includes(kw) ||
      r["Xã/Phường"].toLowerCase().includes(kw)
  );
  renderTable(f);
});


// START
fetchData();
