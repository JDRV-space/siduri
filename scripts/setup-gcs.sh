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
readonly REGION="${REGION:-us-central1}"
readonly SERVICE_ACCOUNT_NAME="${SIDURI_SERVICE_ACCOUNT_NAME:-siduri-sa}"
readonly SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT_NAME@$PROJECT_ID.iam.gserviceaccount.com"

if [[ ! "$ALLOWED_ORIGIN" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  echo "Allowed origin must be an exact HTTP(S) origin."
  exit 1
fi

# Service-account creation and signed URLs require both IAM APIs.
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com \
  --project="$PROJECT_ID"

cors_file="$(mktemp "${TMPDIR:-/tmp}/siduri-cors.XXXXXX.json")"
readonly cors_file
trap 'rm -f "$cors_file"' EXIT

if gcloud storage buckets describe "gs://$BUCKET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Using existing GCS bucket: $BUCKET_NAME"
else
  echo "Creating GCS bucket: $BUCKET_NAME"
  gcloud storage buckets create "gs://$BUCKET_NAME" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --uniform-bucket-level-access
fi

# Enforce uniform bucket-level access for both new and reused buckets.
gcloud storage buckets update "gs://$BUCKET_NAME" \
  --uniform-bucket-level-access \
  --project="$PROJECT_ID"

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

if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --display-name="Siduri Service Account" \
    --project="$PROJECT_ID"
fi

# Bucket-scoped object access for uploads, playback, and deletion.
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET_NAME" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/storage.objectUser" \
  --project="$PROJECT_ID"

# Signed URLs require iam.serviceAccounts.signBlob on the runtime identity.
gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT_EMAIL" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT_ID"

echo "Bucket CORS and least-privilege service identity are configured."
echo "Deploy the app with: --service-account=$SERVICE_ACCOUNT_EMAIL"
