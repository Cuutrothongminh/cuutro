// 🌊 Danh bạ Cứu trợ Thông minh – script.js
// Cập nhật tự động mỗi 15 phút

const API_URL =
  "https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLgppCAEl0RthK6-BToah4P-HMYJqGV1Bf86IySA7xW02iAIu-aB_e-XD1qQDcR4oeCKGRT1hZlCKRlfcMvi27EeJy0r0F6CwFifjghDd0WrYATzP1S6MxwTeIGcLxVq8v4uVeRsgQQEC0nv67R1jq3U7-SZSEgF6AdVdcLd2UB0-tb_zeIRUasP3ZZ8ifnTsKo1CTegLs4J75PGlprbfoDADSZ-k49z1I5XtbAtZrw049RQRQ8Vj6Dx39XTh4S2Gy1RXy0UoDEDa1vJBymE_83URjxU8w&lib=MNlCDEoLrZA_U2CivsAHrwTJOzZw8k3LO";

const updateStatus = document.getElementById("update-status");
const tbody = document.getElementById("data-body");

// Hàm lấy dữ liệu từ Google Script
async function fetchData() {
  try {
    updateStatus.textContent = "🔄 Đang cập nhật dữ liệu...";
    const response = await fetch(API_URL);
    const json = await response.json();

    const data = json.data || json; // Tùy Apps Script trả ra dạng nào

    tbody.innerHTML = "";

    data.forEach((row) => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${row["Tỉnh/TP"] || ""}</td>
        <td>${row["Xã/Phường"] || ""}</td>
        <td>${row["Họ và tên"] || ""}</td>
        <td>${row["Chức vụ"] || ""}</td>
        <td><a href="tel:${row["Số điện thoại"] || ""}">${
        row["Số điện thoại"] || ""
      }</a></td>
        <td>${row["Trước sáp nhập"] || ""}</td>
        <td>${row["Đặc điểm địa hình"] || ""}</td>
        <td id="flood-${Math.random().toString(36).substr(2, 5)}">Đang cập nhật...</td>
      `;

      tbody.appendChild(tr);
    });

    updateStatus.textContent =
      "✅ Dữ liệu đã được cập nhật: " + new Date().toLocaleString("vi-VN");

    // Sau khi hiển thị, cập nhật trạng thái ngập
    updateFloodStatus();

  } catch (err) {
    console.error(err);
    updateStatus.textContent = "❌ Lỗi khi tải dữ liệu, thử lại sau.";
  }
}

// Hàm cập nhật trạng thái ngập (mô phỏng API khí tượng & địa hình)
async function updateFloodStatus() {
  const floodCells = document.querySelectorAll("td[id^='flood-']");

  // 🌧️ Ví dụ mô phỏng trạng thái ngập ngẫu nhiên
  floodCells.forEach((cell) => {
    const rand = Math.random();
    if (rand < 0.1) {
      cell.textContent = "Ngập sâu > 0.5m";
      cell.className = "status-flood";
    } else if (rand < 0.3) {
      cell.textContent = "Cảnh báo mưa lớn";
      cell.className = "status-warning";
    } else {
      cell.textContent = "An toàn";
      cell.className = "status-safe";
    }
  });
}

// Lần đầu tải
fetchData();

// Cập nhật tự động mỗi 15 phút
setInterval(fetchData, 15 * 60 * 1000);
