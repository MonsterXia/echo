"""One-off transport; validates fixed Build output and never publishes the draft."""
from pathlib import Path
import base64
import hashlib
import json
import shutil
import yaml

version = '1.0.4-dev.0'
source = '0774a0b2d6402c447c362bd18f541e881472e16f'
run_url = 'https://github.com/MonsterXia/scrcpy-harmony/actions/runs/40117038066'
root = Path('verified-artifacts')
out = Path('verified-assets')
out.mkdir()
files = [p for p in root.rglob('*') if p.is_file()]

def digest(p, alg='sha256'):
    return hashlib.new(alg, p.read_bytes()).hexdigest()

installers = []
for suffix in ['win-x64.exe', 'mac-arm64.dmg', 'mac-x64.dmg']:
    matches = [p for p in files if p.name == f'Scrcpy Harmony-{version}-{suffix}']
    assert len(matches) == 1, suffix
    p = matches[0]
    name = p.name.replace('Scrcpy Harmony', 'Scrcpy-Harmony')
    shutil.copyfile(p, out / name)
    block = p.with_name(p.name + '.blockmap')
    assert block.is_file()
    shutil.copyfile(block, out / (name + '.blockmap'))
    installers.append(dict(name=name, size=p.stat().st_size, sha256=digest(p)))

metadata = [p for p in files if p.suffix == '.yml']
assert len(metadata) == 3
for p in metadata:
    data = yaml.safe_load(p.read_text())
    assert data['version'] == version
    assert len(data['files']) == 1
    item = data['files'][0]
    assert item['url'] == Path(item['url']).name
    target = out / item['url']
    assert target.is_file() and target.stat().st_size == item['size']
    sha512 = base64.b64encode(hashlib.sha512(target.read_bytes()).digest()).decode()
    assert item['sha512'] == sha512 and data['sha512'] == sha512
    assert data['path'] == item['url']
    shutil.copyfile(p, out / p.name)

reports = [p for p in files if p.name.startswith('verification-')]
assert len(reports) == 3
signatures = {}
for p in reports:
    text = p.read_text(encoding='utf-8-sig')
    assert source in text and run_url in text
    if p.suffix == '.json':
        data = json.loads(text)
        assert data['installationAndStartup'] == 'passed'
        assert data['sha256'] == next(i['sha256'] for i in installers if i['name'].endswith('win-x64.exe'))
        signatures['windows'] = data['authenticodeStatus']
    else:
        assert 'installationAndStartup=passed' in text
        arch = 'arm64' if 'arm64' in p.name else 'x64'
        assert next(i['sha256'] for i in installers if i['name'].endswith(f'mac-{arch}.dmg')) in text
        signatures['mac-' + arch] = [line for line in text.splitlines() if any(s in line for s in ['Signature=', 'not signed', 'codesignVerifyExit=', 'gatekeeperExit=', 'staplerExit='])]
    shutil.copyfile(p, out / p.name)

artifacts = json.loads(Path('source-artifacts.json').read_text())['artifacts']
assets = [dict(name=p.name, size=p.stat().st_size, sha256=digest(p)) for p in sorted(out.iterdir())]
report = dict(version=version, sourceCommit=source, buildRun=run_url, prerelease=True, latest=False,
              installationAndStartup='passed on all three platforms', installers=installers,
              signatures=signatures, assets=assets,
              artifactDigests=[dict(name=a['name'], digest=a['digest']) for a in artifacts])
(out / 'release-validation.json').write_text(json.dumps(report, indent=2) + '\n')
(out / 'SHA256SUMS.txt').write_text(''.join(f'{digest(p)}  {p.name}\n' for p in sorted(out.iterdir())))
print(json.dumps(report, indent=2))
