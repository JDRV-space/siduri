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
}

module.exports = { validateEnv };
