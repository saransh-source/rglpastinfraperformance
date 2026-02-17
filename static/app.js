// RGL Infra Performance Dashboard - JavaScript

let currentPeriod = '14d';
let currentTab = 'overview';
let sendsChart = null;
let rateChart = null;
let currentData = null;
let currentBounceData = null;
let currentDomainData = null;
let workspaceMap = {};

// Date range state
let startDate = null;
let endDate = null;

// Period to days mapping
const PERIOD_DAYS = {
    '3d': 3,
    '7d': 7,
    '14d': 14,
    '30d': 30
};

// Data collection start date (first date we have real data)
const DATA_START_DATE = '2026-02-02';

// Calculate if 30d view should be available (30 days after DATA_START_DATE)
function is30dAvailable() {
    const startDate = new Date(DATA_START_DATE);
    const thirtyDaysLater = new Date(startDate);
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    return new Date() >= thirtyDaysLater;
}

// Periods that are not yet available (dynamically calculated)
function getComingSoonPeriods() {
    const periods = [];
    if (!is30dAvailable()) {
        periods.push('30d');
    }
    return periods;
}

// Chart.js global config
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#2d3748';
Chart.defaults.font.family = "'Inter', sans-serif";

// Color palette for infra types (raw tag names)
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

// Infra type CSS class mapping
function getInfraClass(infraType) {
    return 'infra-' + infraType.toLowerCase().replace(/\s+/g, '-');
}

// Format large numbers
function formatNumber(num) {
    if (num == null) return '-';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}

