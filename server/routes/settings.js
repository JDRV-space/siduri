const express = require('express');
const router = express.Router();
const { jwtAuth } = require('../middleware/jwtAuth');
const { requireAdminOrOwner } = require('../middleware/requireRole');
const {
  getNotificationSettings,
  isValidEmailAddress,
  parseThreshold,
  upsertNotificationSetting
} = require('../lib/notificationSettings');
const { sendTeamsNotification, sendEmailNotification } = require('../lib/notify');
const { validateTeamsWebhookUrl } = require('../lib/teamsWebhook');

// Get all notification settings
router.get('/notifications', jwtAuth, requireAdminOrOwner, (req, res) => {
  try {
    res.json(getNotificationSettings(req.user.id));
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Save Teams notification settings
router.post('/notifications/teams', jwtAuth, requireAdminOrOwner, (req, res) => {
  const { webhookUrl, threshold = 50, enabled = true } = req.body;
  const parsedThreshold = parseThreshold(threshold);

  if (parsedThreshold === null) {
    return res.status(400).json({ error: 'threshold must be an integer from 1 to 100' });
  }

  const validation = validateTeamsWebhookUrl(webhookUrl);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    upsertNotificationSetting({
      userId: req.user.id,
      channel: 'teams',
      destination: validation.url,
      threshold: parsedThreshold,
      enabled
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Save settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Save Email notification settings
router.post('/notifications/email', jwtAuth, requireAdminOrOwner, (req, res) => {
  const { recipientEmail, threshold = 50, enabled = true } = req.body;
  const parsedThreshold = parseThreshold(threshold);

  if (parsedThreshold === null) {
    return res.status(400).json({ error: 'threshold must be an integer from 1 to 100' });
  }

  if (!isValidEmailAddress(recipientEmail)) {
    return res.status(400).json({ error: 'valid recipientEmail required' });
  }

  try {
    upsertNotificationSetting({
      userId: req.user.id,
      channel: 'email',
      destination: recipientEmail.trim(),
      threshold: parsedThreshold,
      enabled
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Save settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Test Teams notification
router.post('/notifications/teams/test', jwtAuth, requireAdminOrOwner, async (req, res) => {
  try {
    const settings = getNotificationSettings(req.user.id).teams;

    if (!settings?.webhook_url || settings.enabled !== 1) {
      return res.status(400).json({ error: 'Teams webhook not configured' });
    }

    const result = await sendTeamsNotification({
      viewerEmail: 'test@example.com',
      viewerName: 'Test User',
      videoId: 'test-video-id',
      videoTitle: 'Test Video',
      watchPercent: 75
    }, settings);

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
router.post('/notifications/email/test', jwtAuth, requireAdminOrOwner, async (req, res) => {
  try {
    const settings = getNotificationSettings(req.user.id).email;

    if (!settings?.webhook_url || settings.enabled !== 1) {
      return res.status(400).json({ error: 'Email notifications not configured' });
    }

    const result = await sendEmailNotification({
      viewerEmail: 'test@example.com',
      viewerName: 'Test User',
      videoId: 'test-video-id',
      videoTitle: 'Test Video',
      watchPercent: 75
    }, settings);

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
