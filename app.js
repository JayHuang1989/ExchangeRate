let rawData = [];
let currencyCols = [];
let currencyDisplayNames = {};
let activeCurrency = "";
let dateColName = "";
let currentTab1Data = [];
let chartInstance = null;

function formatCurrencyName(str) {
  return String(str).trim().toUpperCase().replace(/_/g, ':');
}

function fetchCSVLastModified() {
  fetch('rate_merge.csv', { method: 'HEAD' })
    .then(response => {
      const lastModified = response.headers.get('Last-Modified');
      if (lastModified) {
        const d = new Date(lastModified);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        document.getElementById('dataStatus').innerText = `資料更新時間：${y}/${m}/${day} ${hh}:${mm}`;
      } else {
        document.getElementById('dataStatus').innerText = `資料已載入`;
      }
    })
    .catch(() => {
      document.getElementById('dataStatus').innerText = `資料已載入`;
    });
}

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  loadCSVDatabase();
  fetchCSVLastModified();
});

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      document.getElementById(targetId).classList.add('active');

      if (targetId === 'tab1' && chartInstance) {
        chartInstance.resize();
      } else if (targetId === 'tab2') {
        renderYearMatrix();
      }
    });
  });
}

function loadCSVDatabase() {
  Papa.parse('rate_merge.csv', {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
      if (!results.data || results.data.length === 0) {
        alert('rate_merge.csv 資料為空或無法讀取！');
        document.getElementById('loadingOverlay').style.display = 'none';
        return;
      }
      initData(results.data, results.meta.fields);
    },
    error: function(err) {
      console.error(err);
      alert('找不到 rate_merge.csv，請確認檔案放置於根目錄。');
      document.getElementById('loadingOverlay').style.display = 'none';
    }
  });
}

