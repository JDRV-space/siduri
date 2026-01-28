#!/bin/bash
# Deploy GIF Generator Cloud Function

FUNCTION_NAME="${FUNCTION_NAME:-siduri-gif}"
REGION="${REGION:-us-central1}"
BUCKET="${GCS_BUCKET:?GCS_BUCKET environment variable is required}"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"

gcloud functions deploy $FUNCTION_NAME \
  --gen2 \
  --runtime=python311 \
  --region=$REGION \
  --source=. \
  --entry-point=generate_gif \
  --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
  --trigger-event-filters="bucket=$BUCKET" \
  --memory=1024MB \
  --timeout=300s \
  --set-env-vars="GCS_BUCKET=$BUCKET" \
  --project=$PROJECT_ID

echo "Deploy complete!"
echo "GIFs will be generated at: gs://$BUCKET/videos/{video-id}.gif"
