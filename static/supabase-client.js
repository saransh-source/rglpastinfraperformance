// Supabase Client for RGL Infra Dashboard
// Handles all database queries for dynamic data
// Updated to use new tables: daily_infra_stats, daily_domain_stats, mailbox_snapshots

const SUPABASE_URL = 'https://fxxjfgfnrywffjmxoadl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4eGpmZ2Zucnl3ZmZqbXhvYWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MTg4MzUsImV4cCI6MjA3OTE5NDgzNX0.i3CdO1d81qn8IuVM9nbCiFseIaVqPpNAIuVVE9JH8U8';

// Initialize Supabase client - use the global supabase from CDN
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Tracked infra types (matching config.py - raw tag names, no merging)
const TRACKED_INFRA_TYPES = [
    'GR',
    'GR - N',
    'G-Vis',
    'Google',
    'AO',
    'OD',
    'L',
    'MD SMTP',
    'Outlook',
    'New Outlook',
    'WR SMTP',
    'Gpan',
    'Everwarm'
];

// Max limits per infra type for capacity calculations
const INFRA_MAX_LIMITS = {
    'GR': 20,
    'GR - N': 20,
    'G-Vis': 20,
    'Google': 20,
    'AO': 10,
    'OD': 10,
    'L': 2,
    'MD SMTP': 15,
    'Outlook': 10,
    'New Outlook': 10,
    'WR SMTP': 10,
    'Gpan': 20,
    'Everwarm': 15
};

// ======================
// Date Range Query Functions
// ======================

/**
 * Fetch all rows from a table with pagination (bypasses 1000-row limit)
 * @param {string} table - Table name
 * @param {string} startDate - YYYY-MM-DD format
 * @param {string} endDate - YYYY-MM-DD format
 * @param {number} batchSize - Rows per batch (default 1000)
 * @returns {Promise<Array>} - All rows
 */
async function fetchAllRows(table, startDate, endDate, batchSize = 1000) {
    let allData = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabaseClient
            .from(table)
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date', { ascending: false })
            .range(offset, offset + batchSize - 1);

        if (error) {
            console.error(`Error fetching ${table} at offset ${offset}:`, error);
            break;
        }

        if (data && data.length > 0) {
            allData = allData.concat(data);
            offset += batchSize;
            hasMore = data.length === batchSize;
        } else {
            hasMore = false;
        }
    }

    return allData;
}

/**
 * Fetch infrastructure performance data for a date range
 * Uses new daily_infra_stats table
 * @param {string} startDate - YYYY-MM-DD format
 * @param {string} endDate - YYYY-MM-DD format
 * @returns {Promise<Object>} - Aggregated data by infra type and client
 */
