#!/usr/bin/env python3
"""Adapted from the user's aicost-image helper; local-only gpt-image-2 CLI."""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import shlex
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://www.aicost.me/v1"
SIZE_MAP = {
    "1K": {
        "1:1": "1024x1024", "16:9": "1536x864", "9:16": "864x1536",
        "4:3": "1360x1024", "3:4": "1024x1360", "3:2": "1536x1024", "2:3": "1024x1536",
    },
    "2K": {
        "1:1": "2048x2048", "16:9": "3072x1728", "9:16": "1728x3072",
        "4:3": "2720x2048", "3:4": "2048x2720", "3:2": "3072x2048", "2:3": "2048x3072",
    },
    "4K": {
        "1:1": "2880x2880", "16:9": "3840x2160", "9:16": "2160x3840",
        "4:3": "3328x2496", "3:4": "2496x3328", "3:2": "3520x2336", "2:3": "2336x3520",
    },
}


def load_api_key(skill_root: Path) -> str:
    key = os.environ.get("AICOST_API_KEY", "").strip()
    if key:
        return key
    env_path = skill_root / "secrets.env"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("export "):
                line = line[7:].strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() == "AICOST_API_KEY":
                try:
                    parts = shlex.split(value, comments=True)
                except ValueError:
                    raise SystemExit("Invalid AICOST_API_KEY quoting in secrets.env") from None
                if len(parts) == 1 and parts[0].strip():
                    return parts[0].strip()
    raise SystemExit("Missing AICOST_API_KEY (environment or local secrets.env)")


