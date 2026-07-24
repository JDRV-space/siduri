"""Security checks for subtitle object eligibility."""

import sys
import types
import unittest


functions_framework = types.ModuleType("functions_framework")
functions_framework.cloud_event = lambda function: function
storage_module = types.ModuleType("google.cloud.storage")
storage_module.Client = lambda: object()
cloud_module = types.ModuleType("google.cloud")
cloud_module.storage = storage_module
google_module = types.ModuleType("google")
google_module.cloud = cloud_module
whisper_module = types.ModuleType("faster_whisper")
whisper_module.WhisperModel = object
sys.modules.update(
    {
        "functions_framework": functions_framework,
        "google": google_module,
        "google.cloud": cloud_module,
        "google.cloud.storage": storage_module,
        "faster_whisper": whisper_module,
    }
)

import main


class FakeBlob:
    def __init__(self):
        self.content_type = None
        self.size = None
        self.metadata = None
        self.reloaded = False
        self.downloaded = False

    def reload(self):
        self.reloaded = True
        self.content_type = "video/mp4"
        self.size = 1024
        self.metadata = {
            "siduri-upload-id": "upload",
            "siduri-user-id": "user",
        }

    def download_to_filename(self, _path):
        self.downloaded = True


class SubtitleSecurityTests(unittest.TestCase):
    def test_rejects_oversized_video(self):
        allowed, _ = main.should_process_video(
            "videos/example.mp4",
            "video/mp4",
            main.MAX_VIDEO_BYTES + 1,
        )
        self.assertFalse(allowed)

    def test_reloads_blob_to_verify_custom_metadata(self):
        blob = FakeBlob()

        class Bucket:
            def blob(self, _name):
                return blob

        class StorageClient:
            def bucket(self, _name):
                return Bucket()

        class Model:
            def transcribe(self, *_args, **_kwargs):
                info = types.SimpleNamespace(language="es", language_probability=1.0)
                return [], info

        original_client = main.storage_client
        original_get_model = main.get_model
        main.storage_client = StorageClient()
        main.get_model = lambda: Model()
        try:
            main.generate_subtitles(
                types.SimpleNamespace(
                    data={
                        "bucket": "bucket",
                        "name": "videos/example.mp4",
                        "contentType": "video/mp4",
                        "size": "1024",
                    }
                )
            )
        finally:
            main.storage_client = original_client
            main.get_model = original_get_model

        self.assertTrue(blob.reloaded)
        self.assertTrue(blob.downloaded)


if __name__ == "__main__":
    unittest.main()
