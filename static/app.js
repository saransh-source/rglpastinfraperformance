// RGL Infra Performance Dashboard - JavaScript
// Version: 2026-02-19-v11 (Enhanced Bounces Tab - MX/Infra pre-populated in Supabase)

console.log('[APP VERSION] 2026-02-19-v11 - Enhanced Bounces Tab - MX/Infra pre-populated in Supabase');

// Bounce type explanations with severity and actions
const BOUNCE_TYPE_EXPLANATIONS = {
    'hard_bounce': {
        short: 'Permanent failure',
        detail: 'Invalid recipient address. Email will never be delivered.',
        severity: 'critical',
        action: 'Remove'
    },
    'soft_bounce': {
        short: 'Temporary issue',
        detail: 'Mailbox full, server down, or rate limited.',
        severity: 'warning',
        action: 'Retry'
    },
    'block': {
        short: 'Server blocked',
        detail: 'Blocked by recipient server. Possible reputation issue.',
        severity: 'warning',
        action: 'Investigate'
    },
    'complaint': {
        short: 'Spam report',
        detail: 'Recipient marked email as spam.',
        severity: 'critical',
        action: 'Remove'
    },
    'unknown': {
        short: 'Unclassified',
        detail: 'Could not determine bounce type from message.',
        severity: 'info',
        action: 'Review'
    }
};

let currentPeriod = '14d';
let currentData = null;
let currentBounceData = null;
let workspaceMap = {};

// Chart instances (for cleanup/update)
let infraSendsChart = null;
let infraPositiveRateChart = null;
let dailyReplyRateChart = null;
let dailyPositiveRateChart = null;
let infraComparisonTrendChart = null;
let clientInfraSendsChart = null;
let clientInfraPositiveRateChart = null;
let clientDailyReplyRateChart = null;
let clientDailyPositiveRateChart = null;

// Main tab and subtab state
let currentMainTab = 'infra';
let currentSubtabs = {
    infra: 'infra-overview',
    clients: 'clients-overview'
};

// Client tab period
let clientPeriod = '14d';

// Cached latest snapshot for time-independent tabs
let latestInfraSnapshot = null;

// Date range state (main dashboard - for Infra and Clients)
let startDate = null;
let endDate = null;

// Bounce-specific date state (independent from main dashboard)
let bounceStartDate = null;
let bounceEndDate = null;
const BOUNCE_DATA_START = '2026-02-17'; // First date with webhook bounce data (corrected)

// Client-specific date state (independent from Infra tab)
let clientStartDate = null;
let clientEndDate = null;

// Loading timeout and retry configuration
const LOADING_TIMEOUT_MS = 12000;
const MAX_RETRIES = 3;
let loadingTimeoutId = null;
let currentRetryCount = 0;

// Period to days mapping
const PERIOD_DAYS = {
    '1d': 1,
    '3d': 3,
    '7d': 7,
    '14d': 14,
    '30d': 30
};

// Data collection start date
const DATA_START_DATE = '2026-02-02';

function is30dAvailable() {
    const start = new Date(DATA_START_DATE);
    const thirtyDaysLater = new Date(start);
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    return new Date() >= thirtyDaysLater;
}

function getComingSoonPeriods() {
    return is30dAvailable() ? [] : ['30d'];
}

// Chart.js global config
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#2d3748';
Chart.defaults.font.family = "'Inter', sans-serif";

// Color palette for infra types
const infraColors = {
    'GR': '#3b82f6',
    'GR - N': '#1d4ed8',
    'G-Vis': '#60a5fa',
    'Google': '#2563eb',
    'AO': '#8b5cf6',
    'OD': '#a855f7',
    'L': '#f59e0b',
    'MD SMTP': '#10b981',
    'Outlook': '#ef4444',
    'New Outlook': '#f87171',
    'WR SMTP': '#ec4899',
    'Gpan': '#06b6d4',
    'Everwarm': '#84cc16',
    'Unknown': '#6b7280',
};

function getInfraClass(infraType) {
    return 'infra-' + infraType.toLowerCase().replace(/\s+/g, '-');
}

function formatNumber(num) {
    if (num == null) return '-';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}

function formatCurrency(num) {
    if (num == null || num === 0) return '-';
    return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Aggregate daily data into N-day buckets (e.g., 3-day or 7-day)
function aggregateByPeriod(dailyData, bucketDays = 3) {
    if (!dailyData || dailyData.length === 0) return [];

    const buckets = [];
    for (let i = 0; i < dailyData.length; i += bucketDays) {
        const chunk = dailyData.slice(i, i + bucketDays);
        const totalSent = chunk.reduce((sum, d) => sum + (d.sent || 0), 0);
        const totalReplied = chunk.reduce((sum, d) => sum + (d.replied || 0), 0);
        const totalInterested = chunk.reduce((sum, d) => sum + (d.interested || 0), 0);

        const replyRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;
        const positiveRate = totalSent > 0 ? (totalInterested / totalSent) * 100 : 0;

        // Label: first date - last date in bucket
        const startDate = chunk[0].date;
        const endDate = chunk[chunk.length - 1].date;
        const label = chunk.length > 1
            ? `${startDate.slice(5)} - ${endDate.slice(5)}`
            : startDate.slice(5);

        buckets.push({
            label,
            reply_rate: replyRate,
            positive_rate: positiveRate,
            sent: totalSent,
            replied: totalReplied,
            interested: totalInterested
        });
    }
    return buckets;
}

// Fetch data from Supabase
async function fetchData(period, refresh = false) {
    if (window.SupabaseClient) {
        const days = PERIOD_DAYS[period] || 14;
        const end = endDate || window.SupabaseClient.getLatestDataDate();
        const start = startDate || window.SupabaseClient.getDateNDaysAgo(days);

        try {
            return await window.SupabaseClient.fetchInfraPerformance(start, end);
        } catch (error) {
            console.warn('Supabase fetch failed:', error);
        }
    }

    // Fallback to static JSON
    const response = await fetch('/static/data.json');
    if (!response.ok) throw new Error('Failed to load data');
    const allData = await response.json();
    return allData[period] || allData['14d'] || {};
}

// Fetch bounce data from Supabase
async function fetchBounceData() {
    if (!window.SupabaseClient) return null;

    // Use today's date for bounce end (webhook data is real-time)
    const end = bounceEndDate || window.SupabaseClient.getTodayDate();
    const start = bounceStartDate || BOUNCE_DATA_START;

    console.log(`Fetching bounces from ${start} to ${end}`);

    try {
        return await window.SupabaseClient.fetchBounces(start, end);
    } catch (error) {
        console.error('Error fetching bounces:', error);
        return null;
    }
}

// Tab switching - show/hide date picker based on tab
function switchMainTab(mainTabId) {
    console.log('switchMainTab:', mainTabId);
    currentMainTab = mainTabId;

    // Update main tab buttons
    document.querySelectorAll('.main-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mainTab === mainTabId);
    });

    // Show/hide main tab content
    document.querySelectorAll('.main-tab-content').forEach(content => {
        content.style.display = content.id === `main-tab-${mainTabId}` ? 'block' : 'none';
    });

    // Show/hide date picker (only for Infra - Clients has its own)
    const datePicker = document.getElementById('datePicker');
    if (datePicker) {
        datePicker.style.display = mainTabId === 'infra' ? 'flex' : 'none';
    }

    // If bounces tab, load bounce data
    if (mainTabId === 'bounces') {
        updateBouncesTab();
    }

    // If clients tab, load client data with current client date range
    if (mainTabId === 'clients') {
        loadClientsData();
    }
}

