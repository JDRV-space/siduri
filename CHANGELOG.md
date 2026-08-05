# Changelog

This file records user-visible source changes. Git tags and GitHub releases, when created, own published release state.

## Unreleased

### Changed

- Added first-owner setup and invitation registration to the browser login flow.
- Made root and `/video/studio` page mounts consistent.
- Replaced recipient PII in share URLs with opaque server-side share records.
- Invalidated recipient links created before the server-side share-record change.
- Added configurable viewer-analytics retention and point-of-collection disclosure.
- Made video deletion remove GCS video, GIF, and subtitle objects before database state.
- Aligned Node support and CI with Node.js 22 and 24 LTS.
- Replaced the unsafe Cloud Storage FUSE SQLite deployment recipe.
- Corrected SMTP, GCS IAM, subtitle configuration, and contributor guidance.

### Initial public source snapshot

- Browser recording and direct MP4/WebM uploads to private Google Cloud Storage.
- Video.js playback, optional GIF thumbnails, and optional subtitles.
- Recipient-specific view analytics and owner notifications.
- JWT login, invitations, password reset, rate limiting, and integration tokens.
