const db = require('./db');
const nodemailer = require('nodemailer');

// Email transporter
let emailTransporter = null;

function getEmailTransporter() {
  if (emailTransporter) return emailTransporter;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT || 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    return null;
  }

  emailTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false, // STARTTLS
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  return emailTransporter;
}

async function sendEmailNotification({ viewerEmail, viewerName, videoId, videoTitle, watchPercent }) {
  // Get email settings
  const settings = db.prepare(
    'SELECT * FROM notification_settings WHERE channel = ? AND enabled = 1'
  ).get('email');

  if (!settings?.webhook_url) { // webhook_url stores recipient email for email channel
    return { success: false, error: 'Email notifications not configured' };
  }

  const transporter = getEmailTransporter();
  if (!transporter) {
    return { success: false, error: 'SMTP not configured (missing SMTP_USER/SMTP_PASS)' };
  }

  const viewerDisplay = viewerName || viewerEmail;
  const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
  const watchUrl = `${baseUrl}/watch/${videoId}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #8b0d1d; margin-bottom: 20px;">Video Alert</h2>
      <p style="font-size: 16px; color: #333;">
        <strong>${viewerDisplay}</strong> just watched <strong>${watchPercent}%</strong> of "${videoTitle}"
      </p>
      <table style="margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Email:</td>
          <td style="padding: 8px 0;"><strong>${viewerEmail}</strong></td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Completion:</td>
          <td style="padding: 8px 0;"><strong>${watchPercent}%</strong></td>
        </tr>
      </table>
      <a href="${watchUrl}" style="display: inline-block; background: #8b0d1d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View Video</a>
      <p style="margin-top: 30px; font-size: 12px; color: #999;">Sent by siduri</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: settings.webhook_url, // recipient email stored here
      subject: `${viewerDisplay} watched ${watchPercent}% of "${videoTitle}"`,
      html
    });

    return { success: true };
  } catch (error) {
    console.error('Email notification failed:', error);
    return { success: false, error: error.message };
  }
}

async function sendTeamsNotification({ viewerEmail, viewerName, videoId, videoTitle, watchPercent }) {
  // Get Teams webhook from settings
  const settings = db.prepare(
    'SELECT * FROM notification_settings WHERE channel = ? AND enabled = 1'
  ).get('teams');

  if (!settings?.webhook_url) {
    // Silent return if not configured
    return;
  }

  const viewerDisplay = viewerName || viewerEmail;
  const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
  const watchUrl = `${baseUrl}/watch/${videoId}`;

  // Microsoft Teams Adaptive Card
  const message = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
          "type": "AdaptiveCard",
          "version": "1.2",
          "body": [
            {
              "type": "TextBlock",
              "text": "Video Alert",
              "weight": "Bolder",
              "size": "Medium",
              "color": "Attention"
            },
            {
              "type": "TextBlock",
              "text": `**${viewerDisplay}** just watched **${watchPercent}%** of "${videoTitle}"`,
              "wrap": true
            },
            {
              "type": "FactSet",
              "facts": [
                {
                  "title": "Email",
                  "value": viewerEmail
                },
                {
                  "title": "Completion",
                  "value": `${watchPercent}%`
                }
              ]
            }
          ],
          "actions": [
            {
              "type": "Action.OpenUrl",
              "title": "View Video",
              "url": watchUrl
            }
          ]
        }
      }
    ]
  };

  try {
    const response = await fetch(settings.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      console.error(`Teams notification failed: ${response.status} ${response.statusText}`);
      return { success: false, error: `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error('Teams notification failed:', error);
    return { success: false, error: error.message };
  }
}

async function sendSlackNotification({ viewerEmail, viewerName, videoId, videoTitle, watchPercent }) {
  // Check for SLACK_WEBHOOK_URL env var first
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  // If no env var, check database settings
  let finalWebhookUrl = webhookUrl;
  if (!finalWebhookUrl) {
    const settings = db.prepare(
      'SELECT * FROM notification_settings WHERE channel = ? AND enabled = 1'
    ).get('slack');
    finalWebhookUrl = settings?.webhook_url;
  }

  if (!finalWebhookUrl) {
    // Silent return if not configured
    return;
  }

  const viewerDisplay = viewerName || viewerEmail;
  const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
  const watchUrl = `${baseUrl}/watch/${videoId}`;

  // Determine emoji based on watch percentage
  let emoji = ':eyes:';
  if (watchPercent >= 75) {
    emoji = ':fire:';
  } else if (watchPercent >= 50) {
    emoji = ':star:';
  }

  // Slack Block Kit message
  const message = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${emoji} Video View*`
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Video:*\n${videoTitle}`
          },
          {
            type: "mrkdwn",
            text: `*Viewer:*\n${viewerEmail || 'Anonymous'}`
          },
          {
            type: "mrkdwn",
            text: `*Watched:*\n${watchPercent}%`
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<${watchUrl}|View Video> | Sent by siduri`
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(finalWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      console.error(`Slack notification failed: ${response.status} ${response.statusText}`);
      return { success: false, error: `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error('Slack notification failed:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { sendTeamsNotification, sendEmailNotification, sendSlackNotification };
