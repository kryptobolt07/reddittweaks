"""Create a clean, directly loadable extension archive without build dependencies."""
from pathlib import Path
import json
import re
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
extension = root / 'extension'
manifest = json.loads((extension / 'manifest.json').read_text())
assert re.fullmatch(r'\d+\.\d+\.\d+', manifest['version']), 'Use MAJOR.MINOR.PATCH for extension releases'
runtime_versions = re.findall(r'''setAttribute\(['"]data-rcs-version['"],\s*['"]([^'"]+)['"]\)''', (extension / 'content.js').read_text())
assert runtime_versions == [manifest['version']], 'Manifest and runtime version stamp must match'
required = [*manifest['icons'].values(), manifest['action']['default_popup']]
if manifest.get('background', {}).get('service_worker'):
    required.append(manifest['background']['service_worker'])
for block in manifest['content_scripts']:
    required.extend(block['js'])
for filename in required:
    assert (extension / filename).is_file(), f'Missing extension asset: {filename}'
output = root / 'artifacts' / f'reddit-chat-search-v{manifest["version"]}.zip'
output.parent.mkdir(exist_ok=True)
unpacked = output.parent / 'reddit-chat-search'
unpacked.mkdir(exist_ok=True)
# This generated folder is the stable unpacked installation. Remove assets
# retired from source so a subsequent build cannot retain obsolete scripts.
for path in unpacked.rglob('*'):
    if path.is_file() and not (extension / path.relative_to(unpacked)).is_file():
        path.unlink()
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(extension.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(extension))
            destination = unpacked / path.relative_to(extension)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
print(f'Packaged {output} ({output.stat().st_size:,} bytes)')
shutil.copy2(output, output.parent / 'reddit-chat-search.zip')
print(f'Loadable folder: {unpacked}')
