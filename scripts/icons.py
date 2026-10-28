"""Write the extension icons from the mascot logo.

Source: extension/icons/logo.svg (an original antenna-topped tinkerer with a
gear antenna, goggles and a wrench; not Reddit's Snoo). scripts/assets/
logo-512.png is that SVG rendered at 512px with a transparent background
(rendered in Chrome via scripts/live). This script downsamples it."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'scripts' / 'assets' / 'logo-512.png').convert('RGBA')
destination = root / 'extension' / 'icons'
for size in (16, 32, 48, 128):
    source.resize((size, size), Image.Resampling.LANCZOS).save(destination / f'{size}.png')
