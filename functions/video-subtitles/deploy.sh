#!/bin/bash

# Siduri - Deploy Subtitle Generation Cloud Function
# This function is triggered when videos are uploaded to GCS

set -e

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"
FUNCTION_NAME="${FUNCTION_NAME:-siduri-subtitles}"
REGION="${REGION:-us-central1}"
BUCKET="${GCS_BUCKET:?GCS_BUCKET environment variable is required}"

echo "Deploying subtitle generation Cloud Function..."

gcloud functions deploy $FUNCTION_NAME \
  --gen2 \
  --runtime=python311 \
  --region=$REGION \
  --source=. \
  --entry-point=generate_subtitles \
  --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
  --trigger-event-filters="bucket=$BUCKET" \
  --memory=4GB \
  --timeout=540s \
  --max-instances=3 \
  --set-env-vars="HF_TOKEN=$HF_TOKEN" \
  --project=$PROJECT_ID

echo "✓ Deployment complete!"
echo "Function will automatically generate subtitles for videos uploaded to gs://$BUCKET/videos/"
