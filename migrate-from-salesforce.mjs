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
import { writeFileSync } from 'node:fs';

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

// All data collected in memory, then written to a single JSON file at the end
const output = { accounts: [], contacts: [], deals: [], activities: [] };

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
  output.accounts = accountRows;
  log(`Accounts: ${accountRows.length} extracted\n`);

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
  output.contacts = contactRows;
  log(`Contacts: ${contactRows.length} extracted\n`);

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
  output.deals = dealRows;
  log(`Deals: ${dealRows.length} extracted\n`);

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

  output.activities = [...taskRows, ...eventRows];
  log(`Activities: ${taskRows.length + eventRows.length} extracted\n`);

  // Write JSON file
  const outFile = 'salesforce-export.json';
  writeFileSync(outFile, JSON.stringify(output, null, 2));

  log('══════════════════════════════════════════');
  log(`Export complete → ${outFile}`);
  log(`  Accounts:   ${output.accounts.length}`);
  log(`  Contacts:   ${output.contacts.length}`);
  log(`  Deals:      ${output.deals.length}`);
  log(`  Activities: ${output.activities.length}`);
  log(`\nNext steps:`);
  log(`  1. Open https://dbm779.github.io/MatthewsCRM/`);
  log(`  2. Go to Setup → Import → Import Salesforce JSON`);
  log(`  3. Select the file: ${outFile}`);
  log(`  4. Done — your data is loaded.`);
}

main().catch(e => { err(e.stack || e.message); process.exit(1); });