function switchSubtab(subtabId) {
    const mainTab = subtabId.split('-')[0];
    currentSubtabs[mainTab] = subtabId;

    const mainTabEl = document.getElementById(`main-tab-${mainTab}`);
    if (!mainTabEl) return;

    mainTabEl.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subtab === subtabId);
    });

    mainTabEl.querySelectorAll('.subtab-content').forEach(content => {
        content.style.display = content.id === `subtab-${subtabId}` ? 'block' : 'none';
    });
}

function showDefaultTabs() {
    const mainTabNav = document.getElementById('mainTabNav');
    const datePicker = document.getElementById('datePicker');

    if (mainTabNav) mainTabNav.style.display = 'flex';
    if (datePicker) datePicker.style.display = 'flex';

    switchMainTab('infra');
    switchSubtab('infra-overview');
}

// Update overview cards
function updateOverview(totals, meta) {
    const el = (id) => document.getElementById(id);
    if (el('totalSends')) el('totalSends').textContent = formatNumber(totals.sent);
    if (el('totalReplies')) el('totalReplies').textContent = formatNumber(totals.replied);
    if (el('totalPositive')) el('totalPositive').textContent = totals.interested || 0;
    if (el('replyRate')) el('replyRate').textContent = (totals.reply_rate || 0).toFixed(2) + '%';
    if (el('positiveRate')) el('positiveRate').textContent = (totals.positive_rate || 0).toFixed(3) + '%';
    if (el('positiveReplyRate')) el('positiveReplyRate').textContent = (totals.positive_reply_rate || 0).toFixed(2) + '%';
    if (el('mailboxCount')) el('mailboxCount').textContent = formatNumber(totals.mailbox_count);
    if (el('currentCapacity')) el('currentCapacity').textContent = formatNumber(totals.current_capacity);
    if (el('theoreticalMax')) el('theoreticalMax').textContent = formatNumber(totals.theoretical_max);
    if (el('positivesPerDay')) el('positivesPerDay').textContent = (totals.positives_per_day || 0).toFixed(1);
}

// Update infra comparison table
function updateInfraTable(byInfra) {
    const tbody = document.getElementById('infraTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const sorted = Object.entries(byInfra).sort((a, b) => b[1].sent - a[1].sent);

    for (const [infraType, m] of sorted) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="${getInfraClass(infraType)}">${infraType}</td>
            <td>${m.mailbox_count || 0}</td>
            <td>${m.domain_count || 0}</td>
            <td>${formatNumber(m.current_capacity || 0)}</td>
            <td>${formatNumber(m.theoretical_max || 0)}</td>
            <td>${formatNumber(m.sent)}</td>
            <td>${formatNumber(m.replied)}</td>
            <td class="highlight-col">${m.interested || 0}</td>
            <td>${(m.reply_rate || 0).toFixed(2)}%</td>
            <td class="highlight-col">${(m.positive_rate || 0).toFixed(3)}%</td>
            <td>${(m.positive_reply_rate || 0).toFixed(2)}%</td>
            <td>${(m.bounce_rate || 0).toFixed(2)}%</td>
            <td>${(m.avg_sends_per_mailbox_per_day || 0).toFixed(1)}</td>
            <td class="highlight-col">${(m.positives_per_day || 0).toFixed(1)}</td>
        `;
        tbody.appendChild(row);
    }
}

// Update client/infra breakdown table (in Infra tab)
function updateClientInfraBreakdownTable(byClient, filter = 'all') {
    const tbody = document.getElementById('clientInfraBreakdownTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Populate filter dropdown
    const clientFilter = document.getElementById('clientFilter');
    if (clientFilter && clientFilter.options.length <= 1) {
        Object.keys(byClient || {}).sort().forEach(client => {
            clientFilter.innerHTML += `<option value="${client}">${client}</option>`;
        });
    }

    // Flatten and filter
    const rows = [];
    for (const [clientName, infraData] of Object.entries(byClient || {})) {
        if (filter !== 'all' && clientName !== filter) continue;
        for (const [infraType, m] of Object.entries(infraData)) {
            rows.push({ clientName, infraType, ...m });
        }
    }

    rows.sort((a, b) => {
        if (a.clientName !== b.clientName) return a.clientName.localeCompare(b.clientName);
        return b.sent - a.sent;
    });

    for (const r of rows) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${r.clientName}</td>
            <td class="${getInfraClass(r.infraType)}">${r.infraType}</td>
            <td>${r.mailbox_count || 0}</td>
            <td>${r.domain_count || 0}</td>
            <td>${formatNumber(r.sent)}</td>
            <td>${formatNumber(r.replied)}</td>
            <td class="highlight-col">${r.interested || 0}</td>
            <td>${(r.reply_rate || 0).toFixed(2)}%</td>
            <td class="highlight-col">${(r.positive_rate || 0).toFixed(3)}%</td>
            <td>${(r.positive_reply_rate || 0).toFixed(2)}%</td>
            <td>${(r.bounce_rate || 0).toFixed(2)}%</td>
        `;
        tbody.appendChild(row);
    }
}

