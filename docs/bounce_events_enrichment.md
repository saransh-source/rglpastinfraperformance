# Bounce Events Enrichment Setup

This document explains how to set up automatic enrichment of `bounce_events` rows with `mx_provider` and `infra_type` at insert time.

## Prerequisites

### Ensure mailbox_snapshots is populated

The `mailbox_snapshots` table must contain all mailboxes with their email-to-infra_type mapping.
Run the data collector to populate this table:

```bash
python supabase_data_collector.py
```

This should insert ~12,860 mailboxes. Verify in Supabase:
```sql
SELECT COUNT(*) FROM mailbox_snapshots;
-- Should return ~12,860 rows
```

If you see only ~100 rows, the data collector may have encountered an issue.
Check the console output for errors and ensure API tokens are configured correctly.

## 1. Add Columns to bounce_events Table

Run this SQL in Supabase SQL Editor:

```sql
-- Add mx_provider column if it doesn't exist
ALTER TABLE bounce_events ADD COLUMN IF NOT EXISTS mx_provider VARCHAR(50);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_bounce_mx_provider ON bounce_events(mx_provider);

-- Ensure infra_type column exists (should already be there)
-- If not: ALTER TABLE bounce_events ADD COLUMN IF NOT EXISTS infra_type VARCHAR(50);
```

## 2. n8n Webhook - Enrich Before Insert

In your n8n bounce webhook workflow, **before** inserting to Supabase, add these enrichment steps:

### Step A: MX Provider Lookup

Add an HTTP Request node to look up MX provider:

```javascript
// Input: recipient_domain from the bounce event
const domain = $input.item.json.recipient_domain;

if (!domain) {
  return { mx_provider: 'Unknown' };
}

// Call Google DNS API
const response = await $http.request({
  method: 'GET',
  url: `https://dns.google/resolve?name=${domain}&type=MX`,
  returnFullResponse: false
});

let provider = 'Other';

if (response.Answer && response.Answer.length > 0) {
  const mxRecord = response.Answer[0].data.toLowerCase();

  if (mxRecord.includes('google') || mxRecord.includes('googlemail')) {
    provider = 'Google';
  } else if (mxRecord.includes('outlook') || mxRecord.includes('microsoft') || mxRecord.includes('protection.outlook')) {
    provider = 'Microsoft';
  } else if (mxRecord.includes('mimecast')) {
    provider = 'Mimecast';
  } else if (mxRecord.includes('barracuda')) {
    provider = 'Barracuda';
  } else if (mxRecord.includes('pphosted') || mxRecord.includes('proofpoint')) {
    provider = 'Proofpoint';
  }
}

return { mx_provider: provider };
```

### Step B: Infra Type Lookup

**Option 1: Use mailbox_snapshots table** (if fully populated)

The `mailbox_snapshots` table contains email-to-infra_type mapping for all mailboxes.
Make sure the data collector has run to populate this table with all ~12,860 mailboxes.

```sql
-- Query mailbox_snapshots to get infra_type for the sender_email
SELECT infra_type
FROM mailbox_snapshots
WHERE LOWER(email) = LOWER('{{ sender_email }}')
LIMIT 1
```

**Option 2: Call RevGenLabs API directly** (if mailbox_snapshots is incomplete)

If the mailbox_snapshots table doesn't have all emails, you can call the RevGenLabs API
to get the infra_type from the sender email's tags:

```javascript
// In n8n, use HTTP Request node to call the API
// You'll need the workspace token for the sender's workspace

const senderEmail = $input.item.json.sender_email;
const workspaceName = $input.item.json.workspace_name;

// Get API token for workspace from your config
const workspaceTokens = {
  'Reev': 'YOUR_REEV_TOKEN',
  'EBR': 'YOUR_EBR_TOKEN',
  // ... other workspaces
};

const token = workspaceTokens[workspaceName];
if (!token) return { infra_type: 'Unknown' };

// Fetch sender emails from API
const response = await $http.request({
  method: 'GET',
  url: 'https://app.revgenlabs.com/api/sender-emails',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  },
  qs: { per_page: 100, page: 1 }
});

// Find matching email and extract infra_type from tags
const mailboxes = response.data || [];
const match = mailboxes.find(mb =>
  mb.email.toLowerCase() === senderEmail.toLowerCase()
);

