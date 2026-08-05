const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'siduri-shares-'));

const db = require('../server/lib/db');
const { purgeExpiredViewerData } = require('../server/lib/shares');

test('purgeExpiredViewerData enforces share expiry and analytics retention', () => {
  const videoId = '123e4567-e89b-42d3-a456-426614174000';
  db.prepare(`
    INSERT INTO videos (id, filename, gcs_url, title)
    VALUES (?, ?, ?, ?)
  `).run(
    videoId,
    '123e4567-e89b-42d3-a456-426614174001.mp4',
    'https://storage.googleapis.com/test/videos/example.mp4',
    'Retention test'
  );
  db.prepare(`
    INSERT INTO views (id, video_id, session_id, updated_at)
    VALUES (?, ?, ?, datetime('now', '-91 days'))
  `).run('view-id', videoId, 'session-id');
  db.prepare(`
    INSERT INTO shares (id, video_id, recipient_email, expires_at)
    VALUES (?, ?, ?, datetime('now', '-1 day'))
  `).run('share-id', videoId, 'viewer@example.com');

  assert.deepEqual(purgeExpiredViewerData(), { views: 1, shares: 1 });
  assert.equal(db.prepare('SELECT id FROM views WHERE id = ?').get('view-id'), undefined);
  assert.equal(db.prepare('SELECT id FROM shares WHERE id = ?').get('share-id'), undefined);
});
