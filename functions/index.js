const functions = require('firebase-functions');
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
  const allowed = ['contacts','accounts','deals','activities','events','investors','connections','referrals','emails','deal_contacts','audit_log','activity_checklist','activity_comments','activity_attachments','event_guests','event_budget','event_checklist','event_potluck','deal_ic_votes','deal_dd_status','investor_comms','contact_files','ig_messages','email_campaigns','tracked_documents','email_tracking','document_views'];

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

// === EMAIL & DOCUMENT TRACKING ===

// 1x1 transparent pixel for email open tracking
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

exports.track = functions.runWith(runtimeOpts).https.onRequest(async (req, res) => {
  await initDb();
  const { t, c, cid, e } = req.query; // t=type, c=campaignId, cid=contactId, e=email
  try {
    if (t === 'open') {
      await pool.query(
        'INSERT INTO email_tracking (campaign_id, contact_id, email_to, type, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6)',
        [c||null, cid||null, e||null, 'open', req.ip, req.headers['user-agent']||'']
      );
      if (c) await pool.query('UPDATE email_campaigns SET open_count = open_count + 1 WHERE id = $1', [c]);
      res.set('Content-Type', 'image/gif');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.send(PIXEL);
    } else if (t === 'click') {
      const url = req.query.url;
      await pool.query(
        'INSERT INTO email_tracking (campaign_id, contact_id, email_to, type, url, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c||null, cid||null, e||null, 'click', url||'', req.ip, req.headers['user-agent']||'']
      );
      if (c) await pool.query('UPDATE email_campaigns SET click_count = click_count + 1 WHERE id = $1', [c]);
      res.redirect(url || 'https://tmc-crm-f3728.web.app');
    } else {
      res.status(400).send('Invalid tracking type');
    }
  } catch (err) {
    console.error('Tracking error:', err.message);
    if (t === 'open') { res.set('Content-Type', 'image/gif'); res.send(PIXEL); }
    else res.redirect(req.query.url || 'https://tmc-crm-f3728.web.app');
  }
});

// Document viewer with page-level tracking
exports.doc = functions.runWith(runtimeOpts).https.onRequest(async (req, res) => {
  await initDb();
  const docId = req.path.split('/').filter(Boolean)[0];
  if (!docId) { res.status(404).send('Document not found'); return; }

  if (req.method === 'POST') {
    // Log page view from client-side JS
    const { page, timeSpent, contactId } = req.body || {};
    try {
      await pool.query(
        'INSERT INTO document_views (doc_id, contact_id, page_number, time_spent, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6)',
        [docId, contactId||null, page||0, timeSpent||0, req.ip, req.headers['user-agent']||'']
      );
      res.json({ok: true});
    } catch (err) { res.status(500).json({error: err.message}); }
    return;
  }

  // GET - serve the document viewer
  try {
    const { rows } = await pool.query('SELECT * FROM tracked_documents WHERE id = $1', [docId]);
    if (!rows.length) { res.status(404).send('Document not found'); return; }
    const doc = rows[0];
    await pool.query('UPDATE tracked_documents SET total_views = total_views + 1 WHERE id = $1', [docId]);

    // Serve a Google Drive embed viewer with tracking
    res.send(`<!DOCTYPE html>
<html><head>
<title>${doc.name}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font-family:Arial;} iframe{width:100%;height:calc(100vh - 40px);border:none;} .bar{height:40px;background:#16325c;color:#fff;display:flex;align-items:center;padding:0 16px;font-size:14px;}</style>
</head><body>
<div class="bar">${doc.name}</div>
<iframe src="https://drive.google.com/file/d/${doc.file_url.match(/[-\w]{25,}/)?.[0] || ''}/preview"></iframe>
<script>
let startTime = Date.now();
let currentPage = 1;
function logTime() {
  const spent = Math.floor((Date.now() - startTime) / 1000);
  if (spent > 2) {
    fetch('https://us-central1-tmc-crm-f3728.cloudfunctions.net/doc/${docId}', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({page: currentPage, timeSpent: spent, contactId: '${doc.contact_id||''}'})
    }).catch(() => {});
  }
  startTime = Date.now();
}
setInterval(logTime, 30000);
window.addEventListener('beforeunload', logTime);
</script>
</body></html>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// Campaign analytics endpoint
exports.analytics = functions.runWith(runtimeOpts).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const user = await verifyAuth(req, res);
  if (!user) return;
  await initDb();

  const parts = req.path.split('/').filter(Boolean);
  const type = parts[0]; // 'campaigns', 'documents', 'events'
  const id = parts[1];

  try {
    if (type === 'campaigns' && !id) {
      const { rows } = await pool.query('SELECT * FROM email_campaigns ORDER BY created_at DESC');
      res.json(rows);
    } else if (type === 'campaigns' && id) {
      const { rows: campaign } = await pool.query('SELECT * FROM email_campaigns WHERE id = $1', [id]);
      const { rows: events } = await pool.query('SELECT * FROM email_tracking WHERE campaign_id = $1 ORDER BY created_at DESC', [id]);
      res.json({ campaign: campaign[0], events });
    } else if (type === 'documents' && !id) {
      const { rows } = await pool.query('SELECT * FROM tracked_documents ORDER BY created_at DESC');
      res.json(rows);
    } else if (type === 'documents' && id) {
      const { rows: doc } = await pool.query('SELECT * FROM tracked_documents WHERE id = $1', [id]);
      const { rows: views } = await pool.query('SELECT * FROM document_views WHERE doc_id = $1 ORDER BY created_at DESC', [id]);
      res.json({ document: doc[0], views });
    } else if (type === 'contact' && id) {
      const { rows: opens } = await pool.query('SELECT * FROM email_tracking WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 50', [id]);
      const { rows: docViews } = await pool.query('SELECT dv.*, td.name as doc_name FROM document_views dv JOIN tracked_documents td ON dv.doc_id = td.id WHERE dv.contact_id = $1 ORDER BY dv.created_at DESC LIMIT 50', [id]);
      res.json({ opens, docViews });
    } else {
      res.status(400).json({error: 'Invalid analytics path'});
    }
  } catch (err) { res.status(500).json({error: err.message}); }
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
