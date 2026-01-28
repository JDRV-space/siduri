# Siduri Subtitle Generation

Automatic Spanish subtitle generation using faster-whisper.

## Architecture

```
Video Upload Flow:
1. User uploads video → GCS (gs://YOUR_BUCKET/videos/)
2. GCS triggers Cloud Function (object.finalize event)
3. Cloud Function downloads video
4. faster-whisper transcribes (Spanish, small model)
5. WebVTT file uploaded to GCS (same folder as video)
6. Player auto-loads subtitle track from GCS
```

## Local Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Test with sample video
GCS_BUCKET=your-bucket python test_local.py /path/to/video.mp4
```

## Deployment

```bash
# Set required environment variables
export GCS_BUCKET=your-video-bucket
export HF_TOKEN=your-huggingface-token  # Optional but recommended

# Deploy Cloud Function
./deploy.sh

# Verify deployment
gcloud functions describe siduri-subtitles \
  --gen2 \
  --region=us-central1
```

## Configuration

| Variable | Value | Description |
|----------|-------|-------------|
| MODEL_SIZE | small | Whisper model (tiny/base/small/medium/large) |
| DEVICE | cpu | Processing device |
| COMPUTE_TYPE | int8 | CPU optimization type |
| LANGUAGE | es | Spanish (es-ES) |
| MEMORY | 4GB | Cloud Function memory |
| TIMEOUT | 540s | 9 minutes max |

## Cost Estimate

- **faster-whisper small model**: ~1-2min processing per 1min video
- **Cloud Function**: $0.40/million invocations + compute time
- **Typical 5min video**: ~$0.001-0.002 per video

## Testing

1. Upload video to Siduri
2. Check Cloud Function logs: `gcloud functions logs read siduri-subtitles --gen2 --region=us-central1`
3. Verify VTT file in GCS: `gsutil ls gs://$GCS_BUCKET/videos/*.vtt`
4. Open video in player - subtitles should load automatically

## Troubleshooting

**Subtitles not appearing:**
- Check Cloud Function logs for errors
- Verify VTT file exists in GCS (same name as video)
- Check browser console for CORS errors
- Ensure GCS bucket has public read access

**Processing timeout:**
- Increase `--timeout` in deploy.sh
- Use smaller model (tiny instead of small)
- Reduce `--beam-size` in main.py

**Poor transcription quality:**
- Upgrade to larger model (medium or large-v2)
- Check detected language matches video
- Verify audio quality in source video
