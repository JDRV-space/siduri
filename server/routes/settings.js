const express = require('express');
const router = express.Router();
const { jwtAuth } = require('../middleware/jwtAuth');
const db = require('../lib/db');
const { v4: uuidv4 } = require('uuid');
const { sendTeamsNotification, sendEmailNotification } = require('../lib/notify');

// Get all notification settings
router.get('/notifications', jwtAuth, (req, res) => {
  try {
    const teams = db.prepare('SELECT * FROM notification_settings WHERE channel = ?').get('teams');
    const email = db.prepare('SELECT * FROM notification_settings WHERE channel = ?').get('email');

    res.json({
      teams: teams || { enabled: 0, notify_threshold: 50, webhook_url: '' },
      email: email || { enabled: 0, notify_threshold: 50, webhook_url: '' }
    });
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Save Teams notification settings
router.post('/notifications/teams', jwtAuth, (req, res) => {
  const { webhookUrl, threshold = 50, enabled = true } = req.body;

  if (!webhookUrl) {
    return res.status(400).json({ error: 'webhookUrl required' });
  }

  try {
    db.prepare('DELETE FROM notification_settings WHERE channel = ?').run('teams');
    db.prepare(`
      INSERT INTO notification_settings (id, channel, webhook_url, notify_threshold, enabled)
      VALUES (?, 'teams', ?, ?, ?)
    `).run(uuidv4(), webhookUrl, threshold, enabled ? 1 : 0);

    res.json({ success: true });
  } catch (err) {
    console.error('Save settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Save Email notification settings
router.post('/notifications/email', jwtAuth, (req, res) => {
  const { recipientEmail, threshold = 50, enabled = true } = req.body;

  if (!recipientEmail) {
    return res.status(400).json({ error: 'recipientEmail required' });
  }

  try {
    db.prepare('DELETE FROM notification_settings WHERE channel = ?').run('email');
    db.prepare(`
      INSERT INTO notification_settings (id, channel, webhook_url, notify_threshold, enabled)
      VALUES (?, 'email', ?, ?, ?)
    `).run(uuidv4(), recipientEmail, threshold, enabled ? 1 : 0);

    res.json({ success: true });
  } catch (err) {
    console.error('Save settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Test Teams notification
router.post('/notifications/teams/test', jwtAuth, async (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM notification_settings WHERE channel = ? AND enabled = 1').get('teams');

    if (!settings?.webhook_url) {
      return res.status(400).json({ error: 'Teams webhook not configured' });
    }

    const result = await sendTeamsNotification({
      viewerEmail: 'test@example.com',
      viewerName: 'Test User',
      videoId: 'test-video-id',
      videoTitle: 'Test Video',
      watchPercent: 75
    });

    if (result?.success) {
      res.json({ success: true, message: 'Test notification sent to Teams' });
    } else {
      res.status(500).json({ error: `Teams notification failed: ${result?.error || 'unknown error'}` });
    }
  } catch (err) {
    console.error('Test notification error:', err);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Test Email notification
router.post('/notifications/email/test', jwtAuth, async (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM notification_settings WHERE channel = ? AND enabled = 1').get('email');

    if (!settings?.webhook_url) {
      return res.status(400).json({ error: 'Email notifications not configured' });
    }

    const result = await sendEmailNotification({
      viewerEmail: 'test@example.com',
      viewerName: 'Test User',
      videoId: 'test-video-id',
      videoTitle: 'Test Video',
      watchPercent: 75
    });

    if (result?.success) {
      res.json({ success: true, message: `Test email sent to ${settings.webhook_url}` });
    } else {
      res.status(500).json({ error: `Email notification failed: ${result?.error || 'unknown error'}` });
    }
  } catch (err) {
    console.error('Test notification error:', err);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

module.exports = router;
