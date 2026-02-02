// RGL Infra Performance Dashboard - JavaScript

let currentPeriod = '14d';
let currentTab = 'overview';
let sendsChart = null;
let rateChart = null;
let currentData = null;

// Chart.js global config
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#2d3748';
Chart.defaults.font.family = "'Inter', sans-serif";

// Color palette for infra types
const infraColors = {
    'Maldoso': '#10b981',
    'Google Reseller': '#3b82f6',
    'Aged Outlook': '#8b5cf6',
    'Legacy Panel': '#f59e0b',
    'Outlook': '#ef4444',
    'Winnr SMTP': '#ec4899',
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

// Fetch data - try API first, fallback to static JSON
async function fetchData(period, refresh = false) {
    try {
        // Try API endpoint first (for local development)
        const apiUrl = `/api/analyze?period=${period}${refresh ? '&refresh=true' : ''}`;
        const response = await fetch(apiUrl);
        if (response.ok) {
            const data = await response.json();
            if (data && data.totals) {
                return data;
            }
        }
    } catch (e) {
        console.log('API not available, using static data');
    }
    
    // Fallback to static JSON file (for Vercel/static hosting)
    const staticUrl = `/static/data.json`;
    const response = await fetch(staticUrl);
    if (!response.ok) {
        throw new Error('Failed to load data');
    }
    const allData = await response.json();
    return allData[period] || allData['14d'] || {};
}

// Fetch projections - calculate from current data
async function fetchProjections(byInfra) {
    try {
        const response = await fetch('/api/projections');
        if (response.ok) {
            const data = await response.json();
            if (data && Object.keys(data).length > 0) {
                return data;
            }
        }
    } catch (e) {
        console.log('Projections endpoint not available, calculating client-side');
    }
    
    // Calculate projections client-side
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

// Update footer meta
function updateMeta(meta) {
    document.getElementById('dataPeriod').textContent = 
        `${meta.start_date} to ${meta.end_date} (${meta.days} days)`;
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
        
        setLoading(false);
    } catch (error) {
        console.error('Error loading data:', error);
        showError(error.message);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Period buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => loadData(btn.dataset.period));
    });
    
    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        await fetch('/api/refresh');
        loadData(currentPeriod, true);
    });
    
    // Client filter
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
    
    // Initial load
    loadData('14d');
});
