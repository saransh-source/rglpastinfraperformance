"""
RGL Infra Tracking - Configuration
Workspace API tokens and infra type mappings
"""

# Base API URL
BASE_URL = "https://mail.revgenlabs.com"

# All workspace tokens (name: "id|token")
# NOTE: Primary source is now Supabase workspace_configs table.
# This dict is a fallback only (used if Supabase is unavailable).
WORKSPACES = {
    "Reev": "70|oN8Dzz23OuBeaNZmxkgWoGFd1uNHxXnwPHxjvIWdce260302",
    "Baton": "29|eVEGpeOSUQ1LJiBVfe5E3Qa9bculFxHhq70UIKzYfc81d9d8",
    "Boost": "201|P3SgIm2tn7b4KFr9j1hB5q0pVvxq384nmhrPdzvb9e966e2e",
    "Loop Global": "34|jjKsti7eg9uRNP8et1JF4GzH5nF32lF6TCd5JYADa3816238",
    "Loop Volta": "154|dryoXqTOmFu8EatT7JF31FeIqy4Gw7fodYKikLwe30265610",
    "Voyageur": "94|GEY5u70fx37I2njkChbrxp1Ng7mOpugHd5BcUGz4cfc2a560",
    "Mobius": "136|u5U0SpOi4k60oTfTOvAfqF06Pg70BKIFi6Xj2XLy23e28d58",
    "Optima": "200|wzhFsw55IOlIkPJI9CU37SFdjLdNKn0VRpBxXWNV7699732b",
    "Kodem": "126|RW8l3aAWlNy0SV31aARsFuDM7YLcm3a2Y2YmMfQoe619ab58",
    "Keep Company": "134|S2Y7bQvN7bIqGQSUwkzHFbj0BVpdj0g7eGJn5t6dffb3127c",
    "Elemental TV": "125|TusTryCjoaxv4mdilfBCIvGEL300clQy9IL5cbUg952e7484",
    "Raynmaker": "202|rUmin8FxFmaPIFhimuUIg7DRNEpWbQzuyqRun9rQe44cb449",
    "Records Force": "197|WjMXqmeSXoZ772tdpY26eC1P5ZgMaYxuCq0kPmea62d9ea79",
    "RGL Amir": "106|NSUddH0YLOVJgL44gl9lZ8jSLm1okkiAKQirE59tad4b5f9e",
    "RGL Vera": "145|6Zh6OQhT8aPTuYKIVnntGDQS6u5g3FS0hA93cXS0fcedb8e1",
    "RGL Mitul": "146|bTa2Mg8YRlXpuKtGV87LuQpTY60hTEdMKya9H2DK35afe21b",
    "RGL Kim": "147|YJQW8JWL4Omt5DjBvvMKp4zSgGY8Fmq4zlSe8lxR770eb082",
    "RGL Rahul": "148|I4t7TXTDwLtqasedrH0CXnnAaYCwidPMRvDIAee51a1fb410",
    "RGL Saransh": "149|sylx7dHO3D1oDKSBtM82udP2wZ8sc6AnCjW0RSaNffe2219b",
    "Robot": "188|kwVOP4NfbtkAxksyA31zjpmy3HC5DtKqIIbyzl9s40a9952b",
    "Select Hub": "172|9lGjZdMKZMMe6ntgIHgleRCQ5BJ0nSZ1lJwkdDp8ee6f8af7",
    "SQA": "183|uFUaYyD7QInQ90jH9dcDqFD9Mg72f72a9SWZpavj60e645c4",
    "Hey Reach": "173|eei0yQznrWHWMuZxXLtEYnnATU1JEjiN29N3Banha104a49e",
    "Onramp": "179|uF36yPIzQGvz4BtEQOg4Zkw6Mrhm3UIHkp03amHKc2fe99a6",
}

# Map mailbox tags to infra type names
# IMPORTANT: Each tag is kept separate (no merging) per user requirement
TAG_TO_INFRA = {
    # Each tag maps to itself - no merging
    "GR": "GR",
    "GR - N": "GR - N",  # Separate GR variant
    "G-Vis": "G-Vis",
    "G-VIs": "G-Vis",  # Case normalization only
    "Google": "Google",
    "AO": "AO",
    "OD": "OD",  # Outlook Domain
    "L": "L",
    "MD SMTP": "MD SMTP",
    "Outlook": "Outlook",
    "New Outlook": "New Outlook",
    "WR SMTP": "WR SMTP",
    "winnr SMTP": "WR SMTP",  # Case normalization only
    "Gpan 05-25": "Gpan",
    "Gpan": "Gpan",
    "E": "Everwarm",
    "Everwarm 03-25": "Everwarm",
    "Everwarm": "Everwarm",
}

# All tracked infra types (raw tag names, no merging)
TRACKED_INFRA_TYPES = [
    "GR",
    "GR - N",
    "G-Vis",
    "Google",
    "AO",
    "OD",
    "L",
    "MD SMTP",
    "Outlook",
    "New Outlook",
    "WR SMTP",
    "Gpan",
    "Everwarm",
]

# Time period options (in days)
TIME_PERIODS = {
    "3d": 3,
    "7d": 7,
    "14d": 14,
    "30d": 30,
}

# Infra types to exclude from analysis (internal/testing)
EXCLUDED_WORKSPACES = []  # Add workspace names to exclude if needed

# Maximum sends per mailbox per day when fully warm (theoretical max)
INFRA_MAX_LIMITS = {
    "GR": 20,
    "GR - N": 20,
    "G-Vis": 20,
    "Google": 20,
    "AO": 10,
    "OD": 10,
    "L": 2,
    "MD SMTP": 15,
    "Outlook": 10,
    "New Outlook": 10,
    "WR SMTP": 10,
    "Gpan": 20,
    "Everwarm": 15,
}

# Infra types to show in cost projections (main types)
PROJECTION_INFRA_TYPES = [
    "MD SMTP",
    "GR",
    "AO",
]

# Cost structure for each infra type (for 100k sends/day projections)
INFRA_COSTS = {
    "MD SMTP": {
        "monthly_per_mailbox": 1.67,
        "sends_per_day": 15,
        "mailboxes_per_domain": 4,
        "domain_cost": 4.00,
        "setup_per_mailbox": 0,
        "warmup_weeks": 2,
    },
    "GR": {
        "monthly_per_mailbox": 2.00,
        "sends_per_day": 20,
        "mailboxes_per_domain": 3,
        "domain_cost": 4.00,
        "setup_per_mailbox": 0.20,
        "warmup_weeks": 4,
    },
    "AO": {
        # 25 mailboxes per domain, 1 domain per tenant, 25 mailboxes per tenant
        "monthly_per_tenant": 4.22,  # $4.22/month for 25 mailboxes
        "mailboxes_per_tenant": 25,
        "domains_per_tenant": 1,
        "sends_per_day": 10,
        "tenant_cost": 11.22,  # One-time tenant setup
        "aged_domain_cost": 7.00,  # One-time aged domain premium
        "warmup_weeks": 2,
    },
}