// Format currency
function formatCurrency(num) {
    if (num == null || num === 0) return '-';
    return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Fetch data from Supabase
async function fetchData(period, refresh = false) {
    // Use Supabase client if available
    if (window.SupabaseClient) {
        const days = PERIOD_DAYS[period] || 14;
        // Use latest data date as end (based on collection time at 4:30 PM IST)
        const end = endDate || window.SupabaseClient.getLatestDataDate();
        // Start date is (days-1) before the end date (end date is inclusive)
        const start = startDate || window.SupabaseClient.getDateNDaysAgo(days);

        try {
            const data = await window.SupabaseClient.fetchInfraPerformance(start, end);
            return data;
        } catch (error) {
            console.warn('Supabase fetch failed, falling back to static JSON:', error);
        }
    }

    // Fallback to static JSON
    const staticUrl = `/static/data.json`;
    const response = await fetch(staticUrl);
    if (!response.ok) {
        throw new Error('Failed to load data');
    }
    const allData = await response.json();
    return allData[period] || allData['14d'] || {};
}

// Fetch bounce data from Supabase
async function fetchBounceData() {
    if (!window.SupabaseClient) return null;

    const days = PERIOD_DAYS[currentPeriod] || 14;
    // Use latest data date as end (based on collection time at 4:30 PM IST)
    const end = endDate || window.SupabaseClient.getLatestDataDate();
    const start = startDate || window.SupabaseClient.getDateNDaysAgo(days);

    try {
        return await window.SupabaseClient.fetchBounces(start, end);
    } catch (error) {
        console.error('Error fetching bounces:', error);
        return null;
    }
}

// Fetch domain health data from Supabase
async function fetchDomainData(clientFilter = 'all') {
    if (!window.SupabaseClient) return null;

    try {
        return await window.SupabaseClient.fetchDomainHealth(clientFilter);
    } catch (error) {
        console.error('Error fetching domain health:', error);
        return null;
    }
}

// Fetch projections - calculate client-side (no API needed)
async function fetchProjections(byInfra) {
    return calculateProjectionsClientSide(byInfra);
}

// Client-side projection calculation
function calculateProjectionsClientSide(byInfra) {
    const TARGET_SENDS = 100000;
    const PROJECTION_INFRAS = ['Maldoso', 'Google Reseller', 'Aged Outlook'];
    
    const COSTS = {
        'Maldoso': { monthly_per_mailbox: 1.67, sends_per_day: 15, mailboxes_per_domain: 4, domain_cost: 4.00, setup_per_mailbox: 0 },
        'Google Reseller': { monthly_per_mailbox: 2.00, sends_per_day: 20, mailboxes_per_domain: 3, domain_cost: 4.00, setup_per_mailbox: 0.20 },
        'Aged Outlook': { monthly_per_tenant: 4.22, sends_per_day: 10, mailboxes_per_tenant: 25, domains_per_tenant: 1, tenant_cost: 11.22, aged_domain_cost: 7.00 }
    };
    
    const projections = {};
    
    for (const infraType of PROJECTION_INFRAS) {
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
        
        // Get positive rate from current data
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

// Tab switching
function switchTab(tabId) {
    currentTab = tabId;
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = content.id === `tab-${tabId}` ? 'block' : 'none';
    });
}

// Update overview cards
function updateOverview(totals, meta) {
    document.getElementById('totalSends').textContent = formatNumber(totals.sent);
    document.getElementById('totalReplies').textContent = formatNumber(totals.replied);
    document.getElementById('totalPositive').textContent = totals.interested || 0;
    document.getElementById('replyRate').textContent = (totals.reply_rate || 0).toFixed(2) + '%';
    document.getElementById('positiveRate').textContent = (totals.positive_rate || 0).toFixed(3) + '%';
    document.getElementById('positiveReplyRate').textContent = (totals.positive_reply_rate || 0).toFixed(2) + '%';
    document.getElementById('mailboxCount').textContent = formatNumber(totals.mailbox_count);
    document.getElementById('currentCapacity').textContent = formatNumber(totals.current_capacity);
    document.getElementById('theoreticalMax').textContent = formatNumber(totals.theoretical_max);
    document.getElementById('positivesPerDay').textContent = (totals.positives_per_day || 0).toFixed(1);
}

// Update infra comparison table
function updateInfraTable(byInfra) {
    const tbody = document.getElementById('infraTableBody');
    tbody.innerHTML = '';
    
    // Sort by sends descending
    const sorted = Object.entries(byInfra)
        .sort((a, b) => b[1].sent - a[1].sent);
    
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

// Update TLD tables
function updateTldTables(byTld, byInfraTld) {
    // Overall TLD table
    const tldTbody = document.getElementById('tldTableBody');
    tldTbody.innerHTML = '';
    
    const sortedTld = Object.entries(byTld || {})
        .sort((a, b) => b[1].sent - a[1].sent);
    
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
    
    // Populate infra filter dropdown
    const infraFilter = document.getElementById('infraTldFilter');
    if (infraFilter && byInfraTld) {
        const currentValue = infraFilter.value;
        infraFilter.innerHTML = '<option value="all">All Infra Types</option>';
        Object.keys(byInfraTld).sort().forEach(infra => {
            infraFilter.innerHTML += `<option value="${infra}">${infra}</option>`;
        });
        infraFilter.value = currentValue || 'all';
    }
    
    // Infra + TLD table
    updateInfraTldTable(byInfraTld, infraFilter?.value || 'all');
}

function updateInfraTldTable(byInfraTld, filter) {
    const tbody = document.getElementById('infraTldTableBody');
    tbody.innerHTML = '';
    
    if (!byInfraTld) return;
    
    const rows = [];
    for (const [infraType, tldData] of Object.entries(byInfraTld)) {
        if (filter !== 'all' && infraType !== filter) continue;
        
        for (const [tld, m] of Object.entries(tldData)) {
            rows.push({ infraType, tld, ...m });
        }
    }
    
    // Sort by sends descending
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

// Update warmup table
function updateWarmupTable(byInfra) {
    const tbody = document.getElementById('warmupTableBody');
    tbody.innerHTML = '';
    
    const sorted = Object.entries(byInfra)
        .sort((a, b) => b[1].mailbox_count - a[1].mailbox_count);
    
    for (const [infraType, m] of sorted) {
        const capacityPct = m.theoretical_max > 0 
            ? ((m.current_capacity / m.theoretical_max) * 100).toFixed(1) 
            : 0;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="${getInfraClass(infraType)}">${infraType}</td>
            <td>${m.mailbox_count || 0}</td>
            <td>${m.in_warmup || 0}</td>
            <td>${m.ready || 0}</td>
            <td>${(m.avg_warmup_limit || 0).toFixed(1)}</td>
            <td>${formatNumber(m.current_capacity || 0)}</td>
            <td>${formatNumber(m.theoretical_max || 0)}</td>
            <td>${capacityPct}%</td>
        `;
        tbody.appendChild(row);
    }
}

// Update client table with filtering
function updateClientTable(byClient, filter = 'all') {
    const tbody = document.getElementById('clientTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    // Populate filter dropdown if not done
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
    
    // Sort by client name, then by sends descending
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

// Update projections table (Maldoso, Google Reseller, Aged Outlook only)
function updateProjectionsTable(projections) {
    const tbody = document.getElementById('projectionsTableBody');
    tbody.innerHTML = '';
    
    if (!projections) return;
    
    // Sort by cost per positive (best value first)
    const sorted = Object.entries(projections)
        .sort((a, b) => (a[1].cost_per_positive || 9999) - (b[1].cost_per_positive || 9999));
    
    for (const [infraType, p] of sorted) {
        const row = document.createElement('tr');
        
        // Format cost per positive with special highlight if it's the best
        const costPerPositive = p.cost_per_positive > 0 
            ? '$' + p.cost_per_positive.toFixed(2)
            : 'N/A';
        
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

// ======================
// Bounce Tab Functions
// ======================

// Bounce type colors for charts
const bounceTypeColors = {
    'hard_bounce': '#ef4444',    // Red
    'soft_bounce': '#f59e0b',    // Yellow/Orange
    'block': '#8b5cf6',          // Purple
    'complaint': '#ec4899',       // Pink
    'unknown': '#6b7280',        // Gray
    'aggregate': '#3b82f6'       // Blue (for API aggregate data)
};

// Charts for bounce tab
let bounceTypeChart = null;
let bounceInfraChart = null;
let bounceWorkspaceChart = null;

// Update bounce overview cards
function updateBounceOverview(bounceData) {
    if (!bounceData) return;

    document.getElementById('totalBounces').textContent = formatNumber(bounceData.total);

    // Calculate hard bounces (critical)
    const hardBounces = bounceData.by_type?.hard_bounce || bounceData.by_type?.aggregate || 0;
    document.getElementById('criticalBounces').textContent = formatNumber(hardBounces);

    // Show source indicator with date context
    const sourceEl = document.getElementById('bounceDataSource');
    if (sourceEl) {
        if (bounceData.source?.includes('webhook')) {
            // Get earliest date from raw events
            let earliestDate = null;
            if (bounceData.raw && bounceData.raw.length > 0) {
                earliestDate = bounceData.raw.reduce((min, e) => {
                    const d = e.event_date || e.created_at;
                    return d && (!min || d < min) ? d : min;
                }, null);
            }
            const dateNote = earliestDate ? ` (from ${earliestDate})` : ' (from Feb 17, 2026)';
            sourceEl.textContent = bounceData.source + dateNote;
            sourceEl.className = 'source-webhook';
        } else {
            sourceEl.textContent = bounceData.source || 'unknown';
            sourceEl.className = 'source-aggregate';
        }
    }

    // Calculate blocks and soft bounces
    const blocks = bounceData.by_type?.block || 0;
    document.getElementById('invalidAddressBounces').textContent = formatNumber(blocks);

    const softBounces = bounceData.by_type?.soft_bounce || 0;
    document.getElementById('reputationBounces').textContent = formatNumber(softBounces);
}

// Update bounce type table and chart
function updateBounceTypeTable(bounceData) {
    const tbody = document.getElementById('bounceTypeTableBody');
    if (!tbody || !bounceData) return;

    tbody.innerHTML = '';
    const total = bounceData.total || 1;

    const sorted = Object.entries(bounceData.by_type || {})
        .sort((a, b) => b[1] - a[1]);

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

    // Update pie chart for bounce types
    const chartCanvas = document.getElementById('bounceTypeChart');
    if (chartCanvas && sorted.length > 0) {
        if (bounceTypeChart) bounceTypeChart.destroy();

        const labels = sorted.map(([type, _]) => formatBounceType(type));
        const data = sorted.map(([_, count]) => count);
        const colors = sorted.map(([type, _]) => bounceTypeColors[type] || '#6b7280');

        bounceTypeChart = new Chart(chartCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: '#94a3b8' }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const pct = ((ctx.raw / total) * 100).toFixed(1);
                                return `${ctx.label}: ${formatNumber(ctx.raw)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
}

// Update bounce by infra type table and chart
function updateBounceInfraTable(bounceData) {
    const tbody = document.getElementById('bounceInfraTableBody');
    if (!tbody || !bounceData) return;

    tbody.innerHTML = '';
    const total = bounceData.total || 1;

    const sorted = Object.entries(bounceData.by_infra || {})
        .sort((a, b) => b[1] - a[1]);

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

    // Update bar chart for infra types
    const chartCanvas = document.getElementById('bounceInfraChart');
    if (chartCanvas && sorted.length > 0) {
        if (bounceInfraChart) bounceInfraChart.destroy();

        const labels = sorted.map(([infra, _]) => infra);
        const data = sorted.map(([_, count]) => count);
        const colors = labels.map(l => infraColors[l] || '#6b7280');

        bounceInfraChart = new Chart(chartCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Bounces',
                    data: data,
                    backgroundColor: colors.map(c => c + '80'),
                    borderColor: colors,
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { callback: (val) => formatNumber(val) }
                    }
                }
            }
        });
    }
}

// Update bounce by workspace table and chart
function updateBounceWorkspaceTable(bounceData) {
    const tbody = document.getElementById('bounceWorkspaceTableBody');
    if (!tbody || !bounceData) return;

    tbody.innerHTML = '';
    const total = bounceData.total || 1;

    const sorted = Object.entries(bounceData.by_workspace || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15); // Top 15 workspaces

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

    // Update bar chart for workspaces
    const chartCanvas = document.getElementById('bounceWorkspaceChart');
    if (chartCanvas && sorted.length > 0) {
        if (bounceWorkspaceChart) bounceWorkspaceChart.destroy();

        const labels = sorted.map(([ws, _]) => ws.length > 15 ? ws.substring(0, 15) + '...' : ws);
        const data = sorted.map(([_, count]) => count);

        bounceWorkspaceChart = new Chart(chartCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Bounces',
                    data: data,
                    backgroundColor: '#ef444480',
                    borderColor: '#ef4444',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { callback: (val) => formatNumber(val) }
                    }
                }
            }
        });
    }
}

