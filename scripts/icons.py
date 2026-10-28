"""Write the extension icons from the mascot SVGs.

extension/icons/logo.svg is the detailed mascot (128/48px icons);
logo-small.svg is the toolbar-size simplification (32/16px). Both are
rendered at 512px with headless Chrome (a throwaway profile), cached in
scripts/assets/, then downsampled. Without Chrome the cached renders are used."""
from pathlib import Path
import shutil, subprocess, tempfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
icons, assets = root / 'extension' / 'icons', root / 'scripts' / 'assets'
assets.mkdir(exist_ok=True)
chrome = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('brave-browser')


def render(name):
    cached = assets / f'{name}-512.png'
    if chrome:
        with tempfile.TemporaryDirectory() as profile:
            subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run', f'--user-data-dir={profile}', '--hide-scrollbars',
                            '--force-device-scale-factor=1', '--default-background-color=00000000', '--window-size=512,512',
                            f'--screenshot={cached}', (icons / f'{name}.svg').as_uri()], check=True, capture_output=True, timeout=120)
    return Image.open(cached).convert('RGBA')


detailed, simple = render('logo'), render('logo-small')
for size, source in ((128, detailed), (48, detailed), (32, simple), (16, simple)):
    source.resize((size, size), Image.Resampling.LANCZOS).save(icons / f'{size}.png')
