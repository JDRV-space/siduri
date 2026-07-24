"""Security checks for GIF object eligibility."""

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
sys.modules.update(
    {
        "functions_framework": functions_framework,
        "google": google_module,
        "google.cloud": cloud_module,
        "google.cloud.storage": storage_module,
    }
)

import main


class FakeBlob:
    def __init__(self, *, metadata=None, exists=False):
        self.content_type = "video/mp4"
        self.size = 1024
        self.metadata = metadata
        self._exists = exists
        self.reloaded = False

    def reload(self):
        self.reloaded = True

    def exists(self):
        return self._exists


class GifSecurityTests(unittest.TestCase):
    def test_rejects_oversized_video(self):
        allowed, _ = main.should_process_video(
            "videos/example.mp4",
            "video/mp4",
            (main.MAX_FILE_SIZE_MB + 1) * 1024 * 1024,
        )
        self.assertFalse(allowed)

    def test_requires_signed_upload_metadata(self):
        self.assertFalse(main.has_required_upload_metadata(FakeBlob(metadata={})))
        self.assertTrue(
            main.has_required_upload_metadata(
                FakeBlob(
                    metadata={
                        "siduri-upload-id": "upload",
                        "siduri-user-id": "user",
                    }
                )
            )
        )

    def test_valid_object_reloads_metadata_before_duplicate_check(self):
        video_blob = FakeBlob(
            metadata={
                "siduri-upload-id": "upload",
                "siduri-user-id": "user",
            }
        )
        gif_blob = FakeBlob(exists=True)

        class Bucket:
            def blob(self, name):
                return gif_blob if name.endswith(".gif") else video_blob

        class StorageClient:
            def bucket(self, _name):
                return Bucket()

        original_client = main.storage_client
        main.storage_client = StorageClient()
        try:
            main.generate_gif(
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

        self.assertTrue(video_blob.reloaded)


if __name__ == "__main__":
    unittest.main()
