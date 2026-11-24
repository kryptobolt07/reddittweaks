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

EXTRA_FILES = {'embed-player.js', 'embed-player-main.js'}  # Registered after optional provider host access is granted.
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
    for block in manifest.get('web_accessible_resources', []):
        for name in block.get('resources', []):
            files.add(name)
            if name.endswith('.html') and (extension / name).is_file():
                files.update(popup_references(extension, name))
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


def inline_worker(extension, filename, stack=()):
    check(filename not in stack, 'Circular worker import: ' + filename)
    check(re.fullmatch(r'[a-z0-9-]+\.js', filename), 'Invalid worker import: ' + filename)
    source = (extension / filename).read_text()
    def replace(match):
        names = re.findall(r"['\"]([^'\"]+)['\"]", match[1])
        check(names and re.fullmatch(r"\s*['\"][a-z0-9-]+\.js['\"](?:\s*,\s*['\"][a-z0-9-]+\.js['\"])*\s*", match[1]),
              'Worker imports must be local literals')
        return '{\n' + '\n'.join(inline_worker(extension, name, (*stack, filename)) for name in names) + '\n}'
    return re.sub(r'\bimportScripts\(([^)]*)\);', replace, source)


def target_files(extension, manifest, target='chromium'):
    files = {name: (extension / name).read_bytes() for name in validate(extension, manifest)}
    if target == 'firefox':
        manifest = json.loads(json.dumps(manifest))
        manifest.pop('minimum_chrome_version', None)
        # Firefox has no dynamic web-accessible URLs (its extension origin is already per-install).
        for block in manifest.get('web_accessible_resources', []):
            block.pop('use_dynamic_url', None)
        worker = manifest['background']['service_worker']
        manifest['background'] = {'scripts': ['firefox-background.js']}
        manifest['browser_specific_settings'] = {'gecko_android': {'strict_min_version': '142.0'}, 'gecko': {
            'id': 'reddit-tweaks@kryptobolt07', 'strict_min_version': '140.0',
            'data_collection_permissions': {'required': ['searchTerms', 'browsingActivity', 'websiteContent', 'personalCommunications']}}}
        files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
        files['firefox-background.js'] = ('/* Generated local event-background bundle for Firefox. */\n(() => {\nconst chrome=globalThis.browser || globalThis.chrome;\n' + inline_worker(extension, worker) + '\n})();\n').encode()
    return files


def firefox_source_files(extension, manifest):
    files = {'extension/' + name: (extension / name).read_bytes() for name in validate(extension, manifest)}
    files['scripts/package.py'] = Path(__file__).read_bytes()
    files['BUILDING.md'] = b"# Firefox upload build\n\nRequirements: Python 3.10+ standard library only. From this directory run:\n\n    python3 scripts/package.py --target firefox\n\nThe unsigned AMO upload ZIP appears in artifacts/. No npm install, secret, network access or image generation is needed. Runtime icons are included pre-rendered. The event background is generated by statically inlining local importScripts dependencies; original scripts are in extension/.\n"
    return files


def target_paths(root, version, target):
    prefix = 'reddit-tweaks-firefox' if target == 'firefox' else 'reddit-tweaks'
    archive = root / 'artifacts' / f'{prefix}-v{version}.zip'
    folder = root / 'artifacts' / ('reddit-tweaks-firefox' if target == 'firefox' else 'reddit-chat-search')
    return archive, folder


def build_zip(files, output):
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)


def package(root, target='chromium'):
    extension = root / 'extension'
    manifest = json.loads((extension / 'manifest.json').read_text())
    files = target_files(extension, manifest, target)
    output, unpacked = target_paths(root, manifest['version'], target)
    output.parent.mkdir(exist_ok=True)
    unpacked.mkdir(exist_ok=True)
    for path in unpacked.rglob('*'):
        if path.is_file() and path.relative_to(unpacked).as_posix() not in files:
            path.unlink()
    build_zip(files, output)
    for name, data in files.items():
        destination = unpacked / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    print(f'Packaged {output} ({output.stat().st_size:,} bytes)')
    if target == 'firefox':
        shutil.copy2(output, output.with_name(output.stem + '-unsigned.xpi'))
        # Firefox Add-ons does not take the listing icon from the manifest: it is uploaded on the add-on's page
        # (square PNG or JPEG, stored at 32, 64 and 128 px). Ship the 512 px master export ready for that.
        listing = root / 'scripts' / 'assets' / 'extension-icon-512.png'
        if listing.is_file():
            shutil.copy2(listing, output.parent / 'reddit-tweaks-firefox-listing-icon.png')
        build_zip(firefox_source_files(extension, manifest), output.with_name(f'reddit-tweaks-firefox-source-v{manifest["version"]}.zip'))
    else:
        shutil.copy2(output, output.parent / 'reddit-tweaks.zip')
        shutil.copy2(output, output.parent / 'reddit-chat-search.zip')
    print(f'Loadable folder: {unpacked}')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--target', choices=['chromium', 'firefox'], default='chromium')
    args = parser.parse_args()
    try:
        package(args.root.resolve(), args.target)
    except PackageError as error:
        sys.exit(f'Packaging failed: {error}')
