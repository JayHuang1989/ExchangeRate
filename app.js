let rawData = [];
let currencyCols = [];            // 所有幣別（含折算匯率）
let usdCompareCols = [];          // 僅限原始 USD 幣別 (usd_twd, usd_cny, usd_php)
let currencyDisplayNames = {};
let activeCurrency = "";
let dateColName = "";
let currentTab1Data = [];

// 圖表實例
let chartInstanceTab1 = null;
let chartInstanceTab3 = null;
let chartInstanceTab4 = null;

// 多幣別勾選狀態（預設全選）
let selectedUsdCols = [];

// 配色方案（USD:TWD 亮青藍、USD:CNY 亮綠、USD:PHP 亮粉紅）
const CURRENCY_COLORS = {
  'usd_twd': { line: '#00d2ff', bg: 'rgba(0, 210, 255, 0.1)' },
  'usd_cny': { line: '#00f2a9', bg: 'rgba(0, 242, 169, 0.1)' },
  'usd_php': { line: '#ff5c8a', bg: 'rgba(255, 92, 138, 0.1)' }
};
const FALLBACK_COLORS = ['#ffb800', '#c084fc', '#38bdf8', '#fb923c'];

function formatCurrencyName(str) {
  return String(str).trim().toUpperCase().replace(/_/g, ':');
}

