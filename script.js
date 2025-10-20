// Google Sheet JSON link (chỉ cần xuất bản Sheet ra web)
const sheetUrl = "https://docs.google.com/spreadsheets/d/1vVF7V3qGhg08Zjg-TqKRzuIrfRSg0N-41-1N95FAhX4/gviz/tq?tqx=out:json";

async function fetchSheet() {
  const res = await fetch(sheetUrl);
  const text = await res.text();
  const json = JSON.parse(text.substr(47).slice(0, -2)); // xử lý định dạng Google Sheet
  const rows = json.table.rows.map(r => r.c.map(c => (c ? c.v : "")));
  renderTable(rows);
}

function renderTable(rows) {
  const tableBody = document.querySelector("#dataTable tbody");
  const provinceSelect = document.querySelector("#provinceFilter");
  tableBody.innerHTML = "";

  const provinces = new Set();
  rows.slice(1).forEach(r => {
    const [province, xa, name, role, phone, old, status] = r;
    if (province) provinces.add(province);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${province}</td>
      <td>${xa}</td>
      <td>${name}</td>
      <td>${role}</td>
      <td>${phone}</td>
      <td>${old}</td>
      <td>${status || "Đang cập nhật..."}</td>
    `;
    tableBody.appendChild(tr);
  });

  provinceSelect.innerHTML = '<option value="">-- Chọn tỉnh/thành --</option>';
  provinces.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    provinceSelect.appendChild(opt);
  });

  provinceSelect.addEventListener("change", () => {
    const val = provinceSelect.value;
    document.querySelectorAll("#dataTable tbody tr").forEach(tr => {
      tr.style.display = !val || tr.children[0].textContent === val ? "" : "none";
    });
  });
}

fetchSheet();
