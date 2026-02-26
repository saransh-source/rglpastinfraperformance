-- RGL Infra Dashboard - Workspace Configs Table
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/fxxjfgfnrywffjmxoadl/sql)

-- Table: workspace_configs (Dynamic workspace/client API key management)
-- Named workspace_configs to avoid conflict with existing 'workspaces' table
CREATE TABLE IF NOT EXISTS workspace_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    api_token VARCHAR(200) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_configs_active ON workspace_configs(is_active);

-- Insert existing workspaces from config.py
INSERT INTO workspace_configs (name, api_token, is_active) VALUES
    ('Reev', '70|oN8Dzz23OuBeaNZmxkgWoGFd1uNHxXnwPHxjvIWdce260302', true),
    ('SQA', '92|1kk1GJzDKos99Rw1N90DOnvzj4JP9AZTURjEpM8mcc358f7b', true),
    ('Baton', '29|eVEGpeOSUQ1LJiBVfe5E3Qa9bculFxHhq70UIKzYfc81d9d8', true),
    ('Loop Global', '34|jjKsti7eg9uRNP8et1JF4GzH5nF32lF6TCd5JYADa3816238', true),
    ('Loop Volta', '154|dryoXqTOmFu8EatT7JF31FeIqy4Gw7fodYKikLwe', true),
    ('Voyageur', '94|GEY5u70fx37I2njkChbrxp1Ng7mOpugHd5BcUGz4cfc2a560', true),
    ('Mobius', '136|u5U0SpOi4k60oTfTOvAfqF06Pg70BKIFi6Xj2XLy23e28d58', true),
    ('Big Think', '137|BmF6vLkIwq5ulcSfB0h326KNTHM6WzSDecMnbCqs0c6428f1', true),
    ('Kodem', '126|RW8l3aAWlNy0SV31aARsFuDM7YLcm3a2Y2YmMfQoe619ab58', true),
    ('Keep Company', '134|S2Y7bQvN7bIqGQSUwkzHFbj0BVpdj0g7eGJn5t6dffb3127c', true),
    ('Elemental TV', '125|TusTryCjoaxv4mdilfBCIvGEL300clQy9IL5cbUg952e7484', true),
    ('RGL Amir', '106|NSUddH0YLOVJgL44gl9lZ8jSLm1okkiAKQirE59tad4b5f9e', true),
    ('RGL Vera', '145|6Zh6OQhT8aPTuYKIVnntGDQS6u5g3FS0hA93cXS0fcedb8e1', true),
    ('RGL Mitul', '146|bTa2Mg8YRlXpuKtGV87LuQpTY60hTEdMKya9H2DK35afe21b', true),
    ('RGL Kim', '147|YJQW8JWL4Omt5DjBvvMKp4zSgGY8Fmq4zlSe8lxR770eb082', true),
    ('RGL Rahul', '148|I4t7TXTDwLtqasedrH0CXnnAaYCwidPMRvDIAee51a1fb410', true),
    ('RGL Saransh', '149|sylx7dHO3D1oDKSBtM82udP2wZ8sc6AnCjW0RSaNffe2219b', true),
    ('Select Hub', '172|9lGjZdMKZMMe6ntgIHgleRCQ5BJ0nSZ1lJwkdDp8ee6f8af7', true),
    ('Hey Reach', '173|eei0yQznrWHWMuZxXLtEYnnATU1JEjiN29N3Banha104a49e', true),
    ('Onramp', '179|uF36yPIzQGvz4BtEQOg4Zkw6Mrhm3UIHkp03amHKc2fe99a6', true)
ON CONFLICT (name) DO NOTHING;

-- Enable Row Level Security (RLS)
ALTER TABLE workspace_configs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by data collector)
CREATE POLICY "Service role full access" ON workspace_configs
    FOR ALL USING (true) WITH CHECK (true);

-- Allow anon role to read (dashboard needs workspace names only)
CREATE POLICY "Anon can read workspace configs" ON workspace_configs
    FOR SELECT USING (true);

-- Verify
SELECT name, is_active, created_at FROM workspace_configs ORDER BY name;
