# Siduri

Siduri is a small self-hosted video tool for a single installation. It records or uploads videos in the browser, stores the files in Google Cloud Storage, and keeps metadata, users, share links, and view tracking in SQLite.

The current scope excludes multi-tenant SaaS, high traffic, transcoding, and editing.

## What It Does

- Records webcam and microphone video in the browser.
- Supports MediaPipe background blur or static replacement backgrounds.
- Uploads MP4 or WebM files directly to GCS through signed URLs.
- Plays videos with Video.js from server-issued signed GCS URLs.
- Tracks watch time and completion for tokenized share links.
- Generates share links for a recipient email, with an optional viewer name.
- Sends password reset and view notification emails if SMTP is configured.
- Can run optional Cloud Functions for GIF thumbnails and Spanish subtitles.

## Stack

- Node.js 20-25
- Express
- Vanilla JavaScript frontend, no build step
- SQLite via `better-sqlite3`
- Google Cloud Storage for video files
- Optional Google Cloud Functions for subtitles and GIF thumbnails

## Hard Limits

- Single-tenant by design. The first registered user becomes owner only with `SIDURI_OWNER_SETUP_CODE`. Extra users need invitations, but this is still one shared installation.
- SQLite is embedded. Run at most one app instance writing to the database.
- Cloud Run with SQLite needs `--max-instances 1`. Multiple instances can corrupt or split state.
- GCS FUSE persistence works as a cheap option, not as a real database volume. It has locking and latency caveats.
- Keep video, subtitle, and GIF objects private. The app returns signed read URLs only to the owner session or a valid tokenized share link. A share URL can still be forwarded by its recipient.
- No transcoding, clipping, trimming, adaptive streaming, or format repair. Upload browser-playable MP4 or WebM.
- App upload limit is 100 MB per video and 10 uploads per user per hour.
- The GIF function has its own guards: 100 MB max input by default, 10 minutes max duration, 60 second ffmpeg timeout.
- Subtitle generation is optional, Spanish-focused, slow, and can time out on long or noisy videos.
- MediaPipe blur depends on browser support, WebGL, and CDN resources allowed by the CSP.
- This is not for high-traffic public SaaS.

## Install

```bash
npm install
cp .env.example .env
```

Set at least these values in `.env`:

```bash
JWT_SECRET=use-a-random-string-at-least-32-characters-long
GCS_BUCKET=your-video-bucket
GCS_PROJECT_ID=your-gcp-project-id
SIDURI_OWNER_SETUP_CODE=use-a-random-first-owner-setup-code
```

For local development, authenticate the Google client library:

```bash
gcloud auth application-default login
```

Then run it:

```bash
npm run dev
```

Open `http://localhost:8080`. Register the first account with `SIDURI_OWNER_SETUP_CODE`; that account becomes the owner.

## GCS Setup

Create a bucket and allow browser uploads. The included script creates a uniform-access bucket and CORS rules for the signed upload headers:

```bash
./scripts/setup-gcs.sh \
  YOUR_BUCKET_NAME \
  https://video.yourdomain.com \
  YOUR_PROJECT_ID
```

Equivalent CORS configuration:

```json
[
  {
    "origin": ["https://video.yourdomain.com"],
    "method": ["GET", "HEAD", "PUT"],
    "responseHeader": [
      "Content-Type",
      "Content-Length",
      "Accept-Encoding",
      "x-goog-content-length-range",
      "x-goog-meta-siduri-upload-id",
      "x-goog-meta-siduri-user-id"
    ],
    "maxAgeSeconds": 3600
  }
]
```

Do not grant `allUsers:objectViewer` on the bucket. Playback, subtitles, and GIF thumbnails use signed read URLs.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | Yes | none | Use a random 32+ character value. |
| `GCS_BUCKET` | Yes | none | Bucket used for `videos/` objects. |
| `GCS_PROJECT_ID` | Yes | none | Google Cloud project ID. |
| `PORT` | No | `8080` | Cloud Run expects `8080`. |
| `NODE_ENV` | No | `development` | Use `production` behind HTTPS. |
| `DATA_DIR` | No | `./data` | Directory for `siduri.db`. |
| `BASE_URL` | Production | local URL | Public URL used in reset and share links. Include path prefixes. |
| `SIDURI_OWNER_SETUP_CODE` | First owner setup | none | Required to create the initial owner account. |
| `TRUST_PROXY` | No | `1` in production, `false` otherwise | Express trust proxy setting. |
| `ALLOWED_EMAIL_DOMAINS` | No | all domains | Comma-separated registration allowlist. |
| `ALLOWED_ORIGINS` | No | localhost origins | Comma-separated CORS allowlist. |
| `SMTP_HOST` | No | none | Enables password reset and email notifications with the other SMTP values. |
| `SMTP_PORT` | No | `587` | SMTP port. |
| `SMTP_USER` | No | none | SMTP username. |
| `SMTP_PASS` | No | none | SMTP password. |
| `SMTP_FROM` | No | `SMTP_USER` | Sender address. |

