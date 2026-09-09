// 全域變數
let rawData = [];       // 從 CSV 解析出的全部資料 (已清洗排序)
let currencyCols = [];  // 自動偵測到的幣別欄位 (例如: 美元兌台幣, 美元兌人民幣...)
let dateColName = "";   // 日期欄位名稱
let currentFilteredData = []; // 目前篩選後的資料
let fxChartInstance = null;

// 配色調色盤（若未來增加更多幣別，會依序自動取用）
const lineColors = [
  { stroke: '#00d2ff', bg: 'rgba(0, 210, 255, 0.1)' }, // 科技藍
  { stroke: '#00f2a9', bg: 'rgba(0, 242, 169, 0.1)' }, // 螢光青綠
  { stroke: '#ffb800', bg: 'rgba(255, 184, 0, 0.1)' }, // 金黃
  { stroke: '#ff5c8a', bg: 'rgba(255, 92, 138, 0.1)' }, // 霓虹粉
  { stroke: '#b388ff', bg: 'rgba(179, 136, 255, 0.1)' }, // 紫色
  { stroke: '#ff7a45', bg: 'rgba(255, 122, 69, 0.1)' }  // 珊瑚橘
];

document.addEventListener('DOMContentLoaded', () => {
  loadCSVDatabase();
  setupEventListeners();
});

// 1. 載入並解析 CSV (純靜態讀取同一目錄下的 rate_merge.csv)
function loadCSVDatabase() {
  Papa.parse('rate_merge.csv', {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
      if (!results.data || results.data.length === 0) {
        alert('rate_merge.csv 為空或讀取失敗！');
        document.getElementById('loadingOverlay').style.display = 'none';
        return;
      }
      processRawData(results.data, results.meta.fields);
    },
    error: function(err) {
      console.error(err);
      alert('無法取得 rate_merge.csv，請確認檔案路徑是否正確放於根目錄。');
      document.getElementById('loadingOverlay').style.display = 'none';
    }
  });
}

// 2. 清洗資料與自動識別欄位
function processRawData(data, fields) {
  // 自動將第 1 欄視為日期欄位，其餘視為幣別欄位
  dateColName = fields[0];
  currencyCols = fields.slice(1);

  // 清洗日期格式 (統一轉為 YYYY-MM-DD) 並依日期由舊到新排序
  rawData = data.map(row => {
    let rawDate = (row[dateColName] || '').trim();
    // 支援 2026/04/01 或 2026-04-01 或 20260401 格式正規化
    let formattedDate = rawDate.replace(/\//g, '-');
    if (/^\d{8}$/.test(formattedDate)) {
      formattedDate = `${formattedDate.slice(0, 4)}-${formattedDate.slice(4, 6)}-${formattedDate.slice(6, 8)}`;
    }

    let cleanRow = { [dateColName]: formattedDate };
    currencyCols.forEach(col => {
      let val = parseFloat(row[col]);
      cleanRow[col] = isNaN(val) ? null : val;
    });
    return cleanRow;
  }).filter(r => r[dateColName]); // 過濾無效日期列

  // 排序由舊到新
  rawData.sort((a, b) => new Date(a[dateColName]) - new Date(b[dateColName]));

  document.getElementById('loadingOverlay').style.display = 'none';
  document.getElementById('dataStatus').innerText = `已載入 ${rawData.length} 筆資料`;

  // 設定日期選擇器的最大與最小值
  const minDate = rawData[0][dateColName];
  const maxDate = rawData[rawData.length - 1][dateColName];
  document.getElementById('startDate').min = minDate;
  document.getElementById('startDate').max = maxDate;
  document.getElementById('endDate').min = minDate;
  document.getElementById('endDate').max = maxDate;

  // 預設套用最近 30 日
  applyQuickFilter(30);
}

// 3. 事件監聽
function setupEventListeners() {
  document.getElementById('quickFilter').addEventListener('change', (e) => {
    if (e.target.value === 'all') {
      document.getElementById('startDate').value = rawData[0][dateColName];
      document.getElementById('endDate').value = rawData[rawData.length - 1][dateColName];
      executeFilter();
    } else {
      applyQuickFilter(parseInt(e.target.value));
    }
  });

  document.getElementById('btnFilter').addEventListener('click', executeFilter);
  document.getElementById('btnExport').addEventListener('click', exportCSV);
}

// 快捷篩選指定天數
function applyQuickFilter(days) {
  if (rawData.length === 0) return;
  const lastIndex = rawData.length - 1;
  const startIndex = Math.max(0, lastIndex - days + 1);

  document.getElementById('startDate').value = rawData[startIndex][dateColName];
  document.getElementById('endDate').value = rawData[lastIndex][dateColName];
  executeFilter();
}

// 4. 依區間過濾資料
function executeFilter() {
  const start = document.getElementById('startDate').value;
  const end = document.getElementById('endDate').value;

  if (!start || !end) {
    alert('請選擇完整的開始與結束日期');
    return;
  }

  // 篩選區間
  currentFilteredData = rawData.filter(row => {
    return row[dateColName] >= start && row[dateColName] <= end;
  });

  updateSummaryCards();
  renderChart();
  renderTable();
}

// 5. 更新頂部指標卡片
function updateSummaryCards() {
  const container = document.getElementById('summaryGrid');
  container.innerHTML = '';

  if (currentFilteredData.length === 0) return;
  const latestRow = currentFilteredData[currentFilteredData.length - 1];

  currencyCols.forEach(col => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    const val = latestRow[col] !== null ? latestRow[col].toFixed(4) : '--';
    card.innerHTML = `
      <span class="label">最新 ${col}</span>
      <span class="value">${val}</span>
    `;
    container.appendChild(card);
  });
}

