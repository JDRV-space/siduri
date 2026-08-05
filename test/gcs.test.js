const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GCS_BUCKET = 'siduri-test-bucket';
process.env.GCS_PROJECT_ID = 'siduri-test-project';

const {
  deleteVideoObjects,
  getObjectPathFromGcsUrl,
  getPublicGcsUrl,
  getVideoObjectPath
} = require('../server/lib/gcs');

process.env.SIDURI_FAKE_GCS = '1';

test('getVideoObjectPath stores videos under the videos prefix', () => {
  assert.equal(
    getVideoObjectPath('123e4567-e89b-12d3-a456-426614174000.mp4'),
    'videos/123e4567-e89b-12d3-a456-426614174000.mp4'
  );
});

test('getPublicGcsUrl builds a URL for the configured bucket', () => {
  assert.equal(
    getPublicGcsUrl('videos/123e4567-e89b-12d3-a456-426614174000.mp4'),
    'https://storage.googleapis.com/siduri-test-bucket/videos/123e4567-e89b-12d3-a456-426614174000.mp4'
  );
});

test('getObjectPathFromGcsUrl rejects URLs outside the configured bucket', () => {
  assert.equal(
    getObjectPathFromGcsUrl('https://storage.googleapis.com/other-bucket/videos/private.mp4'),
    null
  );
});

test('getObjectPathFromGcsUrl rejects traversal paths', () => {
  assert.equal(
    getObjectPathFromGcsUrl('https://storage.googleapis.com/siduri-test-bucket/videos/../private.mp4'),
    null
  );
});

test('deleteVideoObjects removes the video and its derived objects idempotently', async () => {
  const paths = await deleteVideoObjects('videos/123e4567-e89b-12d3-a456-426614174000.mp4');
  assert.deepEqual(paths, [
    'videos/123e4567-e89b-12d3-a456-426614174000.mp4',
    'videos/123e4567-e89b-12d3-a456-426614174000.gif',
    'videos/123e4567-e89b-12d3-a456-426614174000.vtt'
  ]);

  await assert.doesNotReject(() => deleteVideoObjects('videos/123e4567-e89b-12d3-a456-426614174000.mp4'));
});