// Update recent bounce events table (from webhook data)
function updateBounceEventsTable(bounceData) {
    const tbody = document.getElementById('bounceEventsTableBody');
    if (!tbody || !bounceData) return;

    tbody.innerHTML = '';

    // Only show if we have raw webhook events
    if (!bounceData.raw || bounceData.raw.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="no-data">
                    No detailed bounce events yet. Set up webhooks to see individual bounces.
                </td>
            </tr>
        `;
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

// Format bounce type for display
function formatBounceType(type) {
    if (!type) return 'Unknown';
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Update all bounce tab components
async function updateBouncesTab() {
    const bounceData = await fetchBounceData();
    if (!bounceData) return;

    currentBounceData = bounceData;
    updateBounceOverview(bounceData);
    updateBounceTypeTable(bounceData);
    updateBounceInfraTable(bounceData);
    updateBounceWorkspaceTable(bounceData);
    updateBounceEventsTable(bounceData);
}

// ======================
// Domain Health Tab Functions
// ======================

// Populate domain client filter
async function populateDomainClientFilter() {
    const filter = document.getElementById('domainClientFilter');
    if (!filter || !window.SupabaseClient) return;

    const clients = await window.SupabaseClient.fetchClients();
    filter.innerHTML = '<option value="all">All Clients</option>';
    for (const client of clients) {
        filter.innerHTML += `<option value="${client}">${client}</option>`;
    }
}

// Update worst bounce rate domains table
function updateWorstBounceTable(domainData) {
    const tbody = document.getElementById('worstBounceTableBody');
    if (!tbody || !domainData) return;

    tbody.innerHTML = '';

    for (const d of (domainData.worst_bounce || []).slice(0, 30)) {
        const bounceClass = d.bounce_rate > 5 ? 'danger-cell' : d.bounce_rate > 2 ? 'warning-cell' : '';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${d.domain}</td>
            <td>${d.client}</td>
            <td class="${getInfraClass(d.infra_type)}">${d.infra_type}</td>
            <td>${d.mailbox_count}</td>
            <td>${formatNumber(d.emails_sent)}</td>
            <td>${formatNumber(d.bounces)}</td>
            <td class="${bounceClass}">${d.bounce_rate.toFixed(2)}%</td>
            <td>${d.reply_rate.toFixed(2)}%</td>
        `;
        tbody.appendChild(row);
    }
}