// Update client overview table (Clients main tab - aggregated by client)
function updateClientOverviewTable(byClient) {
    const tbody = document.getElementById('clientOverviewTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Aggregate by client (sum all infra types)
    const clientTotals = {};
    for (const [clientName, infraData] of Object.entries(byClient || {})) {
        clientTotals[clientName] = {
            mailbox_count: 0,
            domain_count: 0,
            sent: 0,
            replied: 0,
            interested: 0,
            bounced: 0
        };
        for (const m of Object.values(infraData)) {
            clientTotals[clientName].mailbox_count += m.mailbox_count || 0;
            clientTotals[clientName].domain_count += m.domain_count || 0;
            clientTotals[clientName].sent += m.sent || 0;
            clientTotals[clientName].replied += m.replied || 0;
            clientTotals[clientName].interested += m.interested || 0;
            clientTotals[clientName].bounced += m.bounced || 0;
        }
    }

    // Sort by sends descending
    const sorted = Object.entries(clientTotals).sort((a, b) => b[1].sent - a[1].sent);

    for (const [clientName, t] of sorted) {
        const replyRate = t.sent > 0 ? (t.replied / t.sent) * 100 : 0;
        const positiveRate = t.sent > 0 ? (t.interested / t.sent) * 100 : 0;
        const positiveReplyRate = t.replied > 0 ? (t.interested / t.replied) * 100 : 0;
        const bounceRate = t.sent > 0 ? (t.bounced / t.sent) * 100 : 0;
        // Calculate days from meta if available
        const days = currentData?.meta?.days || 14;
        const positivesPerDay = t.interested / days;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${clientName}</td>
            <td>${t.mailbox_count}</td>
            <td>${t.domain_count}</td>
            <td>${formatNumber(t.sent)}</td>
            <td>${formatNumber(t.replied)}</td>
            <td class="highlight-col">${t.interested}</td>
            <td>${replyRate.toFixed(2)}%</td>
            <td class="highlight-col">${positiveRate.toFixed(3)}%</td>
            <td>${positiveReplyRate.toFixed(2)}%</td>
            <td>${bounceRate.toFixed(2)}%</td>
            <td class="highlight-col">${positivesPerDay.toFixed(1)}</td>
        `;
        tbody.appendChild(row);
    }
}

// Update warmup table (simplified: 3 columns)
function updateWarmupTable(byInfra) {
    const tbody = document.getElementById('warmupTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const sorted = Object.entries(byInfra).sort((a, b) => b[1].mailbox_count - a[1].mailbox_count);

    for (const [infraType, m] of sorted) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="${getInfraClass(infraType)}">${infraType}</td>
            <td>${m.mailbox_count || 0}</td>
            <td>${m.in_warmup || 0}</td>
        `;
        tbody.appendChild(row);
    }
}

// Update projections table
function updateProjectionsTable(projections) {
    const tbody = document.getElementById('projectionsTableBody');
    if (!tbody || !projections) return;
    tbody.innerHTML = '';

    const sorted = Object.entries(projections).sort((a, b) => (a[1].cost_per_positive || 9999) - (b[1].cost_per_positive || 9999));

    for (const [infraType, p] of sorted) {
        const costPerPositive = p.cost_per_positive > 0 ? '$' + p.cost_per_positive.toFixed(2) : 'N/A';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="${getInfraClass(infraType)}">${infraType}</td>
            <td>${p.sends_per_day || 0}</td>
            <td>${formatNumber(p.mailboxes_needed)}</td>
            <td>${formatNumber(p.domains_needed)}</td>
            <td>${formatCurrency(p.monthly_cost)}</td>
            <td>${formatCurrency(p.setup_cost)}</td>
            <td>${(p.positive_rate || 0).toFixed(3)}%</td>
            <td>${formatNumber(Math.round(p.expected_positives_per_month || 0))}</td>
            <td class="highlight-col">${costPerPositive}</td>
        `;
        tbody.appendChild(row);
    }
}

// Calculate cost projections using last 7-day positive rates
function calculateProjections(byInfra, last7DayRates = {}) {
    const TARGET_SENDS = 100000;
    const COSTS = {
        'Maldoso': { monthly_per_mailbox: 1.67, sends_per_day: 15, mailboxes_per_domain: 4, domain_cost: 4.00, setup_per_mailbox: 0 },
        'Google Reseller': { monthly_per_mailbox: 2.00, sends_per_day: 20, mailboxes_per_domain: 3, domain_cost: 4.00, setup_per_mailbox: 0.20 },
        'Aged Outlook': { monthly_per_tenant: 4.22, sends_per_day: 10, mailboxes_per_tenant: 25, domains_per_tenant: 1, tenant_cost: 11.22, aged_domain_cost: 7.00 }
    };

    const projections = {};
    for (const infraType of ['Maldoso', 'Google Reseller', 'Aged Outlook']) {
        const config = COSTS[infraType];
        if (!config) continue;

        const mailboxesNeeded = Math.ceil(TARGET_SENDS / config.sends_per_day);
        let monthlyCost, setupCost, domainsNeeded;

        if (infraType === 'Aged Outlook') {
            const tenantsNeeded = Math.ceil(mailboxesNeeded / config.mailboxes_per_tenant);
            domainsNeeded = tenantsNeeded * config.domains_per_tenant;
            monthlyCost = tenantsNeeded * config.monthly_per_tenant;
            setupCost = tenantsNeeded * (config.tenant_cost + config.aged_domain_cost);
        } else {
            domainsNeeded = Math.ceil(mailboxesNeeded / config.mailboxes_per_domain);
            monthlyCost = mailboxesNeeded * config.monthly_per_mailbox;
            setupCost = (domainsNeeded * config.domain_cost) + (mailboxesNeeded * (config.setup_per_mailbox || 0));
        }

        // Use last 7-day positive rate (prioritize over snapshot data)
        let positiveRate = last7DayRates[infraType] || 0;

        // Fallback to snapshot data if 7-day rate not available
        if (positiveRate === 0 && byInfra && byInfra[infraType]) {
            positiveRate = byInfra[infraType].positive_rate || 0;
        }

        const expectedPositivesPerMonth = (TARGET_SENDS * (positiveRate / 100)) * 30;
        const costPerPositive = expectedPositivesPerMonth > 0 ? monthlyCost / expectedPositivesPerMonth : 0;

        projections[infraType] = {
            sends_per_day: config.sends_per_day,
            mailboxes_needed: mailboxesNeeded,
            domains_needed: domainsNeeded,
            monthly_cost: Math.round(monthlyCost * 100) / 100,
            setup_cost: Math.round(setupCost * 100) / 100,
            positive_rate: positiveRate,
            expected_positives_per_month: Math.round(expectedPositivesPerMonth),
            cost_per_positive: Math.round(costPerPositive * 100) / 100
        };
    }
    return projections;
}

// ======================
// Chart Functions
// ======================

function destroyChart(chartInstance) {
    if (chartInstance) {
        chartInstance.destroy();
    }
    return null;
}

function createBarChart(ctx, labels, data, label, color) {
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                backgroundColor: color,
                borderColor: color,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function createMultiBarChart(ctx, labels, datasets) {
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function createLineChart(ctx, labels, data, label, color) {
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                borderColor: color,
                backgroundColor: color + '20',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function createMultiLineChart(ctx, labels, datasets) {
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

// Update Infra Overview Charts
function updateInfraCharts(byInfra) {
    if (!byInfra) return;

    // Get sorted infra types by sends
    const sorted = Object.entries(byInfra)
        .filter(([_, m]) => m.sent > 0)
        .sort((a, b) => b[1].sent - a[1].sent);

    const labels = sorted.map(([name]) => name);
    const sends = sorted.map(([_, m]) => m.sent);
    const positiveRates = sorted.map(([_, m]) => m.positive_rate || 0);
    const colors = labels.map(name => infraColors[name] || '#6b7280');

    // Sends by Infra Chart
    const sendsCtx = document.getElementById('infraSendsChart');
    if (sendsCtx) {
        infraSendsChart = destroyChart(infraSendsChart);
        infraSendsChart = new Chart(sendsCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Sends',
                    data: sends,
                    backgroundColor: colors
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    // Positive Rate by Infra Chart
    const rateCtx = document.getElementById('infraPositiveRateChart');
    if (rateCtx) {
        infraPositiveRateChart = destroyChart(infraPositiveRateChart);
        infraPositiveRateChart = new Chart(rateCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '+ve Rate %',
                    data: positiveRates,
                    backgroundColor: colors
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => value.toFixed(2) + '%'
                        }
                    }
                }
            }
        });
    }
}

// Fixed number of weeks for trend charts (independent of date selection)
const TREND_WEEKS = 6;
const TREND_DAYS = TREND_WEEKS * 7;

// Update Aggregated Trends Charts (weekly buckets, line charts)
// Always fetches last 6 weeks regardless of selected date range
async function updateDailyTrendsCharts() {
    if (!window.SupabaseClient) return;

    // Always fetch 6 weeks of data for trends
    const trends = await window.SupabaseClient.fetchDailyTrends(TREND_DAYS);

    if (!trends || trends.length === 0) return;

    // Aggregate into weekly buckets (7-day)
    const aggregated = aggregateByPeriod(trends, 7);

    const labels = aggregated.map(a => a.label);
    const replyRates = aggregated.map(a => a.reply_rate);
    const positiveRates = aggregated.map(a => a.positive_rate);

    // Reply Rate Chart (Line)
    const replyCtx = document.getElementById('dailyReplyRateChart');
    if (replyCtx) {
        dailyReplyRateChart = destroyChart(dailyReplyRateChart);
        dailyReplyRateChart = new Chart(replyCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Reply Rate %',
                    data: replyRates,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#3b82f6'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => v.toFixed(1) + '%' }
                    }
                }
            }
        });
    }

    // Positive Rate Chart (Line)
    const positiveCtx = document.getElementById('dailyPositiveRateChart');
    if (positiveCtx) {
        dailyPositiveRateChart = destroyChart(dailyPositiveRateChart);
        dailyPositiveRateChart = new Chart(positiveCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '+ve Rate %',
                    data: positiveRates,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#10b981'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => v.toFixed(3) + '%' }
                    }
                }
            }
        });
    }
}

// Update Infra Comparison Trend Chart (multi-line by infra type)
// Always fetches last 6 weeks regardless of selected date range
async function updateInfraComparisonTrendChart() {
    if (!window.SupabaseClient) return;

    // Always fetch 6 weeks of data for trends
    const infraTrends = await window.SupabaseClient.fetchInfraTrends(TREND_DAYS);

    // infraTrends is an object: { infraType: { date: { sent, replied, interested } } }
    if (!infraTrends || Object.keys(infraTrends).length === 0) {
        console.log('No infra trends data available');
        return;
    }

    const allInfraTypes = Object.keys(infraTrends);

    // Get all unique dates across all infra types
    const allDates = new Set();
    for (const infraType of allInfraTypes) {
        Object.keys(infraTrends[infraType]).forEach(d => allDates.add(d));
    }
    const sortedDates = [...allDates].sort();

    // Build data per infra type
    const datasets = [];
    for (const infra of allInfraTypes) {
        // Get daily data for this infra
        const infraData = sortedDates.map(date => {
            const dayStats = infraTrends[infra][date] || { sent: 0, replied: 0, interested: 0 };
            return {
                date: date,
                sent: dayStats.sent || 0,
                replied: dayStats.replied || 0,
                interested: dayStats.interested || 0
            };
        });

        // Aggregate into weekly buckets
        const aggregated = aggregateByPeriod(infraData, 7);

        datasets.push({
            label: infra,
            data: aggregated.map(a => a.positive_rate),
            borderColor: infraColors[infra] || '#6b7280',
            backgroundColor: (infraColors[infra] || '#6b7280') + '20',
            fill: false,
            tension: 0.3,
            pointRadius: 3
        });
    }

    // Get labels from aggregated data
    const firstInfraData = sortedDates.map(d => ({ date: d }));
    const labels = aggregateByPeriod(firstInfraData, 7).map(a => a.label);

    const ctx = document.getElementById('infraComparisonTrendChart');
    if (ctx) {
        infraComparisonTrendChart = destroyChart(infraComparisonTrendChart);
        infraComparisonTrendChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: '+ve Rate %' },
                        ticks: {
                            callback: (v) => v.toFixed(3) + '%'
                        }
                    }
                }
            }
        });
    }
}

// ======================
// Client Analytics Functions
// ======================

function populateClientSelector(byClient) {
    const selector = document.getElementById('clientSelector');
    if (!selector || !byClient) return;

    // Clear existing options except the first placeholder
    selector.innerHTML = '<option value="">-- Select a Client --</option>';

    // Add clients sorted alphabetically
    const clients = Object.keys(byClient).sort();
    for (const client of clients) {
        const option = document.createElement('option');
        option.value = client;
        option.textContent = client;
        selector.appendChild(option);
    }
}

async function loadClientAnalytics(clientName) {
    if (!clientName || !window.SupabaseClient) {
        document.getElementById('clientOverviewSection').style.display = 'none';
        document.getElementById('noClientSelected').style.display = 'block';
        return;
    }

    document.getElementById('noClientSelected').style.display = 'none';
    document.getElementById('clientOverviewSection').style.display = 'block';
    document.getElementById('selectedClientName').textContent = clientName + ' - Overview';

    // Use client-specific date range
    const days = PERIOD_DAYS[clientPeriod] || 14;
    const end = clientEndDate || window.SupabaseClient.getLatestDataDate();
    const start = clientStartDate || window.SupabaseClient.getDateNDaysAgo(days);

    console.log(`Loading client analytics for ${clientName}: ${start} to ${end}`);
    const analytics = await window.SupabaseClient.fetchClientAnalytics(clientName, start, end);

    if (!analytics) return;

    // Update summary cards
    const totals = analytics.totals || {};
    const el = (id) => document.getElementById(id);
    if (el('clientTotalSends')) el('clientTotalSends').textContent = formatNumber(totals.sent || 0);
    if (el('clientTotalReplies')) el('clientTotalReplies').textContent = formatNumber(totals.replied || 0);
    if (el('clientTotalPositive')) el('clientTotalPositive').textContent = totals.interested || 0;
    if (el('clientReplyRate')) el('clientReplyRate').textContent = (totals.reply_rate || 0).toFixed(2) + '%';
    if (el('clientPositiveRate')) el('clientPositiveRate').textContent = (totals.positive_rate || 0).toFixed(3) + '%';
    if (el('clientPositivesPerDay')) el('clientPositivesPerDay').textContent = (totals.positives_per_day || 0).toFixed(1);
    if (el('clientMailboxCount')) el('clientMailboxCount').textContent = formatNumber(totals.mailbox_count || 0);

    // Update infra breakdown table
    updateClientInfraTable(analytics.byInfra);

    // Update infra charts
    updateClientInfraCharts(analytics.byInfra);

    // Update daily trends charts (fetches 6 weeks independently)
    updateClientDailyTrendsCharts(clientName);
}

function updateClientInfraTable(byInfra) {
    const tbody = document.getElementById('clientInfraTableBody');
    if (!tbody || !byInfra) return;
    tbody.innerHTML = '';

    const sorted = Object.entries(byInfra).sort((a, b) => b[1].sent - a[1].sent);

    for (const [infraType, m] of sorted) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="${getInfraClass(infraType)}">${infraType}</td>
            <td>${m.mailbox_count || 0}</td>
            <td>${m.domain_count || 0}</td>
            <td>${formatNumber(m.sent)}</td>
            <td>${formatNumber(m.replied)}</td>
            <td class="highlight-col">${m.interested || 0}</td>
            <td>${(m.reply_rate || 0).toFixed(2)}%</td>
            <td class="highlight-col">${(m.positive_rate || 0).toFixed(3)}%</td>
            <td>${(m.bounce_rate || 0).toFixed(2)}%</td>
        `;
        tbody.appendChild(row);
    }
}

function updateClientInfraCharts(byInfra) {
    if (!byInfra) return;

    const sorted = Object.entries(byInfra)
        .filter(([_, m]) => m.sent > 0)
        .sort((a, b) => b[1].sent - a[1].sent);

    const labels = sorted.map(([name]) => name);
    const sends = sorted.map(([_, m]) => m.sent);
    const positiveRates = sorted.map(([_, m]) => m.positive_rate || 0);
    const colors = labels.map(name => infraColors[name] || '#6b7280');

    // Sends by Infra Chart
    const sendsCtx = document.getElementById('clientInfraSendsChart');
    if (sendsCtx) {
        clientInfraSendsChart = destroyChart(clientInfraSendsChart);
        clientInfraSendsChart = new Chart(sendsCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Sends',
                    data: sends,
                    backgroundColor: colors
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    // Positive Rate by Infra Chart
    const rateCtx = document.getElementById('clientInfraPositiveRateChart');
    if (rateCtx) {
        clientInfraPositiveRateChart = destroyChart(clientInfraPositiveRateChart);
        clientInfraPositiveRateChart = new Chart(rateCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '+ve Rate %',
                    data: positiveRates,
                    backgroundColor: colors
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => value.toFixed(2) + '%'
                        }
                    }
                }
            }
        });
    }
}