// 6. 繪製 Chart.js 走勢圖
function renderChart() {
  const ctx = document.getElementById('fxChart').getContext('2d');
  const labels = currentFilteredData.map(r => r[dateColName]);

  const datasets = currencyCols.map((col, idx) => {
    const color = lineColors[idx % lineColors.length];
    return {
      label: col,
      data: currentFilteredData.map(r => r[col]),
      borderColor: color.stroke,
      backgroundColor: color.bg,
      borderWidth: 2,
      pointRadius: currentFilteredData.length > 60 ? 0 : 3,
      pointHoverRadius: 5,
      tension: 0.1,
      fill: true
    };
  });

  if (fxChartInstance) {
    fxChartInstance.destroy();
  }

  fxChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          labels: { color: '#f0f4fc', font: { size: 12 } }
        },
        tooltip: {
          backgroundColor: '#161e2e',
          titleColor: '#00d2ff',
          bodyColor: '#fff',
          borderColor: '#232f46',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: '#1a2233' },
          ticks: { color: '#8b9bb4', maxTicksLimit: 10 }
        },
        y: {
          grid: { color: '#1a2233' },
          ticks: { color: '#8b9bb4' }
        }
      }
    }
  });
}

// 7. 渲染資料明細表格 (由新到舊反轉顯示)
function renderTable() {
  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');

  // 標題列
  thead.innerHTML = `
    <tr>
      <th>${dateColName}</th>
      ${currencyCols.map(c => `<th>${c}</th>`).join('')}
    </tr>
  `;

  // 內容列 (反轉：最近的排在上面)
  const displayRows = [...currentFilteredData].reverse();
  tbody.innerHTML = displayRows.map(row => `
    <tr>
      <td>${row[dateColName]}</td>
      ${currencyCols.map(c => `<td>${row[c] !== null ? row[c].toFixed(4) : '-'}</td>`).join('')}
    </tr>
  `).join('');
}

// 8. 匯出篩選後的 CSV 到使用者裝置
function exportCSV() {
  if (!currentFilteredData || currentFilteredData.length === 0) {
    alert('目前沒有可下載的資料！');
    return;
  }

  // 使用 PapaParse 反向產生 CSV 字串 (加上 UTF-8 BOM 防止 Excel 開啟亂碼)
  const csvString = '\uFEFF' + Papa.unparse(currentFilteredData);
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  
  const start = document.getElementById('startDate').value;
  const end = document.getElementById('endDate').value;
  const fileName = `FX_Rate_${start}_to_${end}.csv`;

  // 建立虛擬鏈結觸發下載
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}