if (match && match.tags) {
  const infraTags = {
    'Smartlead': 'Smartlead', 'SL': 'Smartlead',
    'Instantly': 'Instantly', 'IN': 'Instantly',
    'Epan': 'Epan', 'EP': 'Epan', 'Epan-GSuite': 'Epan'
  };
  for (const tag of match.tags) {
    if (infraTags[tag.name]) {
      return { infra_type: infraTags[tag.name] };
    }
  }
}

return { infra_type: 'Unknown' };
```

**Option 3: Create a dedicated lookup table** (recommended for performance)

Create a lightweight email-to-infra mapping table in Supabase:

```sql
CREATE TABLE IF NOT EXISTS email_infra_mapping (
  email VARCHAR(255) PRIMARY KEY,
  infra_type VARCHAR(50) NOT NULL,
  workspace_name VARCHAR(100),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Populate from mailbox_snapshots
INSERT INTO email_infra_mapping (email, infra_type, workspace_name)
SELECT email, infra_type, workspace_name
FROM mailbox_snapshots
ON CONFLICT (email) DO UPDATE SET
  infra_type = EXCLUDED.infra_type,
  workspace_name = EXCLUDED.workspace_name,
  updated_at = NOW();
```

Then query this lightweight table instead of mailbox_snapshots.

If no match found in any option, use 'Unknown'.

### Step C: Insert with Enriched Data

Finally, insert to Supabase with all fields including `mx_provider` and `infra_type`:

```javascript
{
  event_date: eventDate,
  bounce_type: bounceType,
  sender_email: senderEmail,
  sender_domain: senderDomain,
  recipient_email: recipientEmail,
  recipient_domain: recipientDomain,
  workspace_name: workspaceName,
  infra_type: infraType,        // From Step B
  mx_provider: mxProvider,      // From Step A
  raw_message: rawMessage
}
```

## 3. Alternative: Supabase Edge Function

If you prefer to handle enrichment in Supabase itself, create an Edge Function:

```typescript
// supabase/functions/enrich-bounce/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const { record } = await req.json()

  // MX Provider lookup
  let mxProvider = 'Unknown'
  if (record.recipient_domain) {
    try {
      const dnsRes = await fetch(
        `https://dns.google/resolve?name=${record.recipient_domain}&type=MX`
      )
      const dnsData = await dnsRes.json()

      if (dnsData.Answer?.length > 0) {
        const mx = dnsData.Answer[0].data.toLowerCase()
        if (mx.includes('google')) mxProvider = 'Google'
        else if (mx.includes('outlook') || mx.includes('microsoft')) mxProvider = 'Microsoft'
        else if (mx.includes('mimecast')) mxProvider = 'Mimecast'
        else if (mx.includes('barracuda')) mxProvider = 'Barracuda'
        else if (mx.includes('pphosted') || mx.includes('proofpoint')) mxProvider = 'Proofpoint'
        else mxProvider = 'Other'
      }
    } catch (e) {
      console.error('MX lookup failed:', e)
    }
  }

  // Infra type lookup
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let infraType = record.infra_type || 'Unknown'
  if (infraType === 'Unknown' && record.sender_email) {
    const { data } = await supabase
      .from('mailbox_snapshots')
      .select('infra_type')
      .ilike('email', record.sender_email)
      .limit(1)
      .single()

    if (data?.infra_type) {
      infraType = data.infra_type
    }
  }

  // Update the record
  await supabase
    .from('bounce_events')
    .update({ mx_provider: mxProvider, infra_type: infraType })
    .eq('id', record.id)

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

Then create a database trigger to call this function on INSERT:

```sql
CREATE OR REPLACE FUNCTION enrich_bounce_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/enrich-bounce',
    body := jsonb_build_object('record', row_to_json(NEW))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_enrich_bounce
AFTER INSERT ON bounce_events
FOR EACH ROW
EXECUTE FUNCTION enrich_bounce_event();
```

## 4. MX Provider Categories

| Provider | MX Record Contains |
|----------|-------------------|
| Google | `google.com`, `googlemail.com` |
| Microsoft | `outlook.com`, `microsoft.com`, `protection.outlook.com` |
| Mimecast | `mimecast.com` |
| Barracuda | `barracuda` |
| Proofpoint | `pphosted.com`, `proofpoint.com` |
| Other | Everything else |
| Unknown | Lookup failed or no MX record |
