#!/usr/bin/env node
// migrate-from-salesforce.mjs
// One-shot migration: Salesforce → Matthews CRM (Supabase)
// Usage:  node migrate-from-salesforce.mjs
//
// Prereqs (you already have these):
//   1. sf CLI installed and logged in (sf org list should show your org)
//   2. Node 18+ (for fetch)
//
// Before running, open https://supabase.com/dashboard → your project → SQL Editor
// and paste the contents of supabase-setup.sql, click Run. Then run this script.

import { execSync } from 'node:child_process';

const SUPABASE_URL = 'https://bnkuieueimlyjovjilqi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Xj5u9741yzSNpZ7HXcY_iw_5JVrQmUN';

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates,return=minimal'
};

const log = (...a) => console.log('[migrate]', ...a);
const err = (...a) => console.error('[migrate][ERR]', ...a);

function sfQuery(soql) {
  log(`SOQL → ${soql.slice(0, 80)}${soql.length > 80 ? '…' : ''}`);
  const out = execSync(`sf data query --query "${soql.replace(/"/g, '\\"')}" --result-format json`, { maxBuffer: 200 * 1024 * 1024 });
  const parsed = JSON.parse(out.toString());
  const rows = parsed?.result?.records || [];
  log(`  → ${rows.length} rows`);
  return rows;
}

async function upsert(table, rows) {
  if (!rows.length) return 0;
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const body = await res.text();
        err(`${table} batch ${i}/${rows.length}: HTTP ${res.status} ${body.slice(0, 200)}`);
        // try one at a time so a single bad row doesn't kill the batch
        for (const row of batch) {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST', headers: HEADERS, body: JSON.stringify([row]),
          });
          if (r.ok) ok++; else { fail++; if (fail < 5) err(`  row ${row.id}: HTTP ${r.status} ${(await r.text()).slice(0,120)}`); }
        }
      } else {
        ok += batch.length;
      }
    } catch (e) {
      err(`${table} batch ${i}: ${e.message}`);
      fail += batch.length;
    }
    process.stdout.write(`\r  ${table}: ${ok} ok, ${fail} fail (${i + batch.length}/${rows.length})`);
  }
  process.stdout.write('\n');
  return ok;
}

const addr = (r, prefix) => {
  const parts = [r[`${prefix}Street`], [r[`${prefix}City`], r[`${prefix}State`], r[`${prefix}PostalCode`]].filter(Boolean).join(' ')]
    .filter(Boolean);
  return parts.join(', ').replace(/\n/g, ' ').trim();
};