// Update client trends - always fetches 6 weeks of data
async function updateClientDailyTrendsCharts(clientName) {
    if (!clientName || !window.SupabaseClient) return;

    // Always fetch 6 weeks of data for trends (independent of date selection)
    const end = window.SupabaseClient.getLatestDataDate();
    const start = window.SupabaseClient.getDateNDaysAgo(TREND_DAYS);

    console.log(`Fetching client trends for ${clientName}: ${start} to ${end}`);
    const analytics = await window.SupabaseClient.fetchClientAnalytics(clientName, start, end);

    if (!analytics || !analytics.byDate) return;

    const byDate = analytics.byDate;
    const sortedDates = Object.keys(byDate).sort();

    // Convert to array format for aggregation
    const dailyData = sortedDates.map(d => ({
        date: d,
        sent: byDate[d].sent || 0,
        replied: byDate[d].replied || 0,
        interested: byDate[d].interested || 0
    }));

    // Aggregate into weekly buckets
    const aggregated = aggregateByPeriod(dailyData, 7);

    const labels = aggregated.map(a => a.label);
    const replyRates = aggregated.map(a => a.reply_rate);
    const positiveRates = aggregated.map(a => a.positive_rate);

    // Reply Rate Chart (Line)
    const replyCtx = document.getElementById('clientDailyReplyRateChart');
    if (replyCtx) {
        clientDailyReplyRateChart = destroyChart(clientDailyReplyRateChart);
        clientDailyReplyRateChart = new Chart(replyCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Reply Rate %',
                    data: replyRates,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#3b82f6'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => v.toFixed(1) + '%' }
                    }
                }
            }
        });
    }

    // Positive Rate Chart (Line)
    const positiveCtx = document.getElementById('clientDailyPositiveRateChart');
    if (positiveCtx) {
        clientDailyPositiveRateChart = destroyChart(clientDailyPositiveRateChart);
        clientDailyPositiveRateChart = new Chart(positiveCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '+ve Rate %',
                    data: positiveRates,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#10b981'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => v.toFixed(3) + '%' }
                    }
                }
            }
        });
    }
}

