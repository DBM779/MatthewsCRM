#!/usr/bin/env node
// sync-salesforce.mjs — One command: pulls SF data, opens CRM with it loaded.
// Usage: node sync-salesforce.mjs
// Prereqs: sf CLI installed + logged in (you already did this)

import { execSync, exec as execCb } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { platform } from 'node:os';

const log = (...a) => console.log('[sync]', ...a);

function sfQuery(soql) {
  log(`SOQL → ${soql.replace(/\s+/g,' ').trim().slice(0, 90)}…`);
  const out = execSync(`sf data query --query "${soql.replace(/"/g, '\\"').replace(/\s+/g,' ').trim()}" --result-format json`, { maxBuffer: 200 * 1024 * 1024 });
  const rows = JSON.parse(out.toString())?.result?.records || [];
  log(`  → ${rows.length} rows`);
  return rows;
}

const addr = (r, prefix) => {
  const parts = [r[`${prefix}Street`], [r[`${prefix}City`], r[`${prefix}State`], r[`${prefix}PostalCode`]].filter(Boolean).join(' ')].filter(Boolean);
  return parts.join(', ').replace(/\n/g, ' ').trim();
};

log('Starting Salesforce sync…\n');

// --- ACCOUNTS ---
log('── Accounts ──');
const accounts = sfQuery(`SELECT Id, Name, Industry, Website, BillingStreet, BillingCity, BillingState, BillingPostalCode, Type, Description, CreatedDate FROM Account ORDER BY CreatedDate`);
const accountRows = accounts.map(a => ({
  id: a.Id, name: a.Name || 'Unnamed', industry: a.Industry || null, website: a.Website || null,
  address: addr(a, 'Billing') || null, type: a.Type || null, notes: a.Description || null,
  created_at: a.CreatedDate || new Date().toISOString(),
}));

// --- CONTACTS ---
log('── Contacts ──');
const contacts = sfQuery(`SELECT Id, FirstName, LastName, Email, MobilePhone, Phone, HomePhone, OtherPhone, Fax, MailingStreet, MailingCity, MailingState, MailingPostalCode, MailingCountry, AccountId, Title, Department, LeadSource, Birthdate, Description, AssistantName, AssistantPhone, CreatedDate FROM Contact ORDER BY CreatedDate`);
const contactRows = contacts.map(c => ({
  id: c.Id, name: [c.FirstName, c.LastName].filter(Boolean).join(' ').trim() || 'Unnamed',
  email: c.Email || null, mobile: c.MobilePhone || null, phone: c.Phone || null,
  home_phone: c.HomePhone || null, other_phone: c.OtherPhone || null, fax: c.Fax || null,
  address: addr(c, 'Mailing') || null, mailing_country: c.MailingCountry || null,
  account_id: c.AccountId || null, accountId: c.AccountId || null,
  tier: '3', title: c.Title || null, department: c.Department || null,
  lead_source: c.LeadSource || null, birthdate: c.Birthdate || null,
  assistant_name: c.AssistantName || null, assistant_phone: c.AssistantPhone || null,
  notes: c.Description || null, created_at: c.CreatedDate || new Date().toISOString(),
}));

// Try custom fields (may not exist in all orgs)
try {
  const custom = sfQuery(`SELECT Id, VIP__c, Tier__c, Instagram__c, LinkedIn__c, LISN_Profile__c, LinkedIn_Profile__c, Last_Activity_Display__c, Days_Since_Last_Activity__c, Activity_Status__c FROM Contact`);
  const customMap = {};
  custom.forEach(c => customMap[c.Id] = c);
  contactRows.forEach(c => {
    const cx = customMap[c.id];
    if (!cx) return;
    if (cx.Tier__c) c.tier = cx.Tier__c;
    c.vip = cx.VIP__c || false;
    c.instagram = cx.Instagram__c || null;
    c.linkedin = cx.LinkedIn__c || null;
    c.lisn_profile = cx.LISN_Profile__c || null;
    c.linkedin_profile = cx.LinkedIn_Profile__c || null;
    c.la = cx.Last_Activity_Display__c || null;
    c.last_activity_display = cx.Last_Activity_Display__c || null;
    c.days_since_last_activity = cx.Days_Since_Last_Activity__c ?? null;
    c.activity_status = cx.Activity_Status__c || null;
  });
  log('  → Custom fields merged');
} catch (e) { log('  → No custom fields found (OK)'); }

