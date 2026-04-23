// Matthews CRM — Autonomous AI Functions
// Runs nightly via Cloud Scheduler to make the CRM self-improving

const { pool } = require('./db');

const GEMINI_KEY = 'AIzaSyA6fX9QfEB1Pehl8aJc8yoek2PhJHdYS88';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

async function askGemini(prompt) {
    try {
        const res = await fetch(GEMINI_URL, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: {maxOutputTokens: 2048, temperature: 0.7}})
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch { return null; }
}

// ============================================
// 1. NIGHTLY AI ANALYSIS
// ============================================
async function nightlyAIAnalysis() {
    console.log('[AI] Starting nightly analysis...');

    // Get key data
    const { rows: contacts } = await pool.query("SELECT id, name, tier, la, obligation FROM contacts WHERE tier IN ('1-VIP','2') ORDER BY la ASC NULLS FIRST LIMIT 50");
    const { rows: deals } = await pool.query("SELECT id, name, stage, value, probability, created_at FROM deals WHERE stage NOT IN ('Closed Won','Closed Lost') ORDER BY created_at ASC");
    const { rows: recentActs } = await pool.query("SELECT type, subject, contact_id, created_at FROM activities ORDER BY created_at DESC LIMIT 30");
    const { rows: staleVIPs } = await pool.query("SELECT name, la, tier FROM contacts WHERE tier = '1-VIP' AND (la IS NULL OR la < CURRENT_DATE - INTERVAL '14 days') ORDER BY la ASC NULLS FIRST LIMIT 10");

    const prompt = `You are an AI advisor for an investment banker's CRM. Analyze this data and generate exactly 5 actionable insights. Format each as: [PRIORITY: high/medium/low] TITLE: one line | BODY: 2-3 sentences of specific advice.

Stale VIP contacts (14+ days no contact): ${staleVIPs.map(c => c.name + ' (' + (c.la || 'never') + ')').join(', ') || 'None'}
Active deals: ${deals.map(d => d.name + ' - ' + d.stage + ' $' + d.value + 'M (' + d.probability + '%)').join(', ') || 'None'}
Recent activities: ${recentActs.slice(0,10).map(a => a.type + ': ' + (a.subject||'')).join(', ') || 'None'}
Total VIP contacts: ${contacts.filter(c => c.tier === '1-VIP').length}
Total Tier 2 contacts: ${contacts.filter(c => c.tier === '2').length}`;

    const result = await askGemini(prompt);
    if (!result) { console.log('[AI] Gemini returned no result'); return; }

    // Parse insights and store
    const lines = result.split('\n').filter(l => l.trim());
    let insightCount = 0;
    for (const line of lines) {
        const priorityMatch = line.match(/\[PRIORITY:\s*(high|medium|low)\]/i);
        const titleMatch = line.match(/TITLE:\s*(.+?)(?:\||$)/);
        const bodyMatch = line.match(/BODY:\s*(.+)/);
        if (titleMatch) {
            await pool.query(
                'INSERT INTO ai_insights (type, title, body, priority) VALUES ($1, $2, $3, $4)',
                ['nightly', titleMatch[1].trim(), bodyMatch ? bodyMatch[1].trim() : '', priorityMatch ? priorityMatch[1].toLowerCase() : 'normal']
            );
            insightCount++;
        }
    }
    console.log(`[AI] Generated ${insightCount} insights`);
}

