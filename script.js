// === Cấu hình liên kết dữ liệu ===
const SHEET_API = "https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLgppCAEl0RthK6-BToah4P-HMYJqGV1Bf86IySA7xW02iAIu-aB_e-XD1qQDcR4oeCKGRT1hZlCKRlfcMvi27EeJy0r0F6CwFifjghDd0WrYATzP1S6MxwTeIGcLxVq8v4uVeRsgQQEC0nv67R1jq3U7-SZSEgF6AdVdcLd2UB0-tb_zeIRUasP3ZZ8ifnTsKo1CTegLs4J75PGlprbfoDADSZ-k49z1I5XtbAtZrw049RQRQ8Vj6Dx39XTh4S2Gy1RXy0UoDEDa1vJBymE_83URjxU8w&lib=MNlCDEoLrZA_U2CivsAHrwTJOzZw8k3LO";

// === Cấu hình API ngập lụt (ví dụ từ OpenWeatherMap) ===
const WEATHER_API = "https://api.open-meteo.com/v1/forecast?latitude=16.47&longitude=107.6&hourly=precipitation";

// === Tải dữ liệu Google Sheet ===
async function fetchData() {
  try {
    const res = await fetch(SHEET_API);
    const data = await res.json();

    localStorage.setItem("lastUpdate", Date.now());
    localStorage.setItem("dataCache", JSON.stringify(data));
    renderData(data);
  } catch (err) {
    console.error("Lỗi tải dữ liệu:", err);
    const cache = localStorage.getItem("dataCache");
    if (cache) renderData(JSON.parse(cache));
  }
}

// === Hiển thị dữ liệu ===
function renderData(data) {
  const tableBody = document.querySelector("#data-body");
  tableBody.innerHTML = "";

  data.forEach(row => {
    const floodStatus = getFloodStatus(row["Tỉnh/TP"], row["Xã/Phường"]);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row["Tỉnh/TP"] || ""}</td>
      <td>${row["Xã/Phường"] || ""}</td>
      <td>${row["Họ và tên"] || ""}</td>
      <td>${row["Chức vụ"] || ""}</td>
      <td><a href="tel:${row["Số điện thoại"]}">📞 ${row["Số điện thoại"] || ""}</a></td>
      <td>${row["Trước sáp nhập"] || ""}</td>
      <td>${row["Đặc điểm địa hình"] || ""}</td>
      <td>${floodStatus}</td>
    `;
    tableBody.appendChild(tr);
  });
}

// === Lấy trạng thái ngập ===
async function getFloodStatus(tinh, xa) {
  try {
    const res = await fetch(WEATHER_API);
    const w = await res.json();
    const rain = w.hourly.precipitation[0];
    if (rain > 30) return "🌊 Ngập nặng";
    if (rain > 10) return "⚠️ Cảnh báo";
    return "✅ An toàn";
  } catch {
    return "Đang cập nhật...";
  }
}

// === Cập nhật tự động mỗi 15 phút ===
setInterval(fetchData, 15 * 60 * 1000);
fetchData();
