# Migrate Salesforce Data into Matthews CRM (Supabase)

Your **local Claude Code** (with SFDX MCP connected) does the work. This web session can't — it doesn't have your Salesforce credentials.

## Prerequisites check
Run these three commands in your terminal first:
```bash
sf org list          # Should show your logged-in Salesforce org
claude mcp list      # Should show salesforce: ✓ Connected
claude               # Starts Claude Code
```

## One-shot migration prompt

Once Claude Code opens, paste this **entire block** as your message. It will execute the full migration.

---

> You have two MCP servers: **Salesforce** (already connected via SFDX) and direct HTTP access to **Supabase**. I want you to migrate all data from Salesforce into a Supabase-backed CRM.
>
> **Supabase connection** (for HTTP calls):
> - URL: `https://bnkuieueimlyjovjilqi.supabase.co`
> - Anon key: `sb_publishable_Xj5u9741yzSNpZ7HXcY_iw_5JVrQmUN`
> - Tables: `accounts`, `contacts`, `deals`, `activities`
>
> **Accounts table columns:** `id` (text PK), `name`, `industry`, `website`, `address`, `type`, `notes`, `created_at`
>
> **Contacts table columns:** `id`, `name`, `email`, `mobile`, `phone`, `address`, `account_id` (FK → accounts.id), `tier`, `la`, `birthdate`, `title`, `instagram`, `linkedin`, `li_sn_p`, `tags`, `notes`, `created_at`
>
> **Deals table columns:** `id`, `name`, `account_id`, `value` (numeric, in millions), `stage`, `sector`, `probability`, `close_date`, `notes`, `created_at`
>
> **Activities table columns:** `id`, `type`, `subject`, `contact_id`, `account_id`, `deal_id`, `due_date`, `status`, `notes`, `created_at`
>
> **Tasks:**
>
> 1. **Accounts:** Query Salesforce:
>    ```sql
>    SELECT Id, Name, Industry, Website, BillingStreet, BillingCity, BillingState, BillingPostalCode, Type, Description, CreatedDate FROM Account
>    ```
>    For each row, concatenate the billing address fields into one `address` string (`Street, City, State ZIP`). Insert into Supabase `accounts` using the Salesforce `Id` as the `id`. Map `Description → notes`, `CreatedDate → created_at`.
>
> 2. **Contacts:** Query:
>    ```sql
>    SELECT Id, FirstName, LastName, Email, MobilePhone, Phone, MailingStreet, MailingCity, MailingState, MailingPostalCode, AccountId, Title, Birthdate, Description, CreatedDate FROM Contact
>    ```
>    Combine `FirstName + LastName` → `name`. Combine mailing fields → `address`. Use `MobilePhone → mobile`, `Phone → phone`, `AccountId → account_id`, `Description → notes`. Default `tier = "3"`. Insert into Supabase `contacts`.
>
> 3. **Opportunities → Deals:** Query:
>    ```sql
>    SELECT Id, Name, AccountId, Amount, StageName, Probability, CloseDate, Description, CreatedDate FROM Opportunity
>    ```
>    Map `Amount → value` (divide by 1,000,000 to get millions), `StageName → stage`, `Probability → probability`, `CloseDate → close_date`, `Description → notes`. Insert into Supabase `deals`.
>
> 4. **Tasks & Events → Activities:** Query:
>    ```sql
>    SELECT Id, Subject, Type, WhoId, WhatId, ActivityDate, Status, Description, CreatedDate FROM Task
>    ```
>    and
>    ```sql
>    SELECT Id, Subject, WhoId, WhatId, ActivityDate, Description, CreatedDate FROM Event
>    ```
>    Normalize: `Subject → subject`, `ActivityDate → due_date`, `Description → notes`. `WhoId` may map to a contact → `contact_id`. `WhatId` may map to an account → `account_id` or a deal → `deal_id` (it starts with `006` for Opportunity, `001` for Account). For Events, set `type = "Meeting"`. For Tasks, use `Type` if present else `"Task"`. Insert into Supabase `activities`.
>
> **Rules:**
> - Use **upsert** behavior by `id` so re-running is safe
> - Batch in groups of 100 per Supabase insert
> - After each object, print a summary: "Imported N accounts", etc.
> - If any row fails, print the error and continue — don't abort the whole migration
> - At the end, print a final summary with counts

---

## After migration completes

1. Open the CRM in a browser — your live URL (GitHub Pages or wherever you hosted it). Or for a quick check, open `index.html` from the repo locally.
2. You should see all your Salesforce data in the Lightning-styled CRM:
   - Accounts tab → every SF Account
   - Contacts tab → every SF Contact, linked to accounts
   - Opportunities tab → SF Opportunities grouped by stage in a Kanban board
   - Tasks tab → all SF Tasks & Events

## Troubleshooting

**"Permission denied to insert into Supabase"** — the Supabase anon key has RLS rules. Check your Supabase project → Authentication → Policies for the table. Add a permissive policy for the `anon` role, e.g.:
```sql
create policy "allow all" on accounts for all using (true) with check (true);
-- repeat for contacts, deals, activities
```

**"Query returned too many rows"** — Salesforce queries are capped at 50k. If your org is larger, ask Claude to paginate using `OFFSET` or `WHERE CreatedDate >` batches.

**"Stage names don't match"** — SF stage names may differ from the CRM's default (Prospect, Pitch, Mandate, Due Diligence, Negotiation, Closed Won, Closed Lost). Ask Claude to map them, or add new kanban columns if you have custom SF stages.

## Re-run?
Just paste the same prompt again. Supabase upsert by `id` is idempotent — nothing duplicates.
