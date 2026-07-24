#!/bin/bash
set -euo pipefail

# Siduri - GCS Bucket Setup

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: ./setup-gcs.sh <bucket-name> <allowed-origin> [project-id]"
  exit 1
fi

readonly BUCKET_NAME="$1"
readonly ALLOWED_ORIGIN="$2"
readonly PROJECT_ID="${3:-$(gcloud config get-value project)}"

if [[ ! "$ALLOWED_ORIGIN" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  echo "Allowed origin must be an exact HTTP(S) origin."
  exit 1
fi

cors_file="$(mktemp "${TMPDIR:-/tmp}/siduri-cors.XXXXXX.json")"
readonly cors_file
trap 'rm -f "$cors_file"' EXIT

echo "Creating GCS bucket: $BUCKET_NAME"

# Create bucket
gcloud storage buckets create "gs://$BUCKET_NAME" \
  --project="$PROJECT_ID" \
  --location=us-central1 \
  --uniform-bucket-level-access

# Set CORS configuration
cat > "$cors_file" << EOF
[
  {
    "origin": ["$ALLOWED_ORIGIN"],
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
EOF

gcloud storage buckets update "gs://$BUCKET_NAME" --cors-file="$cors_file"

echo "Done! Bucket $BUCKET_NAME created with CORS enabled"
echo "For Cloud Run, create a service account with Storage Object Admin role:"
echo "  gcloud iam service-accounts create siduri-sa --display-name='Siduri Service Account'"
echo "  gcloud projects add-iam-policy-binding $PROJECT_ID --member='serviceAccount:siduri-sa@$PROJECT_ID.iam.gserviceaccount.com' --role='roles/storage.objectAdmin'"