## Deploy

### Cloud Run

Basic deployment:

```bash
gcloud run deploy siduri \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --memory 512Mi \
  --set-env-vars "JWT_SECRET=YOUR_SECRET,GCS_BUCKET=YOUR_BUCKET,GCS_PROJECT_ID=YOUR_PROJECT,NODE_ENV=production,BASE_URL=https://YOUR_DOMAIN/video/studio,SIDURI_OWNER_SETUP_CODE=YOUR_OWNER_SETUP_CODE"
```

By default, SQLite lives in the container filesystem. Treat that as disposable. Redeploys, restarts, and instance replacement can lose the database.

If you accept the caveats, mount a separate GCS bucket for the SQLite data directory:

```bash
gsutil mb -l us-central1 gs://YOUR_BUCKET_NAME-data

gcloud run services update siduri \
  --region us-central1 \
  --add-volume name=data-vol,type=cloud-storage,bucket=YOUR_BUCKET_NAME-data \
  --add-volume-mount volume=data-vol,mount-path=/app/data \
  --max-instances 1 \
  --set-env-vars "DATA_DIR=/app/data"
```

Do not remove `--max-instances 1` while using SQLite.

### Docker

```bash
docker build -t siduri .

docker run -p 8080:8080 \
  -e JWT_SECRET=your-secret-key-32-chars-minimum \
  -e GCS_BUCKET=your-bucket \
  -e GCS_PROJECT_ID=your-project \
  -e NODE_ENV=production \
  -e BASE_URL=https://video.yourdomain.com \
  -e SIDURI_OWNER_SETUP_CODE=your-owner-setup-code \
  -v $(pwd)/data:/app/data \
  siduri
```

## Optional Functions

These are separate Cloud Functions triggered by GCS object finalization. The main app works without them. They only process objects that include Siduri's signed upload metadata.

- `functions/gif-generator`: creates a short `.gif` beside uploaded MP4/WebM files.
- `functions/video-subtitles`: creates `.vtt` subtitles with faster-whisper, configured for Spanish.

Deploy from each function directory with its `deploy.sh`. Set `GCS_BUCKET` first. The subtitle function can also use `HF_TOKEN`.

Function dependencies are exact Python 3.11 locks. Edit `requirements.in`, then regenerate the adjacent deploy file:

```bash
uv pip compile --python-version 3.11 --generate-hashes \
  requirements.in --output-file requirements.txt
```

## API

The app mounts the API at `/api`. It also mounts `/video/studio/api` for the existing load-balancer path setup.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/refresh` |
| Password reset | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` |
| Invitations | `POST /api/auth/invitations`, `GET /api/auth/invitations` |
| API tokens | `POST /api/auth/api-token`, `GET /api/auth/api-tokens`, `DELETE /api/auth/api-tokens/:id` |
| Upload | `POST /api/upload` |
| Videos | `POST /api/videos`, `GET /api/videos`, `GET /api/videos/:id`, `PATCH /api/videos/:id`, `DELETE /api/videos/:id` |
| Sharing | `POST /api/videos/:id/share` |
| Tracking | `POST /api/track`, `POST /api/track/beacon` |
| Notifications | `GET /api/settings/notifications`, `POST /api/settings/notifications/teams`, `POST /api/settings/notifications/email` |
| Health | `GET /health` |

## Security Notes

- JWTs are stored in httpOnly cookies. Production mode sets secure cookie behavior for HTTPS.
- Passwords are hashed with bcrypt.
- Login and registration are rate limited to 10 attempts per 15 minutes.
- General API requests are rate limited to 60 requests per minute.
- Helmet is enabled with a CSP that allows the CDN and WebAssembly needs of Video.js and MediaPipe.
- CORS defaults to localhost. Set `ALLOWED_ORIGINS` in production.
- Signed read URLs are minted for owner sessions and tokenized share links.
- Signed upload URLs expire after one hour and include exact size plus Siduri upload metadata headers. Anyone with a leaked valid URL can still upload during that window.

## License

Apache License 2.0. See [LICENSE](LICENSE).

Attribution notices are listed in [NOTICE](NOTICE).
