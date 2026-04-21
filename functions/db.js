const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  password: 'Davimatt311414!',
  database: 'matthews_crm',
  host: '/cloudsql/tmc-crm-f3728:us-central1:crm-db',
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, industry TEXT, website TEXT, address TEXT,
    type TEXT DEFAULT 'Prospect', drive_link TEXT, notes TEXT, ownership NUMERIC,
    acq_date DATE, entry_val NUMERIC, current_val NUMERIC, invested NUMERIC,
    revenue NUMERIC, ebitda NUMERIC, port_status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT, tier TEXT DEFAULT '5', vip TEXT,
    obligation TEXT, pc_number TEXT, wc_number TEXT, pe_email TEXT, we_email TEXT,
    email TEXT, mobile TEXT, phone TEXT, home_phone TEXT, other_phone TEXT, fax TEXT,
    assistant_name TEXT, assistant_phone TEXT, address TEXT, mailing_city TEXT,
    mailing_state TEXT, mailing_country TEXT, birthdate DATE, lead_source TEXT,
    referred_by TEXT, instagram TEXT, facebook TEXT, linkedin TEXT, linkedin_profile TEXT,
    tags TEXT, playbook TEXT, notes TEXT, general_notes TEXT, la DATE,
    pinned BOOLEAN DEFAULT FALSE, account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, stage TEXT DEFAULT 'Prospect', value NUMERIC DEFAULT 0,
    probability INTEGER DEFAULT 0, sector TEXT, source TEXT, source_contact TEXT, close_date DATE,
    fee_structure TEXT, asking_price NUMERIC, sde NUMERIC, owner_involvement TEXT, listing_url TEXT,
    counterparties TEXT, continuation_vehicle TEXT, tech_notes TEXT, notes TEXT, drive_link TEXT,
    stage_date DATE, account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, subject TEXT, status TEXT DEFAULT 'Not Started',
    priority TEXT DEFAULT 'Normal', due_date DATE, date_time TIMESTAMPTZ, notes TEXT,
    call_direction TEXT, call_duration INTEGER, call_result TEXT, location TEXT,
    end_date_time TIMESTAMPTZ, labels TEXT[], recurring TEXT, time_logged INTEGER DEFAULT 0,
    archived BOOLEAN DEFAULT FALSE, contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS activity_checklist (
    id SERIAL PRIMARY KEY, activity_id TEXT REFERENCES activities(id) ON DELETE CASCADE,
    text TEXT NOT NULL, done BOOLEAN DEFAULT FALSE, sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS activity_comments (
    id SERIAL PRIMARY KEY, activity_id TEXT REFERENCES activities(id) ON DELETE CASCADE,
    text TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS activity_attachments (
    id SERIAL PRIMARY KEY, activity_id TEXT REFERENCES activities(id) ON DELETE CASCADE,
    name TEXT NOT NULL, url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'Meeting', status TEXT DEFAULT 'Scheduled',
    start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, address TEXT, description TEXT, attendees TEXT,
    notes TEXT, recap TEXT, contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS event_guests (
    id SERIAL PRIMARY KEY, event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE, status TEXT DEFAULT 'Invited'
);
CREATE TABLE IF NOT EXISTS event_budget (
    id SERIAL PRIMARY KEY, event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
    item TEXT NOT NULL, amount NUMERIC DEFAULT 0, paid BOOLEAN DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS event_checklist (
    id SERIAL PRIMARY KEY, event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
    text TEXT NOT NULL, done BOOLEAN DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS event_potluck (
    id SERIAL PRIMARY KEY, event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
    item TEXT NOT NULL, who TEXT, claimed BOOLEAN DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS deal_contacts (
    id TEXT PRIMARY KEY, deal_id TEXT REFERENCES deals(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE, role TEXT
);
CREATE TABLE IF NOT EXISTS deal_ic_votes (
    id SERIAL PRIMARY KEY, deal_id TEXT REFERENCES deals(id) ON DELETE CASCADE,
    member TEXT NOT NULL, vote TEXT NOT NULL, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS deal_dd_status (
    id SERIAL PRIMARY KEY, deal_id TEXT REFERENCES deals(id) ON DELETE CASCADE,
    category TEXT NOT NULL, item_index INTEGER NOT NULL, done BOOLEAN DEFAULT FALSE,
    UNIQUE(deal_id, category, item_index)
);
CREATE TABLE IF NOT EXISTS investors (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, committed NUMERIC DEFAULT 0,
    called NUMERIC DEFAULT 0, distributed NUMERIC DEFAULT 0, status TEXT DEFAULT 'Active',
    notes TEXT, contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS investor_comms (
    id SERIAL PRIMARY KEY, investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
    type TEXT, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY, from_contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    to_contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    type TEXT DEFAULT 'Knows', context TEXT, strength TEXT DEFAULT 'medium',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY, from_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    to_id TEXT REFERENCES contacts(id) ON DELETE SET NULL, type TEXT,
    status TEXT DEFAULT 'Pending', date DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY, subject TEXT, from_addr TEXT, to_addr TEXT, body TEXT, date DATE,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY, record_type TEXT NOT NULL, record_id TEXT NOT NULL,
    record_name TEXT, field TEXT, old_value TEXT, new_value TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS contact_files (
    id SERIAL PRIMARY KEY, contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ig_messages (
    id SERIAL PRIMARY KEY, contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    from_name TEXT, text TEXT, date TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_tier ON contacts(tier);
CREATE INDEX IF NOT EXISTS idx_contacts_la ON contacts(la);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_due ON activities(due_date);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(record_type, record_id);
`;

let initialized = false;

async function initDb() {
  if (initialized) return;
  try {
    await pool.query(SCHEMA);
    initialized = true;
    console.log('Database tables created/verified');
  } catch (e) {
    console.error('DB init error:', e.message);
    throw e;
  }
}

module.exports = { pool, initDb };