def origin(url: str):
    parsed = urllib.parse.urlsplit(url)
    return parsed.scheme.lower(), parsed.hostname, parsed.port or 443


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Never forward API authentication to another origin or downgrade HTTPS."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urlsplit(newurl)
        if target.scheme.lower() != "https" or target.username or target.password:
            raise urllib.error.HTTPError(req.full_url, code, "Unsafe image API redirect", headers, fp)
        if req.get_header("Authorization") and origin(req.full_url) != origin(newurl):
            raise urllib.error.HTTPError(req.full_url, code, "Cross-origin authenticated redirect blocked", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_request(request, timeout):
    return urllib.request.build_opener(SafeRedirectHandler()).open(request, timeout=timeout)


def http_json(method: str, url: str, api_key: str, body: dict | None = None, timeout: int = 600):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    with open_request(request, timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def error_body(error) -> str:
    if not hasattr(error, "aicost_body"):
        error.aicost_body = error.read().decode("utf-8", errors="replace")
    return error.aicost_body


def multipart_edit(url: str, api_key: str, fields: dict, files: list[Path], timeout: int = 600):
    boundary = f"----aicost{time.time_ns()}"

    def request_for(image_field):
        chunks = []
        for name, value in fields.items():
            chunks.extend([
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                str(value).encode("utf-8"), b"\r\n",
            ])
        for index, path in enumerate(files):
            # Do not interpolate user-controlled filenames into multipart headers.
            suffix = path.suffix.lower()
            safe_suffix = suffix if suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"} else ".bin"
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            chunks.extend([
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{image_field}"; filename="reference-{index}{safe_suffix}"\r\n'.encode(),
                f"Content-Type: {mime}\r\n\r\n".encode(), path.read_bytes(), b"\r\n",
            ])
        chunks.append(f"--{boundary}--\r\n".encode())
        return urllib.request.Request(url, data=b"".join(chunks), method="POST", headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        })

    try:
        with open_request(request_for("image[]"), timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        # Only retry an explicit image[] schema rejection, never auth/rate/server errors.
        if error.code not in (400, 422) or "image[]" not in error_body(error):
            raise
        with open_request(request_for("image"), timeout) as response:
            return json.loads(response.read().decode("utf-8"))


def resolve_payload(payload: dict, api_key: str, out: Path, fmt: str) -> Path:
    if payload.get("task_id"):
        task_id = str(payload["task_id"])
        task_path = urllib.parse.quote(task_id, safe="")
        print("Waiting for image task…", file=sys.stderr)
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            time.sleep(3)
            payload = http_json("GET", f"{BASE}/images/generations/{task_path}", api_key)
            if payload.get("data"):
                break
            if payload.get("status") in ("failed", "error", "cancelled", "canceled"):
                raise SystemExit("Image generation task failed; check the provider console")
        else:
            raise SystemExit("Image generation task timed out after 10 minutes")

    data = (payload.get("data") or [None])[0]
    if not isinstance(data, dict):
        raise SystemExit("Image service returned no image data")
    if data.get("b64_json"):
        raw = base64.b64decode(data["b64_json"], validate=True)
    elif data.get("url"):
        url = urllib.parse.urlsplit(data["url"])
        if url.scheme.lower() != "https" or not url.hostname or url.username or url.password:
            raise SystemExit("Image download requires a valid HTTPS URL")
        # Image URLs may point to a third-party CDN: never send the API key there.
        request = urllib.request.Request(data["url"], headers={"Accept": "image/*"})
        with open_request(request, 120) as response:
            raw = response.read()
    else:
        raise SystemExit("Image service returned neither b64_json nor an image URL")
    if not raw:
        raise SystemExit("Image service returned an empty image")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    return out


def main():
    skill_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="aicost gpt-image-2 generate/edit (local CLI)")
    parser.add_argument("--prompt")
    parser.add_argument("--out", help="output image path")
    parser.add_argument("--aspect", default="16:9", choices=list(SIZE_MAP["2K"]))
    parser.add_argument("--size", default="2K", choices=["1K", "2K", "4K"])
    parser.add_argument("--format", default="jpeg", choices=["jpeg", "png", "gif"])
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--image", action="append", default=[], help="reference image path (repeatable); uses /images/edits")
    offline = parser.add_mutually_exclusive_group()
    offline.add_argument("--check", action="store_true", help="check local credentials without showing the key or making requests")
    offline.add_argument("--dry-run", action="store_true", help="preview request fields without network access or loading credentials")
    args = parser.parse_args()

    if args.check:
        load_api_key(skill_root)
        print(json.dumps({"api_base": BASE, "model": args.model, "credential": "configured", "network_request": False}))
        return
    if not args.prompt or not args.prompt.strip() or not args.out:
        parser.error("--prompt and --out are required unless --check is used")
    out = Path(args.out).expanduser().resolve()
    model = args.model
    if args.format == "gif" and model == "gpt-image-2":
        model = "gpt-image-2.6-sunburst"
    files = [Path(value).expanduser().resolve() for value in args.image]
    for file in files:
        if not file.is_file():
            parser.error(f"missing reference image: {file}")
    if out in files:
        parser.error("output must not overwrite a reference image")
    fields = {
        "model": model, "prompt": args.prompt, "n": 1,
        "size": SIZE_MAP[args.size][args.aspect], "quality": "auto",
        "output_format": args.format, "moderation": "auto",
    }
    endpoint = f"{BASE}/images/{'edits' if files else 'generations'}"
    if args.dry_run:
        print(json.dumps({"endpoint": endpoint, "fields": fields, "reference_images": [str(file) for file in files], "out": str(out), "network_request": False}, ensure_ascii=False, indent=2))
        return
    api_key = load_api_key(skill_root)
    try:
        payload = multipart_edit(endpoint, api_key, fields, files) if files else http_json("POST", endpoint, api_key, fields)
        result = resolve_payload(payload, api_key, out, args.format)
    except urllib.error.HTTPError as error:
        detail = (error_body(error) or str(error.reason)).replace(api_key, "[REDACTED]")[:800]
        raise SystemExit(f"HTTP {error.code}: {detail}") from None
    except (urllib.error.URLError, TimeoutError):
        raise SystemExit("Image request failed; check network connectivity and provider status") from None
    print(str(result))


if __name__ == "__main__":
    main()