// --- OPPORTUNITIES ---
log('── Opportunities ──');
const opps = sfQuery(`SELECT Id, Name, AccountId, Amount, StageName, Probability, CloseDate, Description, CreatedDate FROM Opportunity ORDER BY CreatedDate`);
const dealRows = opps.map(d => ({
  id: d.Id, name: d.Name || 'Unnamed', account_id: d.AccountId || null, accountId: d.AccountId || null,
  value: d.Amount != null ? d.Amount / 1_000_000 : null, stage: d.StageName || 'Prospect',
  probability: d.Probability ?? null, closeDate: d.CloseDate || null, close_date: d.CloseDate || null,
  notes: d.Description || null, created_at: d.CreatedDate || new Date().toISOString(),
}));

// --- TASKS + EVENTS ---
log('── Tasks ──');
const tasks = sfQuery(`SELECT Id, Subject, Type, WhoId, WhatId, ActivityDate, Status, Description, CreatedDate FROM Task ORDER BY CreatedDate`);
log('── Events ──');
const events = sfQuery(`SELECT Id, Subject, WhoId, WhatId, ActivityDate, Description, CreatedDate FROM Event ORDER BY CreatedDate`);

const mapRef = (id) => {
  if (!id) return {};
  if (id.startsWith('003')) return { contactId: id, contact_id: id };
  if (id.startsWith('001')) return { accountId: id, account_id: id };
  if (id.startsWith('006')) return { dealId: id, deal_id: id };
  return {};
};

const activityRows = [
  ...tasks.map(t => ({
    id: t.Id, type: t.Type || 'Task', subject: t.Subject || '(no subject)',
    ...mapRef(t.WhoId), ...mapRef(t.WhatId),
    dueDate: t.ActivityDate || null, due_date: t.ActivityDate || null,
    status: t.Status || 'Open', notes: t.Description || null,
    createdAt: t.CreatedDate || new Date().toISOString(), created_at: t.CreatedDate || new Date().toISOString(),
  })),
  ...events.map(e => ({
    id: e.Id, type: 'Meeting', subject: e.Subject || '(no subject)',
    ...mapRef(e.WhoId), ...mapRef(e.WhatId),
    dueDate: e.ActivityDate || null, due_date: e.ActivityDate || null,
    status: 'Closed', notes: e.Description || null,
    createdAt: e.CreatedDate || new Date().toISOString(), created_at: e.CreatedDate || new Date().toISOString(),
  })),
];

const output = { accounts: accountRows, contacts: contactRows, deals: dealRows, activities: activityRows };

// Save backup
writeFileSync('salesforce-export.json', JSON.stringify(output, null, 2));
log(`\nBackup saved → salesforce-export.json`);
log(`  ${accountRows.length} accounts, ${contactRows.length} contacts, ${dealRows.length} deals, ${activityRows.length} activities\n`);

// Start temp server so the CRM can fetch the data
log('Starting sync server on http://localhost:9876 …');
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(output));
  // Auto-shutdown after serving the data
  setTimeout(() => { log('Data served. Shutting down sync server.'); server.close(); process.exit(0); }, 2000);
});
server.listen(9876, () => {
  const url = 'https://dbm779.github.io/MatthewsCRM/#sync';
  log(`Opening CRM → ${url}`);
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  execCb(`${cmd} "${url}"`);
  log('Waiting for CRM to fetch data… (will auto-close in 30s)');
  setTimeout(() => { log('Timeout. Closing.'); process.exit(0); }, 30000);
});
