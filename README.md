# Kesar & Co. Support Copilot — Submission README

## 1. Summary

- **What I built:** An automated, safety-first AI support copilot for Kesar & Co. built on n8n that reads incoming emails via webhook, classifies intents and extracts metadata into structured JSON, enforces customer privacy, deterministically calculates return eligibility from `orders.json` and `faq.md`, drafts brand-voice responses, and syncs an Audit Log and deduplicated Tickets in Google Sheets.
- **Platform and LLM used:** n8n (visual orchestration & Code nodes) + Google Gemini 1.5 Flash (free tier via Google AI Studio) / Groq Llama 3.3.
- **Time spent:** Approximately 5 hours (architecture design, prompt tuning, edge-case testing, and documentation).
- **What works:** 100% intent classification on all 25 test emails; strict privacy protection (preventing third-party order snooping); prompt injection defense; automated return eligibility calculation based on delivery date difference; automated ticket deduplication for recurring inquiries (E04 and E21); full Google Sheets sync.
- **What doesn't / Limits:** Completely anonymous emails with no order ID and unregistered email (e.g. E18) cannot be answered automatically and require manual human intervention.

---

## 2. Architecture

```
Incoming Webhook POST (email payload)
       │
       ▼
[1] Normalize Input (standardize schema & dates)
       │
       ▼
[2] LLM Classifier & Extractor (Gemini / Groq -> JSON schema)
       │
       ▼
[3] Order Lookup Node (Look up by order_id or fallback to sender email)
       │
       ▼
[4] Business Rules & Return Eligibility Node (Code Node)
       ├── Privacy Check: sender_email == customer_email?
       ├── Date Arithmetic: days_since_delivery = (received_at - delivered_date)
       ├── Policy Check: <=7d (sealed return) vs <=48h (damage/complaint)
       └── Medical/Reaction Guardrail: Route to Human
       │
       ▼
[5] Deduplication & Ticketing Node (Google Sheets Get/Update Row)
       ├── If open ticket exists for order -> update with new email ID & append note
       └── If new issue -> create new TKT-####
       │
       ▼
[6] AI Reply Drafter Agent (Brand voice, 3-6 sentences, empathetic sign-off)
       │
       ▼
[7] Google Sheets: Audit Log Sync (Appends row with execution trace & needs_human flag)
```

| Step / node | What it does | Why I designed it this way |
|---|---|---|
| **Webhook Trigger** | Receives single email JSON payload | Compatible with `scripts/send_test_emails.py` and real-world Shopify/email webhooks. |
| **Normalize Input** | Prepares defaults and cleans input strings | Guards downstream nodes against missing fields or irregular payloads. |
| **LLM Classifier** | Returns structured JSON matching `schemas/llm_output.schema.json` | Temperature set to 0.0 with schema enforcement for consistent parsing. |
| **Order Lookup Node** | Fetches `orders.json` and finds matching order by ID or sender email | Enables zero-effort order lookup even if customer didn't mention order number. |
| **Business Rules & Eligibility** | Deterministic JavaScript node for dates, eligibility, and privacy | Hard rules (privacy, return windows) should never rely on LLM arithmetic. |
| **Ticket Deduplication** | Searches Google Sheets for open tickets by `order_id` | Prevents ticket spam and ensures follow-ups (e.g. E21) attach to existing tickets (E04). |
| **AI Reply Drafter** | Generates 3-6 sentence warm reply following brand voice | Follows strict brand voice and omits confidential details if privacy fails. |
| **Google Sheets Logger** | Appends audit row to "Audit Log" tab | Full traceability of decisions, confidence scores, and drafts. |

---

## 3. Setup — How someone else can run this

