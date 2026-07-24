const crypto = require('crypto');
// Require JWT_SECRET at startup (validated in validateEnv.js)
const SECRET = process.env.JWT_SECRET;

/**
 * Generates a signed base64url token
 * Format: payload_base64.signature_base64
 */
function generateToken(payload) {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString('base64url');
  const hmac = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  return `${b64}.${hmac}`;
}

/**
 * Verifies and decodes a token
 * Returns payload object or null if invalid/expired
 */
function verifyToken(token) {
  if (!token) return null;
  
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  
  const [b64, sig] = parts;

  // Verify signature using timing-safe comparison
  const expectedSig = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');

  // Handle length mismatch (return false before comparison to avoid timing leak)
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expectedSig);
  if (sigBuffer.length !== expectedBuffer.length) return null;

  // Timing-safe comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    
    // Check expiration if present
    if (payload.x && payload.x < Date.now()) {
      return null;
    }
    
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = { generateToken, verifyToken };
