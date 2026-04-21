const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

// Auto-update last_activity_at on contact when activity is created
exports.onActivityCreate = functions.firestore
  .document('users/{uid}/activities/{actId}')
  .onCreate(async (snap, context) => {
    const act = snap.data();
    const uid = context.params.uid;
    const contactId = act.contactId || act.contact_id;
    if (!contactId) return;
    const today = new Date().toISOString().split('T')[0];
    try {
      await db.collection('users').doc(uid).collection('contacts').doc(contactId).update({
        la: today,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) { console.log('LA update skipped:', e.message); }
  });

// Daily backup to Cloud Storage (runs at 2am UTC)
exports.dailyBackup = functions.pubsub.schedule('0 2 * * *').onRun(async () => {
  const usersSnap = await db.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const bucket = admin.storage().bucket();
    const date = new Date().toISOString().split('T')[0];
    const file = bucket.file(`backups/${userDoc.id}/${date}.json`);
    await file.save(JSON.stringify(data), {contentType: 'application/json'});
  }
  console.log('Daily backup complete');
});

// Weekly digest: find VIP contacts needing follow-up (runs Monday 8am UTC)
exports.weeklyDigest = functions.pubsub.schedule('0 8 * * 1').onRun(async () => {
  const usersSnap = await db.collection('users').get();
  const today = new Date();
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data()?.data;
    if (!data?.contacts) continue;
    const vips = (data.contacts || []).filter(c => {
      if (c.tier !== '1-VIP') return false;
      if (!c.la) return true;
      const days = Math.floor((today - new Date(c.la)) / 86400000);
      return days >= 30;
    });
    if (vips.length) {
      console.log(`User ${userDoc.id}: ${vips.length} VIPs need follow-up: ${vips.map(c=>c.name).join(', ')}`);
      // Future: send email notification here
    }
  }
});
