// SIDURI - Recording with MediaRecorder + MediaPipe Background
// getCredentials, showToast defined in auth.js and upload.js

// DOM Elements
const videoPreviewEl = document.getElementById('previewVideo');
const bgCanvas = document.getElementById('bgCanvas');
const recordBtn = document.getElementById('recordBtn');
const recordTimer = document.getElementById('recordTimer');
const recordStatus = document.getElementById('recordStatus');
const bgOptions = document.querySelectorAll('.bg-option');
const customBgInput = document.getElementById('customBgInput');
const bgImage = document.getElementById('bgImage');
const videoTitleInput = document.getElementById('videoTitle');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const recordPreview = document.querySelector('.record-preview');
const recordZone = document.querySelector('.record-zone');

// State
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let timerInterval = null;
let recordingSeconds = 0;
let selectedBg = 'none';
let customBgUrl = null;
let recordingStartTime = null;

// MediaPipe state
let selfieSegmentation = null;
let canvasStream = null;
let ctx = null;
let backgroundImageEl = null;
let segmentationActive = false;
let animationFrameId = null;

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const tabName = tab.dataset.tab;
    document.getElementById('recordTab').style.display = tabName === 'record' ? 'block' : 'none';
    document.getElementById('uploadTab').style.display = tabName === 'upload' ? 'block' : 'none';
    // Don't auto-start camera - let user click to enable
  });
});

