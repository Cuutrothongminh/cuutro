<script>
  const sheetURL = "https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLgppCAEl0RthK6-BToah4P-HMYJqGV1Bf86IySA7xW02iAIu-aB_e-XD1qQDcR4oeCKGRT1hZlCKRlfcMvi27EeJy0r0F6CwFifjghDd0WrYATzP1S6MxwTeIGcLxVq8v4uVeRsgQQEC0nv67R1jq3U7-SZSEgF6AdVdcLd2UB0-tb_zeIRUasP3ZZ8ifnTsKo1CTegLs4J75PGlprbfoDADSZ-k49z1I5XtbAtZrw049RQRQ8Vj6Dx39XTh4S2Gy1RXy0UoDEDa1vJBymE_83URjxU8w&lib=MNlCDEoLrZA_U2CivsAHrwTJOzZw8k3LO";

  let allData = [];

  async function loadData() {
    try {
      const res = await fetch(sheetURL + "&_t=" + Date.now());
      allData = await res.json();
      renderTable(allData);
      fillFilters(allData);
    } catch (e) {
      console.error("Lỗi tải dữ liệu:", e);
      document.getElementById("data-body").innerHTML = "<tr><td colspan='9' align='center'>Lỗi tải dữ liệu!</td></tr>";
    }
  }

  function renderTable(data) {
    const tbody = document.getElementById("data-body");
    tbody.innerHTML = "";
    if (!data.length) {
      tbody.innerHTML = "<tr><td colspan='9' align='center'>Không có dữ liệu</td></tr>";
      return;
    }
    data.forEach(row => {
      const sdt = row["SĐT"] ? `<button class='call-btn' onclick="window.location.href='tel:${row["SĐT"]}'">📞 Gọi</button> ${row["SĐT"]}` : "";
      tbody.insertAdjacentHTML("beforeend", `
        <tr>
          <td>${row["Tỉnh/TP"]||""}</td>
          <td>${row["Xã/Phường"]||""}</td>
          <td>${row["Thôn/Xóm"]||""}</td>
          <td>${row["Họ và tên"]||""}</td>
          <td>${row["Chức vụ"]||""}</td>
          <td>${sdt}</td>
          <td>${row["Trước sáp nhập"]||""}</td>
          <td>${row["Đặc điểm địa hình"]||""}</td>
          <td>${row["Tình trạng"]||"Đang cập nhật..."}</td>
        </tr>`);
    });
  }

  function fillFilters(data) {
    const tinhSelect = document.getElementById("filter-tinh");
    const xaSelect = document.getElementById("filter-xa");
    const tinhList = [...new Set(data.map(d=>d["Tỉnh/TP"]).filter(Boolean))];
    tinhSelect.innerHTML = '<option value="">-- Chọn tỉnh/thành --</option>';
    tinhList.sort().forEach(t => {
      const opt = document.createElement("option"); opt.value = t; opt.textContent = t;
      tinhSelect.appendChild(opt);
    });
    tinhSelect.addEventListener("change", () => {
      const sel = tinhSelect.value;
      const xaList = [...new Set(data.filter(d=>d["Tỉnh/TP"]===sel).map(d=>d["Xã/Phường"]))];
      xaSelect.innerHTML = '<option value="">-- Chọn xã/phường --</option>';
      xaList.sort().forEach(x => {
        const opt = document.createElement("option"); opt.value = x; opt.textContent = x;
        xaSelect.appendChild(opt);
      });
      filterData();
    });
    xaSelect.addEventListener("change", filterData);
    document.getElementById("search").addEventListener("input", filterData);
  }

  function filterData() {
    const tinh = document.getElementById("filter-tinh").value;
    const xa = document.getElementById("filter-xa").value;
    const search = document.getElementById("search").value.toLowerCase();
    const filtered = allData.filter(r =>
      (!tinh || r["Tỉnh/TP"] === tinh) &&
      (!xa || r["Xã/Phường"] === xa) &&
      ( (
          (r["Họ và tên"]||"").toLowerCase().includes(search) ||
          (r["Chức vụ"]||"").toLowerCase().includes(search) ||
          (r["Thôn/Xóm"]||"").toLowerCase().includes(search)
        )
      )
    );
    renderTable(filtered);
  }

  // Tải lần đầu
  loadData();

  // Tự động tải lại mỗi 15 phút
  setInterval(loadData, 15 * 60 * 1000);
</script>