// Update worst reply rate domains table
function updateWorstReplyTable(domainData) {
    const tbody = document.getElementById('worstReplyTableBody');
    if (!tbody || !domainData) return;

    tbody.innerHTML = '';

    for (const d of (domainData.worst_reply || []).slice(0, 30)) {
        const replyClass = d.reply_rate < 0.5 ? 'danger-cell' : d.reply_rate < 1 ? 'warning-cell' : '';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${d.domain}</td>
            <td>${d.client}</td>
            <td class="${getInfraClass(d.infra_type)}">${d.infra_type}</td>
            <td>${d.mailbox_count}</td>
            <td>${formatNumber(d.emails_sent)}</td>
            <td>${formatNumber(d.replies)}</td>
            <td class="${replyClass}">${d.reply_rate.toFixed(2)}%</td>
            <td>${d.bounce_rate.toFixed(2)}%</td>
        `;
        tbody.appendChild(row);
    }
}

// Update best performing domains table
function updateBestDomainsTable(domainData) {
    const tbody = document.getElementById('bestDomainsTableBody');
    if (!tbody || !domainData) return;

    tbody.innerHTML = '';

    for (const d of (domainData.best_reply || []).slice(0, 30)) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${d.domain}</td>
            <td>${d.client}</td>
            <td class="${getInfraClass(d.infra_type)}">${d.infra_type}</td>
            <td>${d.mailbox_count}</td>
            <td>${formatNumber(d.emails_sent)}</td>
            <td>${formatNumber(d.replies)}</td>
            <td class="success-cell">${d.reply_rate.toFixed(2)}%</td>
            <td>${d.bounce_rate.toFixed(2)}%</td>
        `;
        tbody.appendChild(row);
    }
}

