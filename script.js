const sheetURL =
  "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=325047141";

const statusDiv = document.getElementById("update-status");
const dataBody = document.getElementById("dataBody");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

async function fetchData() {
  try {
    const res = await fetch(sheetURL);
    const text = await res.text();
    const json = JSON.parse(text.substring(47).slice(0, -2));
    const rows = json.table.rows.map(r => r.c.map(c => (c ? c.v : "")));

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

    // Chuyển thành đối tượng có key tương ứng
    let data = rows.map(r => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i] || ""));
      return obj;
    });

    // Gộp dữ liệu trùng xã/phường để lấy trạng thái ngập ưu tiên cao nhất
    const merged = {};
    for (const row of data) {
      const key = row["Tỉnh/TP"] + " - " + row["Xã/Phường"];
      if (!merged[key]) merged[key] = row;
      else {
        // Ưu tiên trạng thái ngập "Ngập nặng" > "Ngập nhẹ" > "Bình thường"
        const priority = { "Ngập nặng": 3, "Ngập nhẹ": 2, "Bình thường": 1 };
        const current = priority[merged[key]["Trạng thái ngập"]] || 0;
        const newVal = priority[row["Trạng thái ngập"]] || 0;
        if (newVal > current) merged[key]["Trạng thái ngập"] = row["]()
