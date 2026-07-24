function getBaseUrl() {
  const configuredUrl = process.env.BASE_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('BASE_URL is required in production');
  }

  return `http://localhost:${process.env.PORT || 8080}`;
}

function buildAbsoluteUrl(path, params = {}) {
  const normalizedPath = String(path).replace(/^\/+/, '');
  const url = new URL(normalizedPath, `${getBaseUrl()}/`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function buildWatchUrl(_req, videoId, params = {}) {
  return buildAbsoluteUrl(`watch/${videoId}`, params);
}

function buildResetPasswordUrl(token) {
  return buildAbsoluteUrl('reset-password.html', { token });
}

module.exports = { getBaseUrl, buildAbsoluteUrl, buildWatchUrl, buildResetPasswordUrl };
