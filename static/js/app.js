// ==========================================================================
// CAM Mutual Fund Statement Extractor - Frontend App Logic & Goal Tracker
// ==========================================================================

let uploadedFiles = [];
let currentHoldings = [];
let filteredHoldings = [];
let currentSortColumn = 'Market Value (INR)';
let sortAscending = false;

let activeMainView = 'OVERVIEW'; // 'OVERVIEW' vs 'GOAL_TRACKER'
let filterMode = 'CATEGORY'; // 'CATEGORY', 'FUND_HOUSE', 'SCHEME'
let activeFilterValue = 'ALL';
let includeCategoryMatching = false; // Toggle for Category-matched Goal tracking

let excludedGoalHoldingKeys = new Set(); // Stores holding _ids user excluded from goal analysis in UI

let categoryChart = null;
let registrarChart = null;
let goalComparisonChart = null;

// Default Target Goals fallback configuration
const DEFAULT_TARGET_GOALS = [
  { key: 'parag_parikh', name: 'Parag Parikh Flexi Cap Fund', category: 'Equity: Flexi Cap', targetPct: 35.0, keywords: ['parag parikh flexi'] },
  { key: 'icici_opp', name: 'ICICI Pru India Opp Fund', category: 'Equity: Sectoral / Thematic', targetPct: 20.0, keywords: ['icici prudential india opportunities', 'icici pru india opp'] },
  { key: 'hdfc_midcap', name: 'HDFC Midcap Fund', category: 'Equity: Mid Cap', targetPct: 20.0, keywords: ['hdfc mid cap', 'hdfc midcap'] },
  { key: 'quant_smallcap', name: 'Quant Small Cap Fund', category: 'Equity: Small Cap', targetPct: 15.0, keywords: ['quant small cap', 'quant smallcap'] },
  { key: 'icici_gold', name: 'ICICI Pru Gold ETF FOF', category: 'Commodity: Gold', targetPct: 5.0, keywords: ['icici prudential gold', 'icici pru gold'] },
  { key: 'icici_silver', name: 'ICICI Pru Silver ETF FOF', category: 'Commodity: Silver', targetPct: 5.0, keywords: ['icici prudential silver', 'icici pru silver'] }
];

// Target Goals initialized with defaults, updated asynchronously from target_goals.json via /api/goals
let TARGET_GOALS = [...DEFAULT_TARGET_GOALS];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupUploadEvents();
  fetchTargetGoals();
  fetchSampleData();
});

// Setup Drag & Drop and File Input
function setupUploadEvents() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = Array.from(dt.files);
    handleFiles(files);
  });

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    handleFiles(files);
  });

  document.getElementById('searchInput').addEventListener('input', applyFilters);
}

// Fetch Target Goals Document from /api/goals
async function fetchTargetGoals() {
  try {
    const res = await fetch('/api/goals');
    if (!res.ok) return;
    const result = await res.json();
    if (result.success && result.goals && result.goals.length > 0) {
      TARGET_GOALS = result.goals;
      if (activeMainView === 'GOAL_TRACKER') {
        renderGoalTrackerView();
      }
    }
  } catch (e) {
    console.log('Using default target goals configuration.');
  }
}

// Switch Main Dashboard View
function switchMainView(viewName) {
  activeMainView = viewName;
  document.getElementById('navOverviewBtn').className = 'nav-tab ' + (viewName === 'OVERVIEW' ? 'active' : '');
  document.getElementById('navGoalBtn').className = 'nav-tab ' + (viewName === 'GOAL_TRACKER' ? 'active' : '');

  if (viewName === 'OVERVIEW') {
    document.getElementById('overviewView').style.display = 'block';
    document.getElementById('goalTrackerView').style.display = 'none';
  } else {
    document.getElementById('overviewView').style.display = 'none';
    document.getElementById('goalTrackerView').style.display = 'block';
    renderGoalTrackerView();
  }
}

// Toggle Goal Matching Strategy Mode
function toggleGoalMatchingMode(isChecked) {
  includeCategoryMatching = isChecked;

  const labelExact = document.getElementById('labelExactMode');
  const labelCat = document.getElementById('labelCategoryMode');

  if (isChecked) {
    labelExact.style.color = 'var(--text-muted)';
    labelExact.style.fontWeight = '400';
    labelCat.style.color = '#818cf8';
    labelCat.style.fontWeight = '600';
  } else {
    labelExact.style.color = 'var(--primary)';
    labelExact.style.fontWeight = '600';
    labelCat.style.color = 'var(--text-muted)';
    labelCat.style.fontWeight = '400';
  }

  renderGoalTrackerView();
}

