// === Cấu hình liên kết dữ liệu Google Sheet ===
const SHEET_API =
  "https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLgppCAEl0RthK6-BToah4P-HMYJqGV1Bf86IySA7xW02iAIu-aB_e-XD1qQDcR4oeCKGRT1hZlCKRlfcMvi27EeJy0r0F6CwFifjghDd0WrYATzP1S6MxwTeIGcLxVq8v4uVeRsgQQEC0nv67R1jq3U7-SZSEgF6AdVdcLd2UB0-tb_zeIRUasP3ZZ8ifnTsKo1CTegLs4J75PGlprbfoDADSZ-k49z1I5XtbAtZrw049RQRQ8Vj6Dx39XTh4S2Gy1RXy0UoDEDa1vJBymE_83URjxU8w&lib=MNlCDEoLrZA_U2CivsAHrwTJOzZw8k3LO";

// === API khí tượng (Open-Meteo) ===
const WEATHER_API =
  "https://api.open-meteo.com/v1/forecast?latitude=16.47&longitude=107.6&hourly=precipitation";

// === Hàm tải dữ liệu từ Google Sheets ===
async function fetchData() {
  document.getElementById("update-status").innerText = "🔄 Đang tải dữ liệu...";
  try {
    const res = await fetch(SHEET_API);
    const data = await res.json();

    // Lưu cache
    localStorage.setItem("dataCache", JSON.stringify(data));
    localStorage.setItem("lastUpdate", new Date().toISOString());

    await renderData(data);

    const time = new Date().toLocaleString("vi-VN");
    document.getElementById("update-status").innerText = `✅ Cập nhật lúc ${time}`;
  } catch (err) {
    console.error("Lỗi tải dữ liệu:", err);
    const cache = localStorage.getItem("dataCache");
    if (cache) {
      renderData(JSON.parse(cache));
      document.getElementById("update-status").innerText = "⚠️ Hiển thị dữ liệu lưu tạm (offline)";
    } else {
      document.getElementById("update-status").innerText = "❌ Không thể tải dữ liệu!";
    }
  }
}

// === Hàm hiển thị dữ liệu ra bảng ===
async function renderData(data) {
  const tableBody = document.getElementById("data-body");
  tableBody.innerHTML = "";

  // Lấy thông tin thời tiết một lần để dùng chung
  const weather = await getWeatherStatus();

  data.forEach((row) => {
    const rain = weather.rain;
    const floodStatus = getFloodLevel(rain);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row["Tỉnh/TP"] || ""}</td>
      <td>${row["Xã/Phường"] || ""}</td>
      <td>${row["Họ và tên"] || ""}</td>
      <td>${row["Chức vụ"] || ""}</td>
      <td><a href="tel:${row["Số điện thoại"] || ""}">📞 ${row["Số điện thoại"] || ""}</a></td>
      <td>${row["Trước sáp nhập"] || ""}</td>
      <td>${row["Đặc điểm địa hình"] || ""}</td>
      <td class="${floodStatus.class}">${floodStatus.text}</td>
    `;
    tableBody.appendChild(tr);
  });
}

// === Lấy thông tin thời tiết (lượng mưa) ===
async function getWeatherStatus() {
  try {
    const res = await fetch(WEATHER_API);
    const json = await res.json();
    const rain = json.hourly.precipitation[0] || 0;
    return { rain };
  } catch {
    return { rain: 0 };
  }
}

// === Xác định mức ngập dựa trên lượng mưa ===
function getFloodLevel(rain) {
  if (rain > 30) return { text: "🌊 Ngập nặng", class: "status-flood" };
  if (rain > 10) return { text: "⚠️ Cảnh báo", class: "status-warning" };
  return { text: "✅ An toàn", class: "status-safe" };
}

// === Tự động cập nhật mỗi 15 phút ===
setInterval(fetchData, 15 * 60 * 1000);

// Gọi lần đầu khi mở trang
fetchData();
