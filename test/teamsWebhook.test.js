const test = require('node:test');
const assert = require('node:assert/strict');

const { validateTeamsWebhookUrl } = require('../server/lib/teamsWebhook');

test('validateTeamsWebhookUrl accepts Microsoft Teams webhook hosts', () => {
  const result = validateTeamsWebhookUrl('https://example.webhook.office.com/webhookb2/token');

  assert.equal(result.valid, true);
  assert.equal(result.url, 'https://example.webhook.office.com/webhookb2/token');
});

test('validateTeamsWebhookUrl rejects non-https URLs', () => {
  const result = validateTeamsWebhookUrl('http://example.webhook.office.com/webhookb2/token');

  assert.equal(result.valid, false);
  assert.match(result.error, /https/);
});

test('validateTeamsWebhookUrl rejects localhost SSRF targets', () => {
  const result = validateTeamsWebhookUrl('https://127.0.0.1:443/webhookb2/token');

  assert.equal(result.valid, false);
  assert.match(result.error, /Microsoft Teams/);
});