async function fetchInfraPerformance(startDate, endDate) {
    console.log(`Fetching infra performance from ${startDate} to ${endDate}`);

    // Fetch infra stats and domain stats with pagination to bypass 1000-row limit
    const [infraData, domainData] = await Promise.all([
        fetchAllRows('daily_infra_stats', startDate, endDate),
        fetchAllRows('daily_domain_stats', startDate, endDate)
    ]);

    // Convert to result format expected by rest of code
    const infraResult = { data: infraData, error: null };
    const domainResult = { data: domainData, error: null };

    console.log(`Fetched ${infraData.length} infra records, ${domainData.length} domain records`);

    if (!infraResult.data || infraResult.data.length === 0) {
        console.log('No historical data found, using mailbox_snapshots');
        return fetchFromMailboxSnapshots();
    }

    // Aggregate TLD data from domain stats (using latest available data)
    const byTld = {};
    let tldDataDate = null;
    if (domainResult.data && domainResult.data.length > 0) {
        // Get the date of the TLD data we're using
        tldDataDate = domainResult.data[0].date;
        console.log(`Found ${domainResult.data.length} daily_domain_stats records for TLD analysis (from ${tldDataDate})`);

        for (const row of domainResult.data) {
            const tld = row.tld || 'unknown';
            if (!byTld[tld]) {
                byTld[tld] = {
                    mailbox_count: 0,
                    domain_count: 0,
                    domains: new Set(),
                    sent: 0,
                    replied: 0,
                    bounced: 0,
                    interested: 0
                };
            }
            byTld[tld].sent += row.emails_sent || 0;
            byTld[tld].replied += row.replies || 0;
            byTld[tld].bounced += row.bounces || 0;
            byTld[tld].interested += row.interested || 0;
            byTld[tld].mailbox_count += row.mailbox_count || 0;
            byTld[tld].domains.add(row.domain);
        }

        // Calculate rates for TLD
        for (const m of Object.values(byTld)) {
            m.domain_count = m.domains.size;
            delete m.domains;
            m.reply_rate = m.sent > 0 ? (m.replied / m.sent) * 100 : 0;
            m.positive_rate = m.sent > 0 ? (m.interested / m.sent) * 100 : 0;
            m.bounce_rate = m.sent > 0 ? (m.bounced / m.sent) * 100 : 0;
            m.positive_reply_rate = m.replied > 0 ? (m.interested / m.replied) * 100 : 0;
        }
    }

    // Build byInfraTld - TLD breakdown per infra type
    const byInfraTld = {};
    if (domainResult.data && domainResult.data.length > 0) {
        for (const row of domainResult.data) {
            const infraType = row.infra_type;
            const tld = row.tld || 'unknown';

            if (!infraType) continue;

            if (!byInfraTld[infraType]) {
                byInfraTld[infraType] = {};
            }
            if (!byInfraTld[infraType][tld]) {
                byInfraTld[infraType][tld] = {
                    mailbox_count: 0,
                    domain_count: 0,
                    domains: new Set(),
                    sent: 0,
                    replied: 0,
                    bounced: 0,
                    interested: 0
                };
            }

            byInfraTld[infraType][tld].sent += row.emails_sent || 0;
            byInfraTld[infraType][tld].replied += row.replies || 0;
            byInfraTld[infraType][tld].bounced += row.bounces || 0;
            byInfraTld[infraType][tld].interested += row.interested || 0;
            byInfraTld[infraType][tld].mailbox_count += row.mailbox_count || 0;
            byInfraTld[infraType][tld].domains.add(row.domain);
        }

        // Calculate rates for each infra+TLD combo
        for (const infraData of Object.values(byInfraTld)) {
            for (const m of Object.values(infraData)) {
                m.domain_count = m.domains.size;
                delete m.domains;
                m.reply_rate = m.sent > 0 ? (m.replied / m.sent) * 100 : 0;
                m.positive_rate = m.sent > 0 ? (m.interested / m.sent) * 100 : 0;
                m.bounce_rate = m.sent > 0 ? (m.bounced / m.sent) * 100 : 0;
                m.positive_reply_rate = m.replied > 0 ? (m.interested / m.replied) * 100 : 0;
            }
        }
    }

    const result = aggregateInfraStats(infraResult.data, startDate, endDate);
    result.by_tld = byTld;
    result.by_infra_tld = byInfraTld;
    return result;
}

/**
 * Fallback: Aggregate from mailbox_snapshots (current snapshot)
 */
async function fetchFromMailboxSnapshots() {
    const { data, error } = await supabaseClient
        .from('mailbox_snapshots')
        .select('*');

    if (error) {
        console.error('Error fetching mailbox_snapshots:', error);
        throw error;
    }

    return aggregateMailboxSnapshots(data);
}

/**
 * Aggregate daily_infra_stats data into dashboard format
 * Stats (sent, replied, etc.) are summed across dates
 * Counts (mailboxes, capacity) are taken from the most recent date only
 */
