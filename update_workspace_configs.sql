-- Update workspace_configs with latest active client list
-- Run this in Supabase SQL Editor

-- Step 1: Mark ALL existing workspaces as inactive first
UPDATE workspace_configs SET is_active = false, updated_at = NOW();

-- Step 2: Upsert all active workspaces (insert new ones, update existing)
INSERT INTO workspace_configs (name, api_token, is_active, updated_at) VALUES
    ('Reev', '70|oN8Dzz23OuBeaNZmxkgWoGFd1uNHxXnwPHxjvIWdce260302', true, NOW()),
    ('Baton', '29|eVEGpeOSUQ1LJiBVfe5E3Qa9bculFxHhq70UIKzYfc81d9d8', true, NOW()),
    ('Boost', '201|P3SgIm2tn7b4KFr9j1hB5q0pVvxq384nmhrPdzvb9e966e2e', true, NOW()),
    ('Loop Global', '34|jjKsti7eg9uRNP8et1JF4GzH5nF32lF6TCd5JYADa3816238', true, NOW()),
    ('Loop Volta', '154|dryoXqTOmFu8EatT7JF31FeIqy4Gw7fodYKikLwe30265610', true, NOW()),
    ('Voyageur', '94|GEY5u70fx37I2njkChbrxp1Ng7mOpugHd5BcUGz4cfc2a560', true, NOW()),
    ('Mobius', '136|u5U0SpOi4k60oTfTOvAfqF06Pg70BKIFi6Xj2XLy23e28d58', true, NOW()),
    ('Optima', '200|wzhFsw55IOlIkPJI9CU37SFdjLdNKn0VRpBxXWNV7699732b', true, NOW()),
    ('Kodem', '126|RW8l3aAWlNy0SV31aARsFuDM7YLcm3a2Y2YmMfQoe619ab58', true, NOW()),
    ('Keep Company', '134|S2Y7bQvN7bIqGQSUwkzHFbj0BVpdj0g7eGJn5t6dffb3127c', true, NOW()),
    ('Elemental TV', '125|TusTryCjoaxv4mdilfBCIvGEL300clQy9IL5cbUg952e7484', true, NOW()),
    ('Raynmaker', '202|rUmin8FxFmaPIFhimuUIg7DRNEpWbQzuyqRun9rQe44cb449', true, NOW()),
    ('Records Force', '197|WjMXqmeSXoZ772tdpY26eC1P5ZgMaYxuCq0kPmea62d9ea79', true, NOW()),
    ('RGL Amir', '106|NSUddH0YLOVJgL44gl9lZ8jSLm1okkiAKQirE59tad4b5f9e', true, NOW()),
    ('RGL Vera', '145|6Zh6OQhT8aPTuYKIVnntGDQS6u5g3FS0hA93cXS0fcedb8e1', true, NOW()),
    ('RGL Mitul', '146|bTa2Mg8YRlXpuKtGV87LuQpTY60hTEdMKya9H2DK35afe21b', true, NOW()),
    ('RGL Kim', '147|YJQW8JWL4Omt5DjBvvMKp4zSgGY8Fmq4zlSe8lxR770eb082', true, NOW()),
    ('RGL Rahul', '148|I4t7TXTDwLtqasedrH0CXnnAaYCwidPMRvDIAee51a1fb410', true, NOW()),
    ('RGL Saransh', '149|sylx7dHO3D1oDKSBtM82udP2wZ8sc6AnCjW0RSaNffe2219b', true, NOW()),
    ('Robot', '188|kwVOP4NfbtkAxksyA31zjpmy3HC5DtKqIIbyzl9s40a9952b', true, NOW()),
    ('Select Hub', '172|9lGjZdMKZMMe6ntgIHgleRCQ5BJ0nSZ1lJwkdDp8ee6f8af7', true, NOW()),
    ('SQA', '183|uFUaYyD7QInQ90jH9dcDqFD9Mg72f72a9SWZpavj60e645c4', true, NOW()),
    ('Hey Reach', '173|eei0yQznrWHWMuZxXLtEYnnATU1JEjiN29N3Banha104a49e', true, NOW()),
    ('Onramp', '179|uF36yPIzQGvz4BtEQOg4Zkw6Mrhm3UIHkp03amHKc2fe99a6', true, NOW())
ON CONFLICT (name) DO UPDATE SET
    api_token = EXCLUDED.api_token,
    is_active = true,
    updated_at = NOW();

-- Verify: show all workspaces with status
SELECT name, is_active, updated_at FROM workspace_configs ORDER BY is_active DESC, name;
