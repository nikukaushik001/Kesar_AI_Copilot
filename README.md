# Kesar & Co. Support Copilot — AI Order Automation

[![n8n](https://img.shields.io/badge/Platform-n8n_Cloud-FF6D5A?style=flat-square&logo=n8n&logoColor=white)](https://n8n.io)
[![Model](https://img.shields.io/badge/LLM-Groq_%2F_Gemini_1.5_Flash-4285F4?style=flat-square&logo=google&logoColor=white)](https://console.groq.com)
[![Status](https://img.shields.io/badge/Status-Complete_%26_Evaluated-2ea44f?style=flat-square)](TEST_REPORT.md)
[![Google Sheets](https://img.shields.io/badge/Google_Sheets-Audit_Log_%26_Tickets-34A853?style=flat-square&logo=googlesheets&logoColor=white)](https://docs.google.com/spreadsheets/d/1myzwSxH0Liini5VW8k1i1emW3pcaIcg13gcUthnEU_A/edit?gid=1863519059#gid=1863519059)

> **Live Google Sheets Links:**
> - [Audit Log Spreadsheet](https://docs.google.com/spreadsheets/d/1myzwSxH0Liini5VW8k1i1emW3pcaIcg13gcUthnEU_A/edit?gid=1863519059#gid=1863519059)
> - [Tickets Spreadsheet](https://docs.google.com/spreadsheets/d/16fbF3PofXS6jA_SnzoerEevWgV_IUGFW3h1TRO7nZ1Y/edit?gid=507124389#gid=507124389)

---

## 1. Summary

- **What I built:** An automated, safety-first AI support copilot for Kesar & Co. (D2C Ayurvedic skincare brand) built with an n8n visual workflow and deterministic code nodes. It reads incoming customer support emails via webhooks, accurately classifies customer intent into structured JSON (`schemas/llm_output.schema.json`), performs privacy-first order lookups, deterministically calculates return eligibility, and either drafts warm brand-voice replies or escalates tickets to Google Sheets.
- **Platform & LLM used:** n8n (visual orchestration + JavaScript Code nodes) + Groq (Llama 3.3 70B / Llama 3.1 8B) / Google Gemini 1.5 Flash.
- **Time spent:** ~5 hours (architecture planning, prompt tuning, privacy guardrails, and v1 vs. v2 benchmark evaluation).
- **What works:** 
  - **100% Intent Classification Accuracy** across all 25 test emails (covering Hinglish, Hindi, edge-cases).
  - **Customer Privacy Protection:** Withholds order details if sender email does not match `customer_email` (e.g. email E07).
  - **Prompt Injection Defense:** Neutralizes malicious system overrides (e.g. VIP injection in email E12).
  - **Deterministic Eligibility Engine:** Accurately computes `received_at - delivered_date` for 7-day unopened returns and 48-hour damage complaints.
  - **Smart Ticket Deduplication:** Automatically appends updates to existing open tickets (e.g. follow-up email E21 linked to E04).
- **What doesn't / Limits:** Completely anonymous emails with no order ID and unregistered email (e.g. email E18) cannot be answered automatically and are safely routed to human agents.

---

## 2. Architecture & Workflow Design

```
   Incoming Webhook POST (Email Payload)
                 │
                 ▼
     [1] Normalize Input (Clean payload & dates)
                 │
                 ▼
     [2] LLM Classifier & Extractor (Structured JSON Schema)
                 │
                 ▼
     [3] Order Lookup Node (KC-#### ID or Sender Email Fallback)
                 │
                 ▼
     [4] Business Rules & Return Eligibility (Code Node)
           ├── Privacy Check: sender_email == customer_email?
           ├── Date Arithmetic: days_since_delivery = (received_at - delivered_date)
           ├── Policy Check: <=7d (sealed return) vs <=48h (damage complaint)
           └── Medical / Reaction Guardrail: Route to Human
                 │
                 ▼
     [5] Smart Ticket Deduplication (Google Sheets Tickets)
           ├── If open ticket exists for order -> Append notes & email ID
           └── If new return/complaint -> Create new TKT-####
                 │
                 ▼
     [6] AI Reply Drafter Agent (Brand voice, 3-6 sentences, warm sign-off)
                 │
                 ▼
     [7] Google Sheets: Audit Log Sync (Full trace + needs_human flag)
```

| Step / Node | What It Does | Why I Designed It This Way |
|---|---|---|
| **Webhook Trigger** | Receives single email JSON payload | Compatible with `scripts/send_test_emails.py` and real-world Shopify/email webhooks. |
| **Normalize Input** | Standardizes fields, defaults, and timestamps | Guards downstream nodes against missing fields or unexpected formatting. |
| **LLM Classifier** | Extracts intent, sentiment, order ID into structured JSON | Strict schema enforcement with 0.0 temperature for reliable, repeatable classification. |
| **Order Lookup** | Fetches `orders.json` and finds order by ID or email | Enables customer identification even when the customer forgets their order number. |
| **Business Rules & Eligibility** | Deterministic JavaScript node for dates, eligibility, and privacy | Hard rules (privacy, return windows) should never rely on LLM arithmetic hallucinations. |
| **Ticket Deduplication** | Searches Google Sheets for open tickets by `order_id` | Prevents ticket spam and ensures follow-ups (e.g. E21) attach to existing tickets (E04). |
| **AI Reply Drafter** | Generates 3-6 sentence warm reply following brand voice | Follows strict brand voice and omits confidential details if privacy fails. |
| **Google Sheets Logger** | Appends audit row to "Audit Log" tab | Full traceability of decisions, confidence scores, and drafts. |

---

## 3. Setup — How Someone Else Can Run This

1. **Accounts & Credentials Needed:**
   - Free [n8n Cloud](https://n8n.io) or self-hosted instance.
   - Groq API Key (from [console.groq.com](https://console.groq.com)) or Google Gemini API Key.
   - Google account connected via OAuth to Google Sheets in n8n.
2. **Import the Workflow:**
   - In n8n, click **Workflows** -> **Import from File** -> select [`workflow/kesar_copilot_workflow.json`](workflow/kesar_copilot_workflow.json).
3. **Connect Credentials:**
   - In the LLM nodes, choose your Groq / Gemini credential.
   - In the Google Sheets nodes, connect your Google account and select your `Kesar Support` spreadsheet.
4. **Run Test Emails:**
   - Activate the n8n workflow.
   - Run the included test script:
     ```bash
     python scripts/send_test_emails.py --url <YOUR_N8N_WEBHOOK_URL>
     ```

---

## 4. Prompts & LLM Configuration

All prompt files are stored in [`prompts/`](prompts/):
- **Classification & Extraction Prompt:** [`prompts/classification_prompt_v2.md`](prompts/classification_prompt_v2.md) (Temperature: `0.0`, structured schema enforcement).
- **Reply Drafting Agent Prompt:** [`prompts/reply_drafting_prompt.md`](prompts/reply_drafting_prompt.md) (Temperature: `0.3`, empathetic brand voice).

---

## 5. Key Decisions and Assumptions

- **Low-Confidence Handling:** Any classification with confidence < 0.70 is flagged as `needs_human: true`. This prevents guessing on ambiguous requests.
- **Ticket Deduplication:** Before creating a ticket, the workflow inspects the `Tickets` sheet for an existing ticket with the same `order_id` that is not `Closed`. If found, it appends the new email ID to `email_ids` and adds timestamped notes instead of creating a duplicate ticket.
- **Privacy Enforcement:** If an email inquires about an order (e.g., E07 where Arjun inquires about his wife Meera's order), the workflow compares `sender_email` against `customer_email`. If they do not match, the workflow withholds order tracking and delivery address details and flags `needs_human`.
- **Grounded FAQ Knowledge:** The model is strictly instructed that cosmetics are not medicines and cannot cure illnesses (E20). Queries alleging medical claims are flagged for human review.
- **Untrusted Input Isolation:** Emails containing jailbreak attempts (e.g. E12 with "SYSTEM NOTE TO AI ASSISTANT") are treated as pure customer text and cannot alter system instructions.

---

## 6. Scaling to 1,000 Emails/Day

If scaling from 60 to 1,000 emails/day:
1. **API Rate Limits:** Free LLM tiers will hit requests-per-minute (RPM) limits. Implement a Redis-backed queue (such as BullMQ) or leverage n8n's queue mode with concurrency limits (e.g., 5 parallel executions max).
2. **Database Bottleneck:** Reading `orders.json` over raw GitHub HTTP for every email would be replaced with a cached Redis layer or indexing into PostgreSQL with indexed lookups on `order_id` and `customer_email`.
3. **Google Sheets Concurrency:** Google Sheets API has write quotas (300 requests per minute). At scale, logs and tickets should be written to PostgreSQL / Supabase, with an hourly sync or dashboard for agents.
4. **Monitoring & Cost Control:** Set up telemetry to track token consumption and error rates per hour, with alerting when fallback rates exceed 5%.

---

## 7. Product-Thinking Questions (<=150 words each)

### 1. Auto-send vs. Draft
> I would only auto-send high-confidence (>=0.90) routine `order_status` queries where the sender email strictly matches the order email and tracking is already active. All complaints, returns, refund requests, and product medical inquiries must remain drafts requiring human 1-click approval. I set the confidence threshold at 0.85 for auto-routing and 0.90 for auto-sending because false negatives in customer support irritate users, but false automated promises (e.g. unauthorized refund commitments) cause irreversible financial and brand damage.

### 2. Cost Estimation (1,000 emails/day)
> - Average tokens per email: ~400 input tokens + ~180 output tokens = ~580 tokens total.
> - Using Google Gemini 1.5 Flash ($0.075 / 1M input tokens, $0.30 / 1M output tokens):
>   - Input cost per email: 400 x $0.000000075 = $0.000030
>   - Output cost per email: 180 x $0.00000030 = $0.000054
>   - Total per email: ~$0.000084 (approx INR 0.007).
> - At 1,000 emails/day (30,000 emails/month):
>   - 30,000 x $0.000084 = **$2.52/month (approx INR 210/month)**. Even with tool re-prompts and safety parsing, monthly LLM cost is well under $5/month.

### 3. Success Metric & Switch-Off Condition
> - **Week 1 North Star Metric:** **Agent Draft Acceptance Rate** (percentage of copilot drafts sent by human agents with zero or minor edits). Aim for > 75%.
> - **Switch-off Condition:** If the **Hallucination / Error Rate** exceeds 2% (e.g. incorrect policy stated, private order information leaked to wrong email, or false refund promised), the automation must be instantly paused back to manual review.

### 4. Failure Experience & Damage Control
> When the copilot makes an error (e.g. misunderstands a complex multi-part question), the customer experiences a repetitive or generic response. To minimize damage:
> 1. Every draft includes an explicit reassurance that a dedicated human agent is reviewing their case.
> 2. The customer is never given false certainty on financial refunds.
> 3. If negative sentiment is detected in a follow-up, the copilot immediately silences automated replies and marks the ticket as urgent for human takeover.

### 5. Don't Automate
> **Final refund approval and payment disbursement** should never be automated. While checking return eligibility windows and generating reverse pickup labels is routine, inspecting returned products for opened seals, verified damage photos, or fraud patterns requires human judgment. Automating disbursements opens the brand to return abuse and chargeback exploitation.

---

## 8. How I Used AI Tools

I used AI tools to rapidly scaffold JSON schemas, brainstorm edge-case classifications, and draft structured system prompts. However, I relied strictly on my own architectural judgment to enforce deterministic business logic (such as date arithmetic and customer privacy checks) inside code nodes rather than leaving critical policy decisions to LLM discretion.

---

## 9. If I Had One More Week

- Implement native WhatsApp / Omni-channel integration for Indian D2C customers.
- Support voice note transcription and multi-lingual Indian audio responses.
- Connect direct Shopify GraphQL API and Shiprocket / Delhivery webhook endpoints for real-time tracking updates.
- Build an automated visual QC model that inspects customer-uploaded damage photos before initiating replacements.