// ======================
// Clients Tab Data Loading
// ======================

let clientsData = null;

async function loadClientsData() {
    if (!window.SupabaseClient) return;

    const days = PERIOD_DAYS[clientPeriod] || 14;
    const end = clientEndDate || window.SupabaseClient.getLatestDataDate();
    const start = clientStartDate || window.SupabaseClient.getDateNDaysAgo(days);

    console.log(`Loading clients data from ${start} to ${end}`);

    try {
        const data = await window.SupabaseClient.fetchInfraPerformance(start, end);
        clientsData = data;

        // Update the date range display
        const displayEl = document.getElementById('clientDateRangeDisplay');
        if (displayEl) {
            displayEl.textContent = `${start} → ${end}`;
        }

        // Update all clients table
        updateAllClientsTable(data.by_client || {}, data.meta?.days || days);

        // Populate client selector
        populateClientSelector(data.by_client || {});

        // If a client is already selected, reload their analytics
        const selector = document.getElementById('clientSelector');
        if (selector && selector.value) {
            loadClientAnalytics(selector.value);
        }
    } catch (error) {
        console.error('Error loading clients data:', error);
    }
}

function updateAllClientsTable(byClient, numDays) {
    const tbody = document.getElementById('allClientsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Aggregate by client (sum all infra types)
    const clientTotals = {};
    for (const [clientName, infraData] of Object.entries(byClient || {})) {
        clientTotals[clientName] = {
            mailbox_count: 0,
            domain_count: 0,
            sent: 0,
            replied: 0,
            interested: 0,
            bounced: 0
        };
        for (const m of Object.values(infraData)) {
            clientTotals[clientName].mailbox_count += m.mailbox_count || 0;
            clientTotals[clientName].domain_count += m.domain_count || 0;
            clientTotals[clientName].sent += m.sent || 0;
            clientTotals[clientName].replied += m.replied || 0;
            clientTotals[clientName].interested += m.interested || 0;
            clientTotals[clientName].bounced += m.bounced || 0;
        }
    }

    // Sort by sends descending
    const sorted = Object.entries(clientTotals).sort((a, b) => b[1].sent - a[1].sent);

    for (const [clientName, t] of sorted) {
        const replyRate = t.sent > 0 ? (t.replied / t.sent) * 100 : 0;
        const positiveRate = t.sent > 0 ? (t.interested / t.sent) * 100 : 0;
        const positiveReplyRate = t.replied > 0 ? (t.interested / t.replied) * 100 : 0;
        const bounceRate = t.sent > 0 ? (t.bounced / t.sent) * 100 : 0;
        const positivesPerDay = t.interested / numDays;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${clientName}</td>
            <td>${t.mailbox_count}</td>
            <td>${t.domain_count}</td>
            <td>${formatNumber(t.sent)}</td>
            <td>${formatNumber(t.replied)}</td>
            <td class="highlight-col">${t.interested}</td>
            <td>${replyRate.toFixed(2)}%</td>
            <td class="highlight-col">${positiveRate.toFixed(3)}%</td>
            <td>${positiveReplyRate.toFixed(2)}%</td>
            <td>${bounceRate.toFixed(2)}%</td>
            <td class="highlight-col">${positivesPerDay.toFixed(1)}</td>
        `;
        tbody.appendChild(row);
    }
}

// ======================
// Bounce Tab Functions
// ======================

function formatBounceType(type) {
    if (!type) return 'Unknown';
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function updateBounceOverview(bounceData) {
    if (!bounceData) return;

    const el = (id) => document.getElementById(id);
    if (el('totalBounces')) el('totalBounces').textContent = formatNumber(bounceData.total);
    if (el('hardBounces')) el('hardBounces').textContent = formatNumber(bounceData.by_type?.hard_bounce || 0);
    if (el('blockBounces')) el('blockBounces').textContent = formatNumber(bounceData.by_type?.block || 0);
    if (el('softBounces')) el('softBounces').textContent = formatNumber(bounceData.by_type?.soft_bounce || 0);
}

function updateBounceTypeTable(bounceData) {
    const tbody = document.getElementById('bounceTypeTableBody');
    if (!tbody || !bounceData) return;
    tbody.innerHTML = '';

    const total = bounceData.total || 1;
    const sorted = Object.entries(bounceData.by_type || {}).sort((a, b) => b[1] - a[1]);

    for (const [type, count] of sorted) {
        const pct = ((count / total) * 100).toFixed(1);
        const explanation = BOUNCE_TYPE_EXPLANATIONS[type] || BOUNCE_TYPE_EXPLANATIONS['unknown'];
        const severityClass = `severity-${explanation.severity}`;
        const actionClass = explanation.severity === 'critical' ? 'action-badge-critical' :
                           explanation.severity === 'warning' ? 'action-badge-warning' : 'action-badge-info';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="bounce-type-${type.replace(/_/g, '-')}">${formatBounceType(type)}</td>
            <td class="${severityClass}" title="${explanation.detail}">${explanation.short}</td>
            <td>${formatNumber(count)}</td>
            <td>${pct}%</td>
            <td><span class="action-badge ${actionClass}">${explanation.action}</span></td>
        `;
        tbody.appendChild(row);
    }
}

function updateBounceInfraTable(bounceData) {
    const tbody = document.getElementById('bounceInfraTableBody');
    if (!tbody || !bounceData) return;
    tbody.innerHTML = '';

    const total = bounceData.total || 1;
    const sorted = Object.entries(bounceData.by_infra || {}).sort((a, b) => b[1] - a[1]);

    for (const [infra, count] of sorted) {
        const pct = ((count / total) * 100).toFixed(1);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="${getInfraClass(infra)}">${infra}</td>
            <td>${formatNumber(count)}</td>
            <td>${pct}%</td>
        `;
        tbody.appendChild(row);
    }
}

function updateBounceWorkspaceTable(bounceData) {
    const tbody = document.getElementById('bounceWorkspaceTableBody');
    if (!tbody || !bounceData) return;
    tbody.innerHTML = '';

    const totalBounces = bounceData.total || 1;
    const sendVolumes = bounceData.workspace_send_volumes || {};
    const totalSends = bounceData.total_sends || 1;

    // Calculate overall bounce rate for comparison
    const overallBounceRate = (totalBounces / totalSends) * 100;

    // Build workspace data with bounce rates
    const workspaceData = [];
    for (const [wsName, bounces] of Object.entries(bounceData.by_workspace || {})) {
        const sends = sendVolumes[wsName] || 0;
        const bounceRate = sends > 0 ? (bounces / sends) * 100 : 0;
        const pctOfBounces = (bounces / totalBounces) * 100;
        const rateVsAvg = overallBounceRate > 0 ? (bounceRate / overallBounceRate) : 0;

        workspaceData.push({
            name: wsName,
            bounces,
            sends,
            bounceRate,
            pctOfBounces,
            rateVsAvg
        });
    }

    // Sort by bounces descending
    workspaceData.sort((a, b) => b.bounces - a.bounces);

    for (const ws of workspaceData.slice(0, 20)) {
        const rateClass = ws.rateVsAvg > 1.5 ? 'danger-cell' :
                         ws.rateVsAvg > 1.0 ? 'warning-cell' : 'success-cell';
        const rateLabel = ws.rateVsAvg > 1.5 ? '↑ High' :
                         ws.rateVsAvg > 1.0 ? '→ Avg' : '↓ Low';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${ws.name}</td>
            <td>${formatNumber(ws.bounces)}</td>
            <td>${formatNumber(ws.sends)}</td>
            <td>${ws.bounceRate.toFixed(2)}%</td>
            <td>${ws.pctOfBounces.toFixed(1)}%</td>
            <td class="${rateClass}">${rateLabel}</td>
        `;
        tbody.appendChild(row);
    }
}

function updateBounceEventsTable(bounceData) {
    const tbody = document.getElementById('bounceEventsTableBody');
    if (!tbody || !bounceData) return;
    tbody.innerHTML = '';

    if (!bounceData.raw || bounceData.raw.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="no-data">No bounce events found for selected date range.</td></tr>';
        return;
    }

    // Get limit from selector
    const limitSelector = document.getElementById('bounceEventsLimit');
    const limit = limitSelector ? parseInt(limitSelector.value) : 100;

    // Sort by date descending (most recent first)
    const sortedEvents = [...bounceData.raw].sort((a, b) => {
        const dateA = a.event_date || a.created_at || '';
        const dateB = b.event_date || b.created_at || '';
        return dateB.localeCompare(dateA);
    });

    for (const bounce of sortedEvents.slice(0, limit)) {
        const date = bounce.event_date || bounce.created_at || '-';
        const infraClass = getInfraClass(bounce.infra_type || 'Unknown');
        const messagePreview = bounce.raw_message ?
            (bounce.raw_message.length > 60 ? bounce.raw_message.substring(0, 60) + '...' : bounce.raw_message) : '-';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${date}</td>
            <td class="bounce-type-${(bounce.bounce_type || 'unknown').replace(/_/g, '-')}">${formatBounceType(bounce.bounce_type)}</td>
            <td>${bounce.sender_domain || '-'}</td>
            <td>${bounce.recipient_domain || '-'}</td>
            <td>${bounce.workspace_name || '-'}</td>
            <td class="${infraClass}">${bounce.infra_type || '-'}</td>
            <td class="message-preview" title="${(bounce.raw_message || '').replace(/"/g, '&quot;')}">${messagePreview}</td>
        `;
        tbody.appendChild(row);
    }
}

function updateBounceMXProviderTable(bounceData) {
    const tbody = document.getElementById('bounceMXProviderTableBody');
    if (!tbody || !bounceData) return;
    tbody.innerHTML = '';

    const byMXProvider = bounceData.by_mx_provider || {};
    const total = bounceData.total || 1;

    if (Object.keys(byMXProvider).length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="no-data">MX Provider analysis in progress...</td></tr>';
        return;
    }

    // Sort by count descending
    const sorted = Object.entries(byMXProvider).sort((a, b) => b[1] - a[1]);

    for (const [provider, count] of sorted) {
        const pct = ((count / total) * 100).toFixed(1);
        const providerClass = getMXProviderClass(provider);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="${providerClass}">${provider}</td>
            <td>${formatNumber(count)}</td>
            <td>${pct}%</td>
        `;
        tbody.appendChild(row);
    }
}