// Update all domain health tab components
async function updateDomainsTab(clientFilter = 'all') {
    const domainData = await fetchDomainData(clientFilter);
    if (!domainData) return;

    currentDomainData = domainData;
    updateWorstBounceTable(domainData);
    updateWorstReplyTable(domainData);
    updateBestDomainsTable(domainData);
}

// ======================
// Charts
// ======================

// Create/update charts
function updateCharts(byInfra) {
    // Filter to only infra with sends
    const entries = Object.entries(byInfra).filter(([_, m]) => m.sent > 0);
    const labels = entries.map(([k, _]) => k);
    const sends = entries.map(([_, m]) => m.sent);
    const positiveRates = entries.map(([_, m]) => m.positive_rate || 0);
    const colors = labels.map(l => infraColors[l] || '#6b7280');
    
    // Sends chart
    const sendsCtx = document.getElementById('sendsChart');
    if (sendsCtx) {
        if (sendsChart) sendsChart.destroy();
        
        sendsChart = new Chart(sendsCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Emails Sent',
                    data: sends,
                    backgroundColor: colors.map(c => c + '80'),
                    borderColor: colors,
                    borderWidth: 1,
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => formatNumber(ctx.raw) + ' sends'
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (val) => formatNumber(val)
                        }
                    }
                }
            }
        });
    }
    
    // Positive rate chart
    const rateCtx = document.getElementById('rateChart');
    if (rateCtx) {
        if (rateChart) rateChart.destroy();
        
        rateChart = new Chart(rateCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Positive Rate %',
                    data: positiveRates,
                    backgroundColor: colors.map(c => c + '80'),
                    borderColor: colors,
                    borderWidth: 1,
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ctx.raw.toFixed(3) + '% positive rate'
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (val) => val.toFixed(2) + '%'
                        }
                    }
                }
            }
        });
    }
}

