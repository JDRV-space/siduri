// SIDURI - Upload Page

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const uploadStatus = document.getElementById('uploadStatus');
const result = document.getElementById('result');
const trackingUrlInput = document.getElementById('trackingUrl');

// getCredentials is defined in auth.js

// Drag and drop handlers
uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// Helper to check if content type is allowed (handles codec strings like "video/webm;codecs=vp9,opus")
// MP4 for manual uploads, WebM for recordings
function isAllowedType(contentType) {
  if (!contentType) return false;
  const baseType = contentType.split(';')[0].trim().toLowerCase();
  return baseType === 'video/mp4' || baseType === 'video/webm';
}

async function handleFile(file) {
  // Validate file type (handles codec strings from MediaRecorder)
  if (!isAllowedType(file.type)) {
    showToast('invalid file type. use mp4 or webm', 'error');
    return;
  }

  // Validate file size (100MB)
  if (file.size > 100 * 1024 * 1024) {
    showToast('file too large. max 100mb', 'error');
    return;
  }

  uploadZone.classList.add('uploading');
  progressBar.style.display = 'block';
  uploadStatus.textContent = 'getting upload url...';
  result.style.display = 'none';

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
      throw new Error('failed to get upload url');
    }

    const { uploadUrl, gcsUrl, filename } = await uploadRes.json();
    uploadStatus.textContent = 'uploading to cloud...';

    // Step 2: Upload directly to GCS
    await uploadToGCS(uploadUrl, file);

    uploadStatus.textContent = 'registering video...';

    // Step 3: Register video in database
    const videoRes = await authenticatedFetch('api/videos', {
      method: 'POST',
      body: JSON.stringify({
        gcsUrl,
        filename,
        title: file.name.replace(/\.[^/.]+$/, '') // Remove extension
      })
    });

    if (!videoRes.ok) {
      throw new Error('failed to register video');
    }

    const { trackingUrl } = await videoRes.json();

    // Success!
    uploadStatus.textContent = '';
    trackingUrlInput.value = trackingUrl;
    result.style.display = 'block';
    showToast('video uploaded successfully', 'success');

  } catch (error) {
    console.error('Upload error:', error);
    uploadStatus.textContent = '';
    showToast(error.message, 'error');
  } finally {
    uploadZone.classList.remove('uploading');
    progressBar.style.display = 'none';
    progressFill.style.width = '0%';
  }
}

function uploadToGCS(url, file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = percent + '%';
        uploadStatus.textContent = `uploading... ${percent}%`;
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error('upload failed'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('upload failed')));

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

function copyUrl() {
  trackingUrlInput.select();
  document.execCommand('copy');
  showToast('link copied to clipboard', 'success');
}

function previewVideo() {
  const url = trackingUrlInput.value;
  if (url) {
    // Open in new tab - use link click to avoid popup blocker
    const a = document.createElement('a');
    a.href = url + '?preview=1';
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}