function aggregateInfraStats(data, startDate, endDate) {
    const byInfra = {};
    const byClient = {};
    const byTld = {};
    const totals = {
        sent: 0,
        replied: 0,
        bounced: 0,
        interested: 0,
        mailbox_count: 0,
        domain_count: 0,
        current_capacity: 0,
        theoretical_max: 0,
        in_warmup: 0
    };

    // Get unique dates for day count
    const uniqueDates = new Set(data.map(r => r.date));
    const numDays = uniqueDates.size || 1;

    // Find the most recent date for getting mailbox/capacity counts
    const mostRecentDate = [...uniqueDates].sort().reverse()[0];

    // Aggregate by infra type
    // - Stats (sent, replied, etc.) sum across all dates
    // - Counts (mailboxes, capacity) only from most recent date
    for (const row of data) {
        const infraType = row.infra_type;
        const workspaceName = row.workspace_name;
        const isLatestDate = row.date === mostRecentDate;

        if (!byInfra[infraType]) {
            byInfra[infraType] = {
                mailbox_count: 0,
                domain_count: 0,
                sent: 0,
                replied: 0,
                bounced: 0,
                interested: 0,
                current_capacity: 0,
                theoretical_max: 0,
                in_warmup: 0,
                ready: 0,
                avg_warmup_limit: 0,
                workspaces: new Set()
            };
        }

        // Sum stats across all dates
        byInfra[infraType].sent += row.emails_sent || 0;
        byInfra[infraType].replied += row.replies || 0;
        byInfra[infraType].bounced += row.bounces || 0;
        byInfra[infraType].interested += row.interested || 0;
        byInfra[infraType].workspaces.add(workspaceName);

        // Only count mailboxes/capacity from the most recent date
        if (isLatestDate) {
            byInfra[infraType].mailbox_count += row.mailbox_count || 0;
            byInfra[infraType].domain_count += row.domain_count || 0;
            byInfra[infraType].current_capacity += row.current_capacity || 0;
            byInfra[infraType].theoretical_max += row.theoretical_max || 0;
            byInfra[infraType].in_warmup += row.in_warmup || 0;
        }

        // Aggregate by client (workspace)
        if (!byClient[workspaceName]) {
            byClient[workspaceName] = {};
        }
        if (!byClient[workspaceName][infraType]) {
            byClient[workspaceName][infraType] = {
                mailbox_count: 0,
                domain_count: 0,
                sent: 0,
                replied: 0,
                bounced: 0,
                interested: 0,
                current_capacity: 0
            };
        }
        // Sum stats across all dates
        byClient[workspaceName][infraType].sent += row.emails_sent || 0;
        byClient[workspaceName][infraType].replied += row.replies || 0;
        byClient[workspaceName][infraType].bounced += row.bounces || 0;
        byClient[workspaceName][infraType].interested += row.interested || 0;

        // Only count mailboxes/capacity from the most recent date
        if (isLatestDate) {
            byClient[workspaceName][infraType].mailbox_count += row.mailbox_count || 0;
            byClient[workspaceName][infraType].domain_count += row.domain_count || 0;
            byClient[workspaceName][infraType].current_capacity += row.current_capacity || 0;
        }

        // Update totals - stats sum across dates, counts only from latest date
        totals.sent += row.emails_sent || 0;
        totals.replied += row.replies || 0;
        totals.bounced += row.bounces || 0;
        totals.interested += row.interested || 0;

        if (isLatestDate) {
            totals.mailbox_count += row.mailbox_count || 0;
            totals.domain_count += row.domain_count || 0;
            totals.current_capacity += row.current_capacity || 0;
            totals.theoretical_max += row.theoretical_max || 0;
            totals.in_warmup += row.in_warmup || 0;
        }
    }

    // Calculate rates for each infra type
    for (const [infraType, m] of Object.entries(byInfra)) {
        m.workspace_count = m.workspaces.size;
        delete m.workspaces;
        m.reply_rate = m.sent > 0 ? (m.replied / m.sent) * 100 : 0;
        m.positive_rate = m.sent > 0 ? (m.interested / m.sent) * 100 : 0;
        m.bounce_rate = m.sent > 0 ? (m.bounced / m.sent) * 100 : 0;
        m.positive_reply_rate = m.replied > 0 ? (m.interested / m.replied) * 100 : 0;
        m.avg_sends_per_mailbox_per_day = m.mailbox_count > 0 ? m.sent / m.mailbox_count / numDays : 0;
        m.positives_per_day = m.interested / numDays;
        // Calculate ready (not in warmup) = mailbox_count - in_warmup
        m.ready = (m.mailbox_count || 0) - (m.in_warmup || 0);
    }

    // Calculate rates for each client/infra combo
    for (const clientData of Object.values(byClient)) {
        for (const m of Object.values(clientData)) {
            m.reply_rate = m.sent > 0 ? (m.replied / m.sent) * 100 : 0;
            m.positive_rate = m.sent > 0 ? (m.interested / m.sent) * 100 : 0;
            m.bounce_rate = m.sent > 0 ? (m.bounced / m.sent) * 100 : 0;
            m.positive_reply_rate = m.replied > 0 ? (m.interested / m.replied) * 100 : 0;
        }
    }

    // Calculate totals rates
    totals.reply_rate = totals.sent > 0 ? (totals.replied / totals.sent) * 100 : 0;
    totals.positive_rate = totals.sent > 0 ? (totals.interested / totals.sent) * 100 : 0;
    totals.bounce_rate = totals.sent > 0 ? (totals.bounced / totals.sent) * 100 : 0;
    totals.positive_reply_rate = totals.replied > 0 ? (totals.interested / totals.replied) * 100 : 0;
    totals.positives_per_day = totals.interested / numDays;

    return {
        by_infra: byInfra,
        by_client: byClient,
        by_tld: byTld,
        by_infra_tld: {},
        totals: totals,
        meta: {
            start_date: startDate,
            end_date: endDate,
            days: numDays,
            generated_at: new Date().toISOString(),
            source: 'daily_infra_stats'
        }
    };
}