function fetchCSVLastModified() {
  const owner = 'JayHuang1989';
  const repo = 'ExchangeRate';
  const filePath = 'rate_merge.csv';
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?path=${filePath}&per_page=1`;

  fetch(url)
    .then(response => response.json())
    .then(commits => {
      if (commits && commits.length > 0) {
        const commitTime = commits[0].commit.committer.date;
        const d = new Date(commitTime);
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

      // 切換時重繪對應圖表，避免尺寸跑版
      if (targetId === 'tab1' && chartInstanceTab1) {
        chartInstanceTab1.resize();
      } else if (targetId === 'tab2') {
        renderYearMatrix();
      } else if (targetId === 'tab3') {
        if (chartInstanceTab3) chartInstanceTab3.resize();
        renderTab3IndexedChart();
      } else if (targetId === 'tab4') {
        if (chartInstanceTab4) chartInstanceTab4.resize();
        renderTab4PctChart();
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

  // 1. 所有幣別（排除日期與含 note 欄位）
  currencyCols = fields.slice(1).filter(col => !col.toLowerCase().includes('note'));

  // 2. 僅納入原始 USD 匯率 (usd_ 開頭，排除 cny_twd, php_twd 等)
  usdCompareCols = currencyCols.filter(col => {
    const c = col.toLowerCase();
    return c.startsWith('usd_') && (c === 'usd_twd' || c === 'usd_cny' || c === 'usd_php');
  });

  // 預設全選比較幣別
  selectedUsdCols = [...usdCompareCols];

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

  renderCurrencyRadios('currencyRadioGroupTab1');
  renderCurrencyRadios('currencyRadioGroupTab2');
  renderCompareCheckboxes('compareCheckboxGroupTab3', 3);
  renderCompareCheckboxes('compareCheckboxGroupTab4', 4);

  setupEventListeners();

  // 初始化各頁面
  onCurrencyChanged();
  updateCommonPeriod(3, true);
  updateCommonPeriod(4, true);
}

/* =========================================================================
   單一幣別控制 (Tab 1 & Tab 2)
   ========================================================================= */
function renderCurrencyRadios(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  currencyCols.forEach(col => {
    const label = document.createElement('label');
    label.className = `circle-radio-label ${col === activeCurrency ? 'active' : ''}`;
    label.innerHTML = `
      <input type="radio" name="currencySelect_${containerId}" value="${col}" ${col === activeCurrency ? 'checked' : ''}>
      <span>${currencyDisplayNames[col]}</span>
    `;

    label.querySelector('input').addEventListener('change', () => {
      activeCurrency = col;
      // 同步所有單選按鈕組的狀態
      document.querySelectorAll('.circle-radio-label').forEach(el => {
        const input = el.querySelector('input');
        if (input && input.value === col) {
          el.classList.add('active');
          input.checked = true;
        } else if (input) {
          el.classList.remove('active');
          input.checked = false;
        }
      });
      onCurrencyChanged();
    });

    container.appendChild(label);
  });
}

function onCurrencyChanged() {
  const dispName = currencyDisplayNames[activeCurrency];
  document.getElementById('thCurrencyName').innerText = `${dispName} 匯率`;

  const validData = rawData.filter(r => r[activeCurrency] !== null);
  if (validData.length === 0) return;

  const minDate = validData[0][dateColName];
  const maxDate = validData[validData.length - 1][dateColName];

  const sInput = document.getElementById('tab1StartDate');
  const eInput = document.getElementById('tab1EndDate');
  sInput.min = minDate;
  sInput.max = maxDate;
  eInput.min = minDate;
  eInput.max = maxDate;

  populateYearDropdown(validData);

  const currentQuickFilter = document.getElementById('quickFilter').value;
  if (currentQuickFilter === 'all') {
    sInput.value = minDate;
    eInput.value = maxDate;
    executeTab1Filter();
  } else if (!isNaN(parseInt(currentQuickFilter))) {
    applyQuickFilter(parseInt(currentQuickFilter));
  } else {
    if (sInput.value < minDate) sInput.value = minDate;
    if (eInput.value > maxDate) eInput.value = maxDate;
    executeTab1Filter();
  }

  if (document.getElementById('tab2').classList.contains('active')) {
    renderYearMatrix();
  }
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

  if (!start || !end) return;

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

  if (chartInstanceTab1) chartInstanceTab1.destroy();
  if (values.length === 0) return;

  let maxVal = Math.max(...values);
  let minVal = Math.min(...values);
  let sum = values.reduce((a, b) => a + b, 0);
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

  chartInstanceTab1 = new Chart(ctx, {
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
        legend: { labels: { color: '#f0f4fc' } },
        tooltip: {
          backgroundColor: '#161e2e',
          titleColor: '#00d2ff',
          bodyColor: '#fff',
          borderColor: '#232f46',
          borderWidth: 1
        }
      },
      scales: {
        x: { grid: { color: '#1a2233' }, ticks: { color: '#8b9bb4', maxTicksLimit: 12 } },
        y: { grid: { color: '#1a2233' }, ticks: { color: '#8b9bb4' } }
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

/* =========================================================================
   多幣別比較勾選與共同區間演算法 (Tab 3 & Tab 4)
   ========================================================================= */
function renderCompareCheckboxes(containerId, tabNum) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  usdCompareCols.forEach(col => {
    const isChecked = selectedUsdCols.includes(col);
    const label = document.createElement('label');
    label.className = `checkbox-pill-label ${isChecked ? 'active' : ''}`;
    label.innerHTML = `
      <input type="checkbox" value="${col}" ${isChecked ? 'checked' : ''}>
      <span>${currencyDisplayNames[col]}</span>
    `;

    label.querySelector('input').addEventListener('change', (e) => {
      const val = e.target.value;
      if (e.target.checked) {
        if (!selectedUsdCols.includes(val)) selectedUsdCols.push(val);
      } else {
        if (selectedUsdCols.length <= 1) {
          alert('至少必須保留勾選 1 個幣別！');
          e.target.checked = true;
          return;
        }
        selectedUsdCols = selectedUsdCols.filter(c => c !== val);
      }

      // 同步 Tab 3 與 Tab 4 的 Checkbox UI
      syncCompareCheckboxesUI();

      // 重新計算共同重疊期間並更新圖表
      updateCommonPeriod(3, true);
      updateCommonPeriod(4, true);
    });

    container.appendChild(label);
  });
}

function syncCompareCheckboxesUI() {
  [3, 4].forEach(tabNum => {
    const container = document.getElementById(`compareCheckboxGroupTab${tabNum}`);
    if (!container) return;
    container.querySelectorAll('label').forEach(lbl => {
      const input = lbl.querySelector('input');
      const checked = selectedUsdCols.includes(input.value);
      input.checked = checked;
      lbl.classList.toggle('active', checked);
    });
  });
}

// 取得所勾選幣別共同「均有非 null 資料」的子陣列
function getCommonValidRecords() {
  if (selectedUsdCols.length === 0) return [];
  return rawData.filter(row => {
    return selectedUsdCols.every(col => row[col] !== null && row[col] !== undefined);
  });
}

// 更新指定 Tab 的共同日期極限並設定預設日期
function updateCommonPeriod(tabNum, resetToFull = false) {
  const commonData = getCommonValidRecords();
  const infoEl = document.getElementById(`commonPeriodInfoTab${tabNum}`);
  const sInput = document.getElementById(`tab${tabNum}StartDate`);
  const eInput = document.getElementById(`tab${tabNum}EndDate`);

  if (commonData.length === 0) {
    if (infoEl) infoEl.innerText = '所選幣別之間無共同重疊資料！';
    return;
  }

  const minCommonDate = commonData[0][dateColName];
  const maxCommonDate = commonData[commonData.length - 1][dateColName];

  sInput.min = minCommonDate;
  sInput.max = maxCommonDate;
  eInput.min = minCommonDate;
  eInput.max = maxCommonDate;

  if (infoEl) {
    const names = selectedUsdCols.map(c => currencyDisplayNames[c]).join(', ');
    infoEl.innerText = `ⓘ 目前勾選 [${names}]，共同資料期間：${minCommonDate.replace(/-/g, '/')} ~ ${maxCommonDate.replace(/-/g, '/')} (共 ${commonData.length} 個營業日)`;
  }

  if (resetToFull || !sInput.value || sInput.value < minCommonDate) {
    sInput.value = minCommonDate;
  }
  if (resetToFull || !eInput.value || eInput.value > maxCommonDate) {
    eInput.value = maxCommonDate;
  }

  if (tabNum === 3) renderTab3IndexedChart();
  if (tabNum === 4) renderTab4PctChart();
}

function applyQuickFilterForCompare(tabNum, days) {
  const commonData = getCommonValidRecords();
  if (commonData.length === 0) return;

  const lastIndex = commonData.length - 1;
  const startIndex = Math.max(0, lastIndex - days + 1);

  document.getElementById(`tab${tabNum}StartDate`).value = commonData[startIndex][dateColName];
  document.getElementById(`tab${tabNum}EndDate`).value = commonData[lastIndex][dateColName];

  if (tabNum === 3) renderTab3IndexedChart();
  if (tabNum === 4) renderTab4PctChart();
}

/* =========================================================================
   TAB 3: 基期指數化 (Base 100) 圖表繪製
   ========================================================================= */
function renderTab3IndexedChart() {
  const sDate = document.getElementById('tab3StartDate').value;
  const eDate = document.getElementById('tab3EndDate').value;
  const commonData = getCommonValidRecords().filter(r => r[dateColName] >= sDate && r[dateColName] <= eDate);

  const ctx = document.getElementById('indexedChart').getContext('2d');
  if (chartInstanceTab3) chartInstanceTab3.destroy();

  if (commonData.length === 0) return;

  const labels = commonData.map(r => r[dateColName]);
  const baseRow = commonData[0]; // 起點日

  const datasets = selectedUsdCols.map((col, idx) => {
    const baseVal = baseRow[col];
    const colorObj = CURRENCY_COLORS[col] || { line: FALLBACK_COLORS[idx % FALLBACK_COLORS.length], bg: 'transparent' };
    const indexedValues = commonData.map(r => {
      return parseFloat(((r[col] / baseVal) * 100).toFixed(2));
    });

    return {
      label: `${currencyDisplayNames[col]} (起點匯率 ${baseVal.toFixed(4)})`,
      data: indexedValues,
      borderColor: colorObj.line,
      backgroundColor: 'transparent',
      borderWidth: 2,
      tension: 0.1,
      pointRadius: indexedValues.length > 100 ? 0 : 2,
      pointHoverRadius: 5
    };
  });

  chartInstanceTab3 = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#f0f4fc' } },
        tooltip: {
          backgroundColor: '#161e2e',
          titleColor: '#00d2ff',
          bodyColor: '#fff',
          borderColor: '#232f46',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label.split(' ')[0]}: 指數 ${ctx.parsed.y} (${ctx.parsed.y >= 100 ? '+' : ''}${(ctx.parsed.y - 100).toFixed(2)}%)`
          }
        }
      },
      scales: {
        x: { grid: { color: '#1a2233' }, ticks: { color: '#8b9bb4', maxTicksLimit: 12 } },
        y: {
          grid: { color: '#1a2233' },
          ticks: { color: '#8b9bb4' },
          title: { display: true, text: '基期指數 (起點日 = 100)', color: '#8b9bb4' }
        }
      }
    }
  });
}

