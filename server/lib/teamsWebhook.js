const ALLOWED_EXACT_HOSTS = new Set([
  'outlook.office.com',
  'outlook.office365.com'
]);

function isAllowedHost(hostname) {
  return ALLOWED_EXACT_HOSTS.has(hostname)
    || hostname.endsWith('.webhook.office.com')
    || hostname.endsWith('.logic.azure.com');
}

function hasExpectedPath(hostname, pathname) {
  if (hostname.endsWith('.logic.azure.com')) {
    return pathname.startsWith('/workflows/');
  }

  return pathname.startsWith('/webhook') || pathname.startsWith('/webhookb2/');
}

function validateTeamsWebhookUrl(webhookUrl) {
  if (typeof webhookUrl !== 'string' || webhookUrl.trim() === '') {
    return { valid: false, error: 'Teams webhook URL required' };
  }

  let parsed;
  try {
    parsed = new URL(webhookUrl.trim());
  } catch {
    return { valid: false, error: 'Teams webhook URL must be a valid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Teams webhook URL must use https' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Teams webhook URL must not include credentials' };
  }

  if (parsed.port && parsed.port !== '443') {
    return { valid: false, error: 'Teams webhook URL must use the default https port' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!isAllowedHost(hostname) || !hasExpectedPath(hostname, parsed.pathname)) {
    return { valid: false, error: 'Teams webhook URL must be a Microsoft Teams webhook endpoint' };
  }

  return { valid: true, url: parsed.toString() };
}

module.exports = { validateTeamsWebhookUrl };
