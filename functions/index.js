const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();
const { pool, initDb } = require('./db');

// Set Cloud SQL instance for all functions
const runtimeOpts = { memory: '256MB', timeoutSeconds: 60 };

// Verify Firebase Auth token
async function verifyAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) { res.status(401).json({error:'Unauthorized'}); return null; }
  try {
    return await admin.auth().verifyIdToken(auth.split('Bearer ')[1]);
  } catch { res.status(401).json({error:'Invalid token'}); return null; }
}

// Generic CRUD API for any table
exports.api = functions.runWith(runtimeOpts).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const user = await verifyAuth(req, res);
  if (!user) return;

  await initDb();

  const parts = req.path.split('/').filter(Boolean);
  const table = parts[0];
  const id = parts[1];
  const allowed = ['contacts','accounts','deals','activities','events','investors','connections','referrals','emails','deal_contacts','audit_log','activity_checklist','activity_comments','activity_attachments','event_guests','event_budget','event_checklist','event_potluck','deal_ic_votes','deal_dd_status','investor_comms','contact_files','ig_messages'];

  if (!table || !allowed.includes(table)) { res.status(400).json({error:'Invalid table: ' + table}); return; }

  try {
    if (req.method === 'GET' && !id) {
      // List all records
      const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY created_at DESC`);
      res.json(rows);

    } else if (req.method === 'GET' && id) {
      // Get single record
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      if (!rows.length) { res.status(404).json({error:'Not found'}); return; }
      res.json(rows[0]);

    } else if (req.method === 'POST') {
      // Create record
      const data = req.body;
      const keys = Object.keys(data);
      const vals = Object.values(data);
      const placeholders = keys.map((_, i) => '$' + (i + 1));
      const { rows } = await pool.query(
        `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
        vals
      );
      res.status(201).json(rows[0]);

    } else if (req.method === 'PUT' && id) {
      // Update record
      const data = req.body;
      data.updated_at = new Date().toISOString();
      const keys = Object.keys(data);
      const vals = Object.values(data);
      const sets = keys.map((k, i) => `${k} = $${i + 1}`);
      vals.push(id);
      const { rows } = await pool.query(
        `UPDATE ${table} SET ${sets.join(',')} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      if (!rows.length) { res.status(404).json({error:'Not found'}); return; }
      res.json(rows[0]);

    } else if (req.method === 'DELETE' && id) {
      // Delete record
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      res.json({deleted: true});

    } else {
      res.status(405).json({error:'Method not allowed'});
    }
  } catch (e) {
    console.error('API error:', e.message);
    res.status(500).json({error: e.message});
  }
});

// Bulk data endpoint for initial load and migration
exports.bulk = functions.runWith(runtimeOpts).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const user = await verifyAuth(req, res);
  if (!user) return;

  await initDb();

  try {
    if (req.method === 'GET') {
      // Load all data at once
      const tables = ['contacts','accounts','deals','activities','events','investors','connections','referrals','emails','deal_contacts'];
      const data = {};
      for (const t of tables) {
        const { rows } = await pool.query(`SELECT * FROM ${t} ORDER BY created_at DESC`);
        data[t] = rows;
      }
      res.json(data);

    } else if (req.method === 'POST') {
      // Bulk import
      const data = req.body;
      let imported = 0;
      for (const [table, records] of Object.entries(data)) {
        if (!Array.isArray(records)) continue;
        for (const record of records) {
          const keys = Object.keys(record);
          const vals = Object.values(record);
          const placeholders = keys.map((_, i) => '$' + (i + 1));
          try {
            await pool.query(
              `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders.join(',')}) ON CONFLICT (id) DO NOTHING`,
              vals
            );
            imported++;
          } catch (e) { console.log('Skip:', table, record.id, e.message); }
        }
      }
      res.json({imported});
    }
  } catch (e) {
    console.error('Bulk error:', e.message);
    res.status(500).json({error: e.message});
  }
});

// Health check / setup verification
// Gmail OAuth - server-side token exchange
exports.gmailAuth = functions.runWith(runtimeOpts).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const user = await verifyAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    // Return OAuth URL for user to visit
    const clientId = '952660161996-el5663ja1ns7q1mg7h90fm471am7kqgd.apps.googleusercontent.com';
    const redirectUri = 'https://us-central1-tmc-crm-f3728.cloudfunctions.net/gmailCallback';
    const scope = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
    const state = user.uid;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}&state=${state}&prompt=consent`;
    res.json({ url });
  }
});

// Gmail OAuth callback - receives token from Google
exports.gmailCallback = functions.runWith(runtimeOpts).https.onRequest(async (req, res) => {
  // Google redirects here with token in hash fragment
  // Since hash fragments aren't sent to server, we use a page to extract it
  res.send(`<!DOCTYPE html><html><body><script>
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');
    const expiresIn = params.get('expires_in');
    if (token) {
      window.opener ? window.opener.postMessage({gmailToken: token, expiresIn}, '*') : null;
      document.body.innerHTML = '<h2>Connected! You can close this window.</h2>';
      localStorage.setItem('matthewsCRM_gmailToken', token);
      localStorage.setItem('matthewsCRM_gmailExpiry', Date.now() + (parseInt(expiresIn||3600) * 1000));
      setTimeout(() => window.close(), 2000);
    } else {
      document.body.innerHTML = '<h2>Error connecting. Please try again.</h2><pre>' + hash + '</pre>';
    }
  </script></body></html>`);
});

exports.health = functions.runWith(runtimeOpts).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    await initDb();
    const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    res.json({ status: 'ok', tables: rows.map(r => r.tablename) });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});