// Exclude a holding from UI goal analysis
function excludeHoldingFromGoal(holdingId) {
  excludedGoalHoldingKeys.add(holdingId);
  renderGoalTrackerView();
}

// Reset all user exclusions
function resetGoalExclusions() {
  excludedGoalHoldingKeys.clear();
  renderGoalTrackerView();
}

// Toggle Dropdown for Matched Funds Accordion
function toggleFundDropdown(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const isHidden = row.style.display === 'none';
  row.style.display = isHidden ? 'table-row' : 'none';
}

// ==================== EDIT TARGET GOALS MODAL ====================
let tempEditingGoals = [];

function openGoalsModal() {
  tempEditingGoals = JSON.parse(JSON.stringify(TARGET_GOALS));
  renderModalGoalsList();
  document.getElementById('goalsModal').style.display = 'flex';
}

function closeGoalsModal() {
  document.getElementById('goalsModal').style.display = 'none';
}

function renderModalGoalsList() {
  const container = document.getElementById('modalGoalsList');
  if (tempEditingGoals.length === 0) {
    container.innerHTML = '<p class="empty-state">No target goals defined. Click "Add New Goal Fund" below.</p>';
    return;
  }

  container.innerHTML = tempEditingGoals.map((g, idx) => `
    <div class="goal-edit-card">
      <input type="text" class="goal-edit-input" placeholder="Goal Fund Name" value="${escapeHtml(g.name)}" onchange="updateTempGoal(${idx}, 'name', this.value)">
      <input type="text" class="goal-edit-input" placeholder="Category" value="${escapeHtml(g.category)}" onchange="updateTempGoal(${idx}, 'category', this.value)">
      <input type="number" step="0.5" class="goal-edit-input" placeholder="Target %" value="${g.targetPct}" onchange="updateTempGoal(${idx}, 'targetPct', parseFloat(this.value))">
      <input type="text" class="goal-edit-input" placeholder="Keywords (comma separated)" value="${escapeHtml((g.keywords || []).join(', '))}" onchange="updateTempGoal(${idx}, 'keywords', this.value.split(',').map(s => s.trim()))">
      <button class="modal-close" onclick="removeGoalItem(${idx})" title="Delete Goal">✕</button>
    </div>
  `).join('');
}

function updateTempGoal(idx, field, val) {
  if (tempEditingGoals[idx]) {
    tempEditingGoals[idx][field] = val;
  }
}

function addGoalItem() {
  tempEditingGoals.push({
    key: `goal_${Date.now()}`,
    name: 'New Fund Target',
    category: 'Equity: Flexi Cap',
    targetPct: 10.0,
    keywords: ['new fund']
  });
  renderModalGoalsList();
}

function removeGoalItem(idx) {
  tempEditingGoals.splice(idx, 1);
  renderModalGoalsList();
}

async function saveGoalsFromModal() {
  try {
    const res = await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals: tempEditingGoals })
    });

    const result = await res.json();
    if (result.success) {
      TARGET_GOALS = result.goals;
      closeGoalsModal();
      renderGoalTrackerView();
      alert('Target goals saved successfully to target_goals.json!');
    } else {
      alert('Failed to save target goals: ' + (result.error || 'Server error'));
    }
  } catch (e) {
    console.error(e);
    alert('Error saving target goals to server.');
  }
}

