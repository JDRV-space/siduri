// SIDURI - Player with Tracking

// Get video ID from URL path (/watch/:id)
const pathParts = window.location.pathname.split('/');
const videoId = pathParts[pathParts.length - 1];

// Get viewer token from URL for identified tracking
const urlParams = new URLSearchParams(window.location.search);
const viewerToken = urlParams.get('v') || null;

// Preview mode - skip all tracking (for creator to review before sending)
const isPreviewMode = urlParams.get('preview') === '1';

if (!videoId || videoId.trim() === '' || videoId === 'watch') {
  document.body.innerHTML = '<div class="player-container"><div class="card"><h2>video not found</h2></div></div>';
}

// DOM elements
const videoElement = document.getElementById('videoPlayer');
const startOverlay = document.getElementById('startOverlay');
const captionsOverlay = document.getElementById('captionsOverlay');
const videoTitle = document.getElementById('videoTitle');
const videoMeta = document.getElementById('videoMeta');
const subtitleControls = document.getElementById('subtitleControls');

// State
let player = null;
let videoData = null;
let watchedSeconds = 0;
let lastTrackedSecond = 0;
let trackingInterval = null;
let currentSubtitleLang = 'es'; // Subtitles on by default

// Fullscreen button
const fullscreenBtn = document.getElementById('fullscreenBtn');
const playerWrapper = document.querySelector('.player-wrapper');

// Initialize
async function init() {
  try {
    // Fetch video data
    const res = await fetch(`api/videos/${videoId}`);
    if (!res.ok) {
      throw new Error('Video not found');
    }
    videoData = await res.json();

    // Update UI
    videoTitle.textContent = videoData.title || 'untitled';
    videoMeta.textContent = formatDate(videoData.created_at);
    document.title = `${videoData.title || 'siduri'} - siduri`;

    // Show preview mode indicator
    if (isPreviewMode) {
      const badge = document.createElement('span');
      badge.textContent = 'PREVIEW';
      badge.style.cssText = 'background: #8b0d1d; color: white; padding: 4px 12px; border-radius: 999px; font-size: 12px; margin-left: 12px; font-weight: 600;';
      videoTitle.appendChild(badge);
    }

    // Initialize Video.js
    player = videojs('videoPlayer', {
      fluid: true,
      responsive: true,
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
      sources: [{
        src: videoData.videoUrl,
        type: getVideoType(videoData.filename)
      }]
    });

    // Move captions overlay inside Video.js container (for fullscreen support)
    const vjsContainer = player.el();
    if (vjsContainer && captionsOverlay) {
      vjsContainer.appendChild(captionsOverlay);
    }

    // Set up event handlers
    setupPlayerEvents();
    setupOverlay();
    setupSubtitleControls();
    setupFullscreen();

    // Load subtitles if enabled
    if (currentSubtitleLang !== 'off') {
      loadSubtitles();
    }

  } catch (error) {
    console.error('Init error:', error);
    showToast('failed to load video', 'error');
    videoTitle.textContent = 'error loading video';
  }
}

