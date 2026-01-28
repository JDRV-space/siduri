#!/bin/bash
# Siduri - GCS Bucket Setup

if [ -z "$1" ]; then
  echo "Usage: ./setup-gcs.sh <bucket-name> [project-id]"
  exit 1
fi

BUCKET_NAME=$1
PROJECT_ID=${2:-$(gcloud config get-value project)}

echo "Creating GCS bucket: $BUCKET_NAME"

# Create bucket
gcloud storage buckets create gs://$BUCKET_NAME \
  --project=$PROJECT_ID \
  --location=us-central1 \
  --uniform-bucket-level-access

# Set CORS configuration
cat > /tmp/cors.json << 'EOF'
[
  {
    "origin": ["*"],
    "method": ["GET", "PUT", "POST", "OPTIONS"],
    "responseHeader": ["Content-Type", "Content-Length", "Accept-Encoding"],
    "maxAgeSeconds": 3600
  }
]
EOF

gcloud storage buckets update gs://$BUCKET_NAME --cors-file=/tmp/cors.json

echo "Done! Bucket $BUCKET_NAME created with CORS enabled"
echo ""
echo "For Cloud Run, create a service account with Storage Object Admin role:"
echo "  gcloud iam service-accounts create siduri-sa --display-name='Siduri Service Account'"
echo "  gcloud projects add-iam-policy-binding $PROJECT_ID --member='serviceAccount:siduri-sa@$PROJECT_ID.iam.gserviceaccount.com' --role='roles/storage.objectAdmin'"