// Update footer meta and date range display
function updateMeta(meta) {
    // Update date range next to period buttons
    const dateRangeEl = document.getElementById('dateRangeDisplay');
    if (dateRangeEl) {
        dateRangeEl.textContent = `${meta.start_date} → ${meta.end_date}`;
    }
    
    // Update footer
    document.getElementById('generatedAt').textContent = 
        new Date(meta.generated_at).toLocaleString();
}

// Show/hide loading state
function setLoading(isLoading) {
    document.getElementById('loading').style.display = isLoading ? 'block' : 'none';
    document.getElementById('tabNav').style.display = isLoading ? 'none' : 'flex';
    document.getElementById('footer').style.display = isLoading ? 'none' : 'block';
    
    // Show active tab content
    if (!isLoading) {
        switchTab(currentTab);
    } else {
        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    }
}

// Show error state
function showError(message) {
    setLoading(false);
    document.getElementById('loading').style.display = 'block';
    document.getElementById('tabNav').style.display = 'none';
    document.getElementById('loading').innerHTML = `
        <div class="error">
            <p>⚠️ ${message}</p>
            <p class="hint">Run: <code>python3 run_full_analysis.py</code> from your terminal</p>
        </div>
    `;
}

// Main load function
async function loadData(period, refresh = false) {
    currentPeriod = period;
    setLoading(true);

    // Update active button
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === period);
    });

    // Update date picker to match period
    if (!startDate && !endDate && window.SupabaseClient) {
        const days = PERIOD_DAYS[period] || 14;
        document.getElementById('endDate').value = window.SupabaseClient.getTodayDate();
        document.getElementById('startDate').value = window.SupabaseClient.getDateNDaysAgo(days);
    }

    try {
        const data = await fetchData(period, refresh);
        currentData = data;

        if (!data.totals) {
            throw new Error('No data available for this period');
        }

        // Update all sections
        updateOverview(data.totals, data.meta);
        updateInfraTable(data.by_infra || {});
        updateTldTables(data.by_tld || {}, data.by_infra_tld || {});
        updateWarmupTable(data.by_infra || {});
        updateClientTable(data.by_client || {});
        updateCharts(data.by_infra || {});
        updateMeta(data.meta || { start_date: '-', end_date: '-', days: 0, generated_at: new Date().toISOString() });

        // Load projections (pass byInfra for client-side calculation fallback)
        const projections = await fetchProjections(data.by_infra || {});
        if (projections) {
            updateProjectionsTable(projections);
        }

        // Load bounce and domain data in background
        updateBouncesTab();
        populateDomainClientFilter();
        updateDomainsTab();

        setLoading(false);
    } catch (error) {
        console.error('Error loading data:', error);
        showError(error.message);
    }
}

