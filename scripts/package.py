"""Create a clean, directly loadable extension archive without build dependencies.

The package is built from an allowlist derived from manifest.json (content scripts,
background worker and the scripts it imports, request rules, icons, popup and the files the popup
references). Any other file under extension/ stops the build, and the ZIP is
byte-for-byte reproducible for identical sources.

Usage: python3 scripts/package.py [--root DIR]   (DIR defaults to the repository root)
"""
from pathlib import Path
import argparse
import json
import re
import shutil
import sys
import zipfile

EXTRA_FILES = set()
REQUIRED_FILES = {'popup.js', 'popup.css', 'icons/96.png'}
ZIP_TIME = (1980, 1, 1, 0, 0, 0)


class PackageError(Exception):
    pass


def check(condition, message):
    if not condition:
        raise PackageError(message)


def popup_references(extension, popup):
    html = (extension / popup).read_text()
    refs = re.findall(r'''(?:src|href)\s*=\s*["']([^"'#?]+)["']''', html)
    return {ref for ref in refs if not re.match(r'^(?:[a-z][a-z0-9+.-]*:|//|/)', ref, re.I)}


def worker_imports(extension, worker, seen=None):
    """Files pulled in by importScripts() from the service worker, followed recursively."""
    seen = seen if seen is not None else set()
    if worker in seen or not (extension / worker).is_file():
        return seen
    seen.add(worker)
    text = (extension / worker).read_text()
    for call in re.findall(r'importScripts\(([^)]*)\)', text):
        for name in re.findall(r'''["']([^"']+)["']''', call):
            worker_imports(extension, name, seen)
    return seen


def allowlist(extension, manifest):
    files = {'manifest.json', *EXTRA_FILES}
    files.update(manifest.get('icons', {}).values())
    files.update(rule['path'] for rule in manifest.get('declarative_net_request', {}).get('rule_resources', []))
    action = manifest.get('action', {})
    files.update(action.get('default_icon', {}).values() if isinstance(action.get('default_icon'), dict) else [])
    popup = action.get('default_popup')
    if popup:
        files.add(popup)
        if (extension / popup).is_file():
            files.update(popup_references(extension, popup))
    worker = manifest.get('background', {}).get('service_worker')
    if worker:
        files.update(worker_imports(extension, worker))
        files.add(worker)
    for block in manifest.get('content_scripts', []):
        files.update(block.get('js', []))
        files.update(block.get('css', []))
    return files


def validate(extension, manifest):
    version = manifest.get('version', '')
    check(re.fullmatch(r'\d+\.\d+\.\d+', version), 'Use MAJOR.MINOR.PATCH for extension releases')
    version_name = manifest.get('version_name')
    check(version_name is None or version_name.startswith(version),
          f'version_name {version_name!r} must start with version {version!r}')
    runtime_versions = re.findall(r'''setAttribute\(['"]data-rcs-version['"],\s*['"]([^'"]+)['"]\)''', (extension / 'content.js').read_text())
    check(runtime_versions == [version], 'Manifest and runtime version stamp must match')
    allowed = allowlist(extension, manifest)
    for filename in sorted(allowed | REQUIRED_FILES):
        check((extension / filename).is_file(), f'Missing extension asset: {filename}')
    present = {path.relative_to(extension).as_posix() for path in extension.rglob('*') if path.is_file()}
    unexpected = sorted(present - allowed)
    check(not unexpected, 'Unexpected files in extension/ (not referenced by manifest.json or the popup): ' + ', '.join(unexpected))
    return sorted(allowed)


def build_zip(extension, files, output):
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in files:
            info = zipfile.ZipInfo(name, date_time=ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            archive.writestr(info, (extension / name).read_bytes())


def package(root):
    extension = root / 'extension'
    manifest = json.loads((extension / 'manifest.json').read_text())
    files = validate(extension, manifest)
    output = root / 'artifacts' / f'reddit-tweaks-v{manifest["version"]}.zip'
    output.parent.mkdir(exist_ok=True)
    unpacked = output.parent / 'reddit-chat-search'
    unpacked.mkdir(exist_ok=True)
    # This generated folder is the stable unpacked installation. Remove assets
    # retired from source so a subsequent build cannot retain obsolete scripts.
    for path in unpacked.rglob('*'):
        if path.is_file() and path.relative_to(unpacked).as_posix() not in files:
            path.unlink()
    build_zip(extension, files, output)
    for name in files:
        destination = unpacked / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(extension / name, destination)
    print(f'Packaged {output} ({output.stat().st_size:,} bytes)')
    shutil.copy2(output, output.parent / 'reddit-tweaks.zip')
    # Keep the existing local export alias for users updating an unpacked install.
    shutil.copy2(output, output.parent / 'reddit-chat-search.zip')
    print(f'Loadable folder: {unpacked}')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    try:
        package(parser.parse_args().root.resolve())
    except PackageError as error:
        sys.exit(f'Packaging failed: {error}')
