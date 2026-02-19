// RGL Infra Performance Dashboard - JavaScript
// Version: 2026-02-19-v4 (Added charts/trends, client analytics)

console.log('[APP VERSION] 2026-02-19-v4 - Charts and client analytics');

let currentPeriod = '14d';
let currentData = null;
let currentBounceData = null;
let workspaceMap = {};

// Chart instances (for cleanup/update)
let infraSendsChart = null;
let infraPositiveRateChart = null;
let dailySendsChart = null;
let dailyPositiveRateChart = null;
let clientInfraSendsChart = null;
let clientInfraPositiveRateChart = null;
let clientDailySendsChart = null;
let clientDailyPositiveRateChart = null;

// Main tab and subtab state
let currentMainTab = 'infra';
let currentSubtabs = {
    infra: 'infra-overview'
};

// Cached latest snapshot for time-independent tabs
let latestInfraSnapshot = null;

// Date range state (main dashboard - for Infra and Clients)
let startDate = null;
let endDate = null;

// Bounce-specific date state (independent from main dashboard)
let bounceStartDate = null;
let bounceEndDate = null;
const BOUNCE_DATA_START = '2026-02-18'; // First date with webhook bounce data

// Loading timeout and retry configuration
const LOADING_TIMEOUT_MS = 12000;
const MAX_RETRIES = 3;
let loadingTimeoutId = null;
let currentRetryCount = 0;