// Initialize MediaPipe Selfie Segmentation
async function initSegmentation() {
  if (selfieSegmentation) return;

  if (typeof SelfieSegmentation === 'undefined') {
    console.warn('MediaPipe SelfieSegmentation not loaded');
    return;
  }

  try {
    selfieSegmentation = new SelfieSegmentation({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${file}`;
      }
    });

    selfieSegmentation.setOptions({
      modelSelection: 0 // 0 for general (better quality), 1 for landscape (faster)
    });

    selfieSegmentation.onResults(onSegmentationResults);

    await selfieSegmentation.initialize();
  } catch (error) {
    console.error('Failed to initialize MediaPipe:', error);
    selfieSegmentation = null;
  }
}

// Offscreen canvas for mask processing (edge smoothing)
let maskCanvas = null;
let maskCtx = null;

// Handle segmentation results with edge smoothing
function onSegmentationResults(results) {
  if (!ctx || !bgCanvas) return;

  const width = bgCanvas.width;
  const height = bgCanvas.height;

  // Initialize mask canvas for edge smoothing
  if (!maskCanvas) {
    maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    maskCtx = maskCanvas.getContext('2d');
  }

  // Process mask with edge feathering (reduce artifacts)
  maskCtx.clearRect(0, 0, width, height);
  maskCtx.filter = 'blur(4px)'; // Feather edges
  maskCtx.drawImage(results.segmentationMask, 0, 0, width, height);
  maskCtx.filter = 'none';

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Draw the person from video first
  ctx.drawImage(results.image, 0, 0, width, height);

  // Use smoothed mask to cut out background (keep person)
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0, width, height);

  // Draw background behind the person
  ctx.globalCompositeOperation = 'destination-over';
  if (selectedBg === 'blur') {
    // Draw blurred video as background (light blur)
    ctx.filter = 'blur(15px)';
    ctx.drawImage(results.image, 0, 0, width, height);
    ctx.filter = 'none';
  } else if (selectedBg === 'superblur') {
    // Draw super blurred video as background (heavy blur)
    ctx.filter = 'blur(35px)';
    ctx.drawImage(results.image, 0, 0, width, height);
    ctx.filter = 'none';
  } else if (backgroundImageEl && selectedBg !== 'none') {
    // Draw background image
    ctx.drawImage(backgroundImageEl, 0, 0, width, height);
  } else {
    // No background selected - draw original video
    ctx.drawImage(results.image, 0, 0, width, height);
  }

  ctx.restore();
}

// Process video frames through MediaPipe
async function processFrame() {
  if (!segmentationActive || !selfieSegmentation || !videoPreviewEl.videoWidth) {
    animationFrameId = requestAnimationFrame(processFrame);
    return;
  }

  try {
    await selfieSegmentation.send({ image: videoPreviewEl });
  } catch (e) {
    console.warn('Segmentation frame error:', e);
  }

  animationFrameId = requestAnimationFrame(processFrame);
}

// Start segmentation processing
function startSegmentation() {
  if (segmentationActive) return;

  segmentationActive = true;

  // Setup canvas
  if (bgCanvas && videoPreviewEl.videoWidth) {
    bgCanvas.width = videoPreviewEl.videoWidth || 1280;
    bgCanvas.height = videoPreviewEl.videoHeight || 720;
    ctx = bgCanvas.getContext('2d');
    bgCanvas.style.display = 'block';
    videoPreviewEl.style.opacity = '0';
  }

  processFrame();
}

// Stop segmentation processing
function stopSegmentation() {
  segmentationActive = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (bgCanvas) bgCanvas.style.display = 'none';
  if (videoPreviewEl) videoPreviewEl.style.opacity = '1';
}

// Initialize camera
async function initCamera() {
  try {
    if (recordStatus) recordStatus.textContent = 'starting camera...';

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: true
    });

    videoPreviewEl.srcObject = mediaStream;

    // Wait for video to load metadata
    await new Promise((resolve) => {
      videoPreviewEl.onloadedmetadata = resolve;
      if (videoPreviewEl.readyState >= 1) resolve();
    });

    // Initialize MediaPipe
    await initSegmentation();

    if (recordStatus) recordStatus.textContent = '';

  } catch (error) {
    console.error('Camera error:', error);
    if (recordStatus) recordStatus.textContent = 'camera access denied. check permissions.';
    if (typeof showToast === 'function') showToast('camera access required', 'error');
  }
}

// Background options
bgOptions.forEach(option => {
  option.addEventListener('click', () => {
    const bg = option.dataset.bg;

    // Handle custom background
    if (bg === 'custom') {
      customBgInput.click();
      return;
    }

    selectBackground(option, bg);
  });
});

// Custom background upload
if (customBgInput) {
  customBgInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      customBgUrl = URL.createObjectURL(file);
      const customOption = document.querySelector('.bg-option.custom');
      customOption.style.backgroundImage = `url(${customBgUrl})`;
      customOption.style.backgroundSize = 'cover';
      customOption.style.backgroundPosition = 'center';
      selectBackground(customOption, customBgUrl);
    }
  });
}

function selectBackground(option, bg) {
  bgOptions.forEach(o => o.classList.remove('active'));
  option.classList.add('active');
  selectedBg = bg;

  // Reset any CSS filters
  videoPreviewEl.style.filter = 'none';

  if (bg === 'none') {
    // No background - show raw video
    stopSegmentation();
    if (bgImage) bgImage.style.display = 'none';
    backgroundImageEl = null;
  } else if (bg === 'blur' || bg === 'superblur') {
    // Blur background (light or super) - requires MediaPipe
    if (selfieSegmentation) {
      backgroundImageEl = null;
      startSegmentation();
    } else {
      // No fallback - CSS blur would blur the entire video including face
      // Revert to "none" and show error
      if (typeof showToast === 'function') showToast('Background blur requires MediaPipe. Enable camera first.', 'error');
      bgOptions.forEach(o => o.classList.remove('active'));
      document.querySelector('.bg-option.none')?.classList.add('active');
      selectedBg = 'none';
      return;
    }
    if (bgImage) bgImage.style.display = 'none';
  } else {
    // Image background
    if (selfieSegmentation) {
      // Load background image
      backgroundImageEl = new Image();
      backgroundImageEl.crossOrigin = 'anonymous';
      backgroundImageEl.onload = () => {
        startSegmentation();
      };
      backgroundImageEl.src = bg;
    }
    if (bgImage) bgImage.style.display = 'none';
    videoPreviewEl.style.filter = 'none';
  }
}

// Record button
if (recordBtn) {
  recordBtn.addEventListener('click', async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  });
}

async function startRecording() {
  // Request camera if not already active
  if (!mediaStream) {
    if (typeof showToast === 'function') showToast('enabling camera...', 'info');
    await initCamera();
    if (!mediaStream) {
      if (typeof showToast === 'function') showToast('camera access required', 'error');
      return;
    }
  }

  recordedChunks = [];
  recordingSeconds = 0;

  // Determine which stream to record
  let recordStream;

  if (segmentationActive && bgCanvas) {
    // Record from canvas (with background replacement)
    canvasStream = bgCanvas.captureStream(30);

    // Add audio tracks from original stream
    mediaStream.getAudioTracks().forEach(track => {
      canvasStream.addTrack(track);
    });

    recordStream = canvasStream;
  } else {
    // Record from video directly
    recordStream = mediaStream;
  }

  // Create MediaRecorder with browser-compatible MIME type
  const mimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'  // Safari fallback
  ];

  let selectedMimeType = null;
  for (const type of mimeTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      selectedMimeType = type;
      break;
    }
  }

  try {
    if (selectedMimeType) {
      mediaRecorder = new MediaRecorder(recordStream, { mimeType: selectedMimeType });
    } else {
      mediaRecorder = new MediaRecorder(recordStream);
    }
  } catch (e) {
    console.error('MediaRecorder error:', e);
    mediaRecorder = new MediaRecorder(recordStream);
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = handleRecordingStop;

  mediaRecorder.start(1000);
  isRecording = true;
  recordingStartTime = Date.now();
  recordBtn.classList.add('recording');
  if (recordStatus) recordStatus.textContent = 'recording...';

  // Start timer
  timerInterval = setInterval(() => {
    recordingSeconds++;
    if (recordTimer) recordTimer.textContent = formatTime(recordingSeconds);
  }, 1000);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  isRecording = false;
  recordBtn.classList.remove('recording');

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (recordStatus) recordStatus.textContent = 'processing...';
}

async function handleRecordingStop() {
  const mimeType = mediaRecorder.mimeType || 'video/webm';
  const rawBlob = new Blob(recordedChunks, { type: mimeType });

  // Calculate duration from recording time
  const duration = Date.now() - recordingStartTime;

  // Fix WebM duration metadata using fix-webm-duration library
  let blob = rawBlob;
  if (typeof ysFixWebmDuration === 'function' && mimeType.includes('webm')) {
    try {
      blob = await new Promise((resolve, reject) => {
        ysFixWebmDuration(rawBlob, duration, (fixedBlob) => {
          if (fixedBlob) resolve(fixedBlob);
          else reject(new Error('Failed to fix webm duration'));
        });
      });
    } catch (e) {
      console.warn('Could not fix WebM duration:', e);
      blob = rawBlob;
    }
  }

  // Generate filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const filename = `recording-${timestamp}.${ext}`;

  // Create File object
  const file = new File([blob], filename, { type: mimeType });

  // Upload
  await uploadRecordedVideo(file);
}

async function uploadRecordedVideo(file) {
  if (recordStatus) recordStatus.textContent = 'uploading...';

  try {
    // Step 1: Get signed upload URL
    const uploadRes = await authenticatedFetch('api/upload', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size
      })
    });

    if (!uploadRes.ok) {
      const errorData = await uploadRes.json().catch(() => ({}));
      throw new Error(errorData.error || 'failed to get upload url');
    }

    const { uploadUrl, gcsUrl, filename } = await uploadRes.json();

    // Step 2: Upload to GCS
    const xhr = new XMLHttpRequest();
    await new Promise((resolve, reject) => {
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('upload to storage failed'));
      });
      xhr.addEventListener('error', () => reject(new Error('upload failed')));
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file);
    });

    // Step 3: Register video
    // Use custom title if provided, otherwise use filename
    const customTitle = videoTitleInput?.value?.trim();
    const videoTitle = customTitle || file.name.replace(/\.[^/.]+$/, '');

    const videoRes = await authenticatedFetch('api/videos', {
      method: 'POST',
      body: JSON.stringify({
        gcsUrl,
        filename,
        title: videoTitle
      })
    });

    if (!videoRes.ok) {
      throw new Error('failed to register video');
    }

    const { trackingUrl } = await videoRes.json();

    // Success!
    if (recordStatus) recordStatus.textContent = '';
    document.getElementById('trackingUrl').value = trackingUrl;
    document.getElementById('result').style.display = 'block';
    if (typeof showToast === 'function') showToast('video uploaded successfully', 'success');

    // Reset timer
    if (recordTimer) recordTimer.textContent = '0:00';
    recordingSeconds = 0;

  } catch (error) {
    console.error('Upload error:', error);
    if (recordStatus) recordStatus.textContent = '';
    if (typeof showToast === 'function') showToast(error.message, 'error');
  }
}

// Utility functions
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Fullscreen functionality - use recordZone to include controls
// With iOS Safari fallback (CSS-based pseudo-fullscreen)
if (fullscreenBtn && recordZone) {
  const supportsFullscreen = document.fullscreenEnabled ||
    document.webkitFullscreenEnabled ||
    recordZone.requestFullscreen !== undefined;

  fullscreenBtn.addEventListener('click', () => {
    const isFullscreen = document.fullscreenElement ||
      document.webkitFullscreenElement ||
      recordZone.classList.contains('pseudo-fullscreen');

    if (isFullscreen) {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else {
        // iOS fallback - remove pseudo-fullscreen class
        recordZone.classList.remove('pseudo-fullscreen');
        document.body.style.overflow = '';
      }
    } else {
      // Enter fullscreen
      if (supportsFullscreen && recordZone.requestFullscreen) {
        recordZone.requestFullscreen().catch(err => {
          console.warn('Native fullscreen failed, using CSS fallback:', err);
          recordZone.classList.add('pseudo-fullscreen');
          document.body.style.overflow = 'hidden';
        });
      } else if (recordZone.webkitRequestFullscreen) {
        recordZone.webkitRequestFullscreen();
      } else {
        // iOS fallback - CSS-based pseudo-fullscreen
        recordZone.classList.add('pseudo-fullscreen');
        document.body.style.overflow = 'hidden';
      }
    }
  });

  // Handle ESC key for pseudo-fullscreen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && recordZone.classList.contains('pseudo-fullscreen')) {
      recordZone.classList.remove('pseudo-fullscreen');
      document.body.style.overflow = '';
    }
  });
}

// DON'T auto-initialize camera - wait for user action
// Show enable camera button instead
if (recordStatus) {
  recordStatus.innerHTML = '<button class="btn btn-primary" id="enableCameraBtn">enable camera</button>';
  const enableBtn = document.getElementById('enableCameraBtn');
  if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
      enableBtn.disabled = true;
      enableBtn.textContent = 'starting camera...';
      await initCamera();
      // Hide button on success, show error on failure
      if (mediaStream) {
        recordStatus.textContent = ''; // Clear the button
      } else {
        enableBtn.disabled = false;
        enableBtn.textContent = 'retry camera';
      }
    });
  }
}
