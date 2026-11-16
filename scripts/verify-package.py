"""Verify the shipped extension and prepare checksum/notes for local or GitHub releases."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import runpy
import sys
import zipfile

packager = runpy.run_path(str(Path(__file__).with_name('package.py')))
PackageError = packager['PackageError']
check = packager['check']


def verify(root, tag=None, github_output=None, target='chromium'):
    source = root / 'extension'
    manifest = json.loads((source / 'manifest.json').read_text())
    files = packager['target_files'](source, manifest, target)
    names = set(files)
    version = manifest['version']
    check(tag is None or tag == f'v{version}', 'Release tag must match manifest version: v' + version)
    changelog = (root / 'CHANGELOG.md').read_text()
    sections = list(re.finditer(r'^# (.+)$', changelog, re.M))
    section = next((i for i, match in enumerate(sections) if match[1] in (version, version + ' preview')), None)
    check(section is not None, 'CHANGELOG.md has no section for ' + version)
    end = sections[section + 1].start() if section + 1 < len(sections) else len(changelog)
    notes = changelog[sections[section].end():end].strip()
    check(bool(notes), 'CHANGELOG.md release section is empty')
    archive, stable = packager['target_paths'](root, version, target)
    present = {p.relative_to(stable).as_posix() for p in stable.rglob('*') if p.is_file()}
    check(names == present, 'Unpacked folder membership does not match source')
    with zipfile.ZipFile(archive) as zipped:
        check(len(zipped.namelist()) == len(names) and set(zipped.namelist()) == names,
              'ZIP membership does not match source')
        check(zipped.testzip() is None, 'ZIP integrity check failed')
        for name in sorted(names):
            expected = files[name]
            check((stable / name).read_bytes() == expected, 'Unpacked bytes differ: ' + name)
            check(zipped.read(name) == expected, 'ZIP bytes differ: ' + name)
    if target == 'firefox':
        source_zip = archive.with_name(f'reddit-tweaks-firefox-source-v{version}.zip')
        source_files = packager['firefox_source_files'](source, manifest)
        with zipfile.ZipFile(source_zip) as zipped:
            check(set(zipped.namelist()) == set(source_files) and len(zipped.namelist()) == len(source_files), 'Firefox source ZIP membership differs')
            check(zipped.testzip() is None, 'Firefox source ZIP integrity check failed')
            for name, data in source_files.items():
                check(zipped.read(name) == data, 'Firefox source ZIP bytes differ: ' + name)
        source_zip.with_suffix('.zip.sha256').write_text(f'{hashlib.sha256(source_zip.read_bytes()).hexdigest()}  {source_zip.name}\n')
        xpi = archive.with_name(archive.stem + '-unsigned.xpi')
        check(xpi.read_bytes() == archive.read_bytes(), 'Unsigned XPI bytes differ from ZIP')
        xpi.with_suffix('.xpi.sha256').write_text(f'{hashlib.sha256(xpi.read_bytes()).hexdigest()}  {xpi.name}\n')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n')
    (root / 'artifacts' / 'release-notes.md').write_text(notes + '\n')
    if github_output:
        with github_output.open('a') as output:
            output.write(f'version={version}\nprerelease={str("preview" in manifest.get("version_name", "").lower()).lower()}\n')
    print(f'Verified {len(names)} assets: source = unpacked = ZIP; SHA-256 {digest}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--tag', help='Require this release tag to match the manifest')
    parser.add_argument('--github-output', type=Path, help='Append version/prerelease workflow outputs')
    parser.add_argument('--target', choices=['chromium', 'firefox'], default='chromium')
    args = parser.parse_args()
    try:
        verify(args.root.resolve(), args.tag, args.github_output, args.target)
    except (PackageError, OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        sys.exit(f'Package verification failed: {error}')
