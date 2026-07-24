// SIDURI - Dashboard

let videos = [];
let currentShareVideoId = null;

async function loadDashboard() {
  try {
    const res = await authenticatedFetch('api/videos');

    if (!res.ok) {
      throw new Error('Failed to load videos');
    }

    videos = await res.json();
    renderGlobalStats();
    renderVideoList();

  } catch (error) {
    console.error('Dashboard error:', error);
    showToast('failed to load dashboard', 'error');
  }
}

function renderGlobalStats() {
  const totalVideos = videos.length;
  const totalViews = videos.reduce((sum, v) => sum + (v.stats?.totalViews || 0), 0);
  const totalWatchSecs = videos.reduce((sum, v) => sum + (v.stats?.totalWatchSecs || 0), 0);

  const avgCompletions = videos
    .filter(v => v.stats?.avgCompletion > 0)
    .map(v => v.stats.avgCompletion);
  const avgCompletion = avgCompletions.length > 0
    ? Math.round(avgCompletions.reduce((a, b) => a + b, 0) / avgCompletions.length)
    : 0;

  document.getElementById('totalVideos').textContent = totalVideos;
  document.getElementById('totalViews').textContent = totalViews;
  document.getElementById('totalWatchTime').textContent = formatDuration(totalWatchSecs);
  document.getElementById('avgCompletion').textContent = avgCompletion + '%';
}

function renderVideoList() {
  const container = document.getElementById('videoList');

  if (videos.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>no videos yet</p>
        <p><a href="./">upload your first video</a></p>
      </div>
    `;
    return;
  }

  container.innerHTML = videos.map(video => `
    <div class="video-item" data-id="${video.id}">
      <div class="video-info">
        <h3>${escapeHtml(video.title || 'untitled')}</h3>
        <p class="video-meta">
          ${formatDate(video.created_at)} · ${formatDuration(video.duration_secs || 0)}
        </p>
      </div>
      <div class="video-stats">
        <div class="stat">
          <div class="stat-value">${video.stats?.totalViews || 0}</div>
          <div class="stat-label">views</div>
        </div>
        <div class="stat">
          <div class="stat-value">${video.stats?.avgCompletion || 0}%</div>
          <div class="stat-label">completion</div>
        </div>
        <div class="video-actions">
          <button class="btn btn-sm" onclick="previewVideo('${video.id}')">preview</button>
          <button class="btn btn-sm" onclick="openShareModal('${video.id}')">share</button>
          <button class="btn btn-sm btn-danger" onclick="deleteVideo('${video.id}')">delete</button>
        </div>
      </div>
      <div class="video-details" id="details-${video.id}">
        ${renderViewDetails(video)}
      </div>
    </div>
  `).join('');
}

function renderViewDetails(video) {
  if (!video.views || video.views.length === 0) {
    return '<p class="video-meta" style="text-align: center;">no views yet</p>';
  }

  const duration = video.duration_secs || 1;

  return video.views.map(view => {
    const progress = Math.min(100, Math.round((view.watch_secs / duration) * 100));
    const isComplete = progress >= 90;
    
    // Display viewer info if available
    let viewerInfo = 'anonymous';
    if (view.viewer_email) {
      viewerInfo = escapeHtml(view.viewer_name || view.viewer_email);
    }

    return `
      <div class="view-item">
        <div class="view-session" style="flex:2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${viewerInfo}">
          ${viewerInfo}
        </div>
        <div class="view-session" style="width:100px;">${formatTimeAgo(view.updated_at)}</div>
        <div class="view-progress">
          <div class="view-progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="view-time ${isComplete ? 'view-complete' : ''}">
          ${formatDuration(view.watch_secs)}
        </div>
      </div>
    `;
  }).join('');
}

function toggleDetails(videoId) {
  const details = document.getElementById('details-' + videoId);
  details.classList.toggle('expanded');
}

function previewVideo(videoId) {
  window.open(`/watch/${videoId}?preview=1`, '_blank');
}

function openShareModal(videoId) {
  currentShareVideoId = videoId;
  document.getElementById('shareModal').style.display = 'flex';
  document.getElementById('shareEmail').value = '';
  document.getElementById('shareName').value = '';
  document.getElementById('shareLinkResult').style.display = 'none';
  document.getElementById('shareEmail').focus();
}

function closeShareModal() {
  document.getElementById('shareModal').style.display = 'none';
  currentShareVideoId = null;
}

async function generateShareLink() {
  const email = document.getElementById('shareEmail').value.trim();
  const name = document.getElementById('shareName').value.trim();

  if (!email) {
    showToast('recipient email required', 'error');
    return;
  }

  try {
    const res = await authenticatedFetch(`api/videos/${currentShareVideoId}/share`, {
      method: 'POST',
      body: JSON.stringify({
        recipientEmail: email,
        recipientName: name
      })
    });

    if (!res.ok) throw new Error('Failed to generate link');

    const { trackingUrl } = await res.json();

    document.getElementById('shareLink').value = trackingUrl;
    document.getElementById('shareLinkResult').style.display = 'block';

    showToast('tracking link generated', 'success');

  } catch (error) {
    console.error('Share error:', error);
    showToast('failed to generate link', 'error');
  }
}

function copyShareLink() {
  const link = document.getElementById('shareLink');
  link.select();
  link.setSelectionRange(0, 99999); // For mobile devices

  navigator.clipboard.writeText(link.value).then(() => {
    showToast('link copied', 'success');
  }).catch(() => {
     // Fallback for older browsers
     document.execCommand("copy");
     showToast('link copied', 'success');
  });
}

async function deleteVideo(videoId) {
  if (!confirm('delete this video?')) return;

  try {
    const res = await authenticatedFetch('api/videos/' + videoId, {
      method: 'DELETE'
    });

    if (!res.ok) {
      throw new Error('Failed to delete');
    }

    showToast('video deleted', 'success');
    loadDashboard();

  } catch (error) {
    console.error('Delete error:', error);
    showToast('failed to delete video', 'error');
  }
}

// Utility functions
function formatDuration(secs) {
  if (!secs || secs === 0) return '0:00';
  const mins = Math.floor(secs / 60);
  const remainingSecs = Math.floor(secs % 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}:${remainingMins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatTimeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + 'm ago';
  if (diffHours < 24) return diffHours + 'h ago';
  if (diffDays < 7) return diffDays + 'd ago';
  return formatDate(dateStr);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Initialize
loadDashboard();