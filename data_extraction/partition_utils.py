"""
partition_utils.py
------------------
Shared utility for resolving S3 date partition folder names.

Two functions:
- get_partition_date(s3_base_uri): For WRITING. Returns the next available
  folder name for today (2026-03-18, then 2026-03-18 (1), etc.)

- get_latest_partition(s3_base_uri): For READING. Returns the most recently
  created folder that starts with today's date. Used by downstream modules
  that need to READ from a folder another module just wrote to.
"""

import s3fs
from datetime import datetime


def get_partition_date(s3_base_uri: str) -> str:
    """
    For WRITING a new partition.
    Returns the next available folder name for today's date.
    e.g. '2026-03-18' -> '2026-03-18 (1)' -> '2026-03-18 (2)'
    """
    today = datetime.now().strftime('%Y-%m-%d')

    try:
        fs = s3fs.S3FileSystem(anon=False)
        base_path = s3_base_uri.replace("s3://", "")
        existing = fs.ls(base_path, detail=False)
        existing_names = [p.split("/")[-1] for p in existing]
        matching = [n for n in existing_names if n == today or n.startswith(f"{today} (")]

        if not matching:
            return today

        max_suffix = 0
        for name in matching:
            if name == today:
                continue
            try:
                suffix = int(name.replace(f"{today} (", "").replace(")", ""))
                if suffix > max_suffix:
                    max_suffix = suffix
            except ValueError:
                continue

        return f"{today} ({max_suffix + 1})"

    except Exception as e:
        print(f"⚠️ partition_utils: Could not resolve partition suffix, using base date. Reason: {e}")
        return today


def get_latest_partition(s3_base_uri: str) -> str:
    """
    For READING from an existing partition written by another module.
    Returns the most recently created folder that starts with today's date.
    e.g. if '2026-03-18' and '2026-03-18 (1)' both exist, returns '2026-03-18 (1)'.
    If no folder for today exists yet, returns plain today's date as fallback.
    """
    today = datetime.now().strftime('%Y-%m-%d')

    try:
        fs = s3fs.S3FileSystem(anon=False)
        base_path = s3_base_uri.replace("s3://", "")
        existing = fs.ls(base_path, detail=False)
        existing_names = [p.split("/")[-1] for p in existing]
        matching = [n for n in existing_names if n == today or n.startswith(f"{today} (")]

        if not matching:
            return today

        max_suffix = -1
        for name in matching:
            if name == today:
                if max_suffix < 0:
                    max_suffix = 0
                continue
            try:
                suffix = int(name.replace(f"{today} (", "").replace(")", ""))
                if suffix > max_suffix:
                    max_suffix = suffix
            except ValueError:
                continue

        if max_suffix <= 0:
            return today
        return f"{today} ({max_suffix})"

    except Exception as e:
        print(f"⚠️ partition_utils: Could not resolve latest partition, using base date. Reason: {e}")
        return today