// Account lockout logic with progressive penalties
const db = require('./db');

// Lockout configuration
const LOCKOUT_TIERS = [
  { attempts: 5, duration: 15 * 60 * 1000 },   // 5 fails = 15 min
  { attempts: 10, duration: 60 * 60 * 1000 },  // 10 fails = 1 hr
  { attempts: 15, duration: 24 * 60 * 60 * 1000 } // 15 fails = 24 hr
];

// Check if account is locked due to failed login attempts
function isAccountLocked(email) {
  const now = new Date().toISOString();

  // Get failed attempts in last 24 hours
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const attempts = db.prepare(`
    SELECT COUNT(*) as count
    FROM login_attempts
    WHERE email = ? AND success = 0 AND attempt_time > ?
  `).get(email, cutoff);

  const failCount = attempts.count;

  // Check which lockout tier applies
  for (let i = LOCKOUT_TIERS.length - 1; i >= 0; i--) {
    const tier = LOCKOUT_TIERS[i];
    if (failCount >= tier.attempts) {
      // Check if lockout period has passed
      const lockoutStart = new Date(Date.now() - tier.duration).toISOString();
      const recentFails = db.prepare(`
        SELECT COUNT(*) as count
        FROM login_attempts
        WHERE email = ? AND success = 0 AND attempt_time > ?
      `).get(email, lockoutStart);

      if (recentFails.count >= tier.attempts) {
        return {
          locked: true,
          duration: tier.duration,
          attempts: failCount
        };
      }
    }
  }

  return { locked: false, attempts: failCount };
}

// Record login attempt (success or failure)
function recordLoginAttempt(email, success) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO login_attempts (email, attempt_time, success)
    VALUES (?, ?, ?)
  `).run(email, now, success ? 1 : 0);

  // Cleanup old attempts (older than 24 hours)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM login_attempts WHERE attempt_time < ?').run(cutoff);
}

// Clean up expired revoked tokens (call periodically)
function cleanupRevokedTokens() {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(now);
}

module.exports = {
  isAccountLocked,
  recordLoginAttempt,
  cleanupRevokedTokens,
  LOCKOUT_TIERS
};
