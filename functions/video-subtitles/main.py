"""
Siduri - Subtitle Generation Cloud Function
Triggered on video upload to GCS, generates Spanish subtitles using faster-whisper
"""

import os
import tempfile
import functions_framework
from google.cloud import storage
from faster_whisper import WhisperModel
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize GCS client
storage_client = storage.Client()

# Model settings
MODEL_SIZE = "small"  # Options: tiny, base, small, medium, large (small=~1.5GB)
DEVICE = "cpu"
COMPUTE_TYPE = "int8"  # CPU optimization
LANGUAGE = "es"  # Spanish
MAX_VIDEO_BYTES = int(os.environ.get("MAX_SUBTITLE_VIDEO_BYTES", 100 * 1024 * 1024))
ALLOWED_EXTENSIONS = {".mp4", ".webm"}
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/webm"}
REQUIRED_METADATA_KEYS = {"siduri-upload-id", "siduri-user-id"}

# Global model instance (reused across invocations)
model = None


def get_model():
    """Load or return cached Whisper model"""
    global model
    if model is None:
        logger.info(f"Loading faster-whisper model: {MODEL_SIZE}")
        # HF_TOKEN env var is auto-detected by huggingface_hub for model download
        # Do NOT pass token to WhisperModel - it incorrectly forwards to ctranslate2
        model = WhisperModel(
            MODEL_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
        )
        logger.info("Model loaded successfully")
    return model


def format_timestamp(seconds):
    """Convert seconds to WebVTT timestamp format (HH:MM:SS.mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def generate_vtt(segments):
    """Convert Whisper segments to WebVTT format"""
    vtt = "WEBVTT\n\n"

    for i, segment in enumerate(segments, 1):
        start = format_timestamp(segment.start)
        end = format_timestamp(segment.end)
        text = segment.text.strip()

        vtt += f"{i}\n"
        vtt += f"{start} --> {end}\n"
        vtt += f"{text}\n\n"

    return vtt


def get_content_type_base(content_type):
    """Return normalized MIME type without parameters."""
    if not content_type:
        return ""
    return content_type.split(";", 1)[0].strip().lower()


def parse_object_size(size):
    """Parse GCS object size from event metadata."""
    try:
        parsed_size = int(size)
    except (TypeError, ValueError):
        return None

    return parsed_size if parsed_size >= 0 else None


def should_process_video(file_name, content_type=None, size=None):
    """Return whether a GCS object is safe and eligible for transcription."""
    if not file_name.startswith("videos/"):
        return False, f"Skipping non-video file: {file_name}"

    extension = os.path.splitext(file_name)[1].lower()
    if extension == ".vtt":
        return False, f"Skipping subtitle file: {file_name}"

    if extension not in ALLOWED_EXTENSIONS:
        return False, f"Skipping unsupported video extension: {file_name}"

    content_type_base = get_content_type_base(content_type)
    if content_type_base and content_type_base not in ALLOWED_CONTENT_TYPES:
        return False, f"Skipping unsupported video content type: {content_type}"

    parsed_size = parse_object_size(size)
    if parsed_size is not None and parsed_size > MAX_VIDEO_BYTES:
        return False, f"Skipping oversized video: {parsed_size} bytes"

    return True, None


def has_required_upload_metadata(blob):
    """Return whether the object came from a signed Siduri upload."""
    metadata = blob.metadata or {}
    return all(metadata.get(key) for key in REQUIRED_METADATA_KEYS)


@functions_framework.cloud_event
def generate_subtitles(cloud_event):
    """
    Cloud Function triggered by GCS object finalization.
    Generates Spanish subtitles for uploaded videos.
    """
    data = cloud_event.data

    bucket_name = data["bucket"]
    file_name = data["name"]
    content_type = data.get("contentType")
    object_size = data.get("size")

    should_process, skip_reason = should_process_video(file_name, content_type, object_size)
    if not should_process:
        logger.info(skip_reason)
        return

    logger.info(f"Processing video: gs://{bucket_name}/{file_name}")

    try:
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(file_name)
        # Event payloads do not hydrate custom metadata on the Blob object.
        # Reload before trusting size, type, or the Siduri upload stamp.
        blob.reload()
        object_size = blob.size
        content_type = blob.content_type

        should_process, skip_reason = should_process_video(file_name, content_type, object_size)
        if not should_process:
            logger.info(skip_reason)
            return

        if not has_required_upload_metadata(blob):
            logger.info(f"Skipping object without Siduri upload metadata: {file_name}")
            return

        # Create temp files for video and subtitle
        with tempfile.NamedTemporaryFile(suffix=os.path.splitext(file_name)[1], delete=False) as video_file:
            video_path = video_file.name

            # Download video from GCS
            logger.info(f"Downloading video: {file_name}")
            blob.download_to_filename(video_path)

            # Get or load model
            whisper_model = get_model()

            # Transcribe video
            logger.info(f"Transcribing video (language: {LANGUAGE})")
            segments, info = whisper_model.transcribe(
                video_path,
                language=LANGUAGE,
                beam_size=5,
                vad_filter=True,  # Voice activity detection
                vad_parameters=dict(min_silence_duration_ms=500)
            )

            logger.info(f"Detected language: {info.language} (probability: {info.language_probability:.2f})")

            # Convert segments to list (generator to list)
            segments_list = list(segments)

            if not segments_list:
                logger.warning("No speech detected in video")
                return

            # Generate WebVTT content
            vtt_content = generate_vtt(segments_list)

            # Upload subtitle file to GCS (same folder as video)
            subtitle_filename = file_name.replace(os.path.splitext(file_name)[1], ".vtt")
            subtitle_blob = bucket.blob(subtitle_filename)

            logger.info(f"Uploading subtitles: {subtitle_filename}")
            subtitle_blob.upload_from_string(
                vtt_content,
                content_type="text/vtt"
            )

            # Uniform bucket access keeps the derived object private.
            logger.info(f"✓ Subtitles generated successfully: gs://{bucket_name}/{subtitle_filename}")

    except Exception as e:
        logger.error(f"Error generating subtitles: {str(e)}", exc_info=True)
        raise

    finally:
        # Clean up temp file
        if 'video_path' in locals() and os.path.exists(video_path):
            os.unlink(video_path)
            logger.info("Temporary video file deleted")


# For local testing
if __name__ == "__main__":
    # Mock cloud event for testing
    class MockEvent:
        def __init__(self):
            self.data = {
                "bucket": os.environ.get("GCS_BUCKET", "your-bucket-name"),
                "name": "videos/test.mp4"
            }

    generate_subtitles(MockEvent())
