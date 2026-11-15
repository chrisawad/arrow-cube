"""Export the checked-in artwork to install and browser icon sizes.

Run with Python and Pillow: python scripts/build-icons.py
This is an authoring helper; normal builds use the checked-in PNG/ICO files.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "app-icon" / "source.png"
OUTPUT = ROOT / "public" / "icons"

with Image.open(SOURCE) as original:
    if original.width != original.height:
        raise ValueError("The app icon source must be square.")
    artwork = original.convert("RGB")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for size in (32, 180, 192, 512):
        artwork.resize((size, size), Image.Resampling.LANCZOS).save(
            OUTPUT / f"arrow-cube-v2-{size}.png", optimize=True)
    artwork.save(ROOT / "public" / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

print("Exported 32, 180, 192, and 512px PNG icons and a multi-size favicon.")
