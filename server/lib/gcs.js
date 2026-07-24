const { Storage } = require('@google-cloud/storage');

let storage;
let bucket;

const UPLOAD_LENGTH_RANGE_HEADER = 'x-goog-content-length-range';
const UPLOAD_ID_METADATA_HEADER = 'x-goog-meta-siduri-upload-id';
const USER_ID_METADATA_HEADER = 'x-goog-meta-siduri-user-id';

function getBucket() {
  if (process.env.SIDURI_FAKE_GCS === '1') {
    return {
      file: (objectPath) => ({
        getSignedUrl: async (config) => [`https://storage.googleapis.com/${process.env.GCS_BUCKET}/${objectPath}?signed=${config.action}`],
        getMetadata: async () => [{
          size: process.env.SIDURI_FAKE_GCS_OBJECT_SIZE || '1',
          contentType: process.env.SIDURI_FAKE_GCS_CONTENT_TYPE || 'video/mp4',
          metadata: {
            'siduri-upload-id': process.env.SIDURI_FAKE_GCS_UPLOAD_ID || '',
            'siduri-user-id': process.env.SIDURI_FAKE_GCS_USER_ID || ''
          }
        }]
      })
    };
  }

  if (!storage) {
    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID
    });
    bucket = storage.bucket(process.env.GCS_BUCKET);
  }

  return bucket;
}

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
async function getSignedUploadUrl({ filename, contentType, size, uploadId, userId }) {
  const objectPath = getVideoObjectPath(filename);
  const file = getBucket().file(objectPath);
  const requiredHeaders = {
    [UPLOAD_LENGTH_RANGE_HEADER]: `${size},${size}`,
    [UPLOAD_ID_METADATA_HEADER]: uploadId,
    [USER_ID_METADATA_HEADER]: userId
  };

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
    contentType,
    extensionHeaders: requiredHeaders
  });

  return {
    uploadUrl: url,
    uploadHeaders: requiredHeaders,
    objectPath,
    gcsUrl: getPublicGcsUrl(objectPath)
  };
}

// Generate signed URL for reading (24 hour expiry)
async function getSignedReadUrl(gcsPath) {
  const file = getBucket().file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  });

  return url;
}

async function getObjectMetadata(gcsPath) {
  const file = getBucket().file(gcsPath);
  const [metadata] = await file.getMetadata();

  return {
    contentType: metadata.contentType,
    metadata: metadata.metadata || {},
    size: Number(metadata.size)
  };
}

module.exports = {
  get bucket() {
    return getBucket();
  },
  getObjectPathFromGcsUrl,
  getObjectMetadata,
  getPublicGcsUrl,
  getSignedReadUrl,
  getSignedUploadUrl,
  getVideoObjectPath,
  UPLOAD_ID_METADATA_HEADER,
  UPLOAD_LENGTH_RANGE_HEADER,
  USER_ID_METADATA_HEADER
};
