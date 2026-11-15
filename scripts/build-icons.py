"""Export the close-up cube-corner artwork to install and browser icons.

Run with Python and Pillow: python scripts/build-icons.py
This is an authoring helper; normal builds use the checked-in PNG/ICO files.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "app-icon" / "source-corner.png"
OUTPUT = ROOT / "public" / "icons"

with Image.open(SOURCE) as original:
    if original.width != original.height:
        raise ValueError("The app icon source must be square.")
    artwork = original.convert("RGB")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for size in (32, 180, 192, 512):
        artwork.resize((size, size), Image.Resampling.LANCZOS).save(
            OUTPUT / f"arrow-cube-corner-v2-{size}.png", optimize=True)
    # The important three-face junction stays in the central safe zone. Let
    # the surrounding paths bleed to the edge under any launcher mask.
    artwork.resize((512, 512), Image.Resampling.LANCZOS).save(
        OUTPUT / "arrow-cube-corner-v2-maskable-512.png", optimize=True)
    artwork.save(ROOT / "public" / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

print("Exported close-up corner icons, a maskable icon, and a multi-size favicon.")
