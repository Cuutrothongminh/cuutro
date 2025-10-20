// === Link Google Sheet (xuất bản ra web ở chế độ xem công khai) ===
const sheetUrl =
  "https://docs.google.com/spreadsheets/d/1vVF7V3qGhg08Zjg-TqKRzuIrfRSg0N-41-1N95FAhX4/gviz/tq?tqx=out:json";

// === Hàm đọc dữ liệu từ Google Sheet ===
async function fetchSheet() {
  try {
    const res = await fetch(sheetUrl);
    const text = await res.text();
    const json = JSON.parse(text.substr(47).slice(0, -2));
    const rows = json.table.rows.map(r => r.c.map(c => (c ? c.v : "")));
    renderTable(rows);
  } catch (e) {
    console.error("Không đọc được dữ liệu Google Sheet:", e);
  }
}

// === Hiển thị bảng ===
function renderTable(rows) {
  const tableBody = document.querySelector("#dataTable tbody");
  const provinceSelect = document.querySelector("#provinceFilter");
  const searchBox = document.querySelector("#searchBox");
  tableBody.innerHTML = "";

  const provinces = new Set();
  const headers = rows[0];
  rows.slice(1).forEach(r => {
    const [province, xa, name, role, phone, old, status] = r;
    if (province) provinces.add(province);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${province}</td>
      <td>${xa}</td>
      <td>${name}</td>
      <td>${role}</td>
      <td>
        <button class="call-btn" onclick="window.open('tel:${phone}')">Gọi</button>
        ${phone}
      </td>
      <td>${old}</td>
      <td>${status || "Đang cập nhật..."}</td>
    `;
    tableBody.appendChild(tr);
  });

  // Cập nhật danh sách tỉnh
  provinceSelect.innerHTML = '<option value="">-- Chọn tỉnh/thành --</option>';
  provinces.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    provinceSelect.appendChild(opt);
  });

  // Bộ lọc tỉnh
  provinceSelect.addEventListener("change", () => applyFilters());
  searchBox.addEventListener("input", () => applyFilters());

  function applyFilters() {
    const province = provinceSelect.value.toLowerCase();
    const search = searchBox.value.toLowerCase();

    document.querySelectorAll("#dataTable tbody tr").forEach(tr => {
      const text = tr.innerText.toLowerCase();
      const matchProvince = !province || tr.children[0].textContent.toLowerCase() === province;
      const matchSearch = !search || text.includes(search);
      tr.style.display = matchProvince && matchSearch ? "" : "none";
    });
  }
}

fetchSheet();