/* =========================================================================
   TAB 4: 累積漲跌幅百分比 (%) 圖表繪製
   ========================================================================= */
function renderTab4PctChart() {
  const sDate = document.getElementById('tab4StartDate').value;
  const eDate = document.getElementById('tab4EndDate').value;
  const commonData = getCommonValidRecords().filter(r => r[dateColName] >= sDate && r[dateColName] <= eDate);

  const ctx = document.getElementById('pctChangeChart').getContext('2d');
  if (chartInstanceTab4) chartInstanceTab4.destroy();

  if (commonData.length === 0) return;

  const labels = commonData.map(r => r[dateColName]);
  const baseRow = commonData[0];

  const datasets = selectedUsdCols.map((col, idx) => {
    const baseVal = baseRow[col];
    const colorObj = CURRENCY_COLORS[col] || { line: FALLBACK_COLORS[idx % FALLBACK_COLORS.length], bg: 'transparent' };
    const pctValues = commonData.map(r => {
      const pct = ((r[col] - baseVal) / baseVal) * 100;
      return parseFloat(pct.toFixed(2));
    });

    return {
      label: `${currencyDisplayNames[col]} (起點匯率 ${baseVal.toFixed(4)})`,
      data: pctValues,
      borderColor: colorObj.line,
      backgroundColor: 'transparent',
      borderWidth: 2,
      tension: 0.1,
      pointRadius: pctValues.length > 100 ? 0 : 2,
      pointHoverRadius: 5
    };
  });

  chartInstanceTab4 = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#f0f4fc' } },
        tooltip: {
          backgroundColor: '#161e2e',
          titleColor: '#00d2ff',
          bodyColor: '#fff',
          borderColor: '#232f46',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label.split(' ')[0]}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y}%`
          }
        }
      },
      scales: {
        x: { grid: { color: '#1a2233' }, ticks: { color: '#8b9bb4', maxTicksLimit: 12 } },
        y: {
          grid: { color: '#1a2233' },
          ticks: {
            color: '#8b9bb4',
            callback: (val) => `${val > 0 ? '+' : ''}${val}%`
          },
          title: { display: true, text: '累積漲跌幅 (%)', color: '#8b9bb4' }
        }
      }
    }
  });
}

/* =========================================================================
   年度矩陣統計 (Tab 2 沿用)
   ========================================================================= */
function populateYearDropdown(validData) {
  const yearSet = new Set();
  validData.forEach(r => yearSet.add(r[dateColName].substring(0, 4)));
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

  const thHeader = document.getElementById('thMatrixYearHeader');
  if (thHeader) thHeader.innerText = `${year}年`;

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

  let maxActiveMonthThisYear = 0;
  for (let m = 1; m <= 12; m++) {
    const monStr = String(m).padStart(2, '0');
    for (let d = 1; d <= 31; d++) {
      const dayStr = String(d).padStart(2, '0');
      if (currYearMap[`${monStr}-${dayStr}`] !== undefined) {
        maxActiveMonthThisYear = Math.max(maxActiveMonthThisYear, m);
      }
    }
  }

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
        rowsHtml += `<td style="text-align: center !important; color: #4b5563;">-</td>`;
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

  const calcStats = (yearMap, targetYear, isCurrentYear = true) => {
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
      const mAvg = mCount > 0 ? (mSum / mCount) : null;
      monthlyAvgs.push(mAvg);

      totalCumSum += mSum;
      totalCumCount += mCount;

      if (isCurrentYear && (m > maxActiveMonthThisYear || (mCount === 0 && totalCumCount === 0))) {
        cumDays.push(null);
        cumAvgs.push(null);
      } else {
        cumDays.push(totalCumCount > 0 ? totalCumCount : null);
        const cAvg = totalCumCount > 0 ? (totalCumSum / totalCumCount) : null;
        cumAvgs.push(cAvg);
      }
    }
    return { monthlyAvgs, cumAvgs, monthDays, cumDays };
  };

  const currStats = calcStats(currYearMap, year, true);
  const prevStats = calcStats(prevYearMap, year - 1, false);

  rowsHtml += `
    <tr class="stat-days-row">
      <td>當月天數</td>
      ${currStats.monthDays.map(days => `<td>${days > 0 ? days : ''}</td>`).join('')}
    </tr>
    <tr class="stat-days-row">
      <td>今年天數</td>
      ${currStats.cumDays.map(days => `<td>${days !== null && days > 0 ? days : ''}</td>`).join('')}
    </tr>
  `;
  tbody.innerHTML = rowsHtml;

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

/* =========================================================================
   事件綁定與 CSV 匯出
   ========================================================================= */
function setupEventListeners() {
  // Tab 1 事件
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

  // Tab 2 事件
  document.getElementById('yearSelector').addEventListener('change', renderYearMatrix);
  document.getElementById('btnExportTab2').addEventListener('click', exportTab2CSV);

  // Tab 3 事件
  document.getElementById('tab3QuickFilter').addEventListener('change', (e) => {
    if (e.target.value === 'all') {
      updateCommonPeriod(3, true);
    } else {
      applyQuickFilterForCompare(3, parseInt(e.target.value));
    }
  });
  document.getElementById('btnFilterTab3').addEventListener('click', renderTab3IndexedChart);
  document.getElementById('btnExportTab3').addEventListener('click', () => exportCompareCSV('indexed'));

  // Tab 4 事件
  document.getElementById('tab4QuickFilter').addEventListener('change', (e) => {
    if (e.target.value === 'all') {
      updateCommonPeriod(4, true);
    } else {
      applyQuickFilterForCompare(4, parseInt(e.target.value));
    }
  });
  document.getElementById('btnFilterTab4').addEventListener('click', renderTab4PctChart);
  document.getElementById('btnExportTab4').addEventListener('click', () => exportCompareCSV('percentage'));
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
  const csvRows = rows.map(tr => Array.from(tr.children).map(td => `"${td.innerText.trim()}"`).join(','));
  const csv = '\uFEFF' + csvRows.join('\r\n');
  const year = document.getElementById('yearSelector').value;
  const dispName = currencyDisplayNames[activeCurrency];
  triggerDownload(csv, `${year}年_${dispName.replace(/:/g, '_')}_年度匯率統計表.csv`);
}

function exportCompareCSV(mode) {
  const tabNum = (mode === 'indexed') ? 3 : 4;
  const sDate = document.getElementById(`tab${tabNum}StartDate`).value;
  const eDate = document.getElementById(`tab${tabNum}EndDate`).value;
  const commonData = getCommonValidRecords().filter(r => r[dateColName] >= sDate && r[dateColName] <= eDate);

  if (commonData.length === 0) {
    alert('目前無資料可供匯出！');
    return;
  }

  const baseRow = commonData[0];
  const exportData = commonData.map(r => {
    const rowObj = { "日期": r[dateColName].replace(/-/g, '/') };
    selectedUsdCols.forEach(col => {
      const baseVal = baseRow[col];
      const dispName = currencyDisplayNames[col];
      if (mode === 'indexed') {
        rowObj[`${dispName}_基期指數`] = parseFloat(((r[col] / baseVal) * 100).toFixed(2));
      } else {
        rowObj[`${dispName}_累積漲跌(%)`] = parseFloat((((r[col] - baseVal) / baseVal) * 100).toFixed(2));
      }
      rowObj[`${dispName}_原始匯率`] = r[col];
    });
    return rowObj;
  });

  const csv = '\uFEFF' + Papa.unparse(exportData);
  const prefix = (mode === 'indexed') ? '多幣別基期指數化' : '多幣別累積漲跌幅';
  triggerDownload(csv, `${prefix}_${sDate}_${eDate}.csv`);
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