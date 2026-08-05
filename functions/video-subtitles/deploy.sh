#!/bin/bash

# Siduri - Deploy Subtitle Generation Cloud Function
# This function is triggered when videos are uploaded to GCS

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"
FUNCTION_NAME="${FUNCTION_NAME:-siduri-subtitles}"
REGION="${REGION:-us-central1}"
BUCKET="${GCS_BUCKET:?GCS_BUCKET environment variable is required}"
MODEL_SIZE="${MODEL_SIZE:-small}"
DEVICE="${DEVICE:-cpu}"
COMPUTE_TYPE="${COMPUTE_TYPE:-int8}"
LANGUAGE="${LANGUAGE:-es}"
MAX_SUBTITLE_VIDEO_BYTES="${MAX_SUBTITLE_VIDEO_BYTES:-104857600}"

echo "Deploying subtitle generation Cloud Function..."

gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --runtime=python311 \
  --region="$REGION" \
  --source=. \
  --entry-point=generate_subtitles \
  --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
  --trigger-event-filters="bucket=$BUCKET" \
  --memory=4GB \
  --timeout=540s \
  --max-instances=3 \
  --set-env-vars="MODEL_SIZE=$MODEL_SIZE,DEVICE=$DEVICE,COMPUTE_TYPE=$COMPUTE_TYPE,LANGUAGE=$LANGUAGE,MAX_SUBTITLE_VIDEO_BYTES=$MAX_SUBTITLE_VIDEO_BYTES" \
  --project="$PROJECT_ID"

echo "✓ Deployment complete!"
echo "Function will generate subtitles for Siduri-stamped uploads in gs://$BUCKET/videos/"
