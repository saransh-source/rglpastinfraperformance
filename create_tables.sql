-- RGL Infra Dashboard - New Tables
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/fxxjfgfnrywffjmxoadl/sql)

-- Table 1: mailbox_snapshots (Current state per mailbox)
CREATE TABLE IF NOT EXISTS mailbox_snapshots (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    domain VARCHAR(255) NOT NULL,
    tld VARCHAR(20),
    workspace_name VARCHAR(100) NOT NULL,
    infra_type VARCHAR(50) NOT NULL,

    -- Stats (cumulative totals from API)
    emails_sent INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    bounces INTEGER DEFAULT 0,
    interested INTEGER DEFAULT 0,

    -- Capacity fields
    daily_limit INTEGER DEFAULT 0,
    warmup_enabled BOOLEAN DEFAULT FALSE,
    warmup_daily_limit INTEGER DEFAULT 0,

    -- Metadata
    external_id INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mailbox_workspace ON mailbox_snapshots(workspace_name);
CREATE INDEX IF NOT EXISTS idx_mailbox_infra ON mailbox_snapshots(infra_type);
CREATE INDEX IF NOT EXISTS idx_mailbox_domain ON mailbox_snapshots(domain);

-- Table 2: daily_infra_stats (Historical daily aggregates by workspace + infra)
CREATE TABLE IF NOT EXISTS daily_infra_stats (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    workspace_name VARCHAR(100) NOT NULL,
    infra_type VARCHAR(50) NOT NULL,

    -- Counts
    mailbox_count INTEGER DEFAULT 0,
    domain_count INTEGER DEFAULT 0,

    -- Stats
    emails_sent INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    bounces INTEGER DEFAULT 0,
    interested INTEGER DEFAULT 0,

    -- Capacity
    current_capacity INTEGER DEFAULT 0,
    theoretical_max INTEGER DEFAULT 0,
    in_warmup INTEGER DEFAULT 0,

    -- Calculated rates (stored for quick queries)
    reply_rate DECIMAL(8,4) DEFAULT 0,
    bounce_rate DECIMAL(8,4) DEFAULT 0,
    positive_rate DECIMAL(8,4) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date, workspace_name, infra_type)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_infra_stats(date);
CREATE INDEX IF NOT EXISTS idx_daily_stats_workspace ON daily_infra_stats(workspace_name);
CREATE INDEX IF NOT EXISTS idx_daily_stats_infra ON daily_infra_stats(infra_type);

-- Table 3: daily_domain_stats (Domain-level daily tracking for health analysis)
CREATE TABLE IF NOT EXISTS daily_domain_stats (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    domain VARCHAR(255) NOT NULL,
    workspace_name VARCHAR(100) NOT NULL,
    infra_type VARCHAR(50) NOT NULL,
    tld VARCHAR(20),

    mailbox_count INTEGER DEFAULT 0,
    emails_sent INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    bounces INTEGER DEFAULT 0,
    interested INTEGER DEFAULT 0,

    reply_rate DECIMAL(8,4) DEFAULT 0,
    bounce_rate DECIMAL(8,4) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date, domain, workspace_name)
);

CREATE INDEX IF NOT EXISTS idx_domain_stats_date ON daily_domain_stats(date);
CREATE INDEX IF NOT EXISTS idx_domain_stats_bounce ON daily_domain_stats(bounce_rate DESC);
CREATE INDEX IF NOT EXISTS idx_domain_stats_workspace ON daily_domain_stats(workspace_name);

-- Verify tables created
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('mailbox_snapshots', 'daily_infra_stats', 'daily_domain_stats');
