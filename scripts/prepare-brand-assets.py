#!/usr/bin/env python3
"""Derive Shiwei Daily production assets from the approved raster logo.

Run in an isolated environment with Pillow 13.0.0 and vtracer 0.6.15:
  python -I scripts/prepare-brand-assets.py --source client/assets/brand/logo-approved.png
This is local image processing only; it never calls an image-generation API.
"""
from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

from PIL import Image
import vtracer

ROOT = Path(__file__).resolve().parents[1]
IVORY = (255, 253, 249, 255)
BACKGROUND = (253, 250, 244)
PALETTE = ((182, 87, 53), (135, 148, 102))


def extract_mark(source: Path) -> tuple[Image.Image, Image.Image]:
    with Image.open(source) as image:
        rgb = image.convert("RGB")
    rgba_pixels = []
    flat_pixels = []
    # Remove the ivory background, including negative spaces. Fit each edge
    # pixel to the approved clay/sage colors to avoid an ivory halo on dark UI.
    for pixel in rgb.get_flattened_data():
        best = None
        for color in PALETTE:
            vector = tuple(color[i] - BACKGROUND[i] for i in range(3))
            delta = tuple(pixel[i] - BACKGROUND[i] for i in range(3))
            alpha = max(0.0, min(1.0, sum(a * b for a, b in zip(delta, vector)) / sum(v * v for v in vector)))
            error = sum((pixel[i] - (BACKGROUND[i] + alpha * vector[i])) ** 2 for i in range(3))
            if best is None or error < best[0]:
                best = (error, alpha, color)
        _, alpha, color = best
        if alpha < 0.045:
            rgba_pixels.append((0, 0, 0, 0))
            flat_pixels.append((0, 0, 0, 0))
            continue
        alpha = 1.0 if alpha > 0.93 else alpha
        unmatte = tuple(round(max(0, min(255, (pixel[i] - (1 - alpha) * BACKGROUND[i]) / alpha))) for i in range(3))
        rgba_pixels.append((*unmatte, round(alpha * 255)))
        flat_pixels.append((*color, 255) if alpha >= 0.45 else (0, 0, 0, 0))
    rgba = Image.new("RGBA", rgb.size)
    rgba.putdata(rgba_pixels)
    flat = Image.new("RGBA", rgb.size)
    flat.putdata(flat_pixels)
    bounds = flat.getbbox()
    if bounds is None:
        raise ValueError("Source does not contain the approved clay/sage mark")
    return rgba.crop(bounds), flat.crop(bounds)


def square(mark: Image.Image, size: int, occupancy: float, background=(0, 0, 0, 0)) -> Image.Image:
    fitted = mark.copy()
    fitted.thumbnail((round(size * occupancy), round(size * occupancy)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), background)
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


def save(image: Image.Image, relative: str) -> None:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, optimize=True)
    print(f"{relative}: {image.width} × {image.height}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    approved = ROOT / "client/assets/brand/logo-approved.png"
    approved.parent.mkdir(parents=True, exist_ok=True)
    if args.source.resolve() != approved.resolve():
        shutil.copyfile(args.source, approved)
    mark, flat = extract_mark(approved)
    logo = square(mark, 512, 0.84)
    for target in ("client/assets/logo.png", "admin/public/logo.png", "server-go/assets/logo.png", "server-go/pkg/apidocs/assets/logo.png"):
        save(logo, target)
    icon = square(mark, 1024, 0.72, IVORY).convert("RGB")
    for name in ("icon.png", "adaptive-icon.png", "adaptive-icon-safe.png"):
        save(icon, f"client/assets/images/{name}")
    # Android adaptive masks crop the outer region; keep the complete mark in
    # the central safe circle rather than stretching an opaque launcher tile.
    save(square(mark, 1024, 0.56), "client/assets/images/adaptive-icon-foreground.png")
    for name in ("splash-icon.png", "splash-icon-safe.png"):
        save(square(mark, 1024, 0.80), f"client/assets/images/{name}")
    save(square(mark, 64, 0.84, IVORY), "client/assets/images/favicon.png")
    white = Image.new("RGBA", flat.size, "white")
    white.putalpha(flat.getchannel("A"))
    save(square(white, 96, 0.76), "client/assets/images/notification-icon.png")
    save(square(white, 1024, 0.56), "client/assets/images/adaptive-icon-monochrome.png")
    # The SVG is an actual two-color vector trace of the same silhouette, not
    # a PNG embedded in SVG. The approved raster remains the visual source.
    with tempfile.TemporaryDirectory(prefix="shiwei-vector-") as temp:
        raster = Path(temp) / "trace.png"
        vector = Path(temp) / "logo.svg"
        trace = square(flat, 512, 0.84)
        trace.putdata([
            (*(PALETTE[0] if r > g else PALETTE[1]), 255) if a >= 128 else (0, 0, 0, 0)
            for r, g, b, a in trace.get_flattened_data()
        ])
        trace.save(raster)
        vtracer.convert_image_to_svg_py(str(raster), str(vector), colormode="color", hierarchical="cutout", mode="spline", filter_speckle=12, color_precision=6, corner_threshold=60, length_threshold=4.0, splice_threshold=45, path_precision=3)
        svg = vector.read_text()
        svg = svg.replace('width="512" height="512"', 'width="512" height="512" viewBox="0 0 512 512"')
        svg = svg.replace('height="512" viewBox="0 0 512 512">', 'height="512" viewBox="0 0 512 512">\n<title>拾味日常 · Shiwei Daily</title>')
        svg = "\n".join(line for line in svg.splitlines() if '<path d=""' not in line) + "\n"
        for target in ("client/assets/logo.svg", "admin/public/favicon.svg", "server-go/pkg/apidocs/assets/logo.svg"):
            (ROOT / target).write_text(svg)
            print(f"{target}: vector")


if __name__ == "__main__":
    main()
