const { Storage } = require('@google-cloud/storage');

const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID
});

const bucket = storage.bucket(process.env.GCS_BUCKET);

function getVideoObjectPath(filename) {
  return `videos/${filename}`;
}

function getPublicGcsUrl(objectPath) {
  return `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${objectPath}`;
}

function getObjectPathFromGcsUrl(gcsUrl) {
  const expectedPrefix = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/`;
  if (typeof gcsUrl !== 'string' || !gcsUrl.startsWith(expectedPrefix)) {
    return null;
  }

  const objectPath = gcsUrl.slice(expectedPrefix.length);
  if (!objectPath.startsWith('videos/') || objectPath.includes('..')) {
    return null;
  }

  return objectPath;
}

// Generate signed URL for direct upload (1 hour expiry)
async function getSignedUploadUrl(filename, contentType) {
  const objectPath = getVideoObjectPath(filename);
  const file = bucket.file(objectPath);

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
    contentType: contentType
  });

  return {
    uploadUrl: url,
    objectPath,
    gcsUrl: getPublicGcsUrl(objectPath)
  };
}

// Generate signed URL for reading (24 hour expiry)
async function getSignedReadUrl(gcsPath) {
  const file = bucket.file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  });

  return url;
}

module.exports = {
  bucket,
  getObjectPathFromGcsUrl,
  getPublicGcsUrl,
  getSignedReadUrl,
  getSignedUploadUrl,
  getVideoObjectPath
};
