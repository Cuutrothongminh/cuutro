const sheetURL = "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";
const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

let globalData = [];
const OPENWEATHER_API_KEY = "YOUR_OPENWEATHERMAP_API_KEY"; // Thay bằng API key của bạn

// --- Lấy dữ liệu từ Google Sheet ---
async function fetchData() {
  try {
    const res = await fetch(sheetURL + "&t=" + Date.now());
    const text = await res.text();
    const json = JSON.parse(text.substring(47).slice(0, -2));

    const rows = json.table.rows
      .map(r => r.c?.map(c => (c && c.v ? c.v.toString().trim() : "")))
      .filter(r => r && r.some(x => x !== "") && r[0] !== "Tỉnh/TP"); // bỏ header

    const headers = [
      "Tỉnh/TP",
      "Xã/Phường",
      "Họ và tên",
      "Chức vụ",
      "SĐT",
      "Trước sáp nhập",
      "Đặc điểm địa hình",
    ];

    const data = rows.map(r => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i] || ""));
      return obj;
    });

    // Gộp xã/phường theo dữ liệu Sheet
    const merged = {};
    for (const row of data) {
      const key = `${row["Tỉnh/TP"]} - ${row["Xã/Phường"]}`;
      if (!merged[key]) merged[key] = { ...row };
    }

    globalData = Object.values(merged);
    await updateWeatherStatus();
  } catch (err) {
    console.error("Fetch error:", err);
    statusDiv.textContent = "❌ Không tải được dữ liệu từ Google Sheet!";
  }
}

// --- Lấy lượng mưa và trạng thái ngập từ OpenWeatherMap ---
async function getWeather(province, commune) {
  try {
    const geoRes = await fetch(
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(commune + "," + province + ",VN")}&limit=1&appid=${OPENWEATHER_API_KEY}`
    );
    const geoData = await geoRes.json();
    if (!geoData || !geoData[0]) return { rain: 0, status: "Bình thường" };

    const { lat, lon } = geoData[0];

    const weatherRes = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`
    );
    const weatherData = await weatherRes.json();

    const rain = weatherData.rain?.["1h"] || 0;
    let status;
    if (rain > 50) status = "Ngập nặng";
    else if (rain > 30) status = "Ngập sâu";
    else if (rain > 10) status = "Ngập nhẹ";
    else status = "Bình thường";

    return { rain, status };
  } catch (err) {
    console.error("Weather fetch error:", err);
    return { rain: 0, status: "Bình thường" };
  }
}

// --- Cập nhật trạng thái mưa/ngập ---
async function updateWeatherStatus() {
  statusDiv.textContent = "🕓 Đang tải dữ liệu thời tiết...";
  for (let i = 0; i < globalData.length; i++) {
    const row = globalData[i];
    const result = await getWeather(row["Tỉnh/TP"], row["Xã/Phường"]);
    row["Rain"] = result.rain;
    row["Trạng thái ngập"] = result.status;
  }
  renderData(globalData);
  statusDiv.textContent = `🕓 Cập nhật lần cuối: ${new Date().toLocaleString("vi-VN")}`;
}

// --- Hiển thị dữ liệu ---
function renderData(data) {
  dataBody.innerHTML = "";
  if (!data.length) {
    dataBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">Không có dữ liệu</td></tr>`;
    return;
  }

  data.forEach(r =>
