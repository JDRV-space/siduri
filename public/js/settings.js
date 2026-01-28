// Settings logic
// BASE_PATH is defined in auth.js (loaded first)

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

async function loadSettings() {
  try {
    const res = await authenticatedFetch(BASE_PATH + 'api/settings/notifications');

    if (!res.ok) {
      throw new Error('Failed to load settings');
    }

    const { teams, email } = await res.json();

    // Email settings
    if (email) {
      document.getElementById('emailRecipient').value = email.webhook_url || '';
      document.getElementById('emailThreshold').value = email.notify_threshold || 50;
      document.getElementById('emailEnabled').checked = email.enabled === 1;
    }

    // Teams settings (UI removed, but keep backend support)
    // Elements no longer exist in settings.html

  } catch (error) {
    console.error('Settings load error:', error);
    showToast('failed to load settings', 'error');
  }
}

// Email functions
async function saveEmailSettings() {
  const recipientEmail = document.getElementById('emailRecipient').value.trim();
  const threshold = document.getElementById('emailThreshold').value;
  const enabled = document.getElementById('emailEnabled').checked;

  if (!recipientEmail) {
    showToast('email address required', 'error');
    return;
  }

  try {
    const res = await authenticatedFetch(BASE_PATH + 'api/settings/notifications/email', {
      method: 'POST',
      body: JSON.stringify({
        recipientEmail,
        threshold: parseInt(threshold),
        enabled
      })
    });

    if (!res.ok) throw new Error('Failed to save');

    showToast('email settings saved', 'success');

  } catch (error) {
    console.error('Save error:', error);
    showToast('failed to save settings', 'error');
  }
}

async function testEmailNotification() {
  try {
    const res = await authenticatedFetch(BASE_PATH + 'api/settings/notifications/email/test', {
      method: 'POST'
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'failed to send test', 'error');
      return;
    }

    showToast('test email sent - check your inbox', 'success');

  } catch (error) {
    console.error('Test notification error:', error);
    showToast('failed to send test email', 'error');
  }
}

// Teams functions
async function saveTeamsSettings() {
  const webhookUrl = document.getElementById('teamsWebhookUrl').value.trim();
  const threshold = document.getElementById('teamsThreshold').value;
  const enabled = document.getElementById('teamsEnabled').checked;

  if (!webhookUrl) {
    showToast('teams webhook url required', 'error');
    return;
  }

  try {
    const res = await authenticatedFetch(BASE_PATH + 'api/settings/notifications/teams', {
      method: 'POST',
      body: JSON.stringify({
        webhookUrl,
        threshold: parseInt(threshold),
        enabled
      })
    });

    if (!res.ok) throw new Error('Failed to save');

    showToast('teams settings saved', 'success');

  } catch (error) {
    console.error('Save error:', error);
    showToast('failed to save settings', 'error');
  }
}

async function testTeamsNotification() {
  try {
    const res = await authenticatedFetch(BASE_PATH + 'api/settings/notifications/teams/test', {
      method: 'POST'
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'failed to send test', 'error');
      return;
    }

    showToast('test notification sent to teams', 'success');

  } catch (error) {
    console.error('Test notification error:', error);
    showToast('failed to send test notification', 'error');
  }
}

// API Token functions
async function loadApiTokens() {
  try {
    const res = await authenticatedFetch(BASE_PATH + 'api/auth/api-tokens');
    if (!res.ok) return;

    const tokens = await res.json();
    const container = document.getElementById('tokenList');

    // Filter active tokens (not revoked)
    const activeTokens = tokens.filter(t => !t.revoked_at);

    if (activeTokens.length === 0) {
      container.innerHTML = '<p class="video-meta">no active tokens</p>';
      return;
    }

    container.innerHTML = activeTokens.map(token => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 0.5rem;">
        <div>
          <span style="color: var(--text-primary);">${token.name}</span>
          <span class="video-meta" style="margin-left: 1rem; font-size: 11px;">
            created ${new Date(token.created_at).toLocaleDateString()}
            ${token.last_used_at ? ' - last used ' + new Date(token.last_used_at).toLocaleDateString() : ''}
          </span>
        </div>
        <button class="btn" style="padding: 0.25rem 0.75rem; font-size: 12px;" onclick="revokeToken('${token.id}')">revoke</button>
      </div>
    `).join('');

  } catch (error) {
    console.error('Load tokens error:', error);
  }
}

async function generateApiToken() {
  try {
    const res = await authenticatedFetch(BASE_PATH + 'api/auth/api-token', {
      method: 'POST',
      body: JSON.stringify({ name: 'Chrome Extension' })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'failed to generate token', 'error');
      return;
    }

    // Display the token
    document.getElementById('apiToken').value = data.token;
    document.getElementById('tokenDisplay').style.display = 'block';
    showToast('token generated - copy it now', 'success');

    // Refresh token list
    loadApiTokens();

  } catch (error) {
    console.error('Token generation error:', error);
    showToast('failed to generate token', 'error');
  }
}

async function revokeToken(tokenId) {
  if (!confirm('Revoke this token? Any connected extensions will stop working.')) {
    return;
  }

  try {
    const res = await authenticatedFetch(BASE_PATH + 'api/auth/api-tokens/' + tokenId, {
      method: 'DELETE'
    });

    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || 'failed to revoke token', 'error');
      return;
    }

    showToast('token revoked', 'success');
    loadApiTokens();

  } catch (error) {
    console.error('Revoke token error:', error);
    showToast('failed to revoke token', 'error');
  }
}

function copyToken() {
  const tokenInput = document.getElementById('apiToken');
  tokenInput.select();
  navigator.clipboard.writeText(tokenInput.value).then(() => {
    showToast('token copied to clipboard', 'success');
  }).catch(() => {
    // Fallback for older browsers
    document.execCommand('copy');
    showToast('token copied to clipboard', 'success');
  });
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadApiTokens();
});
