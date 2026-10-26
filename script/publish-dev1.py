"""Resume the inspected dev.1 draft; verify existing assets before publication."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import sys
import zipfile

REPO = 'MonsterXia/scrcpy-harmony'
TAG = 'v1.0.4-dev.1'
SOURCE = '1b8f4a98bbf1678f00643055c9ae0553dc482391'
BUILD = 40330050058
CI = 40330048501
RELEASE_ID = 424286821
JOBS = {'test', 'lint', 'windows-package', 'macos-package-arm64', 'macos-package-x64'}

def gh(*args, **kwargs):
    return subprocess.run(['gh', *args], check=True, timeout=300, **kwargs)

def api(path, *args):
    return json.loads(gh('api', f'repos/{REPO}/{path}', *args, capture_output=True, text=True).stdout)

def save(name, data):
    Path(name).write_text(json.dumps(data, indent=2) + '\n')

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def verify_source():
    for run_id, name in [(BUILD, 'Build'), (CI, 'CI')]:
        run = api(f'actions/runs/{run_id}')
        assert run['head_sha'] == SOURCE and run['name'] == name and run['conclusion'] == 'success'
        jobs = api(f'actions/runs/{run_id}/jobs?per_page=100')['jobs']
        assert all(j['conclusion'] == 'success' for j in jobs)
        if run_id == CI:
            assert {j['name'] for j in jobs} == JOBS
        else:
            assert len(jobs) == 3
            save('source-run.json', run)
    pr = api('pulls/69')
    assert pr['merged'] and pr['head']['sha'] == SOURCE
    assert api('releases/latest')['tag_name'] == 'v1.0.3'

def prepare():
    verify_source()
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
        assert artifact['digest'] == 'sha256:' + digest(archive)
        destination = root / artifact['name']
        with zipfile.ZipFile(archive) as zipped:
            for entry in zipped.infolist():
                assert (destination / entry.filename).resolve().is_relative_to(destination)
            zipped.extractall(destination)

def verify_assets(release, files):
    actual = {a['name']: a for a in release['assets']}
    assert set(actual) == set(files) and len(actual) == 14
    for name, path in files.items():
        assert actual[name]['state'] == 'uploaded' and actual[name]['size'] == path.stat().st_size
        assert actual[name]['digest'] == 'sha256:' + digest(path)

def publish():
    verify_source()
    files = {p.name: p for p in Path('verified-assets').iterdir() if p.is_file()}
    assert len(files) == 14
    # The tag endpoint excludes drafts. Resume only the independently inspected
    # release ID, with no tag movement or asset replacement.
    release = api(f'releases/{RELEASE_ID}')
    assert release['tag_name'] == TAG and release['draft'] and release['prerelease']
    assert release['target_commitish'] == SOURCE
    tag = api(f'git/ref/tags/{TAG}')['object']
    assert tag['type'] == 'commit' and tag['sha'] == SOURCE
    notes = f'''Scrcpy Harmony **1.0.4-dev.1** 开发预发布 / Development preview.

### 本版更新 / Changes
- 修复检查更新无反馈、Windows 菜单状态及更新结果遮挡。Fix manual update checks and result visibility.
- 投屏控制超时支持受限恢复、连续失败上限和手动重试。Recover stalled screencast control with bounded retries.
- 新增默认关闭的 Beta Update；开启后包含预发布，按版本选最新且不降级。Opt in to prerelease updates in Settings.
- 更新窗口即时显示进度，可取消并打开具体版本下载页。Immediate, cancellable update window and version-specific downloads.
- 系统/English/简体中文语言选择，重启后生效；补齐双语菜单与窗口。Language selection applies after restarting the app.

### 下载与验证 / Downloads and verification
Windows x64、macOS Apple Silicon / Intel；macOS 13+。
从 dev.0 升级请下载本版安装包。更新功能打开下载页，由用户安装。
Source/tag: `{SOURCE}`. [CI](https://github.com/{REPO}/actions/runs/{CI}) and same-source [Build / installation / startup](https://github.com/{REPO}/actions/runs/{BUILD}) passed on all three platforms.
Artifacts, update YAML version/name/size/SHA-512 and source reports are checked before upload; all 14 uploaded assets are downloaded again and verified by SHA-256 before publication. See SHA256SUMS.txt and release-validation.json.

### 验收边界 / Limitations
跨固件、长期运行、物理断连矩阵及三平台人工双语视觉仍待验收。手机到电脑剪贴板同步与历史视频扩展残留自动回收尚未包含。
Cross-firmware, long-duration, physical reconnect matrices and manual bilingual visual checks remain pending.
Publisher signing, notarization and Gatekeeper results are recorded in verification-* attachments; installation/startup passing does not imply OS trust approval.

This is a **Pre-release**. Stable Latest remains **v1.0.3**; dev.0 remains available.
'''
    Path('release-notes.md').write_text(notes)
    verify_assets(release, files)
    remote = Path('downloaded-release')
    gh('release', 'download', TAG, '--dir', str(remote))
    assert {p.name for p in remote.iterdir()} == set(files)
    for name, local in files.items():
        assert digest(remote / name) == digest(local), 'Downloaded bytes mismatch: ' + name
    current = api(f'releases/{RELEASE_ID}')
    assert current['updated_at'] == release['updated_at'] and current['draft']
    verify_assets(current, files)
    api(f"releases/{release['id']}", '--method', 'PATCH', '-f', f'tag_name={TAG}',
        '-f', f'target_commitish={SOURCE}', '-F', 'draft=false', '-F', 'prerelease=true', '-f', 'make_latest=false')
    after = api(f'releases/tags/{TAG}')
    tag = api(f'git/ref/tags/{TAG}')['object']
    assert tag['type'] == 'commit' and tag['sha'] == SOURCE
    assert after['prerelease'] and not after['draft'] and after['target_commitish'] == SOURCE
    assert api('releases/latest')['tag_name'] == 'v1.0.3'
    verify_assets(after, files)
    save('release-after.json', after)
    save('publication-audit.json', dict(sourceCommit=SOURCE, releaseId=after['id'],
        publishedAt=datetime.now(timezone.utc).isoformat(), downloadedAssetsVerified=len(files),
        latest='v1.0.3', buildRun=BUILD, ciRun=CI,
        assetDigests={name: digest(p) for name, p in files.items()}))

if sys.argv[1] == 'prepare':
    prepare()
elif sys.argv[1] == 'publish':
    publish()
else:
    raise ValueError('Unknown phase')