// ============================================
// 2. SELF-HEALING DATA
// ============================================
async function selfHealingData() {
    console.log('[Data] Starting self-healing...');
    let fixes = 0;

    // Fix capitalization
    const { rows: badCaps } = await pool.query("SELECT id, name FROM contacts WHERE name ~ '^[a-z]' OR name ~ ' [a-z]'");
    for (const c of badCaps) {
        const fixed = c.name.replace(/\b\w/g, l => l.toUpperCase());
        if (fixed !== c.name) {
            await pool.query('UPDATE contacts SET name = $1 WHERE id = $2', [fixed, c.id]);
            await pool.query('INSERT INTO data_quality_log (action, record_type, record_id, details) VALUES ($1,$2,$3,$4)',
                ['fix_capitalization', 'contact', c.id, `${c.name} → ${fixed}`]);
            fixes++;
        }
    }

    // Fix phone number formatting
    const { rows: phones } = await pool.query("SELECT id, pc_number, wc_number, mobile FROM contacts WHERE pc_number IS NOT NULL OR wc_number IS NOT NULL OR mobile IS NOT NULL");
    for (const c of phones) {
        for (const field of ['pc_number', 'wc_number', 'mobile']) {
            const val = c[field];
            if (!val) continue;
            const digits = val.replace(/\D/g, '');
            if (digits.length === 10 && !val.includes('(')) {
                const formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
                await pool.query(`UPDATE contacts SET ${field} = $1 WHERE id = $2`, [formatted, c.id]);
                await pool.query('INSERT INTO data_quality_log (action, record_type, record_id, details) VALUES ($1,$2,$3,$4)',
                    ['format_phone', 'contact', c.id, `${field}: ${val} → ${formatted}`]);
                fixes++;
            } else if (digits.length === 11 && digits.startsWith('1')) {
                const formatted = `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
                await pool.query(`UPDATE contacts SET ${field} = $1 WHERE id = $2`, [formatted, c.id]);
                fixes++;
            }
        }
    }

    // Find and flag duplicates
    const { rows: dupes } = await pool.query("SELECT name, COUNT(*) as cnt FROM contacts GROUP BY LOWER(name) HAVING COUNT(*) > 1");
    for (const d of dupes) {
        await pool.query('INSERT INTO data_quality_log (action, record_type, record_id, details) VALUES ($1,$2,$3,$4)',
            ['duplicate_detected', 'contact', null, `"${d.name}" appears ${d.cnt} times`]);
    }

    // Archive old completed activities (90+ days)
    const { rowCount: archived } = await pool.query("UPDATE activities SET archived = TRUE WHERE status = 'Completed' AND created_at < CURRENT_DATE - INTERVAL '90 days' AND archived = FALSE");
    if (archived > 0) {
        await pool.query('INSERT INTO data_quality_log (action, record_type, record_id, details) VALUES ($1,$2,$3,$4)',
            ['auto_archive', 'activities', null, `Archived ${archived} completed activities older than 90 days`]);
        fixes += archived;
    }

    // Remove orphaned deal_contacts
    const { rowCount: orphans } = await pool.query("DELETE FROM deal_contacts WHERE deal_id NOT IN (SELECT id FROM deals) OR contact_id NOT IN (SELECT id FROM contacts)");
    if (orphans > 0) fixes += orphans;

    console.log(`[Data] Fixed ${fixes} issues, found ${dupes.length} potential duplicates`);
}

// ============================================
// 3. DEAL OUTCOME PREDICTOR
// ============================================
async function dealOutcomePredictor() {
    console.log('[Deals] Running outcome predictor...');

    const { rows: activeDeals } = await pool.query("SELECT d.*, a.name as account_name FROM deals d LEFT JOIN accounts a ON d.account_id = a.id WHERE d.stage NOT IN ('Closed Won','Closed Lost')");
    const { rows: wonDeals } = await pool.query("SELECT stage, value, probability, EXTRACT(EPOCH FROM (updated_at - created_at))/86400 as days_to_close FROM deals WHERE stage = 'Closed Won'");
    const { rows: lostDeals } = await pool.query("SELECT stage, value, probability, EXTRACT(EPOCH FROM (updated_at - created_at))/86400 as days_to_close FROM deals WHERE stage = 'Closed Lost'");

    if (activeDeals.length === 0) return;

    const avgWinDays = wonDeals.length ? wonDeals.reduce((s,d) => s + (d.days_to_close||0), 0) / wonDeals.length : 90;

    for (const deal of activeDeals) {
        const daysActive = Math.floor((Date.now() - new Date(deal.created_at).getTime()) / 86400000);
        const { rows: acts } = await pool.query("SELECT COUNT(*) as cnt FROM activities WHERE deal_id = $1", [deal.id]);
        const actCount = parseInt(acts[0].cnt);
        const { rows: lastAct } = await pool.query("SELECT created_at FROM activities WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 1", [deal.id]);
        const daysSinceAct = lastAct.length ? Math.floor((Date.now() - new Date(lastAct[0].created_at).getTime()) / 86400000) : 999;

        // Risk signals
        const risks = [];
        if (daysSinceAct > 14) risks.push(`No activity in ${daysSinceAct} days`);
        if (daysActive > avgWinDays * 1.5) risks.push(`Taking ${Math.round(daysActive/avgWinDays*100)}% longer than average win`);
        if (actCount < 3 && deal.stage !== 'Prospect') risks.push(`Only ${actCount} activities logged`);
        if (deal.probability < 30 && deal.stage === 'Negotiation') risks.push('Low probability for late stage');

        if (risks.length >= 2) {
            await pool.query(
                'INSERT INTO ai_insights (type, title, body, priority, record_type, record_id) VALUES ($1,$2,$3,$4,$5,$6)',
                ['deal_risk', `${deal.name} at risk`, risks.join('. '), 'high', 'deal', deal.id]
            );
        }
    }
    console.log(`[Deals] Analyzed ${activeDeals.length} active deals`);
}

// ============================================
// 4. CONTACT AUTO-SCORING
// ============================================
async function contactAutoScoring() {
    console.log('[Scoring] Updating contact scores...');

    const { rows: contacts } = await pool.query("SELECT id, tier, la FROM contacts");

    for (const c of contacts) {
        // Engagement: based on activity frequency
        const { rows: actRows } = await pool.query("SELECT COUNT(*) as cnt FROM activities WHERE contact_id = $1 AND created_at > CURRENT_DATE - INTERVAL '90 days'", [c.id]);
        const recentActs = parseInt(actRows[0].cnt);
        const engagementScore = Math.min(recentActs * 10, 100);

        // Referral: how many deals they're linked to
        const { rows: dealRows } = await pool.query("SELECT COUNT(*) as cnt FROM deal_contacts WHERE contact_id = $1", [c.id]);
        const dealLinks = parseInt(dealRows[0].cnt);
        const referralScore = Math.min(dealLinks * 20, 100);

        // Network: how many connections
        const { rows: connRows } = await pool.query("SELECT COUNT(*) as cnt FROM connections WHERE from_contact_id = $1 OR to_contact_id = $1", [c.id]);
        const connections = parseInt(connRows[0].cnt);
        const networkScore = Math.min(connections * 15, 100);

        // Response: recency of last activity
        const daysAgo = c.la ? Math.floor((Date.now() - new Date(c.la).getTime()) / 86400000) : 365;
        const responseScore = Math.max(0, 100 - daysAgo);

        // Composite
        const composite = Math.round(engagementScore * 0.3 + referralScore * 0.25 + networkScore * 0.2 + responseScore * 0.25);

        // Suggested tier
        let suggestedTier = '5';
        if (composite >= 80) suggestedTier = '1-VIP';
        else if (composite >= 60) suggestedTier = '2';
        else if (composite >= 40) suggestedTier = '3';
        else if (composite >= 20) suggestedTier = '4';

        await pool.query(`INSERT INTO contact_scores (contact_id, engagement_score, referral_score, network_score, response_score, composite_score, suggested_tier, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
            ON CONFLICT (contact_id) DO UPDATE SET engagement_score=$2, referral_score=$3, network_score=$4, response_score=$5, composite_score=$6, suggested_tier=$7, updated_at=NOW()`,
            [c.id, engagementScore, referralScore, networkScore, responseScore, composite, suggestedTier]);
    }

    // Generate insights for contacts whose suggested tier differs from actual
    const { rows: mismatches } = await pool.query(`SELECT c.name, c.tier, cs.suggested_tier, cs.composite_score
        FROM contacts c JOIN contact_scores cs ON c.id = cs.contact_id
        WHERE c.tier != cs.suggested_tier AND cs.composite_score > 60 AND c.tier NOT IN ('1-VIP','2')
        ORDER BY cs.composite_score DESC LIMIT 5`);

    for (const m of mismatches) {
        await pool.query(
            'INSERT INTO ai_insights (type, title, body, priority, record_type) VALUES ($1,$2,$3,$4,$5)',
            ['tier_suggestion', `Consider upgrading ${m.name}`, `Current tier: ${m.tier}. Engagement suggests: ${m.suggested_tier} (score: ${m.composite_score}/100).`, 'medium', 'contact']
        );
    }

    console.log(`[Scoring] Updated ${contacts.length} contact scores`);
}

// ============================================
// 5. AUTO-GENERATED CONTENT
// ============================================
async function autoGenerateContent() {
    console.log('[Content] Generating weekly content...');

    const { rows: wonDeals } = await pool.query("SELECT name, value FROM deals WHERE stage = 'Closed Won' AND updated_at > CURRENT_DATE - INTERVAL '7 days'");
    const { rows: newDeals } = await pool.query("SELECT name, stage, value FROM deals WHERE created_at > CURRENT_DATE - INTERVAL '7 days' AND stage NOT IN ('Closed Won','Closed Lost')");
    const { rows: topContacts } = await pool.query("SELECT c.name FROM contacts c JOIN contact_scores cs ON c.id = cs.contact_id ORDER BY cs.composite_score DESC LIMIT 5");

    const prompt = `Write a brief weekly CRM summary for an investment banker. Keep it under 150 words. Professional but casual tone.

This week:
- Deals won: ${wonDeals.map(d => d.name + ' ($' + d.value + 'M)').join(', ') || 'None'}
- New pipeline: ${newDeals.map(d => d.name + ' - ' + d.stage).join(', ') || 'None'}
- Top engaged contacts: ${topContacts.map(c => c.name).join(', ') || 'N/A'}

Format as a brief executive summary with bullet points.`;

    const result = await askGemini(prompt);
    if (result) {
        await pool.query(
            'INSERT INTO ai_insights (type, title, body, priority) VALUES ($1,$2,$3,$4)',
            ['weekly_summary', 'Weekly CRM Summary', result, 'low']
        );
    }
    console.log('[Content] Weekly summary generated');
}

// ============================================
// MASTER FUNCTION: runs all autonomous tasks
// ============================================
async function runAllAutonomous() {
    console.log('=== AUTONOMOUS CRM RUN STARTING ===');
    const start = Date.now();

    // Clear old insights (keep last 7 days)
    await pool.query("DELETE FROM ai_insights WHERE created_at < CURRENT_DATE - INTERVAL '7 days'");

    try { await selfHealingData(); } catch(e) { console.error('[Data] Error:', e.message); }
    try { await contactAutoScoring(); } catch(e) { console.error('[Scoring] Error:', e.message); }
    try { await dealOutcomePredictor(); } catch(e) { console.error('[Deals] Error:', e.message); }
    try { await nightlyAIAnalysis(); } catch(e) { console.error('[AI] Error:', e.message); }

    // Weekly content on Mondays
    if (new Date().getDay() === 1) {
        try { await autoGenerateContent(); } catch(e) { console.error('[Content] Error:', e.message); }
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`=== AUTONOMOUS RUN COMPLETE (${elapsed}s) ===`);
}

module.exports = { runAllAutonomous, nightlyAIAnalysis, selfHealingData, dealOutcomePredictor, contactAutoScoring, autoGenerateContent };
