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
}

module.exports = { validateEnv };
