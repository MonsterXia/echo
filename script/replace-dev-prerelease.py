"""Fixed, explicitly authorized replacement of dev.0; never targets stable releases."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import sys
import zipfile

REPO = 'MonsterXia/scrcpy-harmony'
TAG = 'v1.0.4-dev.0'
RELEASE_ID = 422885887
OLD = '0774a0b2d6402c447c362bd18f541e881472e16f'
SOURCE = '9b0da71bcbeefcfafac2f9cdd157c0d82bb7edbc'
BUILD = 40121812642
CI = 40121815862
EXPECTED_JOBS = {'test', 'lint', 'windows-package', 'macos-package-arm64', 'macos-package-x64'}

def gh(*args, **kwargs):
    return subprocess.run(['gh', *args], check=True, timeout=300, **kwargs)

def api(path, *args):
    return json.loads(gh('api', f'repos/{REPO}/{path}', *args, capture_output=True, text=True).stdout)

def save(name, data):
    Path(name).write_text(json.dumps(data, indent=2) + '\n')

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def release_state():
    release = api(f'releases/{RELEASE_ID}')
    assert release['tag_name'] == TAG and release['prerelease'] and not release.get('immutable'), 'Wrong or immutable release'
    tag = api(f'git/ref/tags/{TAG}')['object']
    assert tag['type'] == 'commit' and tag['sha'] in {OLD, SOURCE}, 'Unexpected tag movement'
    assert api('releases/latest')['tag_name'] == 'v1.0.3', 'Stable Latest changed'
    return release, tag['sha']

def prepare():
    run = api(f'actions/runs/{BUILD}')
    assert run['head_sha'] == SOURCE and run['conclusion'] == 'success' and run['name'] == 'Build'
    ci = api(f'actions/runs/{CI}')
    assert ci['head_sha'] == SOURCE and ci['conclusion'] == 'success'
    jobs = api(f'actions/runs/{CI}/jobs?per_page=100')['jobs']
    assert {j['name'] for j in jobs} == EXPECTED_JOBS and all(j['conclusion'] == 'success' for j in jobs)
    pr = api('pulls/61')
    assert pr['merged'] and pr['head']['sha'] == SOURCE, 'Fix must be merged at verified head'
    release, _ = release_state()
    save('release-before.json', release)
    save('source-run.json', run)
    artifacts = api(f'actions/runs/{BUILD}/artifacts?per_page=100')
    save('source-artifacts.json', artifacts)
    assert len(artifacts['artifacts']) == 3
    assert {a['name'] for a in artifacts['artifacts']} == {'windows-latest', 'macos-15', 'macos-15-intel'}
    root = Path('verified-artifacts').resolve()
    root.mkdir()
    for artifact in artifacts['artifacts']:
        assert not artifact['expired'] and artifact['workflow_run']['head_sha'] == SOURCE
        archive = Path(f"artifact-{artifact['id']}.zip")
        with archive.open('wb') as output:
            gh('api', f"repos/{REPO}/actions/artifacts/{artifact['id']}/zip", stdout=output)
        assert artifact['digest'] == 'sha256:' + digest(archive), 'Artifact archive digest mismatch'
        destination = root / artifact['name']
        with zipfile.ZipFile(archive) as zipped:
            for entry in zipped.infolist():
                assert (destination / entry.filename).resolve().is_relative_to(destination), 'Unsafe artifact path'
            zipped.extractall(destination)

def verify_assets(release, files):
    actual = {a['name']: a for a in release['assets']}
    assert set(actual) == set(files) and len(actual) == 14, 'Unexpected release asset set'
    for name, path in files.items():
        assert actual[name]['state'] == 'uploaded' and actual[name]['size'] == path.stat().st_size
        assert actual[name]['digest'] == 'sha256:' + digest(path), 'Release digest mismatch: ' + name

def publish():
    files = {p.name: p for p in Path('verified-assets').iterdir() if p.is_file()}
    assert len(files) == 14
    release, current = release_state()
    before = json.loads(Path('release-before.json').read_text())
    assert release['updated_at'] == before['updated_at'], 'Release changed during validation'
    actual_names = {a['name'] for a in release['assets']}
    if current == SOURCE and release['draft']:
        assert actual_names <= set(files), 'Unexpected assets during interrupted replacement'
    else:
        assert actual_names == set(files), 'Unexpected old asset names'
    if current == SOURCE and not release['draft']:
        verify_assets(release, files)
        save('release-after.json', release)
        save('replacement-audit.json', {'alreadyPublished': True, 'sourceCommit': SOURCE})
        return
    notes = f'''Scrcpy Harmony **1.0.4-dev.0** 开发预览版（投屏启动修复）。

2026-10-25 按维护者要求，以同一版本号替换了原预览安装包。**已经下载旧版的用户请重新下载并安装**；同版本不会自动提示升级。下方 SHA256SUMS.txt 和 release-validation.json 用于区分此次修复包。

### 修复内容
- 亮屏解锁但静止时先显示实时 JPEG，H.264 就绪后切换；首帧沉默不再反复等待所有兼容库。
- 修复 JPEG 与 H.264 交接、解码无输出恢复及双通道停止清理。
- 本机旧安装版首图 17.4 秒，修复版首次约 4.9 秒、重开约 0.3 秒；静止固件可能继续使用 JPEG，不保证始终输出 H.264。

保留原预览版的原生投屏、预热、工具栏、画质/FPS、键盘/IME、选区和电脑到手机粘贴，以及本仓内置依赖源码。

### 下载与验证
Windows x64、macOS Apple Silicon（arm64）和 Intel（x64）；macOS 最低 13。
源码/tag：`{SOURCE}`。五项 [CI](https://github.com/{REPO}/actions/runs/{CI}) 通过；同源 [Build](https://github.com/{REPO}/actions/runs/{BUILD}) 三平台实际安装启动通过。上传前核对原始 artifact ZIP SHA-256、安装包及 YAML 文件名/大小/SHA-512，上传后重新下载核对全部 14 个附件的字节摘要。

### 已知范围
- 手机到电脑剪贴板同步尚未包含；可通过右键明确指定粘贴来源。
- 跨固件、人工中文候选窗、多行长文本、旋转、物理拔插和长期运行仍待进一步验收。
- 发行者签名、公证及 Gatekeeper 结果以本次 verification-* 附件为准；安装启动成功不等于系统信任通过。

仍为 **Pre-release**，不设为 Latest；稳定版保持 **v1.0.3**。
'''
    Path('replacement-notes.md').write_text(notes)
    # Keep the existing release ID and URLs; hide the mixed upload state.
    api(f'releases/{RELEASE_ID}', '--method', 'PATCH', '-f', f'tag_name={TAG}', '-F', 'draft=true')
    api(f'git/refs/tags/{TAG}', '--method', 'PATCH', '-f', f'sha={SOURCE}', '-F', 'force=true')
    api(f'releases/{RELEASE_ID}', '--method', 'PATCH', '-f', f'tag_name={TAG}', '-f', f'target_commitish={SOURCE}', '-F', 'prerelease=true')
    gh('release', 'upload', TAG, *[str(p) for p in files.values()], '--clobber')
    verify_assets(api(f'releases/{RELEASE_ID}'), files)
    remote = Path('downloaded-release')
    gh('release', 'download', TAG, '--dir', str(remote))
    assert {p.name for p in remote.iterdir()} == set(files)
    for name, local in files.items():
        assert digest(remote / name) == digest(local), 'Downloaded bytes mismatch: ' + name
    api(f'releases/{RELEASE_ID}', '--method', 'PATCH', '-f', f'tag_name={TAG}',
        '-f', f'target_commitish={SOURCE}', '-F', 'draft=false', '-F', 'prerelease=true',
        '-f', 'make_latest=false', '-f', 'name=Scrcpy Harmony 1.0.4-dev.0 (Screencast Startup Fix)',
        '-f', f'body={notes}')
    after, current = release_state()
    assert current == SOURCE and not after['draft'] and after['target_commitish'] == SOURCE
    verify_assets(after, files)
    save('release-after.json', after)
    save('replacement-audit.json', {'sourceCommit': SOURCE, 'previousSourceCommit': OLD,
        'releaseId': RELEASE_ID, 'replacedAt': datetime.now(timezone.utc).isoformat(),
        'downloadedAssetsVerified': len(files), 'latest': 'v1.0.3', 'buildRun': BUILD, 'ciRun': CI,
        'assetDigests': {name: digest(p) for name, p in files.items()}})

if sys.argv[1] == 'prepare':
    prepare()
elif sys.argv[1] == 'publish':
    publish()
else:
    raise ValueError('Unknown phase')