// Handle File Selection
function handleFiles(files) {
  const validFiles = Array.from(files).filter(f => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf');
  if (validFiles.length === 0) {
    alert('Please upload valid image files (PNG, JPG, WEBP) or PDF statements.');
    return;
  }

  uploadedFiles = validFiles;
  renderFilePreviews();
  uploadAndProcess();
}

function renderFilePreviews() {
  const container = document.getElementById('filePreviews');
  container.innerHTML = '';
  uploadedFiles.forEach((file, index) => {
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const badge = document.createElement('div');
    badge.className = 'preview-badge';
    badge.innerHTML = `
      <span>${isPdf ? '📑' : '📄'} ${file.name} (${(file.size / 1024).toFixed(1)} KB)</span>
      <span class="remove-file" onclick="removeFile(${index})">✕</span>
    `;
    container.appendChild(badge);
  });
}

function removeFile(index) {
  uploadedFiles.splice(index, 1);
  renderFilePreviews();
}

let currentPdfPassword = '';

// Send Files to API Endpoint /api/extract
async function uploadAndProcess() {
  if (uploadedFiles.length === 0) return;

  const spinner = document.getElementById('loadingSpinner');
  spinner.style.display = 'flex';

  const formData = new FormData();
  uploadedFiles.forEach(file => {
    formData.append('images', file);
  });

  if (currentPdfPassword) {
    formData.append('password', currentPdfPassword);
  }

  try {
    const response = await fetch('/api/extract', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    spinner.style.display = 'none';

    if (result.success) {
      currentPdfPassword = ''; // Reset password after successful extraction
      if (result.goals && result.goals.length > 0) TARGET_GOALS = result.goals;
      currentHoldings = prepareHoldings(result.holdings);
      updateDashboard(result.summary, currentHoldings);
    } else if (result.password_required) {
      openPdfPasswordModal(Boolean(currentPdfPassword));
    } else {
      currentPdfPassword = '';
      alert('Extraction Error: ' + (result.error || 'Failed to process files.'));
    }
  } catch (err) {
    currentPdfPassword = '';
    spinner.style.display = 'none';
    console.error(err);
    alert('Server error processing uploaded files.');
  }
}

// PDF Password Modal Helpers
function openPdfPasswordModal(isError = false) {
  const modal = document.getElementById('pdfPasswordModal');
  const input = document.getElementById('modalPdfPassword');
  const errSpan = document.getElementById('modalPdfPasswordError');

  if (errSpan) errSpan.style.display = isError ? 'block' : 'none';
  if (modal) modal.style.display = 'flex';
  
  if (input) {
    input.value = '';
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }
}

function closePdfPasswordModal(resetPassword = true) {
  const modal = document.getElementById('pdfPasswordModal');
  if (modal) modal.style.display = 'none';
  if (resetPassword) {
    currentPdfPassword = '';
  }
}

function submitPdfPasswordFromModal() {
  const input = document.getElementById('modalPdfPassword');
  const val = input ? input.value.trim() : '';

  if (!val) {
    alert('Please enter your PDF password.');
    return;
  }

  currentPdfPassword = val;
  closePdfPasswordModal(false);
  uploadAndProcess();
}

// Fetch Sample Data on First Load
async function fetchSampleData() {
  try {
    const res = await fetch('/api/sample');
    const result = await res.json();
    if (result.success && result.holdings && result.holdings.length > 0) {
      if (result.goals && result.goals.length > 0) TARGET_GOALS = result.goals;
      currentHoldings = prepareHoldings(result.holdings);
      updateDashboard(result.summary, currentHoldings);
    }
  } catch (e) {
    console.log('No sample data loaded on startup.');
  }
}

// Assign unique immutable IDs to each holding
function prepareHoldings(rawHoldings) {
  return rawHoldings.map((h, idx) => ({
    ...h,
    _id: `h_${idx}_${(h['Folio No.'] || 'no').toString().replace(/[^a-zA-Z0-9]/g, '')}_${(h['ISIN'] || 'no').toString()}`
  }));
}

// Update Dashboard View
function updateDashboard(summary, holdings) {
  // Update Overall Metrics
  document.getElementById('valMarket').textContent = '₹' + formatCurrency(summary.total_market_value);
  document.getElementById('valCost').textContent = '₹' + formatCurrency(summary.total_cost);

  const gainElem = document.getElementById('valGain');
  const gainPctElem = document.getElementById('valGainPct');
  const isGain = summary.total_gain_loss >= 0;

  gainElem.textContent = (isGain ? '+₹' : '-₹') + formatCurrency(Math.abs(summary.total_gain_loss));
  gainElem.className = 'metric-value ' + (isGain ? 'text-success' : 'text-danger');

  gainPctElem.textContent = (isGain ? '+' : '') + summary.total_gain_loss_pct + '%';
  gainPctElem.className = 'metric-sub ' + (isGain ? 'text-success' : 'text-danger');

  document.getElementById('valCount').textContent = summary.total_holdings;

  // Render Filter Pills based on current Filter Mode
  renderFilterPills();

  // Render Charts
  renderCategoryChart(summary.categories);
  renderRegistrarChart(summary.registrars);

  // Apply filters & update table + selection breakdown bar
  applyFilters();

  // Also update Goal Tracker view data
  renderGoalTrackerView();
}

// Render Goal Tracker View Analytics
function renderGoalTrackerView() {
  if (!currentHoldings || currentHoldings.length === 0 || !TARGET_GOALS || TARGET_GOALS.length === 0) return;

  const totalPortfolioMarketVal = currentHoldings.reduce((sum, h) => sum + (parseFloat(h['Market Value (INR)']) || 0), 0);

  // Update Exclusions Reset Container
  const resetContainer = document.getElementById('resetExclusionsContainer');
  const excludedBadge = document.getElementById('excludedCountBadge');
  if (excludedGoalHoldingKeys.size > 0) {
    if (resetContainer) resetContainer.style.display = 'block';
    if (excludedBadge) excludedBadge.textContent = excludedGoalHoldingKeys.size;
  } else {
    if (resetContainer) resetContainer.style.display = 'none';
  }

  // Subtitle & Table Titles
  const chartSub = document.getElementById('chartSubtitle');
  const holdingsTitle = document.getElementById('goalHoldingsTableTitle');

  if (includeCategoryMatching) {
    if (chartSub) chartSub.textContent = 'Side-by-side comparison including all category-equivalent funds in your portfolio.';
    if (holdingsTitle) holdingsTitle.textContent = '📋 Included Goal & Category-Equivalent Holdings';
  } else {
    if (chartSub) chartSub.textContent = 'Side-by-side comparison of your exact target model funds vs actual current holdings.';
    if (holdingsTitle) holdingsTitle.textContent = '📋 Included Target Fund Holdings';
  }

  // Match holdings to target goal items based on selected mode & excluded keys
  const goalResults = TARGET_GOALS.map(goal => {
    const matchedHoldings = currentHoldings.filter(h => {
      if (excludedGoalHoldingKeys.has(h._id)) {
        return false; // User excluded this holding in UI
      }

      if (includeCategoryMatching) {
        return (h.Category || '').toLowerCase() === (goal.category || '').toLowerCase();
      } else {
        const schemeName = (h['Scheme Name'] || '').toLowerCase();
        const goalName = (goal.name || '').toLowerCase();
        const keywords = (goal.keywords || []).map(k => k.toLowerCase());
        
        return keywords.some(kw => schemeName.includes(kw)) || schemeName.includes(goalName) || goalName.includes(schemeName);
      }
    });

    const marketVal = matchedHoldings.reduce((sum, h) => sum + (parseFloat(h['Market Value (INR)']) || 0), 0);
    const costVal = matchedHoldings.reduce((sum, h) => sum + (parseFloat(h['Cost Value (INR)']) || 0), 0);

    const displayName = includeCategoryMatching ? `${goal.name} (${goal.category})` : goal.name;

    return {
      ...goal,
      displayName,
      matchedHoldings,
      marketVal,
      costVal,
      gainVal: marketVal - costVal,
      gainPct: costVal > 0 ? ((marketVal - costVal) / costVal * 100) : 0
    };
  });

  const totalGoalMarketVal = goalResults.reduce((sum, g) => sum + g.marketVal, 0);
  const totalGoalCostVal = goalResults.reduce((sum, g) => sum + g.costVal, 0);
  const totalGoalGainVal = totalGoalMarketVal - totalGoalCostVal;
  const totalGoalGainPct = totalGoalCostVal > 0 ? (totalGoalGainVal / totalGoalCostVal * 100) : 0;
  const goalSharePct = totalPortfolioMarketVal > 0 ? (totalGoalMarketVal / totalPortfolioMarketVal * 100) : 0;

  // Update Goal Metrics Cards
  document.getElementById('goalValMarket').textContent = '₹' + formatCurrency(totalGoalMarketVal);
  document.getElementById('goalValShare').textContent = goalSharePct.toFixed(1) + '% of Total Portfolio';
  document.getElementById('goalValCost').textContent = '₹' + formatCurrency(totalGoalCostVal);

  const goalGainElem = document.getElementById('goalValGain');
  const goalGainPctElem = document.getElementById('goalValGainPct');
  const isGoalGain = totalGoalGainVal >= 0;

  goalGainElem.textContent = (isGoalGain ? '+₹' : '-₹') + formatCurrency(Math.abs(totalGoalGainVal));
  goalGainElem.className = 'metric-value ' + (isGoalGain ? 'text-success' : 'text-danger');
  goalGainPctElem.textContent = (isGoalGain ? '+' : '') + totalGoalGainPct.toFixed(2) + '%';
  goalGainPctElem.className = 'metric-sub ' + (isGoalGain ? 'text-success' : 'text-danger');

  // Calculate Drift & Action for each goal fund
  let maxDrift = 0;
  const rebalanceData = goalResults.map(g => {
    const actualPct = totalGoalMarketVal > 0 ? (g.marketVal / totalGoalMarketVal * 100) : 0;
    const targetVal = (g.targetPct / 100) * totalGoalMarketVal;
    const driftPct = actualPct - g.targetPct;
    const driftAmt = g.marketVal - targetVal;

    if (Math.abs(driftPct) > maxDrift) maxDrift = Math.abs(driftPct);

    let actionBadge = '';
    if (Math.abs(driftPct) <= 1.5) {
      actionBadge = `<span class="badge-action-target">On Target ✅</span>`;
    } else if (driftPct < 0) {
      actionBadge = `<span class="badge-action-buy">Buy +₹${formatCurrency(Math.abs(driftAmt))}</span>`;
    } else {
      actionBadge = `<span class="badge-action-sell">Hold / Rebalance -₹${formatCurrency(driftAmt)}</span>`;
    }

    return {
      ...g,
      actualPct,
      targetVal,
      driftPct,
      driftAmt,
      actionBadge
    };
  });

  const alignmentScore = Math.max(0, Math.round(100 - (maxDrift * 2.5)));
  document.getElementById('goalAlignmentScore').textContent = alignmentScore + '%';
  const statusElem = document.getElementById('goalDriftStatus');
  if (alignmentScore >= 85) {
    statusElem.textContent = 'Well Balanced';
    statusElem.className = 'metric-sub text-success';
  } else if (alignmentScore >= 70) {
    statusElem.textContent = 'Minor Drift Detected';
    statusElem.className = 'metric-sub text-primary';
  } else {
    statusElem.textContent = 'Rebalance Suggested';
    statusElem.className = 'metric-sub text-danger';
  }

  // Render Target vs Actual Bar Chart
  renderGoalComparisonChart(rebalanceData);

  // Render Rebalance Analysis Table
  renderGoalRebalanceTable(rebalanceData);

  // Render Goal Holdings List Table
  const allGoalHoldings = rebalanceData.flatMap(g => g.matchedHoldings);
  renderGoalHoldingsTable(allGoalHoldings);
}

// Render Target vs Actual Comparison Bar Chart
function renderGoalComparisonChart(rebalanceData) {
  const ctx = document.getElementById('goalComparisonChart').getContext('2d');
  if (goalComparisonChart) goalComparisonChart.destroy();

  const labels = rebalanceData.map(g => g.name);
  const targetData = rebalanceData.map(g => g.targetPct);
  const actualData = rebalanceData.map(g => parseFloat(g.actualPct.toFixed(2)));

  goalComparisonChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Target Weight (%)',
          data: targetData,
          backgroundColor: '#38bdf8',
          borderRadius: 6
        },
        {
          label: includeCategoryMatching ? 'Actual Weight (Incl. Category Funds %)' : 'Actual Weight (Exact Fund %)',
          data: actualData,
          backgroundColor: includeCategoryMatching ? '#818cf8' : '#10b981',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } }
        }
      },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
        y: { 
          ticks: { color: '#94a3b8', callback: v => v + '%' }, 
          grid: { color: 'rgba(255, 255, 255, 0.05)' } 
        }
      }
    }
  });
}

