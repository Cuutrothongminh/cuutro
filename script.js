<script>
/*
  Robust loader for Google Sheets GViz JSON.
  - Tự dò header từ json.table.cols
  - Xử lý ô merge / header nhiều dòng
  - Map cột theo tên (hỗ trợ các biến thể chữ hoa/thoáng)
  - Hiển thị cột "Đặc điểm địa hình" nếu có
  - Hỗ trợ bộ lọc Tỉnh / Huyện / Xã và tìm kiếm
*/

const SHEET_ID = "12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU";
const SHEET_NAME = "Tổng";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}`;

let allRows = [];     // array of objects { header1: value, ... }
let headers = [];     // array of header names exactly as from sheet

// helper: normalize header names for matching
function norm(h){ return (h||'').toString().trim().toLowerCase().replace(/\s+/g,' '); }

// find best key by matching possible header variants
function findKey(obj, patterns){
  for(const p of patterns){
    const want = p.toLowerCase();
    for(const k of Object.keys(obj)){
      if(norm(k).includes(norm(want))) return k;
    }
  }
  return null;
}

// fetch sheet, parse robustly
async function loadSheetJson(){
  try{
    const r = await fetch(SHEET_URL);
    const txt = await r.text();

    // GVIZ returns: google.visualization.Query.setResponse({...});
    // find first '{' and last ')'
    const firstBrace = txt.indexOf('{');
    const lastParen = txt.lastIndexOf(')');
    if(firstBrace < 0) throw new Error('Không nhận được JSON từ GViz');
    const jsonText = txt.substring(firstBrace, lastParen);
    const j = JSON.parse(jsonText);

    // headers from j.table.cols (preferred) else from first row
    const cols = j.table && j.table.cols ? j.table.cols : null;
    let colLabels = [];
    if(cols && cols.length){
      colLabels = cols.map(c => (c && c.label !== undefined) ? c.label : '');
    }

    const rawRows = j.table.rows || [];
    // build matrix of values (each row as array)
    const matrix = rawRows.map(r => {
      if(!r.c) return [];
      return r.c.map(cell => {
        if(!cell) return '';
        // if there is a formatted value
        if(cell.f !== undefined && cell.f !== null) return cell.f;
        return cell.v !== undefined ? cell.v : '';
      });
    });

    // if colLabels empty, try take first row as header
    if(!colLabels.length && matrix.length){
      const first = matrix[0];
      colLabels = first.map(c => c || '');
      // drop first row from matrix data
      matrix.shift();
    }

    headers = colLabels.map(h => h ? String(h).trim() : '');
    // map rows to objects using headers length
    const objs = matrix.map(arr => {
      const obj = {};
      for(let i=0;i<headers.length;i++){
        const key = headers[i] || `col${i}`;
        obj[key] = arr[i] !== undefined ? arr[i] : '';
      }
      // if extra cells beyond headers, append as colX
      if(arr.length > headers.length){
        for(let j=headers.length;j<arr.length;j++){
          obj[`col${j}`] = arr[j];
        }
      }
      return obj;
    });

    return { headers, rows: objs };
  } catch(err){
    console.error('Lỗi loadSheetJson:', err);
    throw err;
  }
}

// render UI
function buildUI(rows){
  allRows = rows.slice(); // copy
  // identify keys in sheet for required fields (robust names)
  const sample = allRows[0] || {};

  // patterns to search
  const keyT = findKey(sample, ['Tỉnh','Tỉnh/Thành phố','Tinh','tinh']);
  const keyH = findKey(sample, ['Huyện','Quận','Huyện/Thị xã/TP','Huyen','Huyện/Thị xã','Huyen/']);
  const keyX = findKey(sample, ['Xã','Phường','Xã/Phường','Xa','Xa/Phuong','xã/phường']);
  const keyTh = findKey(sample, ['Thôn','Xóm','Thôn/Xóm','Thôn/xóm','thon']);
  const keyName = findKey(sample, ['Họ và tên','Họ tên','Ho va ten','Tên']);
  const keyRole = findKey(sample, ['Chức vụ','Chuc vu','Vai trò','Chức']);
  const keyPhone = findKey(sample, ['Số điện thoại','Số ĐT','Điện thoại','Phone','SĐT']);
  const keyTruoc = findKey(sample, ['Trước sáp nhập','Truoc sap nhap','Trước sáp nhập']);
  const keyTerrain = findKey(sample, ['Đặc điểm địa hình','Đặc điểm','Địa hình','terrain','characteristics']);

  // save mapping for rendering
  const map = { keyT, keyH, keyX, keyTh, keyName, keyRole, keyPhone, keyTruoc, keyTerrain };

  // fill province dropdown
  const provSet = new Set(allRows.map(r => r[keyT] || '').filter(Boolean));
  const provSel = document.getElementById('provinceSelect');
  provSel.innerHTML = '<option value="">-- Chọn Tỉnh/Thành phố --</option>';
  Array.from(provSet).sort().forEach(p=>{
    const o=document.createElement('option'); o.value=p; o.textContent=p; provSel.appendChild(o);
  });

  // store map on window for use in filter
  window._sheetMap = map;
  renderTable(allRows, map);
}

// render table rows (data is array of objects)
function renderTable(data, map){
  const tbody = document.querySelector('#dataTable tbody');
  tbody.innerHTML = '';

  // ensure header order in table: Tỉnh, Huyện, Xã, Thôn, Họ tên, Chức vụ, SĐT, Trước sáp nhập, Đặc điểm địa hình
  for(const r of data){
    const tr = document.createElement('tr');

    const cells = [
      r[map.keyT]||'',
      r[map.keyH]||'',
      r[map.keyX]||'',
      r[map.keyTh]||'',
      r[map.keyName]||'',
      r[map.keyRole]||'',
      r[map.keyPhone]||'',
      r[map.keyTruoc]||'',
      r[map.keyTerrain]||''
    ];

    cells.forEach(txt=>{
      const td = document.createElement('td');
      td.textContent = txt;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  }
}

// filter logic (uses mapping saved earlier)
function filterTable(){
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const prov = document.getElementById('provinceSelect').value;
  const dist = document.getElementById('districtSelect').value;
  const comm = document.getElementById('communeSelect').value;

  const map = window._sheetMap || {};
  const filtered = allRows.filter(r=>{
    if(prov && (r[map.keyT] || '') !== prov) return false;
    if(dist && (r[map.keyH] || '') !== dist) return false;
    if(comm && (r[map.keyX] || '') !== comm) return false;
    if(!q) return true;
    // search across all visible fields
    const hay = [
      r[map.keyT], r[map.keyH], r[map.keyX], r[map.keyTh],
      r[map.keyName], r[map.keyRole], r[map.keyPhone], r[map.keyTruoc], r[map.keyTerrain]
    ].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });

  // update district & commune select based on current province & filtered rows
  updateDistrictCommuneOptions(filtered, map);
  renderTable(filtered, map);
}

function updateDistrictCommuneOptions(rows, map){
  const ds = [...new Set(rows.map(r => r[map.keyH]||'').filter(Boolean))].sort();
  const cs = [...new Set(rows.map(r => r[map.keyX]||'').filter(Boolean))].sort();
  const dsel = document.getElementById('districtSelect');
  const csel = document.getElementById('communeSelect');
  dsel.innerHTML = '<option value="">-- Chọn Huyện/Thị xã/TP --</option>';
  csel.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
  ds.forEach(d => { const o=document.createElement('option'); o.value=d; o.textContent=d; dsel.appendChild(o); });
  cs.forEach(c => { const o=document.createElement('option'); o.value=c; o.textContent=c; csel.appendChild(o); });
}

// initial load
(async function init(){
  try{
    const { headers: h, rows } = await loadSheetJson();
    // if no rows -> show message
    if(!rows || !rows.length){
      document.querySelector('#dataTable tbody').innerHTML = '<tr><td colspan="9">Không có dữ liệu</td></tr>';
      return;
    }
    buildUI(rows);
  }catch(e){
    console.error(e);
    alert('Lỗi tải dữ liệu. Kiểm tra quyền chia sẻ Google Sheet hoặc console log.');
  }
})();

// attach events
document.getElementById('searchInput').addEventListener('input', ()=> filterTable());
document.getElementById('provinceSelect').addEventListener('change', ()=> filterTable());
document.getElementById('districtSelect').addEventListener('change', ()=> filterTable());
document.getElementById('communeSelect').addEventListener('change', ()=> filterTable());
</script>
