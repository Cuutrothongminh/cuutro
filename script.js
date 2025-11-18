const API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";

const sheetURL =
  "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";

const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

let globalData = [];
let geoCache = JSON.parse(localStorage.getItem("geoCache") || "{}");

async function fetchGeocode(xa, tinh) {
  const key = `${xa}-${tinh}`.toLowerCase();

  if (geoCache[key]) return geoCache[key];

  const url =
    `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
      xa
    )},${encodeURIComponent(tinh)},Vietnam&limit=1&appid=${API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.length) return null;

  geoCache[key] = { lat: data[0].lat, lon: data[0].lon };
  localStorage.setItem("geoCache", JSON.stringify(geoCache));

  return geoCache[key];
}

async function fetchRain(lat, lon) {
  const url =
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
  const res = await fetch(url);
  const data = await res.json();

  return data.rain?.["1h"] || 0;
}

function classifyFlood(rain) {
  if (rain >= 50) return "Ngập nặng";
  if (rain >= 30) return "Ngập sâu";
  if (rain >= 10) return "Ngập nhẹ";
  return "Bình thường";
}

async function fetchData() {
  try {
    const res = await fetch(sheetURL + "&t=" + Date.now());
    const text = await res.text();
    const json = JSON.parse(text.substring(47).slice(0, -2));

    const rows = json.table.rows.map(r => r.c.map(c => (c && c.v ? c.v + "" : "")));

    globalData = rows.map(r => ({
      "Tỉnh/TP": r[0] || "",
      "Xã/Phường": r[1] || "",
      "Chức vụ": r[3] || "",
      "Họ và tên": r[2] || "",
      "SĐT": r[4] || "",
      "Trước sáp nhập": r[5] || "",
      "Huyện - Tỉnh cũ": r[6] || "",
      "Đặc điểm địa hình": r[7] || "",
      rain: 0,
      flood: "Đang cập nhật..."
    }));

    await updateWeather();

    renderData(globalData);
    statusDiv.textContent = "🕓 Cập nhật: " + new Date().toLocaleString("vi-VN");

  } catch (e) {
    console.error(e);
    statusDiv.textContent = "❌ Không tải được dữ liệu từ Google Sheet!";
  }
}

async function updateWeather() {
  for (let row of globalData) {
    const geo = await fetchGeocode(row["Xã/Phường"], row["Tỉnh/TP"]);

    if (!geo) {
      row.rain = 0;
      row.flood = "Không có dữ liệu";
      continue;
    }

    const rain = await fetchRain(geo.lat, geo.lon);

    row.rain = rain;
    row.flood = classifyFlood(rain);
  }
}

function renderData(data) {
  dataBody.innerHTML = "";

  data.forEach(r => {
    const cls =
      r.flood.includes("nặng") || r.flood.includes("sâu")
        ? "status-flood"
        : r.flood.includes("nhẹ")
        ? "status-warning"
        : "status-safe";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r["Tỉnh/TP"]}</td>
      <td>${r["Xã/Phường"]}</td>
      <td>${r["Chức vụ"]}</td>
      <td>${r["Họ và tên"]}</td>
      <td>${r["SĐT"]}</td>
      <td>${r["Trước sáp nhập"]}</td>
      <td>${r["Huyện - Tỉnh cũ"]}</td>
      <td>${r["Đặc điểm địa hình"]}</td>
      <td>${r.rain}</td>
      <td class="${cls}">${r.flood}</td>
    `;
    dataBody.appendChild(tr);
  });
}

function searchData() {
  const kw = searchInput.value.trim().toLowerCase();
  if (!kw) return renderData(globalData);

  const filtered = globalData.filter(r =>
    Object.values(r).some(v => (v + "").toLowerCase().includes(kw))
  );

  renderData(filtered);
}

searchBtn.onclick = searchData;
searchInput.addEventListener("keypress", e => {
  if (e.key === "Enter") searchData();
});

fetchData();
setInterval(fetchData, 900000);