function getMXProviderClass(provider) {
    const providerClasses = {
        'Google': 'mx-google',
        'Microsoft': 'mx-microsoft',
        'Mimecast': 'mx-mimecast',
        'Barracuda': 'mx-barracuda',
        'Proofpoint': 'mx-proofpoint',
        'Other': 'mx-other',
        'Unknown': 'mx-unknown'
    };
    return providerClasses[provider] || 'mx-other';
}

async function updateBouncesTab() {
    console.log('Loading bounce data...');
    const bounceData = await fetchBounceData();
    if (!bounceData) {
        console.log('No bounce data returned');
        return;
    }

    console.log('Bounce data received:', bounceData.total, 'total bounces');
    currentBounceData = bounceData;
    updateBounceOverview(bounceData);
    updateBounceTypeTable(bounceData);
    updateBounceInfraTable(bounceData);
    updateBounceWorkspaceTable(bounceData);
    updateBounceMXProviderTable(bounceData);
    updateBounceEventsTable(bounceData);
}

// ======================
// Time-Independent Tabs
// ======================

async function fetchAndCacheLatestSnapshot() {
    if (!window.SupabaseClient) return;
    latestInfraSnapshot = await window.SupabaseClient.fetchLatestInfraSnapshot();
}

function updateWarmupTableFromSnapshot() {
    if (!latestInfraSnapshot || !latestInfraSnapshot.by_infra) return;
    updateWarmupTable(latestInfraSnapshot.by_infra);
}

// Fetch last 7 days positive rates for cost projections
// Map raw database infra type names to display names used in cost projections
const INFRA_TYPE_TO_DISPLAY = {
    'MD SMTP': 'Maldoso',
    'Maldoso': 'Maldoso',
    'GR': 'Google Reseller',
    'GR - N': 'Google Reseller',
    'Google Reseller': 'Google Reseller',
    'AO': 'Aged Outlook',
    'Aged Outlook': 'Aged Outlook'
};

