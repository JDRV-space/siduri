const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const DEFAULT_THRESHOLD = 50;
const CHANNELS = ['teams', 'email'];

function defaultSetting(channel) {
  return {
    channel,
    enabled: 0,
    notify_threshold: DEFAULT_THRESHOLD,
    webhook_url: ''
  };
}

function parseThreshold(value) {
  const threshold = Number(value ?? DEFAULT_THRESHOLD);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    return null;
  }

  return threshold;
}

function isValidEmailAddress(email) {
  return typeof email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getNotificationSettings(userId) {
  const rows = db.prepare(`
    SELECT *
    FROM notification_settings
    WHERE user_id = ?
  `).all(userId);

  const settingsByChannel = Object.fromEntries(rows.map(row => [row.channel, row]));

  return {
    teams: settingsByChannel.teams || defaultSetting('teams'),
    email: settingsByChannel.email || defaultSetting('email')
  };
}

function getEnabledNotificationSettings(userId) {
  return db.prepare(`
    SELECT *
    FROM notification_settings
    WHERE user_id = ?
      AND enabled = 1
      AND channel IN (${CHANNELS.map(() => '?').join(', ')})
  `).all(userId, ...CHANNELS);
}

function upsertNotificationSetting({ userId, channel, destination, threshold, enabled }) {
  const existing = db.prepare(`
    SELECT id
    FROM notification_settings
    WHERE user_id = ? AND channel = ?
  `).get(userId, channel);

  if (existing) {
    db.prepare(`
      UPDATE notification_settings
      SET webhook_url = ?,
          notify_threshold = ?,
          enabled = ?
      WHERE id = ?
    `).run(destination, threshold, enabled ? 1 : 0, existing.id);
    return existing.id;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO notification_settings (id, user_id, channel, webhook_url, notify_threshold, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, channel, destination, threshold, enabled ? 1 : 0);
  return id;
}

module.exports = {
  getNotificationSettings,
  getEnabledNotificationSettings,
  isValidEmailAddress,
  parseThreshold,
  upsertNotificationSetting
};
