function getBaseUrl(req) {
  const configuredUrl = process.env.BASE_URL;
  const baseUrl = configuredUrl || `${req.protocol}://${req.get('host')}`;
  return baseUrl.replace(/\/+$/, '');
}

function buildWatchUrl(req, videoId, params = {}) {
  const url = new URL(`/watch/${videoId}`, getBaseUrl(req));

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

module.exports = { getBaseUrl, buildWatchUrl };