/**
 * Aggregate mailbox_snapshots data (fallback for current snapshot)
 */
function aggregateMailboxSnapshots(data) {
    const byInfra = {};
    const byClient = {};
    const byTld = {};
    const allDomains = new Set();
    const totals = {
        sent: 0,
        replied: 0,
        bounced: 0,
        interested: 0,
        mailbox_count: 0,
        domain_count: 0,
        current_capacity: 0,
        theoretical_max: 0,
        in_warmup: 0
    };

    for (const row of data) {
        const infraType = row.infra_type;
        const workspaceName = row.workspace_name;
        const domain = row.domain || '';
        const tld = row.tld || '';

        allDomains.add(domain);
        totals.sent += row.emails_sent || 0;
        totals.replied += row.replies || 0;
        totals.bounced += row.bounces || 0;
        totals.interested += row.interested || 0;
        totals.mailbox_count += 1;
        totals.current_capacity += row.daily_limit || 0;
        totals.theoretical_max += INFRA_MAX_LIMITS[infraType] || 10;
        if (row.warmup_enabled) totals.in_warmup += 1;

        // Aggregate by infra type
        if (!byInfra[infraType]) {
            byInfra[infraType] = {
                mailbox_count: 0,
                domain_count: 0,
                domains: new Set(),
                sent: 0,
                replied: 0,
                bounced: 0,
                interested: 0,
                current_capacity: 0,
                theoretical_max: 0,
                in_warmup: 0,
                ready: 0,
                avg_warmup_limit: 0
            };
        }
        byInfra[infraType].sent += row.emails_sent || 0;
        byInfra[infraType].replied += row.replies || 0;
        byInfra[infraType].bounced += row.bounces || 0;
        byInfra[infraType].interested += row.interested || 0;
        byInfra[infraType].mailbox_count += 1;
        byInfra[infraType].domains.add(domain);
        byInfra[infraType].current_capacity += row.daily_limit || 0;
        byInfra[infraType].theoretical_max += INFRA_MAX_LIMITS[infraType] || 10;
        if (row.warmup_enabled) byInfra[infraType].in_warmup += 1;

        // Aggregate by TLD
        if (tld) {
            if (!byTld[tld]) {
                byTld[tld] = {
                    mailbox_count: 0,
                    domain_count: 0,
                    domains: new Set(),
                    sent: 0,
                    replied: 0,
                    bounced: 0,
                    interested: 0
                };
            }
            byTld[tld].sent += row.emails_sent || 0;
            byTld[tld].replied += row.replies || 0;
            byTld[tld].bounced += row.bounces || 0;
            byTld[tld].interested += row.interested || 0;
            byTld[tld].mailbox_count += 1;
            byTld[tld].domains.add(domain);
        }

        // Aggregate by client (workspace)
        if (!byClient[workspaceName]) {
            byClient[workspaceName] = {};
        }
        if (!byClient[workspaceName][infraType]) {
            byClient[workspaceName][infraType] = {
                mailbox_count: 0,
                domain_count: 0,
                domains: new Set(),
                sent: 0,
                replied: 0,
                bounced: 0,
                interested: 0,
                current_capacity: 0
            };
        }
        byClient[workspaceName][infraType].sent += row.emails_sent || 0;
        byClient[workspaceName][infraType].replied += row.replies || 0;
        byClient[workspaceName][infraType].bounced += row.bounces || 0;
        byClient[workspaceName][infraType].interested += row.interested || 0;
        byClient[workspaceName][infraType].mailbox_count += 1;
        byClient[workspaceName][infraType].domains.add(domain);
        byClient[workspaceName][infraType].current_capacity += row.daily_limit || 0;
    }

    // Convert domain Sets to counts and calculate rates
    const numDays = 30; // Snapshot represents 30-day data

    for (const [infraType, m] of Object.entries(byInfra)) {
        m.domain_count = m.domains.size;
        delete m.domains;
        m.reply_rate = m.sent > 0 ? (m.replied / m.sent) * 100 : 0;
        m.positive_rate = m.sent > 0 ? (m.interested / m.sent) * 100 : 0;
        m.bounce_rate = m.sent > 0 ? (m.bounced / m.sent) * 100 : 0;
        m.positive_reply_rate = m.replied > 0 ? (m.interested / m.replied) * 100 : 0;
        m.avg_sends_per_mailbox_per_day = m.mailbox_count > 0 ? m.sent / m.mailbox_count / numDays : 0;
        m.positives_per_day = m.interested / numDays;
    }

    for (const [tld, m] of Object.entries(byTld)) {
        m.domain_count = m.domains.size;
        delete m.domains;
        m.reply_rate = m.sent > 0 ? (m.replied / m.sent) * 100 : 0;
        m.positive_rate = m.sent > 0 ? (m.interested / m.sent) * 100 : 0;
        m.bounce_rate = m.sent > 0 ? (m.bounced / m.sent) * 100 : 0;
        m.positive_reply_rate = m.replied > 0 ? (m.interested / m.replied) * 100 : 0;
    }

    for (const clientData of Object.values(byClient)) {
        for (const m of Object.values(clientData)) {
            m.domain_count = m.domains.size;
            delete m.domains;
            m.reply_rate = m.sent > 0 ? (m.replied / m.sent) * 100 : 0;
            m.positive_rate = m.sent > 0 ? (m.interested / m.sent) * 100 : 0;
            m.bounce_rate = m.sent > 0 ? (m.bounced / m.sent) * 100 : 0;
            m.positive_reply_rate = m.replied > 0 ? (m.interested / m.replied) * 100 : 0;
        }
    }

    // Calculate totals rates
    totals.domain_count = allDomains.size;
    totals.reply_rate = totals.sent > 0 ? (totals.replied / totals.sent) * 100 : 0;
    totals.positive_rate = totals.sent > 0 ? (totals.interested / totals.sent) * 100 : 0;
    totals.bounce_rate = totals.sent > 0 ? (totals.bounced / totals.sent) * 100 : 0;
    totals.positive_reply_rate = totals.replied > 0 ? (totals.interested / totals.replied) * 100 : 0;
    totals.positives_per_day = totals.interested / numDays;

    return {
        by_infra: byInfra,
        by_client: byClient,
        by_tld: byTld,
        by_infra_tld: {},
        totals: totals,
        meta: {
            start_date: getDateNDaysAgo(30),
            end_date: getTodayDate(),
            days: numDays,
            generated_at: new Date().toISOString(),
            source: 'mailbox_snapshots (current snapshot)'
        }
    };
}