// Render Rebalance Analysis Table with Expandable Matched Funds Accordion & Exclude Action
function renderGoalRebalanceTable(rebalanceData) {
  const tbody = document.getElementById('goalRebalanceTableBody');
  tbody.innerHTML = rebalanceData.map(row => {
    const driftSign = row.driftPct >= 0 ? '+' : '';
    const driftClass = Math.abs(row.driftPct) <= 1.5 ? 'text-primary' : (row.driftPct > 0 ? 'text-warning' : 'text-danger');
    const dropdownRowId = `matched_drop_${row.key}`;

    return `
      <tr>
        <td>
          <strong>${escapeHtml(row.name)}</strong>
          ${includeCategoryMatching ? `<br><span style="color: var(--text-dim); font-size: 0.775rem;">Category: ${escapeHtml(row.category)}</span>` : ''}
          ${row.matchedHoldings.length > 0 ? `
            <br>
            <button class="btn-expand-funds" onclick="toggleFundDropdown('${dropdownRowId}')">
              <span>🔍 View Matched Funds (${row.matchedHoldings.length}) ▼</span>
            </button>
          ` : '<br><span style="color: var(--text-dim); font-size: 0.775rem;">No holdings matched</span>'}
        </td>
        <td><span class="badge-category">${row.targetPct.toFixed(1)}%</span></td>
        <td>₹${formatCurrency(row.targetVal)}</td>
        <td><strong>₹${formatCurrency(row.marketVal)}</strong></td>
        <td><span class="badge-amc">${row.actualPct.toFixed(2)}%</span></td>
        <td><span class="${driftClass}">${driftSign}${row.driftPct.toFixed(2)}%</span></td>
        <td>${row.actionBadge}</td>
      </tr>

      <tr id="${dropdownRowId}" class="fund-dropdown-row" style="display: none;">
        <td colspan="7" style="padding: 0.75rem 1.25rem; background: rgba(15, 23, 42, 0.75);">
          <div class="matched-funds-card">
            <div class="matched-funds-header">
              <strong>📁 Matched Funds Breakdown for ${escapeHtml(row.name)} (${escapeHtml(row.category)}):</strong>
            </div>
            <div class="matched-funds-list">
              ${row.matchedHoldings.map(h => `
                <div class="matched-fund-item">
                  <div class="matched-fund-name">
                    <strong>${escapeHtml(h['Scheme Name'])}</strong>
                    <span class="text-dim" style="font-size: 0.775rem;">Folio: ${escapeHtml(h['Folio No.'] || '-')} | ISIN: ${escapeHtml(h['ISIN'] || '-')} | RTA: ${escapeHtml(h['Registrar'] || '-')}</span>
                  </div>
                  <div class="matched-fund-values">
                    <span class="text-muted">Cost: ₹${formatCurrency(h['Cost Value (INR)'])}</span>
                    <strong class="text-primary" style="margin-left: 12px; font-size: 0.925rem;">Market Value: ₹${formatCurrency(h['Market Value (INR)'])}</strong>
                    <button class="btn-exclude-fund" onclick="excludeHoldingFromGoal('${h._id}')" title="Exclude from UI Goal calculation">
                      ✕ Exclude
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Render Goal Holdings List Table
function renderGoalHoldingsTable(holdings) {
  const tbody = document.getElementById('goalHoldingsTableBody');
  if (!holdings || holdings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No goal portfolio holdings detected.</td></tr>';
    return;
  }

  tbody.innerHTML = holdings.map(row => `
    <tr>
      <td><code>${escapeHtml(row['Folio No.'] || '-')}</code></td>
      <td><code>${escapeHtml(row['ISIN'] || '-')}</code></td>
      <td><strong>${escapeHtml(row['Scheme Name'] || '-')}</strong></td>
      <td><span class="badge-amc">${escapeHtml(row['Fund House'] || '-')}</span></td>
      <td><span class="badge-category">${escapeHtml(row['Category'] || '-')}</span></td>
      <td>₹${formatCurrency(row['Cost Value (INR)'])}</td>
      <td>${formatNumber(row['Unit Balance'])}</td>
      <td>₹${formatNumber(row['NAV (INR)'])}</td>
      <td><strong>₹${formatCurrency(row['Market Value (INR)'])}</strong></td>
      <td><span class="badge-registrar">${escapeHtml(row['Registrar'] || '-')}</span></td>
    </tr>
  `).join('');
}

// Set Filter Mode (CATEGORY, FUND_HOUSE, SCHEME)
function setFilterMode(mode) {
  filterMode = mode;
  activeFilterValue = 'ALL';

  document.getElementById('tabCategory').className = 'mode-tab ' + (mode === 'CATEGORY' ? 'active' : '');
  document.getElementById('tabFundHouse').className = 'mode-tab ' + (mode === 'FUND_HOUSE' ? 'active' : '');
  document.getElementById('tabScheme').className = 'mode-tab ' + (mode === 'SCHEME' ? 'active' : '');

  renderFilterPills();
  applyFilters();
}

// Render Filter Pills based on active Filter Mode
function renderFilterPills() {
  const pillsContainer = document.getElementById('filterPills');
  pillsContainer.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'pill ' + (activeFilterValue === 'ALL' ? 'active' : '');
  allBtn.textContent = 'All Items';
  allBtn.onclick = () => setFilterValue('ALL', allBtn);
  pillsContainer.appendChild(allBtn);

  let items = [];
  if (filterMode === 'CATEGORY') {
    items = Array.from(new Set(currentHoldings.map(h => h.Category).filter(Boolean))).sort();
  } else if (filterMode === 'FUND_HOUSE') {
    items = Array.from(new Set(currentHoldings.map(h => h['Fund House']).filter(Boolean))).sort();
  } else if (filterMode === 'SCHEME') {
    items = Array.from(new Set(currentHoldings.map(h => h['Scheme Name']).filter(Boolean))).sort();
  }

  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'pill ' + (activeFilterValue === item ? 'active' : '');
    btn.textContent = item;
    btn.onclick = () => setFilterValue(item, btn);
    pillsContainer.appendChild(btn);
  });
}

function setFilterValue(val, btnElem) {
  activeFilterValue = val;
  document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
  btnElem.classList.add('active');
  applyFilters();
}

// Filter & Sort Table Rows and Update Selection Breakdown Bar
function applyFilters() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();

  filteredHoldings = currentHoldings.filter(h => {
    let matchesMode = true;
    if (activeFilterValue !== 'ALL') {
      if (filterMode === 'CATEGORY') matchesMode = (h.Category === activeFilterValue);
      else if (filterMode === 'FUND_HOUSE') matchesMode = (h['Fund House'] === activeFilterValue);
      else if (filterMode === 'SCHEME') matchesMode = (h['Scheme Name'] === activeFilterValue);
    }

    const matchesSearch = !searchTerm || [
      h['Scheme Name'], h['Fund House'], h['Folio No.'], h['ISIN'], h['Registrar'], h['Category']
    ].some(val => val && val.toString().toLowerCase().includes(searchTerm));

    return matchesMode && matchesSearch;
  });

  // Calculate selection statistics
  let filteredCost = 0;
  let filteredMarket = 0;

  filteredHoldings.forEach(h => {
    filteredCost += parseFloat(h['Cost Value (INR)']) || 0;
    filteredMarket += parseFloat(h['Market Value (INR)']) || 0;
  });

  const filteredGain = filteredMarket - filteredCost;
  const filteredGainPct = filteredCost > 0 ? ((filteredGain / filteredCost) * 100).toFixed(2) : '0.00';
  const totalMarket = currentHoldings.reduce((sum, h) => sum + (parseFloat(h['Market Value (INR)']) || 0), 0);
  const sharePct = totalMarket > 0 ? ((filteredMarket / totalMarket) * 100).toFixed(1) : '100.0';

  let titlePrefix = 'All Portfolio Items';
  if (activeFilterValue !== 'ALL') {
    if (filterMode === 'CATEGORY') titlePrefix = 'Category: ' + activeFilterValue;
    else if (filterMode === 'FUND_HOUSE') titlePrefix = 'AMC: ' + activeFilterValue;
    else if (filterMode === 'SCHEME') titlePrefix = 'Fund: ' + activeFilterValue;
  }

  document.getElementById('catSummaryName').textContent = titlePrefix;
  document.getElementById('catSummaryMarket').textContent = '₹' + formatCurrency(filteredMarket);
  document.getElementById('catSummaryCost').textContent = '₹' + formatCurrency(filteredCost);

  const isGain = filteredGain >= 0;
  const catGainElem = document.getElementById('catSummaryGain');
  catGainElem.textContent = (isGain ? '+₹' : '-₹') + formatCurrency(Math.abs(filteredGain)) + ` (${isGain ? '+' : ''}${filteredGainPct}%)`;
  catGainElem.className = isGain ? 'text-success font-weight-bold' : 'text-danger font-weight-bold';

  document.getElementById('catSummaryShare').textContent = sharePct + '% Portfolio Share';
  document.getElementById('catSummaryCount').textContent = filteredHoldings.length + ' Schemes';

  sortHoldings();
  renderTable();
}

