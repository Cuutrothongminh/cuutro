if (rain > 50) status = "Ngập nặng";
    else if (rain > 30) status = "Ngập sâu";
    else if (rain > 10) status = "Ngập nhẹ";
    else status = "Bình thường";

    weatherCache[key] = { rain, status };
    localStorage.setItem("weatherCache", JSON.stringify(weatherCache));
    return { rain, status };
  } catch (err) {
    console.error("Weather fetch error:", err);
    return { rain: 0, status: "Bình thường" };
  }
}

// --- Cập nhật trạng thái mưa/ngập ---
async function updateWeatherStatus() {
  statusDiv.textContent = "🕓 Đang tải dữ liệu thời tiết...";

  const uniqueCommunes = {};
  globalData.forEach(r => {
    const key = `${r["Tỉnh/TP"]}-${r["Xã/Phường"]}`;
    if (!uniqueCommunes[key]) uniqueCommunes[key] = r;
  });

  const promises = Object.values(uniqueCommunes).map(async r => {
    const geo = await getLatLon(r["Tỉnh/TP"], r["Xã/Phường"]);
    if (geo) {
      const result = await getWeatherWithCache(r["Tỉnh/TP"], r["Xã/Phường"], geo.lat, geo.lon);
      r["Rain"] = result.rain;
      r["Trạng thái ngập"] = result.status;
    } else {
      r["Rain"] = 0;
      r["Trạng thái ngập"] = "Bình thường";
    }
  });

  await Promise.all(promises);

  globalData.forEach(r => {
    const key = `${r["Tỉnh/TP"]}-${r["Xã/Phường"]}`;
    const uniqueData = uniqueCommunes[key];
    r["Rain"] = uniqueData["Rain"];
    r["Trạng thái ngập"] = uniqueData["Trạng thái ngập"];
  });

  renderData(globalData);
  statusDiv.textContent = `🕓 Cập nhật lần cuối: ${new Date().toLocaleString("vi-VN")}`;
}

// --- Render dữ liệu ---
function renderData(data) {
  dataBody.innerHTML = "";
  if (!data.length) {
    dataBody.innerHTML = `<tr><td colspan="10" style="text-align:center;">Không có dữ liệu</td></tr>`;
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
      <td>${r["Huyện - Tỉnh cũ"]}</td>
      <td>${r["Đặc điểm địa hình"]}</td>
      <td>${r["Rain"]}</td>
      <td class="${statusClass}">${r["Trạng thái ngập"]}</td>
    `;
    dataBody.appendChild(tr);
  });
}

// --- Tìm kiếm nhanh ---
function searchData() {
  const keyword = searchInput.value.trim().toLowerCase();
  if (!keyword) {
    renderData(globalData);
    return;
  }
  const filtered = globalData.filter(
    r => r["Tỉnh/TP"].toLowerCase() === keyword || r["Xã/Phường"].toLowerCase() === keyword
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
setInterval(fetchData, 15 * 60 * 1000);
