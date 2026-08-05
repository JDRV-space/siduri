// Startup environment validation - fail fast

function validateEnv() {
  const required = [
    'JWT_SECRET',
    'GCS_BUCKET',
    'GCS_PROJECT_ID'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nCopy .env.example to .env and fill in values.\n');
    process.exit(1);
  }

  // Validate PORT if set
  if (process.env.PORT && isNaN(parseInt(process.env.PORT))) {
    console.error('❌ PORT must be a valid number');
    process.exit(1);
  }

  if (process.env.JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET must be at least 32 characters');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production' && !process.env.BASE_URL) {
    console.error('❌ BASE_URL is required in production to prevent poisoned absolute links');
    process.exit(1);
  }

  if (process.env.VIEW_DATA_RETENTION_DAYS) {
    const retentionValue = process.env.VIEW_DATA_RETENTION_DAYS.trim();
    const retentionDays = Number.parseInt(retentionValue, 10);
    if (!/^\d+$/.test(retentionValue) || retentionDays < 1 || retentionDays > 3650) {
      console.error('❌ VIEW_DATA_RETENTION_DAYS must be an integer from 1 to 3650');
      process.exit(1);
    }
  }

  const smtpKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const smtpConfigured = smtpKeys.some(key => Boolean(process.env[key]));
  const missingSmtp = smtpKeys.filter(key => !process.env[key]);
  if (smtpConfigured && missingSmtp.length > 0) {
    console.error(`❌ Partial SMTP configuration; missing ${missingSmtp.join(', ')}`);
    process.exit(1);
  }

  if (process.env.SMTP_PORT) {
    const smtpPortValue = process.env.SMTP_PORT.trim();
    const smtpPort = Number.parseInt(smtpPortValue, 10);
    if (!/^\d+$/.test(smtpPortValue) || smtpPort < 1 || smtpPort > 65535) {
      console.error('❌ SMTP_PORT must be an integer from 1 to 65535');
      process.exit(1);
    }
  }
}

module.exports = { validateEnv };
