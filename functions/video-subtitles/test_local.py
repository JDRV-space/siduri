"""
Local test script for subtitle generation
Usage: python test_local.py <path_to_video_file>
"""

import sys
import os
from faster_whisper import WhisperModel

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

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_local.py <video_file>")
        sys.exit(1)

    video_path = sys.argv[1]

    if not os.path.exists(video_path):
        print(f"Error: File not found: {video_path}")
        sys.exit(1)

    print(f"Loading faster-whisper model (medium)...")
    model = WhisperModel("medium", device="cpu", compute_type="int8")

    print(f"Transcribing: {video_path}")
    segments, info = model.transcribe(
        video_path,
        language="es",
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500)
    )

    print(f"Detected language: {info.language} (probability: {info.language_probability:.2f})")

    segments_list = list(segments)

    if not segments_list:
        print("No speech detected in video")
        sys.exit(0)

    print(f"Found {len(segments_list)} segments")

    # Generate VTT
    vtt_content = generate_vtt(segments_list)

    # Save to file
    output_path = video_path.rsplit('.', 1)[0] + '.vtt'
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(vtt_content)

    print(f"✓ Subtitles saved to: {output_path}")

    # Print first 5 segments as preview
    print("\nPreview (first 5 segments):")
    for i, segment in enumerate(segments_list[:5], 1):
        print(f"{i}. [{format_timestamp(segment.start)} --> {format_timestamp(segment.end)}]")
        print(f"   {segment.text.strip()}\n")
