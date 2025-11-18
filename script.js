// ==========================================
// CONFIG
// ==========================================
const API_KEY = "29bae1383ca3c78ad32949ccd7aaf7e0";  
const GOOGLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/12Ne9OjotFAmM9zbG9oOZ5KdERO0Y0nKWWlT_GVHtFdU/gviz/tq?tqx=out:json&gid=0";

let rawData = [];
let locationCache = {};      // cache geocoding
let weatherCache = {};       // cache thời tiết

// ==========================================
// Fetch Google Sheet
// ==========================================
async function loadSheet() {
    try {
        const res = await fetch(GOOGLE_SHEET_URL);
        const text = await res.text();
        const json = JSON.parse(text.substring(47, text.length - 2));

        rawData = json.table.rows.map(r => {
            const c = r.c;
            return {
                tinh: c[0]?.v || "",
                huyen: c[1]?.v || "",
                xa: c[2]?.v || "",
                thon: c[3]?.v || "",
                lienhe: c[4]?.v || "",
                phone: c[5]?.v || "",
                diahinh: c[6]?.v || "",
                ghichu: c[7]?.v || "",
                lat: c[8]?.v || "",
                lon: c[9]?.v || ""
            };
        });

        buildSidebarTree();
        renderTable(rawData);
        document.getElementById("update-status").innerText = "Đã tải xong.";
    } catch (err) {
        document.getElementById("update-status").innerText = "Lỗi tải dữ liệu.";
    }
}

// ==========================================
// SIDEBAR TREE
// ==========================================
function buildSidebarTree() {
    const container = document.getElementById("locationTree");
    container.innerHTML = "";

    const grouped = {};

    rawData.forEach(row => {
        if (!grouped[row.tinh]) grouped[row.tinh] = {};
        if (!grouped[row.tinh][row.huyen]) grouped[row.tinh][row.huyen] = {};
        if (!grouped[row.tinh][row.huyen][row.xa]) grouped[row.tinh][row.huyen][row.xa] = true;
    });

    for (let tinh in grouped) {
        const tinhDiv = createGroupItem(tinh);
        const huyenDiv = document.createElement("div");
        huyenDiv.className = "group-children";

        for (let huyen in grouped[tinh]) {
            const huyenItem = createGroupItem(huyen);
            const xaDiv = document.createElement("div");
            xaDiv.className = "group-children";

            for (let xa in grouped[tinh][huyen]) {
                const xaItem = document.createElement("div");
                xaItem.className = "group-title";
                xaItem.innerText = xa;
                xaItem.onclick = () => filterTable(tinh, huyen, xa);
                xaDiv.appendChild(xaItem);
            }

            huyenItem.appendChild(xaDiv);
            huyenItem.onclick = (e) => toggleGroup(e, xaDiv);
            huyenDiv.appendChild(huyenItem);
        }

        tinhDiv.appendChild(huyenDiv);
        tinhDiv.onclick = (e) => toggleGroup(e, huyenDiv);
        container.appendChild(tinhDiv);
    }
}

function createGroupItem(name) {
    const div = document.createElement("div");
    div.className = "group-title";
    div.innerText = name;
    return div;
}

function toggleGroup(event, childDiv) {
    event.stopPropagation();
    childDiv.style.display = childDiv.style.display === "block" ? "none" : "block";
}

// ==========================================
// RENDER TABLE
// ==========================================
async function renderTable(data) {
    const tbody = document.querySelector("#dataTable tbody");
    tbody.innerHTML = "";

    for (const row of data) {
        const { lat, lon } = await ensureLatLon(row);

        const weather = await fetchWeather(lat, lon);

        const rain = weather?.rain?.["1h"] || weather?.rain?.["3h"] || 0;
        const rowClass = getRainClass(rain);

        const tr = document.createElement("tr");
        tr.className = rowClass;

        tr.innerHTML = `
            <td>${row.tinh}</td>
            <td>${row.huyen}</td>
            <td>${row.xa}</td>
            <td>${row.thon}</td>
            <td>${row.lienhe}</td>
            <td>${row.phone}</td>
            <td>${row.diahinh}</td>
            <td>${rain.toFixed(1)}</td>
            <td>${new Date().toLocaleString("vi-VN")}</td>
            <td><a class="call-btn" href="tel:${row.phone}">Gọi</a></td>
        `;

        tbody.appendChild(tr);
    }
}

function getRainClass(rain) {
    if (rain < 5) return "rain-low";
    if (rain < 20) return "rain-mid";
    if (rain < 50) return "rain-high";
    return "rain-extreme";
}

// ==========================================
// FILTER TABLE
// ==========================================
function filterTable(tinh, huyen, xa) {
    const filtered = rawData.filter(r =>
        r.tinh === tinh && r.huyen === huyen && r.xa === xa
    );
    renderTable(filtered);
}

// ==========================================
// GEOCODING (OpenWeatherMap)
// ==========================================
async function ensureLatLon(row) {
    const key = `${row.thon}-${row.xa}-${row.huyen}-${row.tinh}`;
    if (locationCache[key]) return locationCache[key];

    if (row.lat && row.lon) {
        locationCache[key] = { lat: row.lat, lon: row.lon };
        return locationCache[key];
    }

    const q = `${row.thon}, ${row.xa}, ${row.huyen}, ${row.tinh}, Việt Nam`;
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${API_KEY}`;

    const res = await fetch(url);
    const js = await res.json();

    const lat = js[0]?.lat || 16.0472;
    const lon = js[0]?.lon || 108.2062;

    locationCache[key] = { lat, lon };
    return { lat, lon };
}

// ==========================================
// WEATHER
// ==========================================
async function fetchWeather(lat, lon) {
    const key = `${lat},${lon}`;
    if (weatherCache[key]) return weatherCache[key];

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;

    const res = await fetch(url);
    const js = await res.json();

    weatherCache[key] = js;
    return js;
}

// ==========================================
// SEARCH
// ==========================================
document.getElementById("searchInput").addEventListener("input", function () {
    const text = this.value.toLowerCase();

    const filtered = rawData.filter(r =>
        r.tinh.toLowerCase().includes(text) ||
        r.huyen.toLowerCase().includes(text) ||
        r.xa.toLowerCase().includes(text) ||
        r.thon.toLowerCase().includes(text) ||
        r.lienhe.toLowerCase().includes(text) ||
        r.phone.includes(text)
    );

    renderTable(filtered);
});

// ==========================================
// INIT
// ==========================================
loadSheet();
