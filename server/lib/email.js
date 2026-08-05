const { createSmtpTransporter } = require('./smtp');

const transporter = createSmtpTransporter();

async function sendPasswordResetEmail(email, resetUrl) {
  if (!transporter) {
    // Only log in development - never log sensitive URLs in production
    if (process.env.NODE_ENV !== 'production') {
      console.log('SMTP not configured. Reset URL:', resetUrl);
    }
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Reset your password - siduri',
    html: `
      <p>You requested a password reset.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request this, ignore this email.</p>
    `
  });
}

module.exports = { sendPasswordResetEmail };