// ======================
// Domain Health Functions
// ======================

/**
 * Fetch domain performance from daily_domain_stats with pagination
 * @param {string} clientFilter - Optional client (workspace) filter
 * @returns {Promise<Object>} - Domain performance data
 */
async function fetchDomainHealth(clientFilter = null) {
    // Use pagination to get all domain stats (bypasses 1000-row limit)
    let allData = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
        let query = supabaseClient
            .from('daily_domain_stats')
            .select('*')
            .gt('emails_sent', 0)
            .range(offset, offset + batchSize - 1);

        if (clientFilter && clientFilter !== 'all') {
            query = query.eq('workspace_name', clientFilter);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching domain health at offset', offset, ':', error);
            break;
        }

        if (data && data.length > 0) {
            allData = allData.concat(data);
            offset += batchSize;
            hasMore = data.length === batchSize;
        } else {
            hasMore = false;
        }
    }

    console.log(`Fetched ${allData.length} domain health records`);
    return aggregateDomainHealth(allData);
}

/**
 * Aggregate domain-level metrics
 */
function aggregateDomainHealth(data) {
    const domainMap = {};

    for (const row of data) {
        const domain = row.domain;
        const workspace = row.workspace_name;
        const key = `${domain}|${workspace}`;

        if (!domainMap[key]) {
            domainMap[key] = {
                domain,
                client: workspace,
                infra_type: row.infra_type,
                tld: row.tld,
                mailbox_count: 0,
                emails_sent: 0,
                replies: 0,
                bounces: 0,
                interested: 0
            };
        }

        domainMap[key].mailbox_count += row.mailbox_count || 0;
        domainMap[key].emails_sent += row.emails_sent || 0;
        domainMap[key].replies += row.replies || 0;
        domainMap[key].bounces += row.bounces || 0;
        domainMap[key].interested += row.interested || 0;
    }

    // Calculate rates and convert to array
    const domains = Object.values(domainMap).map(d => ({
        ...d,
        reply_rate: d.emails_sent > 0 ? (d.replies / d.emails_sent) * 100 : 0,
        bounce_rate: d.emails_sent > 0 ? (d.bounces / d.emails_sent) * 100 : 0,
        positive_rate: d.emails_sent > 0 ? (d.interested / d.emails_sent) * 100 : 0
    }));

    // Sort by bounce rate descending for worst domains
    const worstByBounce = [...domains]
        .filter(d => d.emails_sent >= 100) // Min 100 sends
        .sort((a, b) => b.bounce_rate - a.bounce_rate)
        .slice(0, 50);

    // Sort by reply rate ascending for worst reply rate
    const worstByReply = [...domains]
        .filter(d => d.emails_sent >= 100)
        .sort((a, b) => a.reply_rate - b.reply_rate)
        .slice(0, 50);

    // Sort by reply rate descending for best domains
    const bestByReply = [...domains]
        .filter(d => d.emails_sent >= 100)
        .sort((a, b) => b.reply_rate - a.reply_rate)
        .slice(0, 50);

    return {
        all: domains,
        worst_bounce: worstByBounce,
        worst_reply: worstByReply,
        best_reply: bestByReply
    };
}

