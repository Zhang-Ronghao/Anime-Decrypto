"""Download the official full snapshot and publish only compact anime statistics.

Uses Python's standard library and Node.js. The raw archive lives in a temporary
directory and is discarded after processing. No Bangumi subject API is called.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from zipfile import ZipFile

LATEST = "https://raw.githubusercontent.com/bangumi/Archive/master/aux/latest.json"
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "worker/data/bangumi-popular-anime.ts"
META = OUTPUT.with_suffix(".meta.json")
SCHEMA_VERSION = 1
USER_AGENT = "Zhang-Ronghao/Anime-Decrypto catalog updater"


def open_url(url):
    return urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=120)


def update(force=False):
    with open_url(LATEST) as response:
        asset = json.load(response)
    name = asset["name"]
    match = re.fullmatch(r"dump-(\d{4}-\d{2}-\d{2})\.(\d{6})Z\.zip", name)
    if not match:
        raise ValueError(f"Unexpected official snapshot filename: {name}")
    download_url = asset["browser_download_url"]
    parsed = urlparse(download_url)
    if parsed.scheme != "https" or parsed.netloc != "github.com" or not parsed.path.startswith("/bangumi/Archive/releases/download/"):
        raise ValueError("Unexpected official snapshot download URL")
    previous = json.loads(META.read_text(encoding="utf-8")) if META.exists() else {}
    if not force and OUTPUT.exists() and previous.get("assetName") == name and previous.get("schemaVersion") == SCHEMA_VERSION:
        print(f"Already using {name}; nothing to update", flush=True)
        return
    if previous.get("assetName", "") > name:
        raise ValueError("Refusing to replace the catalog with an older snapshot")
    source_date = match[1]
    timestamp = asset["created_at"]
    with tempfile.TemporaryDirectory(prefix="anime-decrypto-archive-") as temporary:
        work = Path(temporary)
        archive = work / "archive.zip"
        digest = hashlib.sha256()
        print(f"Downloading {name} ({asset['size'] / 1024 / 1024:.1f} MiB)", flush=True)
        size = 0
        with open_url(download_url) as response, archive.open("wb") as target:
            while chunk := response.read(1024 * 1024):
                target.write(chunk)
                digest.update(chunk)
                size += len(chunk)
                if size > asset["size"]:
                    raise ValueError("Snapshot exceeds its declared size")
        if size != asset["size"]:
            raise ValueError("Incomplete snapshot download")
        expected_digest = asset.get("digest")
        actual_digest = "sha256:" + digest.hexdigest()
        if expected_digest and expected_digest != actual_digest:
            raise ValueError("Snapshot SHA-256 checksum mismatch")
        with ZipFile(archive) as zipped:
            # Never extract arbitrary paths or the unrelated person/episode files.
            with zipped.open("subject.jsonlines") as source, (work / "subject.jsonlines").open("wb") as target:
                shutil.copyfileobj(source, target)
        generated = work / "anime.ts"
        result = subprocess.run([
            "node", str(ROOT / "scripts/build-bangumi-popular-anime.mjs"),
            str(work / "subject.jsonlines"), str(generated), source_date, timestamp,
        ], cwd=ROOT, check=True, capture_output=True, text=True)
        stats = json.loads(result.stdout)
        if stats["entryCount"] < previous.get("entryCount", 0) * 0.8:
            raise ValueError("Anime count dropped by more than 20%; keeping the existing catalog")
        metadata = {
            "schemaVersion": SCHEMA_VERSION, "assetName": name,
            "sha256": actual_digest, **stats,
        }
        staged_output = OUTPUT.with_suffix(".ts.tmp")
        staged_meta = META.with_suffix(".json.tmp")
        shutil.copyfile(generated, staged_output)
        staged_meta.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(staged_output, OUTPUT)
        os.replace(staged_meta, META)
        print(json.dumps(metadata, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Rebuild even if the snapshot version is unchanged")
    update(parser.parse_args().force)