// Load data with custom date range
async function loadDataWithDateRange(start, end) {
    startDate = start;
    endDate = end;

    // Clear period selection
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    setLoading(true);

    try {
        const data = await window.SupabaseClient.fetchInfraPerformance(start, end);
        currentData = data;

        if (!data.totals) {
            throw new Error('No data available for this date range');
        }

        // Update all sections
        updateOverview(data.totals, data.meta);
        updateInfraTable(data.by_infra || {});
        updateTldTables(data.by_tld || {}, data.by_infra_tld || {});
        updateWarmupTable(data.by_infra || {});
        updateClientTable(data.by_client || {});
        updateCharts(data.by_infra || {});
        updateMeta(data.meta);

        // Load projections
        const projections = await fetchProjections(data.by_infra || {});
        if (projections) {
            updateProjectionsTable(projections);
        }

        // Load bounce and domain data
        updateBouncesTab();
        updateDomainsTab();

        setLoading(false);
    } catch (error) {
        console.error('Error loading data:', error);
        showError(error.message);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    // Load workspace map for bounce tab
    if (window.SupabaseClient) {
        workspaceMap = await window.SupabaseClient.fetchWorkspaces();
    }

    // Set default date values and constraints
    if (window.SupabaseClient) {
        // Latest date with collected data (based on 4:30 PM IST collection time)
        const latestDataDate = window.SupabaseClient.getLatestDataDate();
        const startDateInput = document.getElementById('startDate');
        const endDateInput = document.getElementById('endDate');

        // Set min date to DATA_START_DATE (first date we have data)
        startDateInput.min = DATA_START_DATE;
        endDateInput.min = DATA_START_DATE;

        // Set max date to latest data date (can't select dates without data)
        startDateInput.max = latestDataDate;
        endDateInput.max = latestDataDate;

        // Set default values - end at latest data date, start 14 days before that
        endDateInput.value = latestDataDate;
        const defaultStart = new Date(latestDataDate);
        defaultStart.setDate(defaultStart.getDate() - 13); // 14 days inclusive
        startDateInput.value = defaultStart.toISOString().split('T')[0];

        // Ensure start date doesn't go before DATA_START_DATE
        if (startDateInput.value < DATA_START_DATE) {
            startDateInput.value = DATA_START_DATE;
        }
    }

    // Period buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const period = btn.dataset.period;
            const comingSoon = getComingSoonPeriods();

            // Check if period is coming soon
            if (comingSoon.includes(period)) {
                const daysUntil30d = Math.ceil((new Date(DATA_START_DATE).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000));
                alert(`30-day view coming soon! We need ${daysUntil30d} more days of data. Please use 3D, 7D, or 14D for now.`);
                return;
            }

            // Reset custom date range
            startDate = null;
            endDate = null;
            loadData(period);
        });
    });

    // Update 30d button state based on data availability
    const btn30d = document.querySelector('.period-btn[data-period="30d"]');
    if (btn30d && is30dAvailable()) {
        btn30d.classList.remove('disabled');
        btn30d.title = '';
    }

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        if (startDate && endDate) {
            loadDataWithDateRange(startDate, endDate);
        } else {
            loadData(currentPeriod, true);
        }
    });

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

    // Client filter (Clients tab)
    const clientFilter = document.getElementById('clientFilter');
    if (clientFilter) {
        clientFilter.addEventListener('change', () => {
            if (currentData) {
                updateClientTable(currentData.by_client || {}, clientFilter.value);
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

    // Domain client filter
    const domainClientFilter = document.getElementById('domainClientFilter');
    const applyDomainFilterBtn = document.getElementById('applyDomainFilter');
    if (applyDomainFilterBtn) {
        applyDomainFilterBtn.addEventListener('click', () => {
            const filter = domainClientFilter?.value || 'all';
            updateDomainsTab(filter);
        });
    }

    // Initial load
    loadData('14d');
});