function sortTable(column) {
  if (currentSortColumn === column) {
    sortAscending = !sortAscending;
  } else {
    currentSortColumn = column;
    sortAscending = true;
  }
  sortHoldings();
  renderTable();
}

function sortHoldings() {
  filteredHoldings.sort((a, b) => {
    let valA = a[currentSortColumn];
    let valB = b[currentSortColumn];

    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';

    const numA = parseFloat(valA);
    const numB = parseFloat(valB);

    if (!isNaN(numA) && !isNaN(numB)) {
      return sortAscending ? numA - numB : numB - numA;
    }

    return sortAscending ? valA.toString().localeCompare(valB.toString()) : valB.toString().localeCompare(valA.toString());
  });
}

// Render Table Rows
function renderTable() {
  const tbody = document.getElementById('tableBody');
  if (filteredHoldings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No matching holdings found.</td></tr>';
    return;
  }

  tbody.innerHTML = filteredHoldings.map(row => `
    <tr>
      <td><code>${escapeHtml(row['Folio No.'] || '-')}</code></td>
      <td><code>${escapeHtml(row['ISIN'] || '-')}</code></td>
      <td>
        <strong>${escapeHtml(row['Scheme Name'] || '-')}</strong>
        ${row['Scheme Code'] ? `<span style="color: var(--text-dim); font-size: 0.75rem; margin-left: 6px;">[${escapeHtml(row['Scheme Code'])}]</span>` : ''}
      </td>
      <td><span class="badge-amc">${escapeHtml(row['Fund House'] || 'Other')}</span></td>
      <td><span class="badge-category">${escapeHtml(row['Category'] || 'Other')}</span></td>
      <td>₹${formatCurrency(row['Cost Value (INR)'])}</td>
      <td>${formatNumber(row['Unit Balance'])}</td>
      <td>₹${formatNumber(row['NAV (INR)'])}</td>
      <td><strong>₹${formatCurrency(row['Market Value (INR)'])}</strong></td>
      <td><span class="badge-registrar">${escapeHtml(row['Registrar'] || '-')}</span></td>
    </tr>
  `).join('');
}

