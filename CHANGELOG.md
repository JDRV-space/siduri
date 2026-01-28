# Changelog

All notable changes to Siduri will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] - 2026-01-28

### Added
- Initial open source release
- **Video Recording** with webcam/microphone in browser
- **Background Blur** using MediaPipe Selfie Segmentation (light + super blur)
- **Custom Backgrounds** - gradient, office, dark, or custom image upload
- **Direct Upload** to Google Cloud Storage with progress indicator
- **Video Playback** with Video.js player
- **Automatic Subtitles** via faster-whisper Cloud Function (Spanish)
- **GIF Thumbnails** auto-generated via Cloud Function
- **View Tracking** with watch time and completion percentage
- **Analytics Dashboard** showing all videos and per-viewer stats
- **Email Notifications** when someone watches your video
- **Shareable Links** with optional viewer identification
- **JWT Authentication** with secure httpOnly cookies
- **Invitation System** - first user becomes owner, others need invite code
- **Password Reset** via email
- **Rate Limiting** on auth endpoints (10 attempts per 15 min)
- **Cloud Run Deployment** guide with GCS FUSE for SQLite persistence
- **Docker Support** for self-hosting