/**
 * Get unique clients (workspaces) for filter dropdown
 */
async function fetchClients() {
    const { data, error } = await supabaseClient
        .from('daily_infra_stats')
        .select('workspace_name');

    if (error) {
        console.error('Error fetching clients:', error);
        return [];
    }

    // Get unique workspaces
    const clients = [...new Set(data.map(d => d.workspace_name))].filter(c => c).sort();
    return clients;
}

// ======================
// Bounce Query Functions
// ======================

/**
 * Fetch bounce events with breakdown from bounce_events table (webhook data)
 * Falls back to aggregate bounces from daily_infra_stats if no webhook data
 * @param {string} startDate - YYYY-MM-DD format
 * @param {string} endDate - YYYY-MM-DD format
 * @returns {Promise<Object>} - Bounce breakdown by type, workspace, infra
 */
async function fetchBounces(startDate, endDate) {
    // Try to fetch from bounce_events table (webhook-collected detailed data)
    const { data: bounceEvents, error: bounceError } = await supabaseClient
        .from('bounce_events')
        .select('event_date, workspace_name, infra_type, bounce_type, sender_domain')
        .gte('event_date', startDate)
        .lte('event_date', endDate);

    // If bounce_events table exists and has data, use it
    if (!bounceError && bounceEvents && bounceEvents.length > 0) {
        console.log(`Found ${bounceEvents.length} detailed bounce events from webhook`);

        const byType = {};
        const byWorkspace = {};
        const byInfra = {};
        const byDomain = {};

        for (const row of bounceEvents) {
            // By bounce type
            const type = row.bounce_type || 'unknown';
            byType[type] = (byType[type] || 0) + 1;

            // By workspace
            const ws = row.workspace_name || 'Unknown';
            byWorkspace[ws] = (byWorkspace[ws] || 0) + 1;

            // By infra type
            const infra = row.infra_type || 'Unknown';
            byInfra[infra] = (byInfra[infra] || 0) + 1;

            // By sender domain
            const domain = row.sender_domain || 'unknown';
            byDomain[domain] = (byDomain[domain] || 0) + 1;
        }

        return {
            total: bounceEvents.length,
            by_type: byType,
            by_workspace: byWorkspace,
            by_infra: byInfra,
            by_domain: byDomain,
            source: 'bounce_events (webhook)',
            raw: bounceEvents
        };
    }

    // Fall back to aggregate bounces from daily_infra_stats
    console.log('No webhook bounce data, using aggregate bounces from daily_infra_stats');

    const { data: infraData, error: infraError } = await supabaseClient
        .from('daily_infra_stats')
        .select('workspace_name, infra_type, bounces')
        .gte('date', startDate)
        .lte('date', endDate);

    if (infraError) {
        console.error('Error fetching bounces from daily_infra_stats:', infraError);
        return {
            total: 0,
            by_type: {},
            by_workspace: {},
            by_infra: {},
            by_domain: {},
            source: 'none',
            raw: []
        };
    }

    const byWorkspace = {};
    const byInfra = {};
    let total = 0;

    for (const row of infraData) {
        const bounces = row.bounces || 0;
        total += bounces;

        const ws = row.workspace_name || 'Unknown';
        byWorkspace[ws] = (byWorkspace[ws] || 0) + bounces;

        const infra = row.infra_type || 'Unknown';
        byInfra[infra] = (byInfra[infra] || 0) + bounces;
    }

    return {
        total,
        by_type: { 'aggregate': total }, // No type breakdown from API
        by_workspace: byWorkspace,
        by_infra: byInfra,
        by_domain: {},
        source: 'daily_infra_stats (aggregate)',
        raw: []
    };
}

