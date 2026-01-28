"""
GIF Generator Cloud Function
Triggers on GCS video upload, generates animated GIF thumbnail
"""
import functions_framework
from google.cloud import storage
import subprocess
import tempfile
import os
import json
import signal

storage_client = storage.Client()
BUCKET_NAME = os.environ.get('GCS_BUCKET')

# Validation limits
MAX_DURATION_SECS = 600  # 10 minutes
MAX_FILE_SIZE_MB = 500
FFMPEG_TIMEOUT_SECS = 60

class TimeoutError(Exception):
    pass

def timeout_handler(signum, frame):
    raise TimeoutError("ffmpeg timed out")

def get_video_duration(video_path):
    """Get video duration using ffprobe."""
    cmd = [
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'json',
        video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
        return float(data.get('format', {}).get('duration', 0))
    except (json.JSONDecodeError, ValueError):
        return None

@functions_framework.cloud_event
def generate_gif(cloud_event):
    """Triggered by GCS upload of video files."""
    data = cloud_event.data

    file_name = data.get('name', '')
    bucket_name = data.get('bucket', BUCKET_NAME)
    file_size = int(data.get('size', 0))

    # Only process video files in videos/ folder (.mp4 or .webm)
    if not file_name.startswith('videos/'):
        print(f"Skipping non-videos folder: {file_name}")
        return
    if not (file_name.endswith('.mp4') or file_name.endswith('.webm')):
        print(f"Skipping non-video file: {file_name}")
        return

    # Validate file size
    file_size_mb = file_size / (1024 * 1024)
    if file_size_mb > MAX_FILE_SIZE_MB:
        print(f"File too large: {file_size_mb:.1f}MB > {MAX_FILE_SIZE_MB}MB limit")
        return

    # Skip if GIF already exists
    import re
    gif_name = re.sub(r'\.(mp4|webm)$', '.gif', file_name, flags=re.IGNORECASE)
    bucket = storage_client.bucket(bucket_name)
    gif_blob = bucket.blob(gif_name)

    if gif_blob.exists():
        print(f"GIF already exists: {gif_name}")
        return

    print(f"Generating GIF for: {file_name} ({file_size_mb:.1f}MB)")

    with tempfile.TemporaryDirectory() as tmpdir:
        # Download video
        video_path = os.path.join(tmpdir, 'input.mp4')
        gif_path = os.path.join(tmpdir, 'output.gif')

        video_blob = bucket.blob(file_name)
        video_blob.download_to_filename(video_path)
        print(f"Downloaded video: {video_path}")

        # Validate video duration
        duration = get_video_duration(video_path)
        if duration is None:
            print(f"Could not determine video duration, skipping")
            return
        if duration > MAX_DURATION_SECS:
            print(f"Video too long: {duration:.0f}s > {MAX_DURATION_SECS}s limit")
            return

        print(f"Video duration: {duration:.1f}s")

        # Generate GIF with ffmpeg (with timeout)
        # - Start at 0 seconds
        # - 3 second duration
        # - 10 fps
        # - 480px width (height auto)
        # - Optimized palette for quality
        cmd = [
            'ffmpeg', '-y',
            '-ss', '0',
            '-i', video_path,
            '-t', '3',
            '-vf', 'fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
            '-loop', '0',
            gif_path
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=FFMPEG_TIMEOUT_SECS
            )
            if result.returncode != 0:
                print(f"ffmpeg error: {result.stderr}")
                return  # Don't raise, just log and return
        except subprocess.TimeoutExpired:
            print(f"ffmpeg timed out after {FFMPEG_TIMEOUT_SECS}s")
            return

        print(f"Generated GIF: {gif_path}")

        # Upload GIF to GCS
        gif_blob.upload_from_filename(gif_path, content_type='image/gif')
        gif_blob.make_public()

        print(f"Uploaded GIF: gs://{bucket_name}/{gif_name}")
        print(f"Public URL: https://storage.googleapis.com/{bucket_name}/{gif_name}")

    return 'OK'
