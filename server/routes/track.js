const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { verifyToken } = require('../lib/token');
const { sendTeamsNotification, sendEmailNotification } = require('../lib/notify');

// Validate watchSecs - returns null if invalid (reject the request)
function sanitizeWatchSecs(watchSecs) {
  if (watchSecs === undefined || watchSecs === null) return null;
  const parsed = parseInt(watchSecs);
  if (isNaN(parsed) || parsed < 0 || parsed > 86400) return null;
  return parsed;
}

// Shared logic for processing track data
async function processTrackData({ videoId, watchSecs, viewerToken, sessionId }) {
  let viewerEmail = null;
  let viewerName = null;

  // Decode viewer token if present
  if (viewerToken) {
    const payload = verifyToken(viewerToken);
    if (payload && payload.v === videoId) { // Ensure token matches video
      viewerEmail = payload.e;
      viewerName = payload.n;
    }
  }

  // Get video info for percentage calculation
  const video = db.prepare('SELECT title, duration_secs FROM videos WHERE id = ?').get(videoId);
  const duration = video?.duration_secs || 0;
  const watchPercent = duration > 0 ? (watchSecs / duration) * 100 : 0;

  // Get existing view
  const existing = db.prepare(
    'SELECT * FROM views WHERE video_id = ? AND session_id = ?'
  ).get(videoId, sessionId);

  const previousPercent = existing && duration > 0
    ? (existing.watch_secs / duration) * 100
    : 0;

  // Upsert view with viewer info
  if (existing) {
    db.prepare(`
      UPDATE views
      SET watch_secs = ?,
          viewer_email = COALESCE(?, viewer_email),
          viewer_name = COALESCE(?, viewer_name),
          updated_at = datetime('now')
      WHERE video_id = ? AND session_id = ?
    `).run(watchSecs, viewerEmail, viewerName, videoId, sessionId);
  } else {
    db.prepare(`
      INSERT INTO views (id, video_id, session_id, watch_secs, viewer_email, viewer_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), videoId, sessionId, watchSecs, viewerEmail, viewerName);
  }

  // NOTIFICATION LOGIC
  // Check all enabled notification channels
  const allSettings = db.prepare('SELECT * FROM notification_settings WHERE enabled = 1').all();

  // Use lowest threshold from any enabled channel (default 50)
  const threshold = allSettings.length > 0
    ? Math.min(...allSettings.map(s => s.notify_threshold || 50))
    : 50;

  // Trigger if:
  // 1. We know who it is (viewerEmail)
  // 2. Crossed threshold just now (prev < threshold <= current)
  // 3. Not already notified
  const crossedThreshold = previousPercent < threshold && watchPercent >= threshold;
  const notAlreadyNotified = !existing?.notified_at;

  if (viewerEmail && crossedThreshold && notAlreadyNotified && allSettings.length > 0) {
    // Mark as notified immediately to prevent double-sends
    db.prepare(`
      UPDATE views SET notified_at = datetime('now')
      WHERE video_id = ? AND session_id = ?
    `).run(videoId, sessionId);

    const notificationData = {
      viewerEmail,
      viewerName,
      videoId,
      videoTitle: video?.title || 'Untitled',
      watchPercent: Math.round(watchPercent)
    };

    // Send to all enabled channels (don't await to avoid blocking)
    for (const setting of allSettings) {
      if (setting.channel === 'teams') {
        sendTeamsNotification(notificationData).catch(err => console.error('Teams notification error:', err));
      } else if (setting.channel === 'email') {
        sendEmailNotification(notificationData).catch(err => console.error('Email notification error:', err));
      }
    }
  }
}

// POST /api/track - Log video watch heartbeat
// ONLY tracks views with valid viewerToken (designated recipient)
router.post('/', async (req, res) => {
  try {
    const { videoId, watchSecs, viewerToken } = req.body;

    // No token = no tracking (anonymous views ignored)
    if (!viewerToken) {
      return res.json({ success: true, tracked: false, reason: 'no_token' });
    }

    // Validate UUID format
    if (!videoId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(videoId)) {
      return res.status(400).json({ error: 'valid videoId required' });
    }

    // Validate watchSecs
    const validWatchSecs = sanitizeWatchSecs(watchSecs);
    if (validWatchSecs === null) {
      return res.status(400).json({ error: 'invalid watchSecs (must be 0-86400)' });
    }

    // Verify token is valid before tracking
    const payload = verifyToken(viewerToken);
    if (!payload || payload.v !== videoId) {
      return res.json({ success: true, tracked: false, reason: 'invalid_token' });
    }

    // Get or create session ID
    let sessionId = req.cookies?.siduri_session;
    if (!sessionId) {
      sessionId = uuidv4();
      res.cookie('siduri_session', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });
    }

    await processTrackData({ videoId, watchSecs: validWatchSecs, viewerToken, sessionId });

    res.json({ success: true, tracked: true, sessionId });

  } catch (error) {
    console.error('Track error:', error);
    res.json({ success: false });
  }
});

// POST /api/track/beacon - For sendBeacon
// ONLY tracks views with valid viewerToken (designated recipient)
router.post('/beacon', express.text({ type: '*/*' }), async (req, res) => {
  try {
    let data;
    try {
      data = JSON.parse(req.body);
    } catch {
      return res.status(204).end();
    }
    const { videoId, watchSecs, viewerToken } = data;

    // No token = no tracking (anonymous views ignored)
    if (!viewerToken) {
      return res.status(204).end();
    }

    if (!videoId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(videoId)) {
      return res.status(204).end();
    }

    const validWatchSecs = sanitizeWatchSecs(watchSecs);
    if (validWatchSecs === null) {
      return res.status(204).end();
    }

    // Verify token is valid before tracking
    const payload = verifyToken(viewerToken);
    if (!payload || payload.v !== videoId) {
      return res.status(204).end();
    }

    let sessionId = req.cookies?.siduri_session;
    if (!sessionId) {
      sessionId = 'token-' + Date.now();
    }

    await processTrackData({ videoId, watchSecs: validWatchSecs, viewerToken, sessionId });

    res.status(204).end();

  } catch (error) {
    console.error('Beacon track error:', error);
    res.status(204).end();
  }
});

module.exports = router;