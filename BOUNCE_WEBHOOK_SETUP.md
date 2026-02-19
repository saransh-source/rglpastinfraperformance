# Bounce Webhook Setup Guide

This guide explains how to set up bounce tracking via webhooks in n8n.

## Step 1: Create Supabase Table

Run this SQL in your Supabase SQL Editor:

```sql
CREATE TABLE bounce_events (
    id SERIAL PRIMARY KEY,
    received_at TIMESTAMP DEFAULT NOW(),
    event_date DATE NOT NULL,
    workspace_id INTEGER NOT NULL,
    workspace_name TEXT NOT NULL,
    infra_type TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    sender_domain TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    recipient_domain TEXT NOT NULL,
    bounce_type TEXT NOT NULL,
    raw_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bounce_events_date ON bounce_events(event_date);
CREATE INDEX idx_bounce_events_workspace ON bounce_events(workspace_name, event_date);
CREATE INDEX idx_bounce_events_infra ON bounce_events(infra_type, event_date);
```

## Step 2: Create n8n Workflow

### Node 1: Webhook Trigger

1. Add a **Webhook** node
2. Set HTTP Method: `POST`
3. Path: `bounce` (or any path you prefer)
4. Response Mode: `Immediately`
5. Save and copy the webhook URL (e.g., `https://your-n8n.com/webhook/bounce`)

### Node 2: Function Node (Parse Bounce)

Add a **Function** node connected to the webhook with this code:

```javascript
const items = $input.all();
const results = [];

for (const item of items) {
  const payload = item.json;
  const event = payload.event || {};
  const data = payload.data || {};

  // Only process EMAIL_BOUNCED events
  if (event.type !== 'EMAIL_BOUNCED') {
    continue;
  }

  const textBody = (data.reply?.text_body || '').toLowerCase();

  // Detect bounce type from message content
  let bounceType = 'unknown';
  if (textBody.includes('550') && textBody.includes('permanent')) {
    bounceType = 'hard_bounce';
  } else if (textBody.includes('invalid') && textBody.includes('recipient')) {
    bounceType = 'hard_bounce';
  } else if (textBody.includes('user') && textBody.includes('unknown')) {
    bounceType = 'hard_bounce';
  } else if (textBody.includes('no such user')) {
    bounceType = 'hard_bounce';
  } else if (textBody.includes('mailbox') && textBody.includes('not found')) {
    bounceType = 'hard_bounce';
  } else if (textBody.includes('blocked') || textBody.includes('rejected')) {
    bounceType = 'block';
  } else if (textBody.includes('blacklist') || textBody.includes('denied')) {
    bounceType = 'block';
  } else if (textBody.includes('mailbox full') || textBody.includes('quota')) {
    bounceType = 'soft_bounce';
  } else if (textBody.includes('temporary') || textBody.includes('try again')) {
    bounceType = 'soft_bounce';
  } else if (textBody.includes('service unavailable')) {
    bounceType = 'soft_bounce';
  } else if (textBody.includes('spam') || textBody.includes('abuse')) {
    bounceType = 'complaint';
  }

  // Map sender type to infra type
  const senderType = data.sender_email?.type || '';
  const infraMap = {
    'google_workspace_oauth': 'GR',
    'google': 'Google',
    'outlook': 'Outlook',
    'microsoft': 'AO',
    'smtp': 'MD SMTP',
    'imap': 'Unknown'
  };
  const infraType = infraMap[senderType] || 'Unknown';

  // Extract domains
  const senderEmail = data.sender_email?.email || '';
  const recipientEmail = data.lead?.email || '';

  const extractDomain = (email) => {
    if (email && email.includes('@')) {
      return email.split('@')[1].toLowerCase();
    }
    return '';
  };

  // Parse date
  const createdAt = data.campaign_event?.created_at || new Date().toISOString();
  const eventDate = createdAt.split('T')[0];

  results.push({
    json: {
      event_date: eventDate,
      workspace_id: event.workspace_id || 0,
      workspace_name: event.workspace_name || '',
      infra_type: infraType,
      sender_email: senderEmail,
      sender_domain: extractDomain(senderEmail),
      recipient_email: recipientEmail,
      recipient_domain: extractDomain(recipientEmail),
      bounce_type: bounceType,
      raw_message: textBody.substring(0, 500)
    }
  });
}

return results;
```

### Node 3: Supabase Node

1. Add a **Supabase** node
2. Connect to your Supabase instance
3. Resource: `Row`
4. Operation: `Create`
5. Table: `bounce_events`
6. Map the fields from the Function node:
   - `event_date` → `{{ $json.event_date }}`
   - `workspace_id` → `{{ $json.workspace_id }}`
   - `workspace_name` → `{{ $json.workspace_name }}`
   - `infra_type` → `{{ $json.infra_type }}`
   - `sender_email` → `{{ $json.sender_email }}`
   - `sender_domain` → `{{ $json.sender_domain }}`
   - `recipient_email` → `{{ $json.recipient_email }}`
   - `recipient_domain` → `{{ $json.recipient_domain }}`
   - `bounce_type` → `{{ $json.bounce_type }}`
   - `raw_message` → `{{ $json.raw_message }}`

## Step 3: Configure RevGenLabs Webhooks

For each workspace in RevGenLabs:

1. Go to workspace settings → Webhooks
2. Add webhook URL: `https://your-n8n.com/webhook/bounce`
3. Select event: `EMAIL_BOUNCED`
4. Save

**Important**: You only need ONE webhook URL for ALL workspaces. The payload contains `workspace_id` and `workspace_name` to identify which workspace the bounce came from.

## Step 4: Test the Webhook

Send a test POST request to your webhook URL:

```bash
curl -X POST https://your-n8n.com/webhook/bounce \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "type": "EMAIL_BOUNCED",
      "workspace_id": 1,
      "workspace_name": "Test Workspace"
    },
    "data": {
      "sender_email": {
        "email": "test@example.com",
        "type": "google_workspace_oauth"
      },
      "lead": {
        "email": "bounce@test.com"
      },
      "reply": {
        "text_body": "550 permanent failure for one or more recipients"
      },
      "campaign_event": {
        "created_at": "2026-02-17T12:00:00.000Z"
      }
    }
  }'
```

## Bounce Type Reference

| Pattern in Message | Bounce Type |
|-------------------|-------------|
| "550 permanent failure" | hard_bounce |
| "invalid recipient" | hard_bounce |
| "user unknown" | hard_bounce |
| "no such user" | hard_bounce |
| "mailbox not found" | hard_bounce |
| "blocked", "rejected" | block |
| "blacklist", "denied" | block |
| "mailbox full", "quota" | soft_bounce |
| "temporary", "try again" | soft_bounce |
| "service unavailable" | soft_bounce |
| "spam", "abuse" | complaint |

## Dashboard Updates

The dashboard now automatically detects webhook data:
- If `bounce_events` table has data, it shows detailed breakdown by type
- Otherwise, it falls back to aggregate bounces from `daily_infra_stats`

The bounce tab now shows:
- Pie chart: Bounce types (hard vs soft vs block vs complaint)
- Bar chart: Bounces by infra type
- Bar chart: Bounces by workspace
- Recent events table (from webhook data)
