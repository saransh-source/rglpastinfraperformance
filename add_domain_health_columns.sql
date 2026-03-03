-- Domain Health Feature - Add new columns
-- Run this in Supabase SQL Editor BEFORE deploying code changes
-- These are purely additive - no existing columns or data are touched

-- Add created_at to mailbox_snapshots (from API's mailbox creation date)
ALTER TABLE mailbox_snapshots ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- Add oldest_mailbox_date to daily_domain_stats (oldest mailbox on domain)
ALTER TABLE daily_domain_stats ADD COLUMN IF NOT EXISTS oldest_mailbox_date TIMESTAMPTZ;

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('mailbox_snapshots', 'daily_domain_stats')
AND column_name IN ('created_at', 'oldest_mailbox_date')
ORDER BY table_name, column_name;