function setupPlayerEvents() {
  // Handle playback errors (e.g., WebM not supported on Safari)
  player.on('error', () => {
    const error = player.error();
    console.error('Video.js error:', error);

    // Check if it's a format/decode error
    if (error && (error.code === 4 || error.code === 3)) {
      // MEDIA_ERR_SRC_NOT_SUPPORTED or MEDIA_ERR_DECODE
      showToast('video format not supported by your browser. try chrome or firefox.', 'error');
      videoTitle.textContent = 'playback error';
    } else {
      showToast('failed to load video', 'error');
    }
  });

  // Track time update + subtitle display
  player.on('timeupdate', () => {
    const currentTime = player.currentTime();
    const currentTimeInt = Math.floor(currentTime);

    if (currentTimeInt > watchedSeconds) {
      watchedSeconds = currentTimeInt;
    }

    // Update subtitle display
    updateSubtitleDisplay(currentTime);
  });

  // Start tracking when playing
  player.on('play', () => {
    startTracking();
  });

  // Stop tracking when paused
  player.on('pause', () => {
    stopTracking();
    sendTrackingData();
  });

  // Final tracking on end
  player.on('ended', () => {
    stopTracking();
    sendTrackingData();
  });

  // Store duration when metadata loads
  player.on('loadedmetadata', () => {
    if (videoData && !videoData.duration_secs) {
      const duration = Math.floor(player.duration());
      // Update duration in DB (fire and forget)
      fetch(`api/videos/${videoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_secs: duration })
      }).catch(() => {});
    }
  });
}

function setupOverlay() {
  startOverlay.addEventListener('click', () => {
    startOverlay.classList.add('hidden');
    player.play();
  });
}

function setupSubtitleControls() {
  const buttons = subtitleControls.querySelectorAll('.subtitle-btn');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentSubtitleLang = btn.dataset.lang;

      if (currentSubtitleLang === 'off') {
        subtitlesEnabled = false;
        captionsOverlay.classList.remove('visible');
      } else {
        subtitlesEnabled = true;
        loadSubtitles();
      }
    });
  });
}

function setupFullscreen() {
  if (fullscreenBtn && playerWrapper) {
    fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        fullscreenBtn.textContent = '⛶ fullscreen';
      } else {
        playerWrapper.requestFullscreen().catch(err => {
          console.warn('Fullscreen not supported:', err);
          // Try Video.js fullscreen as fallback
          if (player) player.requestFullscreen();
        });
        fullscreenBtn.textContent = '⛶ exit';
      }
    });

    // Update button text when fullscreen changes
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        fullscreenBtn.textContent = '⛶ exit';
      } else {
        fullscreenBtn.textContent = '⛶ fullscreen';
      }
    });
  }
}

// Tracking functions
function startTracking() {
  // Skip tracking in preview mode
  if (isPreviewMode) return;
  if (trackingInterval) return;

  // Send heartbeat every 10 seconds
  trackingInterval = setInterval(() => {
    if (watchedSeconds > lastTrackedSecond) {
      sendTrackingData();
      lastTrackedSecond = watchedSeconds;
    }
  }, 10000);
}

function stopTracking() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
}

async function sendTrackingData() {
  // Skip tracking in preview mode
  if (isPreviewMode) return;
  if (!videoId || watchedSeconds === 0) return;

  try {
    await fetch('api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: videoId,
        watchSecs: watchedSeconds,
        viewerToken: viewerToken
      })
    });
  } catch (error) {
    console.error('Tracking error:', error);
  }
}

// Send final data on page unload
window.addEventListener('beforeunload', () => {
  // Skip tracking in preview mode
  if (isPreviewMode) return;
  if (videoId && watchedSeconds > 0) {
    // Use sendBeacon for reliable delivery
    navigator.sendBeacon('api/track/beacon', JSON.stringify({
      videoId: videoId,
      watchSecs: watchedSeconds,
      viewerToken: viewerToken
    }));
  }
});

// VTT-based subtitles (generated by faster-whisper Cloud Function)
let subtitlesLoaded = false;
let subtitleCues = [];
let subtitlesEnabled = true;

async function loadSubtitles() {
  if (subtitlesLoaded || !videoData?.videoUrl) return;

  // VTT file is same path as video but with .vtt extension
  // Strip query params (signed URL signature) - VTT is public
  const videoUrlBase = videoData.videoUrl.split('?')[0];
  const vttUrl = videoUrlBase.replace(/\.[^.]+$/, '.vtt');

  try {
    const res = await fetch(vttUrl);
    if (!res.ok) {
      return;
    }

    const vttText = await res.text();
    subtitleCues = parseVTT(vttText);
    subtitlesLoaded = true;

  } catch (error) {
  }
}

function parseVTT(vttText) {
  const cues = [];
  const lines = vttText.split('\n');
  let i = 0;

  // Skip WEBVTT header
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for timestamp line (00:00:00.000 --> 00:00:02.000)
    if (line.includes('-->')) {
      const [startStr, endStr] = line.split('-->').map(s => s.trim());
      const start = parseTimestamp(startStr);
      const end = parseTimestamp(endStr);

      // Collect text lines until empty line
      let text = '';
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        text += (text ? ' ' : '') + lines[i].trim();
        i++;
      }

      if (text) {
        cues.push({ start, end, text });
      }
    }
    i++;
  }

  return cues;
}

function parseTimestamp(ts) {
  // Parse HH:MM:SS.mmm or MM:SS.mmm
  const parts = ts.split(':');
  let hours = 0, minutes = 0, seconds = 0;

  if (parts.length === 3) {
    hours = parseInt(parts[0]);
    minutes = parseInt(parts[1]);
    seconds = parseFloat(parts[2]);
  } else if (parts.length === 2) {
    minutes = parseInt(parts[0]);
    seconds = parseFloat(parts[1]);
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function updateSubtitleDisplay(currentTime) {
  if (!subtitlesEnabled || !subtitlesLoaded) {
    captionsOverlay.classList.remove('visible');
    return;
  }

  // Find active cue
  const activeCue = subtitleCues.find(cue =>
    currentTime >= cue.start && currentTime <= cue.end
  );

  if (activeCue) {
    captionsOverlay.textContent = activeCue.text;
    captionsOverlay.classList.add('visible');
  } else {
    captionsOverlay.classList.remove('visible');
  }
}

// Utility functions
function getVideoType(filename) {
  if (!filename) return 'video/mp4';
  if (filename.includes('.webm')) return 'video/webm';
  return 'video/mp4';
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Start
init();
