// Thay SHEET_ID và GID bằng sheet của bạn
const SHEET_ID = "12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU";
const GID = "325047141";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}`;

const AUTO_INTERVAL = 15*60*1000;

let dataRows = [], currentPage = 1, pageSize = 50;

const dom = {
  dataBody: document.getElementById("dataBody"),
  updateStatus: document.getElementById("updateStatus"),
  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),
  pageSizeSelect: document.getElementById("pageSize"),
  prevPageBtn: document.getElementById("prevPage"),
  nextPageBtn: document.getElementById("nextPage"),
  currentPageEl: document.getElementById("currentPage"),
  totalPageEl: document.getElementById("totalPage"),
  resultCountEl: document.getElementById("resultCount"),
  sortSelect: document.getElementById("sortSelect"),
  refreshBtn: document.getElementById("refreshBtn")
};

// Khởi tạo bản đồ (không marker)
const map = L.map('map').setView([16,107.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

async function fetchSheet() {
  dom.updateStatus.textContent = "Đang tải dữ liệu...";
  try {
    const res = await fetch(SHEET_URL);
    const text = await res.text();
    const match = text.match(/google\.visualization\.Query\.setResponse\((.*)\);/s);
    if(!match) throw new Error("Response không đúng định dạng JSON");
    const json = JSON.parse(match[1]);
    dataRows = json.table.rows.map(r=>{
      const obj = {};
      json.table.cols.forEach((c,i)=>obj[c.label] = r.c[i]?.v || "");
      return obj;
    });
    dom.updateStatus.textContent = `Đã tải ${dataRows.length} hàng`;
    currentPage = 1;
    renderTable();
  } catch(e){
    console.error(e);
    dom.updateStatus.textContent = "Lỗi tải dữ liệu!";
  }
}

function renderTable(){
  dom.dataBody.innerHTML = "";
  let rows = [...dataRows];

  // filter
  const q = dom.searchInput.value.toLowerCase();
  if(q) rows = rows.filter(r=>Object.values(r).some(v=>v.toString().toLowerCase().includes(q)));

  // sort
  const sort = dom.sortSelect.value;
  if(sort==="rain_desc") rows.sort((a,b)=>parseFloat(b["Lượng mưa (mm/1h)"]||0)-parseFloat(a["Lượng mưa (mm/1h)"]||0));
  else if(sort==="rain_asc") rows.sort((a,b)=>parseFloat(a["Lượng mưa (mm/1h)"]||0)-parseFloat(b["Lượng mưa (mm/1h)"]||0));
  else rows.sort((a,b)=>(a["Tỉnh/TP"]||"").localeCompare(b["Tỉnh/TP"]||""));

  pageSize = parseInt(dom.pageSizeSelect.value||50);
  const totalPage = Math.max(1, Math.ceil(rows.length/pageSize));
  if(currentPage>totalPage) currentPage = totalPage;
  dom.currentPageEl.textContent = currentPage;
  dom.totalPageEl.textContent = totalPage;
  dom.resultCountEl.textContent = rows.length;

  const pageRows = rows.slice((currentPage-1)*pageSize, (currentPage-1)*pageSize+pageSize);

  pageRows.forEach(r=>{
    const rain = parseFloat(r["Lượng mưa (mm/1h)"]||0);
    const tr = document.createElement("tr");
    tr.className = rain<5?"row-green":rain<20?"row-yellow":rain<50?"row-orange":"row-red";
    tr.innerHTML=`
      <td>${r["Tỉnh/TP"]}</td>
      <td>${r["Huyện - Tỉnh cũ"]}</td>
      <td>${r["Xã/Phường"]}</td>
      <td>${r["Chức vụ"]}</td>
      <td>${r["Họ và tên"]}</td>
      <td><a href="tel:${r["Số điện thoại"]}">${r["Số điện thoại"]}</a></td>
      <td>${r["Đặc điểm địa hình"]}</td>
      <td>${rain.toFixed(1)}</td>
      <td>${r["Trạng_thái"]||"Bình thường"}</td>
      <td><a class="btn btn-sm btn-success" href="tel:${r["Số điện thoại"]}">Gọi</a></td>
    `;
    dom.dataBody.appendChild(tr);
  });
}

// Event listeners
dom.searchBtn.addEventListener("click",()=>{ currentPage=1; renderTable(); });
dom.searchInput.addEventListener("input",()=>{ currentPage=1; renderTable(); });
dom.prevPageBtn.addEventListener("click",()=>{ if(currentPage>1){currentPage--;renderTable();} });
dom.nextPageBtn.addEventListener("click",()=>{ currentPage++; renderTable(); });
dom.pageSizeSelect.addEventListener("change",()=>{ currentPage=1; renderTable(); });
dom.sortSelect.addEventListener("change",()=>{ currentPage=1; renderTable(); });
dom.refreshBtn.addEventListener("click",fetchSheet);

fetchSheet();
setInterval(fetchSheet,AUTO_INTERVAL);