// Render Chart.js Category Donut Chart
function renderCategoryChart(categories) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  if (categoryChart) categoryChart.destroy();

  const labels = Object.keys(categories);
  const data = Object.values(categories);

  const colors = [
    '#38bdf8', '#818cf8', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'
  ];

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: '#0a0f1d',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } }
        }
      }
    }
  });
}

// Render Chart.js Registrar Bar Chart
function renderRegistrarChart(registrars) {
  const ctx = document.getElementById('registrarChart').getContext('2d');
  if (registrarChart) registrarChart.destroy();

  const labels = Object.keys(registrars);
  const data = Object.values(registrars);

  registrarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Market Value (INR)',
        data: data,
        backgroundColor: ['#38bdf8', '#818cf8', '#10b981'],
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
        y: { ticks: { color: '#94a3b8', callback: v => v + '%' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
      }
    }
  });
}

// Utility Helpers
function formatCurrency(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return '₹0.00';
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return '-';
  return num.toLocaleString('en-IN', { maximumFractionDigits: 4 });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Clear all data (CSV report and in-memory portfolio state)
async function clearAllData() {
  if (!confirm('Are you sure you want to delete the extracted CSV report and clear all portfolio data?')) {
    return;
  }

  try {
    const res = await fetch('/api/clear', { method: 'POST' });
    let result = {};
    try {
      result = await res.json();
    } catch (parseErr) {
      alert('The server has not loaded the new /api/clear feature yet.\n\nPlease stop (Ctrl+C) and restart python server.py in your terminal!');
      return;
    }
    
    if (res.ok && result.success) {
      uploadedFiles = [];
      currentHoldings = [];
      filteredHoldings = [];
      excludedGoalHoldingKeys.clear();
      currentPdfPassword = '';
      sessionStorage.removeItem('cam_pdf_password');
      
      renderFilePreviews();
      updateDashboard({
        total_holdings: 0,
        total_cost: 0,
        total_market_value: 0,
        total_gain_loss: 0,
        total_gain_loss_pct: 0,
        categories: {},
        fund_houses: {},
        registrars: {}
      }, []);

      alert('All extracted portfolio data and CSV files have been cleared.');
    } else {
      alert('Error clearing data: ' + (result.error || 'Failed to clear server data.'));
    }
  } catch (e) {
    console.error(e);
    alert('Network error connecting to server.');
  }
}
