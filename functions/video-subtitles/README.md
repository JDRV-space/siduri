# Siduri Subtitle Generation

Subtitle generation using faster-whisper. Spanish is the default language.

## Architecture

```
Video Upload Flow:
1. User uploads video → GCS (gs://YOUR_BUCKET/videos/)
2. GCS triggers Cloud Function (object.finalize event)
3. Cloud Function downloads video
4. faster-whisper transcribes (Spanish, small model)
5. WebVTT file uploaded to GCS (same folder as video)
6. Player auto-loads subtitle track through a server-issued signed URL
```

The function skips objects without Siduri's signed upload metadata (`siduri-upload-id` and `siduri-user-id`).

## Local Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install the exact dependency lock
pip install --require-hashes -r requirements.txt

# Test with sample video
GCS_BUCKET=your-bucket python test_local.py /path/to/video.mp4
```

## Deployment

```bash
# Set required environment variables
export GCS_BUCKET=your-video-bucket

# Deploy Cloud Function
./deploy.sh

# Verify deployment
gcloud functions describe siduri-subtitles \
  --gen2 \
  --region=us-central1
```

## Configuration

| Environment variable | Default | Description |
|----------|-------|-------------|
| MODEL_SIZE | small | Whisper model (tiny/base/small/medium/large) |
| DEVICE | cpu | Processing device |
| COMPUTE_TYPE | int8 | CPU optimization type |
| LANGUAGE | es | Transcription language |
| MAX_SUBTITLE_VIDEO_BYTES | 104857600 | Max input size in bytes |

The deployment script separately owns the Cloud Function resource settings: 4 GB memory, 540-second timeout, and a maximum of three instances.

## Cost Planning

Cost and processing time depend on region, model size, video duration, memory, and current Google Cloud pricing. Measure representative videos in the target project before setting a budget; this repository does not publish a per-video cost estimate.

## Testing

Run the isolated handler tests before deployment:

```bash
python3 -m unittest discover -s . -p test_main.py
```

For a deployed verification, upload a Siduri-stamped video, check the function logs, verify the adjacent VTT object, and open the video through Siduri.

## Troubleshooting

**Subtitles not appearing:**
- Check Cloud Function logs for errors
- Verify VTT file exists in GCS (same name as video)
- Check browser console for CORS errors
- Ensure the app can create signed read URLs for the GCS bucket

**Processing timeout:**
- Increase `--timeout` in deploy.sh
- Use smaller model (tiny instead of small)
- Reduce the `beam_size` argument in `main.py`

**Poor transcription quality:**
- Upgrade to larger model (medium or large-v2)
- Check detected language matches video
- Verify audio quality in source video
