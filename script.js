const sheetUrl = "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/gviz/tq?gid=325047141";
const updateStatus = document.getElementById("update-status");
const tableBody = document.querySelector("#dataTable tbody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

async function fetchSheetData() {
  updateStatus.textContent = "⏳ Đang tải dữ liệu...";
  try {
    const res = await fetch(sheetUrl);
    const text = await res.text();

    // Google Sheets trả về JS callback, cần tách JSON
    const json = JSON.parse(text.substring(47, text.length - 2));
    const rows = json.table.rows;

    let html = "";
    rows.forEach(r => {
      const cells = r.c.map(c => (c ? c.v : ""));
      html += `
        <tr>
          <td>${cells[0]}</td>
          <td>${cells[1]}</td>
          <td>${cells[2]}</td>
          <td>${cells[3]}</td>
          <td>${cells[4]}</td>
          <td>${cells[5]}</td>
          <td>${cells[6]}</td>
          <td>${cells[7]}</td>
        </tr>`;
    });

    tableBody.innerHTML = html;
    updateStatus.textContent = `✅ Cập nhật lần cuối: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    console.error("Lỗi tải dữ liệu:", error);
    updateStatus.textContent = "❌ Không tải được dữ liệu. Kiểm tra lại link hoặc quyền chia sẻ!";
  }
}

// 🔎 Tìm kiếm nhanh
searchBtn.addEventListener("click", () => {
  const keyword = searchInput.value.trim().toLowerCase();
  const rows = tableBody.querySelectorAll("tr");
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(keyword) ? "" : "none";
  });
});

// ⏱ Cập nhật tự động mỗi 15 phút
fetchSheetData();
setInterval(fetchSheetData, 15 * 60 * 1000);
