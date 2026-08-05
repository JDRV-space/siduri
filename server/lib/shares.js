const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { generateToken, verifyToken } = require('./token');

const SHARE_TTL_DAYS = 30;
const DEFAULT_VIEW_DATA_RETENTION_DAYS = 90;

function parseRetentionDays(value) {
  const normalized = value === undefined ? '' : String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    return DEFAULT_VIEW_DATA_RETENTION_DAYS;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (parsed < 1 || parsed > 3650) return DEFAULT_VIEW_DATA_RETENTION_DAYS;
  return parsed;
}

function getViewerDataRetentionDays() {
  return parseRetentionDays(process.env.VIEW_DATA_RETENTION_DAYS);
}

function toSqliteDateTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function createShareToken({ videoId, recipientEmail, recipientName }) {
  const id = uuidv4();
  const expiresAtMs = Date.now() + (SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO shares (id, video_id, recipient_email, recipient_name, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    videoId,
    recipientEmail,
    recipientName || null,
    toSqliteDateTime(new Date(expiresAtMs))
  );

  return generateToken({ s: id, v: videoId, x: expiresAtMs });
}

function resolveShareToken(token, videoId) {
  const payload = verifyToken(token);
  if (!payload || payload.v !== videoId || typeof payload.s !== 'string') {
    return null;
  }

  return db.prepare(`
    SELECT id, video_id, recipient_email, recipient_name, expires_at
    FROM shares
    WHERE id = ?
      AND video_id = ?
      AND expires_at > datetime('now')
  `).get(payload.s, videoId) || null;
}

function purgeExpiredViewerData() {
  const retentionModifier = `-${getViewerDataRetentionDays()} days`;
  const views = db.prepare("DELETE FROM views WHERE updated_at < datetime('now', ?)").run(retentionModifier);
  const shares = db.prepare("DELETE FROM shares WHERE expires_at <= datetime('now')").run();
  return { views: views.changes, shares: shares.changes };
}

module.exports = {
  createShareToken,
  getViewerDataRetentionDays,
  purgeExpiredViewerData,
  resolveShareToken
};