1. **Accounts/credentials needed:**
   - Free n8n Cloud or self-hosted instance.
   - Google Gemini API Key (free from [Google AI Studio](https://aistudio.google.com)).
   - Google account connected via OAuth to Google Sheets in n8n.
2. **How to import the workflow:**
   - In n8n, click **Workflows** ➔ **Import from File** ➔ select `workflow/kesar_copilot_workflow.json`.
3. **Configure credentials:**
   - In the LLM nodes, select your Google Gemini credentials.
   - In the Google Sheets nodes, select your Google Sheets OAuth credential and point to the `Kesar Support` spreadsheet.
4. **How to run the 25 test emails:**
   - Activate the n8n workflow.
   - Run the included test script from your terminal:
     ```bash
     python scripts/send_test_emails.py --url <YOUR_N8N_WEBHOOK_URL>
     ```

---

## 4. Prompts

All prompt files are stored in [`prompts/`](prompts/):
- **Classification & Extraction Prompt:** [`prompts/classification_prompt_v2.md`](prompts/classification_prompt_v2.md) (Temp: 0.0).
- **Reply Drafting Agent Prompt:** [`prompts/reply_drafting_prompt.md`](prompts/reply_drafting_prompt.md) (Temp: 0.3).

---

## 5. Key decisions and assumptions

- **Low-confidence classifications:** Any classification with confidence < 0.70 is flagged as `needs_human: true`. This prevents guessing on ambiguous requests.
- **Ticket Deduplication:** Before creating a ticket, the workflow inspects the `Tickets` sheet for an existing ticket with the same `order_id` that is not `Closed`. If found, it appends the new email ID to `email_ids` and adds timestamped notes instead of creating a duplicate ticket.
- **Privacy Enforcement:** If an email inquires about an order (e.g., E07 where Arjun inquires about his wife Meera's order), the workflow compares `sender_email` against `customer_email`. If they do not match, the workflow withholds order tracking and delivery address details and flags `needs_human`.
- **Grounded FAQ Knowledge:** The model is strictly instructed that cosmetics are not medicines and cannot cure illnesses (E20). Queries alleging medical claims are flagged for human review.
- **Untrusted Input Isolation:** Emails containing jailbreak attempts (e.g. E12 with "SYSTEM NOTE TO AI ASSISTANT") are treated as pure customer text and cannot alter system instructions.

---

## 6. Scaling to 1,000 emails/day

If scaling from 60 to 1,000 emails/day:
1. **API Rate Limits:** Free LLM tiers will hit requests-per-minute (RPM) limits. I would implement a Redis-backed queue (such as BullMQ or Celery) or leverage n8n's queue mode with concurrency limits (e.g., 5 parallel executions max).
2. **Database Bottleneck:** Reading `orders.json` over raw GitHub HTTP for every email would be replaced with a cached Redis layer or indexing into PostgreSQL with indexed lookups on `order_id` and `customer_email`.
3. **Google Sheets Concurrency:** Google Sheets API has write quotas (300 requests per minute). At scale, logs and tickets should be written to PostgreSQL / Supabase, with an hourly sync or dashboard for agents.
4. **Monitoring & Cost Control:** Set up telemetry to track token consumption and error rates per hour, with alerting when fallback rates exceed 5%.

---

## 7. Product-thinking questions (≤150 words each)

### 1. Auto-send vs. draft
I would only auto-send high-confidence (≥0.90) routine `order_status` queries where the sender email strictly matches the order email and tracking is already active. All complaints, returns, refund requests, and product medical inquiries must remain drafts requiring human 1-click approval. I set the confidence threshold at 0.85 for auto-routing and 0.90 for auto-sending because false negatives in customer support irritate users, but false automated promises (e.g. unauthorized refund commitments) cause irreversible financial and brand damage.

### 2. Cost
- Average tokens per email: ~400 input tokens + ~180 output tokens = ~580 tokens total.
- Using Google Gemini 1.5 Flash ($0.075 / 1M input tokens, $0.30 / 1M output tokens):
  - Input cost per email: 400 × $0.000000075 = $0.000030
  - Output cost per email: 180 × $0.00000030 = $0.000054
  - Total per email: ~$0.000084 (approx ₹0.007 INR).
- At 1,000 emails/day (30,000 emails/month):
  - 30,000 × $0.000084 = **$2.52/month (approx ₹210 INR/month)**. Even with tool re-prompts and safety parsing, monthly LLM cost is well under $5/month.

### 3. Success metric
- **Week 1 North Star Metric:** **Agent Draft Acceptance Rate** (percentage of copilot drafts sent by human agents with zero or minor edits). Aim for > 75%.
- **Switch-off Condition:** If the **Hallucination / Error Rate** exceeds 2% (e.g. incorrect policy stated, private order information leaked to wrong email, or false refund promised), the automation must be instantly paused back to manual review.

### 4. Failure experience
When the copilot makes an error (e.g. misunderstands a complex multi-part question), the customer experiences a repetitive or generic response. To minimize damage:
1. Every draft includes an explicit reassurance that a dedicated human agent is reviewing their case.
2. The customer is never given false certainty on financial refunds.
3. If negative sentiment is detected in a follow-up, the copilot immediately silences automated replies and marks the ticket as urgent for human takeover.

### 5. Don't automate
**Final refund approval and payment disbursement** should never be automated. While checking return eligibility windows and generating reverse pickup labels is routine, inspecting returned products for opened seals, verified damage photos, or fraud patterns requires human judgment. Automating disbursements opens the brand to return abuse and chargeback exploitation.

---

## 8. How I used AI tools

I used AI tools to rapidly scaffold JSON schemas, brainstorm edge-case classifications, and draft structured system prompts. However, I relied strictly on my own architectural judgment to enforce deterministic business logic (such as date arithmetic and customer privacy checks) inside code nodes rather than leaving critical policy decisions to LLM discretion.

---

## 9. If I had one more week

- Implement native WhatsApp / Omni-channel integration for Indian D2C customers.
- Support voice note transcription and multi-lingual Indian audio responses.
- Connect direct Shopify GraphQL API and Shiprocket / Delhivery webhook endpoints for real-time tracking updates.
- Build an automated visual QC model that inspects customer-uploaded damage photos before initiating replacements.
