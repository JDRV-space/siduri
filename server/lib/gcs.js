const { Storage } = require('@google-cloud/storage');

const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID
});

const bucket = storage.bucket(process.env.GCS_BUCKET);

// Generate signed URL for direct upload (1 hour expiry)
async function getSignedUploadUrl(filename, contentType) {
  const file = bucket.file(`videos/${filename}`);

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
    contentType: contentType
  });

  return {
    uploadUrl: url,
    gcsUrl: `https://storage.googleapis.com/${process.env.GCS_BUCKET}/videos/${filename}`
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

module.exports = { getSignedUploadUrl, getSignedReadUrl, bucket };
