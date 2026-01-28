// SQLite database — embedded, no external database service needed
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Store DB in data folder (persists across restarts)
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'siduri.db');
const db = new Database(dbPath);

// Use DELETE mode for GCS FUSE compatibility (no file locking support)
// WAL mode is faster but requires file locking which Cloud Storage FUSE doesn't support
db.pragma('journal_mode = DELETE');
// Sync after each write for durability on mounted storage
db.pragma('synchronous = FULL');
// Enable foreign key constraints for referential integrity
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    gcs_url TEXT NOT NULL,
    duration_secs INTEGER,
    title TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS views (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    watch_secs INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    UNIQUE(video_id, session_id)
  );

  CREATE INDEX IF NOT EXISTS idx_views_video ON views(video_id);
`);

// Notification System Migrations
try {
  const columns = db.pragma('table_info(views)').map(c => c.name);

  if (!columns.includes('viewer_email')) {
    db.exec('ALTER TABLE views ADD COLUMN viewer_email TEXT');
  }
  if (!columns.includes('viewer_name')) {
    db.exec('ALTER TABLE views ADD COLUMN viewer_name TEXT');
  }
  if (!columns.includes('notified_at')) {
    db.exec('ALTER TABLE views ADD COLUMN notified_at TEXT'); // SQLite doesn't have DATETIME type, uses TEXT
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_settings (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      notify_threshold INTEGER DEFAULT 50,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_views_viewer ON views(viewer_email);
  `);
} catch (err) {
  console.error('Migration error:', err);
}

// Password Reset Tokens table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id);
  `);
} catch (err) {
  // Table might already exist, that's fine
  if (!err.message.includes('already exists')) {
    console.error('Password reset tokens migration error:', err);
  }
}

// Security System Migrations (users, auth, invitations)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invitations (
      code TEXT PRIMARY KEY,
      email TEXT,
      created_by TEXT REFERENCES users(id),
      used_at TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT NOT NULL,
      attempt_time TEXT NOT NULL,
      success INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT DEFAULT 'Chrome Extension',
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
  `);

  // Add user_id column to videos if not exists
  const videoColumns = db.pragma('table_info(videos)').map(c => c.name);
  if (!videoColumns.includes('user_id')) {
    db.exec('ALTER TABLE videos ADD COLUMN user_id TEXT REFERENCES users(id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_videos_user ON videos(user_id)');
  }

  // Migration: Assign all videos with NULL user_id to the first owner
  const nullUserVideos = db.prepare('SELECT COUNT(*) as count FROM videos WHERE user_id IS NULL').get();
  if (nullUserVideos.count > 0) {
    const firstOwner = db.prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1").get();
    if (firstOwner) {
      console.log(`Migrating ${nullUserVideos.count} videos to owner ${firstOwner.id}`);
      db.prepare('UPDATE videos SET user_id = ? WHERE user_id IS NULL').run(firstOwner.id);
    } else {
      console.warn('WARNING: No owner user found. Videos with NULL user_id remain unassigned.');
    }
  }
} catch (err) {
  console.error('Security migration error:', err);
}

module.exports = db;