async function fetchLast7DaysPositiveRates() {
    if (!window.SupabaseClient) return {};

    try {
        const trends = await window.SupabaseClient.fetchInfraTrends(7);
        if (!trends || Object.keys(trends).length === 0) return {};

        // Calculate 7-day aggregated positive rate per infra type
        // Group by display name (e.g., combine GR and GR - N into "Google Reseller")
        const aggregatedByDisplay = {};

        for (const [infraType, dateData] of Object.entries(trends)) {
            const displayName = INFRA_TYPE_TO_DISPLAY[infraType];
            if (!displayName) continue; // Skip infra types not in cost projections

            if (!aggregatedByDisplay[displayName]) {
                aggregatedByDisplay[displayName] = { sent: 0, interested: 0 };
            }

            for (const stats of Object.values(dateData)) {
                aggregatedByDisplay[displayName].sent += stats.sent || 0;
                aggregatedByDisplay[displayName].interested += stats.interested || 0;
            }
        }

        // Calculate rates
        const rates = {};
        for (const [displayName, totals] of Object.entries(aggregatedByDisplay)) {
            rates[displayName] = totals.sent > 0 ? (totals.interested / totals.sent) * 100 : 0;
        }

        console.log('Raw infra trends:', Object.keys(trends));
        console.log('Mapped positive rates:', rates);
        return rates;
    } catch (error) {
        console.error('Error fetching 7-day positive rates:', error);
        return {};
    }
}

async function updateProjectionsFromSnapshot() {
    if (!latestInfraSnapshot || !latestInfraSnapshot.by_infra) return;

    // Always fetch last 7 days positive rates for cost projections
    const last7DayRates = await fetchLast7DaysPositiveRates();
    console.log('Last 7-day positive rates:', last7DayRates);

    const projections = calculateProjections(latestInfraSnapshot.by_infra, last7DayRates);
    updateProjectionsTable(projections);
}

// Update footer meta and date range display
function updateMeta(meta) {
    const dateRangeEl = document.getElementById('dateRangeDisplay');
    if (dateRangeEl) {
        dateRangeEl.textContent = `${meta.start_date} → ${meta.end_date}`;
    }
    const genEl = document.getElementById('generatedAt');
    if (genEl) {
        genEl.textContent = new Date(meta.generated_at).toLocaleString();
    }
}

// Loading state
function setLoading(isLoading) {
    if (loadingTimeoutId) {
        clearTimeout(loadingTimeoutId);
        loadingTimeoutId = null;
    }

    const loadingEl = document.getElementById('loading');
    const mainTabNav = document.getElementById('mainTabNav');
    const datePicker = document.getElementById('datePicker');
    const footer = document.getElementById('footer');

    if (loadingEl) loadingEl.style.display = isLoading ? 'block' : 'none';
    if (mainTabNav) mainTabNav.style.display = isLoading ? 'none' : 'flex';
    if (datePicker) datePicker.style.display = isLoading ? 'none' : 'flex';
    if (footer) footer.style.display = isLoading ? 'none' : 'block';

    if (!isLoading) {
        showDefaultTabs();
        currentRetryCount = 0;
        if (loadingEl) {
            loadingEl.innerHTML = '<div class="spinner"></div><p>Loading data...</p>';
        }
    } else {
        document.querySelectorAll('.main-tab-content').forEach(c => c.style.display = 'none');
        loadingTimeoutId = setTimeout(showSlowLoadingMessage, LOADING_TIMEOUT_MS);
    }
}

function showSlowLoadingMessage() {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        loadingEl.innerHTML = `
            <div class="spinner"></div>
            <p class="slow-message">Taking longer than expected...</p>
            <p class="slow-hint">The database might be waking up.</p>
            <p class="slow-hint">Attempt ${currentRetryCount + 1} of ${MAX_RETRIES}</p>
        `;
    }
}

function showError(message, canRetry = true) {
    if (loadingTimeoutId) {
        clearTimeout(loadingTimeoutId);
        loadingTimeoutId = null;
    }

    setLoading(false);

    const loadingEl = document.getElementById('loading');
    const mainTabNav = document.getElementById('mainTabNav');

    if (loadingEl) loadingEl.style.display = 'block';
    if (mainTabNav) mainTabNav.style.display = 'none';

    if (loadingEl) {
        loadingEl.innerHTML = `
            <div class="error">
                <p>⚠️ ${message}</p>
                <p class="hint">This may be due to a slow database connection.</p>
                ${canRetry ? '<button class="retry-btn" onclick="retryLoad()">Retry Now</button>' : ''}
            </div>
        `;
    }
}

function retryLoad() {
    currentRetryCount = 0;
    if (startDate && endDate) {
        loadDataWithDateRange(startDate, endDate);
    } else {
        loadData(currentPeriod, true);
    }
}

async function fetchWithTimeout(fetchFn, timeoutMs = 30000) {
    return Promise.race([
        fetchFn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), timeoutMs))
    ]);
}

function updateLoadingStatus(message) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        loadingEl.innerHTML = `<div class="spinner"></div><p>${message}</p>`;
    }
    console.log('Loading status:', message);
}

// Main load function
async function loadData(period, refresh = false) {
    console.log('loadData:', period);
    currentPeriod = period;
    setLoading(true);

    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === period);
    });

    if (!startDate && !endDate && window.SupabaseClient) {
        const days = PERIOD_DAYS[period] || 14;
        const endEl = document.getElementById('endDate');
        const startEl = document.getElementById('startDate');
        if (endEl) endEl.value = window.SupabaseClient.getTodayDate();
        if (startEl) startEl.value = window.SupabaseClient.getDateNDaysAgo(days);
    }

    while (currentRetryCount < MAX_RETRIES) {
        try {
            updateLoadingStatus('Fetching data from database...');
            const data = await fetchWithTimeout(() => fetchData(period, refresh), 30000);
            currentData = data;

            if (!data.totals) {
                throw new Error('No data available for this period');
            }

            updateLoadingStatus('Rendering dashboard...');

            updateOverview(data.totals, data.meta);
            updateInfraTable(data.by_infra || {});
            updateClientInfraBreakdownTable(data.by_client || {});
            updateMeta(data.meta || { start_date: '-', end_date: '-', days: 0, generated_at: new Date().toISOString() });

            // Update infra charts
            updateInfraCharts(data.by_infra || {});

            // Update daily trends charts (async, non-blocking)
            updateDailyTrendsCharts();
            updateInfraComparisonTrendChart();

            // Populate client selector
            populateClientSelector(data.by_client || {});

            // Load time-independent tabs
            await fetchAndCacheLatestSnapshot();
            updateWarmupTableFromSnapshot();
            updateProjectionsFromSnapshot();

            setLoading(false);
            return;
        } catch (error) {
            console.error(`Load attempt ${currentRetryCount + 1} failed:`, error);
            currentRetryCount++;

            if (currentRetryCount < MAX_RETRIES) {
                showSlowLoadingMessage();
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                showError('Failed to load data after multiple attempts. ' + error.message);
                return;
            }
        }
    }
}

