const sheetURL =
  "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";

const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

let globalData = [];

async function fetchData() {
  try {
    const res = await fetch(sheetURL + "&t=" + Date.now()); // tránh cache
    const text = await res.text();
    const json = JSON.parse(text.substring(47).slice(0, -2));

    const rows = json.table.rows
      .map(r => r.c?.map(c => (c && c.v ? c.v.toString().trim() : "")))
      .filter(r => r && r.some(x => x !== "")); // bỏ hàng trống

    const headers = [
      "Tỉnh/TP",
      "Xã/Phường",
      "Họ và tên",
      "Chức vụ",
      "SĐT",
      "Trước sáp nhập",
      "Đặc điểm địa hình",
      "Trạng thái ngập",
    ];

    const data = rows.map(r => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i] || ""));
      return obj;
    });

    // --- Gộp xã/phường theo mức độ ngập cao nhất ---
    const priority = {
      "Ngập nặng": 4,
      "Ngập sâu": 3,
      "Ngập nhẹ": 2,
      "Bình thường": 1,
      "": 0,
    };

    const merged = {};
    for (const row of data) {
      const key = `${row["Tỉnh/TP"]} - ${row["Xã/Phường"]}`;
      if (!merged[key]) merged[key] = { ...row };
      else {
        const oldLevel = priority[merged[key]["Trạng thái ngập"]] || 0;
        const newLevel = priority[row["Trạng thái ngập"]] || 0;
        if (newLevel > oldLevel) merged[key]["Trạng thái ngập"] = row["Trạng thái ngập"];
      }
    }

    globalData = Object.values(merged);
    renderData(globalData);
    statusDiv.textContent = `🕓 Cập nhật lần cuối: ${new Date().toLocaleString("vi-VN")}`;
  } catch (err) {
    console.error("Fetch error:", err);
    statusDiv.textContent =
      "❌ Không tải được dữ liệu. Kiểm tra lại link Google Sheet hoặc quyền chia sẻ!";
  }
}

function renderData(data) {
  dataBody.innerHTML = "";

  if (!data.length) {
    dataBody.innerHTML = `<tr><td colspan="8" style="text-align:center;">Không có dữ liệu</td></tr>`;
    return;
  }

  data.forEach(r => {
    const statusClass =
      r["Trạng thái ngập"] === "Ngập nặng" || r["Trạng thái ngập"] === "Ngập sâu"
        ? "status-flood"
        : r["Trạng thái ngập"] === "Ngập nhẹ"
        ? "status-warning"
        : "status-safe";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r["Tỉnh/TP"]}</td>
      <td>${r["Xã/Phường"]}</td>
      <td>${r["Họ và tên"]}</td>
      <td>${r["Chức vụ"]}</td>
      <td>${r["SĐT"]}</td>
      <td>${r["Trước sáp nhập"]}</td>
      <td>${r["Đặc điểm địa hình"]}</td>
      <td class="${statusClass}">${r["Trạng thái ngập"]}</td>
    `;
    dataBody.appendChild(tr);
  });
}

// --- Tìm nhanh địa phương ---
function searchData() {
  const keyword = searchInput.value.trim().toLowerCase();
  if (!keyword) {
    renderData(globalData);
    return;
  }

  const filtered = globalData.filter(r =>
    Object.values(r).some(v => v.toLowerCase().includes(keyword))
  );
  renderData(filtered);
}

searchBtn.onclick = searchData;
searchInput.addEventListener("keypress", e => {
  if (e.key === "Enter") searchData();
});

// --- Lần đầu tải ---
fetchData();

// --- Cập nhật tự động mỗi 15 phút ---
setInterval(fetchData, 900000);
