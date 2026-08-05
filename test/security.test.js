const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
process.env.GCS_BUCKET = 'siduri-test-bucket';
process.env.GCS_PROJECT_ID = 'siduri-test-project';
process.env.BASE_URL = 'https://siduri.example/video/studio';
process.env.SIDURI_OWNER_SETUP_CODE = 'owner-setup-code';
process.env.SIDURI_FAKE_GCS = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'siduri-security-'));

const { app } = require('../server/index');
const db = require('../server/lib/db');

let server;
let baseUrl;
let ownerCookie;
let ownerEmail = 'owner@example.com';
let ownerPassword = 'correct horse battery staple';

function getCookies(response) {
  const setCookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
  return setCookies.map(cookie => cookie.split(';')[0]).join('; ');
}

async function request(pathname, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers
  };

  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body
  });
}

async function json(response) {
  return response.json();
}

test.before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
});

test('security acceptance flows', async (t) => {
  await t.test('clean install exposes owner setup and both supported page mounts', async () => {
    const setupResponse = await request('/api/auth/check-first-user');
    assert.equal(setupResponse.status, 200);
    assert.deepEqual(await json(setupResponse), {
      isFirstUser: true,
      requiresInviteCode: true,
      ownerSetupConfigured: true
    });

    const rootPage = await request('/');
    assert.equal(rootPage.status, 200);
    const rootHtml = await rootPage.text();
    assert.match(rootHtml, /id="registrationFields"/);
    assert.match(rootHtml, /id="showRegistrationBtn"/);

    for (const pathname of [
      '/video/studio/',
      '/video/studio/dashboard',
      '/video/studio/settings',
      '/video/studio/watch/123e4567-e89b-42d3-a456-426614174000'
    ]) {
      const response = await request(pathname);
      assert.equal(response.status, 200, pathname);
    }
  });

  await t.test('concurrent first-user setup creates exactly one owner', async () => {
    const registrations = await Promise.all([
      request('/api/auth/register', {
        method: 'POST',
        body: {
          email: ownerEmail,
          password: ownerPassword,
          inviteCode: 'owner-setup-code'
        }
      }),
      request('/api/auth/register', {
        method: 'POST',
        body: {
          email: 'attacker@example.com',
          password: 'attacker password phrase',
          inviteCode: 'owner-setup-code'
        }
      })
    ]);

    const statuses = registrations.map(response => response.status).sort();
    assert.deepEqual(statuses, [200, 400]);

    const ownerResponse = registrations.find(response => response.status === 200);
    ownerCookie = getCookies(ownerResponse);

    const ownerCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'owner'").get();
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    assert.equal(ownerCount.count, 1);
    assert.equal(userCount.count, 1);
  });

  await t.test('concurrent invitation reuse creates one member', async () => {
    const inviteResponse = await request('/api/auth/invitations', {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {}
    });
    assert.equal(inviteResponse.status, 200);
    const invitation = await json(inviteResponse);

    const registrations = await Promise.all([
      request('/api/auth/register', {
        method: 'POST',
        body: {
          email: 'member-one@example.com',
          password: 'member password phrase',
          inviteCode: invitation.code
        }
      }),
      request('/api/auth/register', {
        method: 'POST',
        body: {
          email: 'member-two@example.com',
          password: 'member password phrase',
          inviteCode: invitation.code
        }
      })
    ]);

    const statuses = registrations.map(response => response.status).sort();
    assert.deepEqual(statuses, [200, 400]);

    const memberCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'member'").get();
    const usedInvitation = db.prepare('SELECT used_at FROM invitations WHERE code = ?').get(invitation.code);
    assert.equal(memberCount.count, 1);
    assert.ok(usedInvitation.used_at);
  });

  await t.test('password reset uses configured base URL and revokes old session and API tokens', async () => {
    const apiTokenResponse = await request('/api/auth/api-token', {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: { name: 'test token' }
    });
    assert.equal(apiTokenResponse.status, 200);
    const { token: apiToken } = await json(apiTokenResponse);

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
    };

    try {
      const forgotResponse = await request('/api/auth/forgot-password', {
        method: 'POST',
        headers: { Host: 'evil.example' },
        body: { email: ownerEmail }
      });
      assert.equal(forgotResponse.status, 200);
    } finally {
      console.log = originalLog;
    }

    const resetLine = logs.find(line => line.includes('Reset URL:'));
    assert.ok(resetLine);
    const resetUrl = resetLine.slice(resetLine.indexOf('https://'));
    assert.ok(resetUrl.startsWith('https://siduri.example/video/studio/reset-password.html?token='));
    assert.equal(resetUrl.includes('evil.example'), false);

    const token = new URL(resetUrl).searchParams.get('token');
    const resetResponse = await request('/api/auth/reset-password', {
      method: 'POST',
      body: {
        token,
        password: 'new owner password phrase'
      }
    });
    assert.equal(resetResponse.status, 200);

    const oldSessionResponse = await request('/api/auth/me', {
      headers: { Cookie: ownerCookie }
    });
    assert.equal(oldSessionResponse.status, 401);

    const oldApiResponse = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${apiToken}` }
    });
    assert.equal(oldApiResponse.status, 401);

    const loginResponse = await request('/api/auth/login', {
      method: 'POST',
      body: {
        email: ownerEmail,
        password: 'new owner password phrase'
      }
    });
    assert.equal(loginResponse.status, 200);
    ownerCookie = getCookies(loginResponse);
  });

  await t.test('media metadata and duration updates require owner session or valid share token', async () => {
    const owner = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
    const videoId = '123e4567-e89b-42d3-a456-426614174000';
    db.prepare(`
      INSERT INTO videos (id, filename, gcs_url, title, duration_secs, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      videoId,
      '123e4567-e89b-42d3-a456-426614174001.mp4',
      'https://storage.googleapis.com/siduri-test-bucket/videos/123e4567-e89b-42d3-a456-426614174001.mp4',
      'Private video',
      10,
      owner.id
    );

    const unauthenticatedVideo = await request(`/api/videos/${videoId}`);
    assert.equal(unauthenticatedVideo.status, 403);

    const unauthorizedDuration = await request(`/api/videos/${videoId}`, {
      method: 'PATCH',
      body: { duration_secs: 99 }
    });
    assert.equal(unauthorizedDuration.status, 401);

    const shareResponse = await request(`/api/videos/${videoId}/share`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        recipientEmail: 'viewer@example.com',
        recipientName: 'Test Viewer'
      }
    });
    assert.equal(shareResponse.status, 200);
    const share = await json(shareResponse);
    const viewerToken = new URL(share.trackingUrl).searchParams.get('v');
    const tokenPayload = JSON.parse(Buffer.from(viewerToken.split('.')[0], 'base64url').toString());
    assert.equal(tokenPayload.e, undefined);
    assert.equal(tokenPayload.n, undefined);
    assert.equal(typeof tokenPayload.s, 'string');

    const sharedVideo = await request(`/api/videos/${videoId}?v=${encodeURIComponent(viewerToken)}`);
    assert.equal(sharedVideo.status, 200);
    const sharedBody = await json(sharedVideo);
    assert.match(sharedBody.videoUrl, /\?signed=read/);
    assert.match(sharedBody.subtitleUrl, /\.vtt\?signed=read/);
    assert.deepEqual(sharedBody.tracking, { enabled: true, retentionDays: 90 });

    const trackResponse = await request('/api/track', {
      method: 'POST',
      body: { videoId, watchSecs: 5, viewerToken }
    });
    assert.equal(trackResponse.status, 200);
    assert.equal((await json(trackResponse)).tracked, true);
    const view = db.prepare('SELECT viewer_email, viewer_name FROM views WHERE video_id = ?').get(videoId);
    assert.deepEqual(view, { viewer_email: 'viewer@example.com', viewer_name: 'Test Viewer' });

    const ownerDuration = await request(`/api/videos/${videoId}`, {
      method: 'PATCH',
      headers: { Cookie: ownerCookie },
      body: { duration_secs: 42 }
    });
    assert.equal(ownerDuration.status, 200);

    const updated = db.prepare('SELECT duration_secs FROM videos WHERE id = ?').get(videoId);
    assert.equal(updated.duration_secs, 42);

    const deleteResponse = await request(`/api/videos/${videoId}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie }
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal(db.prepare('SELECT id FROM videos WHERE id = ?').get(videoId), undefined);
    assert.equal(db.prepare('SELECT id FROM views WHERE video_id = ?').get(videoId), undefined);
    assert.equal(db.prepare('SELECT id FROM shares WHERE video_id = ?').get(videoId), undefined);
  });

  await t.test('signed upload registration verifies object size and metadata before consuming', async () => {
    const uploadResponse = await request('/api/upload', {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        filename: 'screen.mp4',
        contentType: 'video/mp4',
        size: 25
      }
    });
    assert.equal(uploadResponse.status, 200);
    const upload = await json(uploadResponse);

    assert.equal(upload.uploadHeaders['x-goog-content-length-range'], '25,25');
    assert.equal(upload.uploadHeaders['x-goog-meta-siduri-upload-id'], upload.uploadId);

    const concurrentReservations = await Promise.all(
      Array.from({ length: 12 }, (_, index) => request('/api/upload', {
        method: 'POST',
        headers: { Cookie: ownerCookie },
        body: {
          filename: `concurrent-${index}.mp4`,
          contentType: 'video/mp4',
          size: 25
        }
      }))
    );
    const reservationStatuses = concurrentReservations.map(response => response.status);
    assert.equal(reservationStatuses.filter(status => status === 200).length, 9);
    assert.equal(reservationStatuses.filter(status => status === 429).length, 3);

    const owner = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
    process.env.SIDURI_FAKE_GCS_OBJECT_SIZE = '99';
    process.env.SIDURI_FAKE_GCS_CONTENT_TYPE = 'video/mp4';
    process.env.SIDURI_FAKE_GCS_UPLOAD_ID = upload.uploadId;
    process.env.SIDURI_FAKE_GCS_USER_ID = owner.id;

    const wrongSize = await request('/api/videos', {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: { uploadId: upload.uploadId, title: 'wrong size' }
    });
    assert.equal(wrongSize.status, 400);
    assert.match((await json(wrongSize)).error, /size/);

    const pendingAfterFailure = db.prepare('SELECT consumed_at FROM pending_uploads WHERE id = ?').get(upload.uploadId);
    assert.equal(pendingAfterFailure.consumed_at, null);

    process.env.SIDURI_FAKE_GCS_OBJECT_SIZE = '25';
    const registered = await request('/api/videos', {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: { uploadId: upload.uploadId, title: 'registered' }
    });
    assert.equal(registered.status, 200);

    const reused = await request('/api/videos', {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: { uploadId: upload.uploadId, title: 'reused' }
    });
    assert.equal(reused.status, 400);
  });
});
