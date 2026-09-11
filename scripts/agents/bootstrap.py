"""Install the recovered, hash-pinned sister package into one versioned directory."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCK = json.loads((HERE / 'package-lock.json').read_text(encoding='utf-8'))
DEFAULT_ROOT = HERE.parent.parent / '.local' / 'agents' / 'athena-stella'


def install(archive, root=DEFAULT_ROOT):
    archive, root = Path(archive).resolve(), Path(root).resolve()
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != LOCK['sha256']:
        raise ValueError('Archive does not match the recovered v3.1 package')
    target = root / LOCK['version']
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='install-', dir=root) as temporary:
        stage = Path(temporary)
        with zipfile.ZipFile(archive) as bundle:
            for item in bundle.infolist():
                destination = (stage / item.filename).resolve()
                if not destination.is_relative_to(stage) or ((item.external_attr >> 16) & 0o170000) == 0o120000:
                    raise ValueError('Unsafe archive entry')
            bundle.extractall(stage)
        package = stage / LOCK['archive_root']
        manifest = json.loads((package / 'manifest.json').read_text(encoding='utf-8'))
        if manifest['version'] != LOCK['version']:
            raise ValueError('Package version mismatch')
        # The archive is pinned before executing its offline verification suite.
        result = subprocess.run([sys.executable, str(package / 'check_all.py')],
                                cwd=package, capture_output=True, text=True, encoding='utf-8')
        if result.returncode:
            raise RuntimeError('Package verification failed:\n' + result.stdout + result.stderr)
        if target.exists():
            # Reinstall must not silently discard local experiments or edits.
            originals = [p for p in package.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
            changed = [p.relative_to(package).as_posix() for p in originals
                       if not (target / p.relative_to(package)).is_file()
                       or (target / p.relative_to(package)).read_bytes() != p.read_bytes()]
            if changed:
                raise ValueError('Existing installation differs; choose another --root: ' + ', '.join(changed[:5]))
        else:
            shutil.move(str(package), str(target))
    receipt = {'version': LOCK['version'], 'archive_sha256': digest,
               'package': str(target), 'provider': 'openai', 'interface': 'chatgpt'}
    pointer = root / 'current.json'
    temporary_pointer = root / 'current.json.tmp'
    temporary_pointer.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    temporary_pointer.replace(pointer)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.archive, args.root)))
    except (ValueError, OSError, RuntimeError) as error:
        parser.exit(1, str(error) + '\n')