async function main() {
  log('Starting Salesforce → Matthews CRM migration\n');

  // ---------- ACCOUNTS ----------
  log('── Accounts ──');
  const accounts = sfQuery(`
    SELECT Id, Name, Industry, Website, BillingStreet, BillingCity, BillingState, BillingPostalCode,
           Type, Description, CreatedDate
    FROM Account ORDER BY CreatedDate`.replace(/\s+/g, ' ').trim());

  const accountRows = accounts.map(a => ({
    id: a.Id,
    name: a.Name || 'Unnamed',
    industry: a.Industry || null,
    website: a.Website || null,
    address: addr(a, 'Billing') || null,
    type: a.Type || null,
    notes: a.Description || null,
    created_at: a.CreatedDate || new Date().toISOString(),
  }));
  const accOk = await upsert('accounts', accountRows);
  log(`Accounts: ${accOk}/${accountRows.length} inserted\n`);

  // ---------- CONTACTS ----------
  log('── Contacts ──');
  const contacts = sfQuery(`
    SELECT Id, FirstName, LastName, Email, MobilePhone, Phone, MailingStreet, MailingCity, MailingState,
           MailingPostalCode, AccountId, Title, Birthdate, Description, CreatedDate
    FROM Contact ORDER BY CreatedDate`.replace(/\s+/g, ' ').trim());

  const contactRows = contacts.map(c => ({
    id: c.Id,
    name: [c.FirstName, c.LastName].filter(Boolean).join(' ').trim() || 'Unnamed',
    email: c.Email || null,
    mobile: c.MobilePhone || null,
    phone: c.Phone || null,
    address: addr(c, 'Mailing') || null,
    account_id: c.AccountId || null,
    tier: '3',
    title: c.Title || null,
    birthdate: c.Birthdate || null,
    notes: c.Description || null,
    created_at: c.CreatedDate || new Date().toISOString(),
  }));
  const conOk = await upsert('contacts', contactRows);
  log(`Contacts: ${conOk}/${contactRows.length} inserted\n`);

  // ---------- OPPORTUNITIES → DEALS ----------
  log('── Opportunities → Deals ──');
  const opps = sfQuery(`
    SELECT Id, Name, AccountId, Amount, StageName, Probability, CloseDate, Description, CreatedDate
    FROM Opportunity ORDER BY CreatedDate`.replace(/\s+/g, ' ').trim());

  const dealRows = opps.map(d => ({
    id: d.Id,
    name: d.Name || 'Unnamed',
    account_id: d.AccountId || null,
    value: d.Amount != null ? d.Amount / 1_000_000 : null,
    stage: d.StageName || 'Prospect',
    probability: d.Probability ?? null,
    close_date: d.CloseDate || null,
    notes: d.Description || null,
    created_at: d.CreatedDate || new Date().toISOString(),
  }));
  const dealOk = await upsert('deals', dealRows);
  log(`Deals: ${dealOk}/${dealRows.length} inserted\n`);

  // ---------- TASKS + EVENTS → ACTIVITIES ----------
  log('── Tasks + Events → Activities ──');
  const tasks = sfQuery(`
    SELECT Id, Subject, Type, WhoId, WhatId, ActivityDate, Status, Description, CreatedDate
    FROM Task ORDER BY CreatedDate`.replace(/\s+/g, ' ').trim());
  const events = sfQuery(`
    SELECT Id, Subject, WhoId, WhatId, ActivityDate, Description, CreatedDate
    FROM Event ORDER BY CreatedDate`.replace(/\s+/g, ' ').trim());

  const mapRef = (id) => {
    if (!id) return {};
    if (id.startsWith('003')) return { contact_id: id };
    if (id.startsWith('001')) return { account_id: id };
    if (id.startsWith('006')) return { deal_id: id };
    return {};
  };

  const taskRows = tasks.map(t => ({
    id: t.Id,
    type: t.Type || 'Task',
    subject: t.Subject || '(no subject)',
    ...mapRef(t.WhoId),
    ...mapRef(t.WhatId),
    due_date: t.ActivityDate || null,
    status: t.Status || 'Open',
    notes: t.Description || null,
    created_at: t.CreatedDate || new Date().toISOString(),
  }));

  const eventRows = events.map(e => ({
    id: e.Id,
    type: 'Meeting',
    subject: e.Subject || '(no subject)',
    ...mapRef(e.WhoId),
    ...mapRef(e.WhatId),
    due_date: e.ActivityDate || null,
    status: 'Closed',
    notes: e.Description || null,
    created_at: e.CreatedDate || new Date().toISOString(),
  }));

  const activityOk = await upsert('activities', [...taskRows, ...eventRows]);
  log(`Activities: ${activityOk}/${taskRows.length + eventRows.length} inserted\n`);

  log('══════════════════════════════════════════');
  log(`Migration complete.`);
  log(`  Accounts:   ${accOk}/${accountRows.length}`);
  log(`  Contacts:   ${conOk}/${contactRows.length}`);
  log(`  Deals:      ${dealOk}/${dealRows.length}`);
  log(`  Activities: ${activityOk}/${taskRows.length + eventRows.length}`);
  log(`\nOpen https://dbm779.github.io/MatthewsCRM/ and refresh to see your data.`);
}

main().catch(e => { err(e.stack || e.message); process.exit(1); });
