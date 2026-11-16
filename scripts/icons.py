"""Export browser and listing PNG sizes from the approved transparent circular master.

Requires Pillow. The source is scripts/assets/extension-icon.png; this script
only resizes and preserves RGBA alpha, without rendering a browser or regenerating art.
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
icons, assets = root / 'extension' / 'icons', root / 'scripts' / 'assets'
with Image.open(assets / 'extension-icon.png') as source:
    master = source.convert('RGBA')
    if master.width != master.height:
        raise ValueError('The approved icon master must be square')
    for size in (16, 32, 48, 96, 128, 256, 512):
        output = icons / f'{size}.png' if size <= 128 else assets / f'extension-icon-{size}.png'
        master.resize((size, size), Image.Resampling.LANCZOS).save(output, optimize=True)