async function loadDataWithDateRange(start, end) {
    startDate = start;
    endDate = end;

    document.querySelectorAll('.period-btn').forEach(btn => btn.classList.remove('active'));
    setLoading(true);

    while (currentRetryCount < MAX_RETRIES) {
        try {
            const data = await fetchWithTimeout(() => window.SupabaseClient.fetchInfraPerformance(start, end), 30000);
            currentData = data;

            if (!data.totals) {
                throw new Error('No data available for this date range');
            }

            updateOverview(data.totals, data.meta);
            updateInfraTable(data.by_infra || {});
            updateClientInfraBreakdownTable(data.by_client || {});
            updateMeta(data.meta);

            // Update infra charts
            updateInfraCharts(data.by_infra || {});

            // Update daily trends charts
            updateDailyTrendsCharts();
            updateInfraComparisonTrendChart();

            // Populate client selector
            populateClientSelector(data.by_client || {});

            if (!latestInfraSnapshot) {
                await fetchAndCacheLatestSnapshot();
            }
            updateWarmupTableFromSnapshot();
            updateProjectionsFromSnapshot();

            setLoading(false);
            return;
        } catch (error) {
            console.error(`Load attempt ${currentRetryCount + 1} failed:`, error);
            currentRetryCount++;

            if (currentRetryCount < MAX_RETRIES) {
                showSlowLoadingMessage();
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                showError('Failed to load data after multiple attempts. ' + error.message);
                return;
            }
        }
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for Supabase client
    if (!window.SupabaseClient) {
        console.error('SupabaseClient not available - waiting...');
        let waited = 0;
        while (!window.SupabaseClient && waited < 5000) {
            await new Promise(r => setTimeout(r, 100));
            waited += 100;
        }
        if (!window.SupabaseClient) {
            document.getElementById('loading').innerHTML = `
                <div class="error">
                    <p>Failed to initialize database client</p>
                    <p class="hint">Please refresh the page to try again.</p>
                    <button class="retry-btn" onclick="location.reload()">Refresh Page</button>
                </div>
            `;
            return;
        }
    }

    console.log('DOMContentLoaded: Starting initialization');
    updateLoadingStatus('Initializing...');

    // Load workspace map (non-blocking)
    window.SupabaseClient.fetchWorkspaces()
        .then(map => { workspaceMap = map; console.log('Workspace map loaded'); })
        .catch(e => console.warn('Failed to load workspace map:', e));

    updateLoadingStatus('Loading dashboard data...');

    // Set default date values
    if (window.SupabaseClient) {
        const latestDataDate = window.SupabaseClient.getLatestDataDate();
        const startDateInput = document.getElementById('startDate');
        const endDateInput = document.getElementById('endDate');

        if (startDateInput && endDateInput) {
            startDateInput.min = DATA_START_DATE;
            endDateInput.min = DATA_START_DATE;
            startDateInput.max = latestDataDate;
            endDateInput.max = latestDataDate;
            endDateInput.value = latestDataDate;
            const defaultStart = new Date(latestDataDate);
            defaultStart.setDate(defaultStart.getDate() - 13);
            startDateInput.value = defaultStart.toISOString().split('T')[0];
            if (startDateInput.value < DATA_START_DATE) {
                startDateInput.value = DATA_START_DATE;
            }
        }
    }

    // Period buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const period = btn.dataset.period;
            if (getComingSoonPeriods().includes(period)) {
                alert('30-day view coming soon! Please use 3D, 7D, or 14D for now.');
                return;
            }
            startDate = null;
            endDate = null;
            loadData(period);
        });
    });

    // Update 30d button
    const btn30d = document.querySelector('.period-btn[data-period="30d"]');
    if (btn30d && is30dAvailable()) {
        btn30d.classList.remove('disabled');
        btn30d.title = '';
    }

    // Main tab buttons
    document.querySelectorAll('.main-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchMainTab(btn.dataset.mainTab));
    });

    // Subtab buttons
    document.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchSubtab(btn.dataset.subtab));
    });

    // Bounce date picker
    const bounceStartInput = document.getElementById('bounceStartDate');
    const bounceEndInput = document.getElementById('bounceEndDate');
    const applyBounceDateBtn = document.getElementById('applyBounceDate');

    if (bounceStartInput && bounceEndInput && window.SupabaseClient) {
        // Use today's date for bounce end (webhook data is real-time)
        const todayDate = window.SupabaseClient.getTodayDate();
        bounceEndInput.value = todayDate;
        bounceStartInput.value = BOUNCE_DATA_START;
        bounceStartInput.min = BOUNCE_DATA_START;
        bounceEndInput.min = BOUNCE_DATA_START;
        bounceStartInput.max = todayDate;
        bounceEndInput.max = todayDate;
    }

    if (applyBounceDateBtn) {
        applyBounceDateBtn.addEventListener('click', () => {
            bounceStartDate = bounceStartInput.value;
            bounceEndDate = bounceEndInput.value;
            updateBouncesTab();
        });
    }

    // Bounce events limit selector
    const bounceEventsLimit = document.getElementById('bounceEventsLimit');
    if (bounceEventsLimit) {
        bounceEventsLimit.addEventListener('change', () => {
            if (currentBounceData) {
                updateBounceEventsTable(currentBounceData);
            }
        });
    }

    // Refresh bounce events button
    const refreshBounceEventsBtn = document.getElementById('refreshBounceEvents');
    if (refreshBounceEventsBtn) {
        refreshBounceEventsBtn.addEventListener('click', () => {
            updateBouncesTab();
        });
    }

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (startDate && endDate) {
                loadDataWithDateRange(startDate, endDate);
            } else {
                loadData(currentPeriod, true);
            }
        });
    }

    // Date range apply button
    const applyDateRangeBtn = document.getElementById('applyDateRange');
    if (applyDateRangeBtn) {
        applyDateRangeBtn.addEventListener('click', () => {
            const start = document.getElementById('startDate').value;
            const end = document.getElementById('endDate').value;
            if (start && end) {
                loadDataWithDateRange(start, end);
            }
        });
    }

    // Client filter (in Infra > By Client subtab)
    const clientFilter = document.getElementById('clientFilter');
    if (clientFilter) {
        clientFilter.addEventListener('change', () => {
            if (currentData) {
                updateClientInfraBreakdownTable(currentData.by_client || {}, clientFilter.value);
            }
        });
    }

    // Client selector (Clients tab)
    const clientSelector = document.getElementById('clientSelector');
    if (clientSelector) {
        clientSelector.addEventListener('change', () => {
            const selectedClient = clientSelector.value;
            loadClientAnalytics(selectedClient);
        });
    }

    // ======================
    // Client Date Picker Setup
    // ======================
    if (window.SupabaseClient) {
        const latestDataDate = window.SupabaseClient.getLatestDataDate();
        const clientStartInput = document.getElementById('clientStartDate');
        const clientEndInput = document.getElementById('clientEndDate');

        if (clientStartInput && clientEndInput) {
            clientStartInput.min = DATA_START_DATE;
            clientEndInput.min = DATA_START_DATE;
            clientStartInput.max = latestDataDate;
            clientEndInput.max = latestDataDate;
            clientEndInput.value = latestDataDate;
            const defaultStart = new Date(latestDataDate);
            defaultStart.setDate(defaultStart.getDate() - 13);
            clientStartInput.value = defaultStart.toISOString().split('T')[0];
            if (clientStartInput.value < DATA_START_DATE) {
                clientStartInput.value = DATA_START_DATE;
            }
        }
    }

    // Client period buttons
    document.querySelectorAll('.client-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const period = btn.dataset.period;
            clientPeriod = period;

            // Update active state
            document.querySelectorAll('.client-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Reset custom dates
            clientStartDate = null;
            clientEndDate = null;

            // Reload client data
            loadClientsData();
        });
    });

    // Client date range apply button
    const applyClientDateRangeBtn = document.getElementById('applyClientDateRange');
    if (applyClientDateRangeBtn) {
        applyClientDateRangeBtn.addEventListener('click', () => {
            const start = document.getElementById('clientStartDate').value;
            const end = document.getElementById('clientEndDate').value;
            if (start && end) {
                clientStartDate = start;
                clientEndDate = end;

                // Clear period button active state
                document.querySelectorAll('.client-period-btn').forEach(b => b.classList.remove('active'));

                // Reload client data
                loadClientsData();
            }
        });
    }

    // Initial load
    loadData('14d');
});