/**
 * Fetch bounce breakdown by infra type (legacy function for compatibility)
 */
async function fetchBounceBreakdown() {
    // Get bounce totals from daily_infra_stats grouped by infra_type
    const { data, error } = await supabaseClient
        .from('daily_infra_stats')
        .select('infra_type, bounces, workspace_name');

    if (error) {
        console.error('Error fetching bounce breakdown:', error);
        return null;
    }

    // Aggregate bounces by infra type
    const byInfra = {};
    for (const row of data) {
        const infra = row.infra_type;
        if (!byInfra[infra]) {
            byInfra[infra] = 0;
        }
        byInfra[infra] += row.bounces || 0;
    }

    return Object.entries(byInfra).map(([infra_type, count]) => ({
        infra_type,
        bounce_count: count
    }));
}

/**
 * Fetch workspaces for mapping
 */
async function fetchWorkspaces() {
    const { data, error } = await supabaseClient
        .from('daily_infra_stats')
        .select('workspace_name');

    if (error) {
        console.error('Error fetching workspaces:', error);
        return {};
    }

    const workspaceMap = {};
    const uniqueWorkspaces = [...new Set(data.map(d => d.workspace_name))];
    for (const name of uniqueWorkspaces) {
        workspaceMap[name] = name;
    }
    return workspaceMap;
}

// ======================
// Utility Functions
// ======================

/**
 * Get the most recent date with collected data.
 * Data is collected at 4:30 PM IST (11:00 UTC) daily.
 * Before collection time: latest data is from 2 days ago
 * After collection time: latest data is from yesterday
 * @returns {string} - YYYY-MM-DD format
 */
function getLatestDataDate() {
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const istOffset = 5.5 * 60; // minutes
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istMinutes = utcMinutes + istOffset;
    const istHour = Math.floor(istMinutes / 60) % 24;
    const istMinute = istMinutes % 60;

    // Collection happens at 4:30 PM IST (16:30)
    const collectionTime = 16 * 60 + 30; // 16:30 in minutes
    const currentIstTime = istHour * 60 + istMinute;

    // If before 4:30 PM IST, yesterday's data hasn't been collected yet
    // So latest available is 2 days ago
    // If after 4:30 PM IST, yesterday's data is available
    const daysBack = currentIstTime < collectionTime ? 2 : 1;

    const date = new Date();
    date.setDate(date.getDate() - daysBack);
    return date.toISOString().split('T')[0];
}

/**
 * Get date string for N days before the latest data date
 * @param {number} days - Number of days to include
 * @returns {string} - YYYY-MM-DD format (start date for the range)
 */
function getDateNDaysAgo(days) {
    const latestDate = new Date(getLatestDataDate());
    latestDate.setDate(latestDate.getDate() - days + 1); // +1 because end date is inclusive
    return latestDate.toISOString().split('T')[0];
}

/**
 * Get yesterday's date
 * @returns {string} - YYYY-MM-DD format
 */
function getYesterdayDate() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
}

/**
 * Get today's date
 * @returns {string} - YYYY-MM-DD format
 */
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Normalize infra type (for backward compatibility)
 */
function normalizeInfraType(tag) {
    return tag || 'Unknown';
}

// Export functions for use in app.js
window.SupabaseClient = {
    fetchInfraPerformance,
    fetchBounces,
    fetchBounceBreakdown,
    fetchDomainHealth,
    fetchClients,
    fetchWorkspaces,
    getDateNDaysAgo,
    getLatestDataDate,
    getYesterdayDate,
    getTodayDate,
    normalizeInfraType
};