// Period to days mapping
const PERIOD_DAYS = {
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

    const end = bounceEndDate || window.SupabaseClient.getLatestDataDate();
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

    // Show/hide date picker (only for Infra and Clients)
    const datePicker = document.getElementById('datePicker');
    if (datePicker) {
        datePicker.style.display = (mainTabId === 'infra' || mainTabId === 'clients') ? 'flex' : 'none';
    }

    // If bounces tab, load bounce data
    if (mainTabId === 'bounces') {
        updateBouncesTab();
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

// Update TLD tables
function updateTldTables(byTld, byInfraTld) {
    const tldTbody = document.getElementById('tldTableBody');
    if (tldTbody) {
        tldTbody.innerHTML = '';
        const sortedTld = Object.entries(byTld || {}).sort((a, b) => b[1].sent - a[1].sent);

        for (const [tld, m] of sortedTld) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${tld}</td>
                <td>${m.mailbox_count || 0}</td>
                <td>${m.domain_count || 0}</td>
                <td>${formatNumber(m.sent)}</td>
                <td>${formatNumber(m.replied)}</td>
                <td class="highlight-col">${m.interested || 0}</td>
                <td>${(m.reply_rate || 0).toFixed(2)}%</td>
                <td class="highlight-col">${(m.positive_rate || 0).toFixed(3)}%</td>
                <td>${(m.positive_reply_rate || 0).toFixed(2)}%</td>
                <td>${(m.bounce_rate || 0).toFixed(2)}%</td>
            `;
            tldTbody.appendChild(row);
        }
    }

    // Populate infra filter
    const infraFilter = document.getElementById('infraTldFilter');
    if (infraFilter && byInfraTld) {
        const currentValue = infraFilter.value;
        infraFilter.innerHTML = '<option value="all">All Infra Types</option>';
        Object.keys(byInfraTld).sort().forEach(infra => {
            infraFilter.innerHTML += `<option value="${infra}">${infra}</option>`;
        });
        infraFilter.value = currentValue || 'all';
    }

    updateInfraTldTable(byInfraTld, infraFilter?.value || 'all');
}

function updateInfraTldTable(byInfraTld, filter) {
    const tbody = document.getElementById('infraTldTableBody');
    if (!tbody || !byInfraTld) return;
    tbody.innerHTML = '';

    const rows = [];
    for (const [infraType, tldData] of Object.entries(byInfraTld)) {
        if (filter !== 'all' && infraType !== filter) continue;
        for (const [tld, m] of Object.entries(tldData)) {
            rows.push({ infraType, tld, ...m });
        }
    }

    rows.sort((a, b) => b.sent - a.sent);

    for (const r of rows) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="${getInfraClass(r.infraType)}">${r.infraType}</td>
            <td>${r.tld}</td>
            <td>${r.mailbox_count || 0}</td>
            <td>${formatNumber(r.sent)}</td>
            <td>${(r.reply_rate || 0).toFixed(2)}%</td>
            <td class="highlight-col">${(r.positive_rate || 0).toFixed(3)}%</td>
            <td>${(r.bounce_rate || 0).toFixed(2)}%</td>
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

function calculateProjections(byInfra) {
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

        const infraData = byInfra ? byInfra[infraType] : null;
        const positiveRate = infraData ? (infraData.positive_rate || 0) : 0;
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

// Update Daily Trends Charts
async function updateDailyTrendsCharts() {
    if (!window.SupabaseClient) return;

    const days = PERIOD_DAYS[currentPeriod] || 14;
    const trends = await window.SupabaseClient.fetchDailyTrends(days);

    if (!trends || trends.length === 0) return;

    const labels = trends.map(t => t.date.slice(5)); // MM-DD format
    const sends = trends.map(t => t.sent);
    const replies = trends.map(t => t.replied);
    const positiveRates = trends.map(t => t.positive_rate);

    // Daily Sends & Replies Chart
    const sendsCtx = document.getElementById('dailySendsChart');
    if (sendsCtx) {
        dailySendsChart = destroyChart(dailySendsChart);
        dailySendsChart = new Chart(sendsCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Sends',
                        data: sends,
                        borderColor: '#3b82f6',
                        backgroundColor: '#3b82f620',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Replies',
                        data: replies,
                        borderColor: '#10b981',
                        backgroundColor: '#10b98120',
                        fill: true,
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    // Daily Positive Rate Chart
    const rateCtx = document.getElementById('dailyPositiveRateChart');
    if (rateCtx) {
        dailyPositiveRateChart = destroyChart(dailyPositiveRateChart);
        dailyPositiveRateChart = new Chart(rateCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '+ve Rate %',
                    data: positiveRates,
                    borderColor: '#8b5cf6',
                    backgroundColor: '#8b5cf620',
                    fill: true,
                    tension: 0.3
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

    const analytics = await window.SupabaseClient.fetchClientAnalytics(clientName);

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

    // Update daily trends charts
    updateClientDailyTrendsCharts(analytics.byDate);
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

function updateClientDailyTrendsCharts(byDate) {
    if (!byDate) return;

    const sortedDates = Object.keys(byDate).sort();
    const labels = sortedDates.map(d => d.slice(5)); // MM-DD format
    const sends = sortedDates.map(d => byDate[d].sent || 0);
    const replies = sortedDates.map(d => byDate[d].replied || 0);
    const positiveRates = sortedDates.map(d => {
        const s = byDate[d];
        return s.sent > 0 ? (s.interested / s.sent) * 100 : 0;
    });

    // Daily Sends & Replies Chart
    const sendsCtx = document.getElementById('clientDailySendsChart');
    if (sendsCtx) {
        clientDailySendsChart = destroyChart(clientDailySendsChart);
        clientDailySendsChart = new Chart(sendsCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Sends',
                        data: sends,
                        borderColor: '#3b82f6',
                        backgroundColor: '#3b82f620',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Replies',
                        data: replies,
                        borderColor: '#10b981',
                        backgroundColor: '#10b98120',
                        fill: true,
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    // Daily Positive Rate Chart
    const rateCtx = document.getElementById('clientDailyPositiveRateChart');
    if (rateCtx) {
        clientDailyPositiveRateChart = destroyChart(clientDailyPositiveRateChart);
        clientDailyPositiveRateChart = new Chart(rateCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '+ve Rate %',
                    data: positiveRates,
                    borderColor: '#8b5cf6',
                    backgroundColor: '#8b5cf620',
                    fill: true,
                    tension: 0.3
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
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="bounce-type-${type.replace(/_/g, '-')}">${formatBounceType(type)}</td>
            <td>${formatNumber(count)}</td>
            <td>${pct}%</td>
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

    const total = bounceData.total || 1;
    const sorted = Object.entries(bounceData.by_workspace || {}).sort((a, b) => b[1] - a[1]).slice(0, 20);

    for (const [wsName, count] of sorted) {
        const pct = ((count / total) * 100).toFixed(1);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${wsName}</td>
            <td>${formatNumber(count)}</td>
            <td>${pct}%</td>
        `;
        tbody.appendChild(row);
    }
}

function updateBounceEventsTable(bounceData) {
    const tbody = document.getElementById('bounceEventsTableBody');
    if (!tbody || !bounceData) return;
    tbody.innerHTML = '';

    if (!bounceData.raw || bounceData.raw.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">No bounce events found for selected date range.</td></tr>';
        return;
    }

    for (const bounce of bounceData.raw.slice(0, 50)) {
        const date = bounce.event_date || bounce.created_at || '-';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${date}</td>
            <td class="bounce-type-${(bounce.bounce_type || 'unknown').replace(/_/g, '-')}">${formatBounceType(bounce.bounce_type)}</td>
            <td>${bounce.sender_domain || '-'}</td>
            <td>${bounce.workspace_name || '-'}</td>
            <td class="${getInfraClass(bounce.infra_type || 'Unknown')}">${bounce.infra_type || '-'}</td>
        `;
        tbody.appendChild(row);
    }
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

function updateProjectionsFromSnapshot() {
    if (!latestInfraSnapshot || !latestInfraSnapshot.by_infra) return;
    const projections = calculateProjections(latestInfraSnapshot.by_infra);
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
            updateTldTables(data.by_tld || {}, data.by_infra_tld || {});
            updateMeta(data.meta || { start_date: '-', end_date: '-', days: 0, generated_at: new Date().toISOString() });

            // Update infra charts
            updateInfraCharts(data.by_infra || {});

            // Update daily trends charts (async, non-blocking)
            updateDailyTrendsCharts();

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
            updateTldTables(data.by_tld || {}, data.by_infra_tld || {});
            updateMeta(data.meta);

            // Update infra charts
            updateInfraCharts(data.by_infra || {});

            // Update daily trends charts
            updateDailyTrendsCharts();

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
        const latestDate = window.SupabaseClient.getLatestDataDate();
        bounceEndInput.value = latestDate;
        bounceStartInput.value = BOUNCE_DATA_START;
        bounceStartInput.min = BOUNCE_DATA_START;
        bounceEndInput.min = BOUNCE_DATA_START;
        bounceStartInput.max = latestDate;
        bounceEndInput.max = latestDate;
    }

    if (applyBounceDateBtn) {
        applyBounceDateBtn.addEventListener('click', () => {
            bounceStartDate = bounceStartInput.value;
            bounceEndDate = bounceEndInput.value;
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

    // Infra TLD filter
    const infraTldFilter = document.getElementById('infraTldFilter');
    if (infraTldFilter) {
        infraTldFilter.addEventListener('change', () => {
            if (currentData) {
                updateInfraTldTable(currentData.by_infra_tld || {}, infraTldFilter.value);
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

    // Initial load
    loadData('14d');
});
