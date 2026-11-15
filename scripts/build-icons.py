"""Export the exact gameplay screenshot crop to install and browser icons.

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
            OUTPUT / f"arrow-cube-game-{size}.png", optimize=True)
    # Preserve the screenshot pixels, adding matching background padding only
    # for launchers that crop icons into circles or other platform shapes.
    maskable = Image.new("RGB", (512, 512), artwork.getpixel((0, 0)))
    maskable.paste(artwork.resize((400, 400), Image.Resampling.LANCZOS), (56, 56))
    maskable.save(OUTPUT / "arrow-cube-game-maskable-512.png", optimize=True)
    artwork.save(ROOT / "public" / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

print("Exported screenshot icons, a maskable icon, and a multi-size favicon.")
