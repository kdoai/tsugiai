"""Cloud Storage service for file uploads."""

import os
import uuid
from datetime import datetime, timedelta
from typing import Optional
from google.cloud import storage


class StorageService:
    """Service for Cloud Storage operations."""

    def __init__(self, bucket_name: Optional[str] = None):
        self.client = storage.Client()
        self.bucket_name = bucket_name or os.environ.get(
            "STORAGE_BUCKET",
            f"{os.environ.get('GOOGLE_CLOUD_PROJECT')}-handover-attachments"
        )
        self.bucket = self.client.bucket(self.bucket_name)

    def upload_file(
        self,
        file_data: bytes,
        file_name: str,
        content_type: str,
        session_id: str,
        item_id: str,
    ) -> dict:
        """
        Upload a file to Cloud Storage.

        Returns:
            dict with id, storage_url, and thumbnail_url
        """
        # Generate unique file path
        file_id = str(uuid.uuid4())
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        extension = file_name.split(".")[-1] if "." in file_name else "jpg"
        blob_path = f"sessions/{session_id}/{item_id}/{timestamp}_{file_id}.{extension}"

        # Upload file
        blob = self.bucket.blob(blob_path)
        blob.upload_from_string(file_data, content_type=content_type)

        # Bucket has uniform bucket-level access with allUsers objectViewer
        return {
            "id": file_id,
            "storage_url": blob.public_url,
            "blob_path": blob_path,
            "thumbnail_url": None,
        }

    def generate_signed_url(self, blob_path: str, expiration_minutes: int = 60) -> str:
        """Generate a signed URL for private access."""
        blob = self.bucket.blob(blob_path)
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=expiration_minutes),
            method="GET",
        )
        return url

    def download_file(self, url_or_path: str) -> Optional[bytes]:
        """Download a file from Cloud Storage by public URL or blob path."""
        try:
            # If it's a public URL, extract the blob path
            prefix = f"https://storage.googleapis.com/{self.bucket_name}/"
            if url_or_path.startswith(prefix):
                blob_path = url_or_path[len(prefix):]
            elif url_or_path.startswith("https://"):
                # Fallback: fetch via HTTP
                import urllib.request
                with urllib.request.urlopen(url_or_path) as resp:
                    return resp.read()
            else:
                blob_path = url_or_path

            blob = self.bucket.blob(blob_path)
            return blob.download_as_bytes()
        except Exception as e:
            print(f"Failed to download file: {e}")
            return None

    def delete_file(self, blob_path: str) -> bool:
        """Delete a file from storage."""
        try:
            blob = self.bucket.blob(blob_path)
            blob.delete()
            return True
        except Exception:
            return False

    def list_session_files(self, session_id: str) -> list[dict]:
        """List all files for a session."""
        prefix = f"sessions/{session_id}/"
        blobs = self.bucket.list_blobs(prefix=prefix)

        files = []
        for blob in blobs:
            files.append({
                "name": blob.name,
                "url": blob.public_url,
                "size": blob.size,
                "updated": blob.updated,
            })
        return files