function initData(data, fields) {
  dateColName = fields[0];
  currencyCols = fields.slice(1);

  currencyDisplayNames = {};
  currencyCols.forEach(col => {
    currencyDisplayNames[col] = formatCurrencyName(col);
  });

  rawData = data.map(row => {
    let rawDate = (row[dateColName] || '').trim().replace(/\//g, '-');
    if (/^\d{8}$/.test(rawDate)) {
      rawDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    }

    const obj = { [dateColName]: rawDate };
    currencyCols.forEach(col => {
      let val = parseFloat(row[col]);
      obj[col] = (isNaN(val) || row[col] === '' || row[col] === null) ? null : val;
    });
    return obj;
  }).filter(r => r[dateColName] && /^\d{4}-\d{2}-\d{2}$/.test(r[dateColName]));

  rawData.sort((a, b) => new Date(a[dateColName]) - new Date(b[dateColName]));
  activeCurrency = currencyCols[0] || "";

  document.getElementById('loadingOverlay').style.display = 'none';

  renderCurrencyRadios();
  setupEventListeners();
  onCurrencyChanged();
}

function renderCurrencyRadios() {
  const container = document.getElementById('currencyRadioGroup');
  container.innerHTML = '';

  currencyCols.forEach(col => {
    const label = document.createElement('label');
    label.className = `circle-radio-label ${col === activeCurrency ? 'active' : ''}`;
    label.innerHTML = `
      <input type="radio" name="currencySelect" value="${col}" ${col === activeCurrency ? 'checked' : ''}>
      <span>${currencyDisplayNames[col]}</span>
    `;

    label.querySelector('input').addEventListener('change', () => {
      activeCurrency = col;
      document.querySelectorAll('.circle-radio-label').forEach(el => el.classList.remove('active'));
      label.classList.add('active');
      onCurrencyChanged();
    });

    container.appendChild(label);
  });
}

function onCurrencyChanged() {
  const dispName = currencyDisplayNames[activeCurrency];
  document.getElementById('thCurrencyName').innerText = `${dispName} 匯率`;

  const validData = rawData.filter(r => r[activeCurrency] !== null);
  if (validData.length === 0) {
    alert(`此幣別 (${dispName}) 目前無任何有效資料！`);
    return;
  }

  const minDate = validData[0][dateColName];
  const maxDate = validData[validData.length - 1][dateColName];

  const sInput = document.getElementById('tab1StartDate');
  const eInput = document.getElementById('tab1EndDate');
  sInput.min = minDate;
  sInput.max = maxDate;
  eInput.min = minDate;
  eInput.max = maxDate;

  populateYearDropdown(validData);
  applyQuickFilter(30);

  if (document.getElementById('tab2').classList.contains('active')) {
    renderYearMatrix();
  }
}

function setupEventListeners() {
  document.getElementById('quickFilter').addEventListener('change', (e) => {
    if (e.target.value === 'all') {
      const validData = rawData.filter(r => r[activeCurrency] !== null);
      if (validData.length > 0) {
        document.getElementById('tab1StartDate').value = validData[0][dateColName];
        document.getElementById('tab1EndDate').value = validData[validData.length - 1][dateColName];
        executeTab1Filter();
      }
    } else {
      applyQuickFilter(parseInt(e.target.value));
    }
  });

  document.getElementById('btnFilterTab1').addEventListener('click', executeTab1Filter);
  document.getElementById('btnExportTab1').addEventListener('click', exportTab1CSV);
  document.getElementById('yearSelector').addEventListener('change', renderYearMatrix);
  document.getElementById('btnExportTab2').addEventListener('click', exportTab2CSV);
}

function applyQuickFilter(days) {
  const validData = rawData.filter(r => r[activeCurrency] !== null);
  if (validData.length === 0) return;

  const lastIndex = validData.length - 1;
  const startIndex = Math.max(0, lastIndex - days + 1);

  document.getElementById('tab1StartDate').value = validData[startIndex][dateColName];
  document.getElementById('tab1EndDate').value = validData[lastIndex][dateColName];
  executeTab1Filter();
}

function executeTab1Filter() {
  const start = document.getElementById('tab1StartDate').value;
  const end = document.getElementById('tab1EndDate').value;

  if (!start || !end) {
    alert('請設定完整的開始與結束日期！');
    return;
  }

  currentTab1Data = rawData.filter(r => {
    return r[dateColName] >= start && r[dateColName] <= end && r[activeCurrency] !== null;
  });

  renderTab1SummaryCards();
  renderTab1Chart();
  renderTab1Table();
}

function renderTab1SummaryCards() {
  const container = document.getElementById('tab1SummaryGrid');
  container.innerHTML = '';

  if (currentTab1Data.length === 0) {
    container.innerHTML = `<div class="stat-card"><span class="label">區間內查無有效資料</span></div>`;
    return;
  }

  let sum = 0;
  let maxItem = currentTab1Data[0];
  let minItem = currentTab1Data[0];

  currentTab1Data.forEach(item => {
    const val = item[activeCurrency];
    sum += val;
    if (val > maxItem[activeCurrency]) maxItem = item;
    if (val < minItem[activeCurrency]) minItem = item;
  });

  const avg = (sum / currentTab1Data.length).toFixed(4);
  const latestItem = currentTab1Data[currentTab1Data.length - 1];
  const formatSlashDate = (str) => str.replace(/-/g, '/');

  const cardsData = [
    { label: '最新匯率', val: latestItem[activeCurrency].toFixed(4), sub: formatSlashDate(latestItem[dateColName]), color: 'var(--accent-blue)' },
    { label: '區間平均匯率', val: avg, sub: `共 ${currentTab1Data.length} 個營業日`, color: 'var(--text-main)' },
    { label: '區間最高匯率', val: maxItem[activeCurrency].toFixed(4), sub: formatSlashDate(maxItem[dateColName]), color: 'var(--accent-green)' },
    { label: '區間最低匯率', val: minItem[activeCurrency].toFixed(4), sub: formatSlashDate(minItem[dateColName]), color: 'var(--accent-red)' }
  ];

  cardsData.forEach(card => {
    const el = document.createElement('div');
    el.className = 'stat-card';
    el.innerHTML = `
      <span class="label">${card.label}</span>
      <span class="value" style="color: ${card.color}">${card.val}</span>
      <span class="sub-date">${card.sub}</span>
    `;
    container.appendChild(el);
  });
}

function renderTab1Chart() {
  const ctx = document.getElementById('fxChart').getContext('2d');
  const labels = currentTab1Data.map(r => r[dateColName]);
  const values = currentTab1Data.map(r => r[activeCurrency]);
  const dispName = currencyDisplayNames[activeCurrency];

  if (chartInstance) {
    chartInstance.destroy();
  }

  if (values.length === 0) return;

  let maxVal = -Infinity;
  let minVal = Infinity;
  let sum = 0;

  values.forEach(v => {
    if (v > maxVal) maxVal = v;
    if (v < minVal) minVal = v;
    sum += v;
  });

  const avgVal = parseFloat((sum / values.length).toFixed(4));
  const avgLineData = new Array(values.length).fill(avgVal);
  const isApproxEqual = (a, b) => Math.abs(a - b) < 0.00001;

  const pointBgColors = [];
  const pointBorderColors = [];
  const pointRadii = [];
  const pointHoverRadii = [];

  const defaultRadius = values.length > 80 ? 0 : 2;

  values.forEach(v => {
    if (isApproxEqual(v, maxVal)) {
      pointBgColors.push('#00f2a9');
      pointBorderColors.push('#ffffff');
      pointRadii.push(7);
      pointHoverRadii.push(9);
    } else if (isApproxEqual(v, minVal)) {
      pointBgColors.push('#ff5c8a');
      pointBorderColors.push('#ffffff');
      pointRadii.push(7);
      pointHoverRadii.push(9);
    } else {
      pointBgColors.push('#00d2ff');
      pointBorderColors.push('#00d2ff');
      pointRadii.push(defaultRadius);
      pointHoverRadii.push(defaultRadius > 0 ? 5 : 0);
    }
  });

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: dispName,
          data: values,
          borderColor: '#00d2ff',
          backgroundColor: 'rgba(0, 210, 255, 0.12)',
          borderWidth: 2,
          tension: 0.1,
          fill: true,
          pointBackgroundColor: pointBgColors,
          pointBorderColor: pointBorderColors,
          pointBorderWidth: 2,
          pointRadius: pointRadii,
          pointHoverRadius: pointHoverRadii,
          order: 1
        },
        {
          label: `平均匯率 (${avgVal})`,
          data: avgLineData,
          borderColor: 'rgba(255, 255, 255, 0.65)',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          onClick: null,
          labels: { color: '#f0f4fc' }
        },
        tooltip: {
          backgroundColor: '#161e2e',
          titleColor: '#00d2ff',
          bodyColor: '#fff',
          borderColor: '#232f46',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              const label = context.dataset.label || '';
              const val = context.parsed.y;
              if (context.datasetIndex === 0) {
                if (isApproxEqual(val, maxVal)) return `${label}: ${val} (最高)`;
                if (isApproxEqual(val, minVal)) return `${label}: ${val} (最低)`;
              }
              return `${label}: ${val}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#1a2233' },
          ticks: { color: '#8b9bb4', maxTicksLimit: 12 }
        },
        y: {
          grid: { color: '#1a2233' },
          ticks: { color: '#8b9bb4' }
        }
      }
    }
  });
}

function renderTab1Table() {
  const tbody = document.getElementById('tab1TableBody');
  const reversed = [...currentTab1Data].reverse();

  tbody.innerHTML = reversed.map(r => `
    <tr>
      <td>${r[dateColName].replace(/-/g, '/')}</td>
      <td>${r[activeCurrency] !== null ? r[activeCurrency].toFixed(4) : ''}</td>
    </tr>
  `).join('');
}

function populateYearDropdown(validData) {
  const yearSet = new Set();
  validData.forEach(r => {
    const y = r[dateColName].substring(0, 4);
    yearSet.add(y);
  });

  const sortedYears = Array.from(yearSet).sort((a, b) => b - a);
  const selector = document.getElementById('yearSelector');
  selector.innerHTML = sortedYears.map(y => `<option value="${y}">${y} 年</option>`).join('');
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function renderYearMatrix() {
  const year = parseInt(document.getElementById('yearSelector').value);
  if (!year) return;

  const dispName = currencyDisplayNames[activeCurrency];
  document.getElementById('matrixYearTitle').innerText = `${year}年匯率統計表(${dispName})`;

  // 將表格左上角更新為「YYYY年」
  const thHeader = document.getElementById('thMatrixYearHeader');
  if (thHeader) {
    thHeader.innerText = `${year}年`;
  }

  const currYearMap = {};
  const prevYearMap = {};

  rawData.forEach(r => {
    if (r[activeCurrency] === null) return;
    const [yStr, mStr, dStr] = r[dateColName].split('-');
    const y = parseInt(yStr);
    const key = `${mStr}-${dStr}`;
    if (y === year) currYearMap[key] = r[activeCurrency];
    if (y === year - 1) prevYearMap[key] = r[activeCurrency];
  });

  const lastActiveKeyPerMonth = {};
  for (let m = 1; m <= 12; m++) {
    const monStr = String(m).padStart(2, '0');
    for (let d = 31; d >= 1; d--) {
      const dayStr = String(d).padStart(2, '0');
      const key = `${monStr}-${dayStr}`;
      if (currYearMap[key] !== undefined) {
        lastActiveKeyPerMonth[m] = key;
        break;
      }
    }
  }

  const tbody = document.getElementById('matrixTableBody');
  let rowsHtml = '';

  for (let d = 1; d <= 31; d++) {
    const dayStr = String(d).padStart(2, '0');
    rowsHtml += `<tr><td>${d}日</td>`;

    for (let m = 1; m <= 12; m++) {
      const monStr = String(m).padStart(2, '0');
      const key = `${monStr}-${dayStr}`;
      const maxDays = getDaysInMonth(year, m);

      if (d > maxDays) {
        rowsHtml += `<td style="color: #4b5563;">-</td>`;
      } else {
        const val = currYearMap[key];
        if (val !== undefined) {
          const isLast = (lastActiveKeyPerMonth[m] === key);
          rowsHtml += `<td class="${isLast ? 'last-valid-rate' : ''}">${val.toFixed(4)}</td>`;
        } else {
          rowsHtml += `<td></td>`;
        }
      }
    }
    rowsHtml += `</tr>`;
  }

  const calcStats = (yearMap, targetYear) => {
    const monthlyAvgs = [];
    const cumAvgs = [];
    const monthDays = [];
    const cumDays = [];

    let totalCumSum = 0;
    let totalCumCount = 0;

    for (let m = 1; m <= 12; m++) {
      const monStr = String(m).padStart(2, '0');
      const maxDays = getDaysInMonth(targetYear, m);
      let mSum = 0;
      let mCount = 0;

      for (let d = 1; d <= maxDays; d++) {
        const dayStr = String(d).padStart(2, '0');
        const v = yearMap[`${monStr}-${dayStr}`];
        if (v !== undefined) {
          mSum += v;
          mCount++;
        }
      }

      monthDays.push(mCount);
      totalCumCount += mCount;
      cumDays.push(totalCumCount);

      const mAvg = mCount > 0 ? (mSum / mCount) : null;
      monthlyAvgs.push(mAvg);

      totalCumSum += mSum;
      const cAvg = totalCumCount > 0 ? (totalCumSum / totalCumCount) : null;
      cumAvgs.push(cAvg);
    }
    return { monthlyAvgs, cumAvgs, monthDays, cumDays };
  };

  const currStats = calcStats(currYearMap, year);
  const prevStats = calcStats(prevYearMap, year - 1);

  rowsHtml += `
    <tr class="stat-days-row">
      <td>當月天數</td>
      ${currStats.monthDays.map(days => `<td>${days > 0 ? days : ''}</td>`).join('')}
    </tr>
    <tr class="stat-days-row">
      <td>今年天數</td>
      ${currStats.cumDays.map(days => `<td>${days > 0 ? days : ''}</td>`).join('')}
    </tr>
  `;
  tbody.innerHTML = rowsHtml;

  // 底部統計：確實更名為「當月平均」、「累計平均」、「去年同月」、「去年累計」
  const tfoot = document.getElementById('matrixTableFoot');
  tfoot.innerHTML = `
    <tr class="highlight-stat">
      <td>當月平均</td>
      ${currStats.monthlyAvgs.map(v => `<td>${v !== null ? v.toFixed(4) : ''}</td>`).join('')}
    </tr>
    <tr class="highlight-stat">
      <td>累計平均</td>
      ${currStats.cumAvgs.map(v => `<td>${v !== null ? v.toFixed(4) : ''}</td>`).join('')}
    </tr>
    <tr class="last-year-stat">
      <td>去年同月</td>
      ${prevStats.monthlyAvgs.map(v => `<td>${v !== null ? v.toFixed(4) : ''}</td>`).join('')}
    </tr>
    <tr class="last-year-stat">
      <td>去年累計</td>
      ${prevStats.cumAvgs.map(v => `<td>${v !== null ? v.toFixed(4) : ''}</td>`).join('')}
    </tr>
  `;

  renderQuarterCards(currYearMap, year);
}

// 季度卡片：標籤精簡為「Q1平均」、「Q2平均」、「Q3平均」、「Q4平均」
function renderQuarterCards(yearMap, targetYear) {
  const container = document.getElementById('tab2QuarterGrid');
  container.innerHTML = '';

  const quarters = [
    { name: 'Q1平均', months: [1, 2, 3] },
    { name: 'Q2平均', months: [4, 5, 6] },
    { name: 'Q3平均', months: [7, 8, 9] },
    { name: 'Q4平均', months: [10, 11, 12] }
  ];

  quarters.forEach(q => {
    let sum = 0;
    let count = 0;

    q.months.forEach(m => {
      const monStr = String(m).padStart(2, '0');
      const maxDays = getDaysInMonth(targetYear, m);
      for (let d = 1; d <= maxDays; d++) {
        const dayStr = String(d).padStart(2, '0');
        const v = yearMap[`${monStr}-${dayStr}`];
        if (v !== undefined) {
          sum += v;
          count++;
        }
      }
    });

    const avg = count > 0 ? (sum / count).toFixed(4) : '--';
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `
      <span class="label">${q.name}</span>
      <span class="value quarter-stat-value">${avg}</span>
      <span class="sub-date">${count > 0 ? `共 ${count} 個營業日` : '尚無資料'}</span>
    `;
    container.appendChild(card);
  });
}

function exportTab1CSV() {
  if (!currentTab1Data || currentTab1Data.length === 0) {
    alert('目前無有效資料可匯出！');
    return;
  }

  const dispName = currencyDisplayNames[activeCurrency];
  const exportData = currentTab1Data.map(r => ({
    "日期": r[dateColName].replace(/-/g, '/'),
    [dispName]: r[activeCurrency]
  }));

  const csv = '\uFEFF' + Papa.unparse(exportData);
  triggerDownload(csv, `${dispName.replace(/:/g, '_')}_匯率_${document.getElementById('tab1StartDate').value}_${document.getElementById('tab1EndDate').value}.csv`);
}

function exportTab2CSV() {
  const table = document.getElementById('yearMatrixTable');
  const rows = Array.from(table.querySelectorAll('tr'));
  
  const csvRows = rows.map(tr => {
    return Array.from(tr.children).map(td => `"${td.innerText.trim()}"`).join(',');
  });

  const csv = '\uFEFF' + csvRows.join('\r\n');
  const year = document.getElementById('yearSelector').value;
  const dispName = currencyDisplayNames[activeCurrency];
  triggerDownload(csv, `${year}年_${dispName.replace(/:/g, '_')}_年度匯率統計表.csv`);
}

function triggerDownload(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}