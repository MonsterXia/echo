import hashlib,json,os,subprocess
from pathlib import Path

repo='MonsterXia/scrcpy-harmony'
source='2cce9e1d1034f1f16bbc47e86a5ce661d13e3aca'
build=41197974717
platform=os.environ['RELEASE_PLATFORM']
arch=os.environ['EXPECTED_ARCH']
mode=os.environ['RELEASE_MODE']
assert mode in ('preflight','postrelease')
assert (platform,arch) in [('win','x64'),('mac','arm64'),('mac','x64')]
ext='exe' if platform=='win' else 'dmg'
artifact='windows-latest' if platform=='win' else 'macos-15' if arch=='arm64' else 'macos-15-intel'
output=Path('release/stable-acceptance').resolve()
output.mkdir(parents=True,exist_ok=True)
tools=Path(__file__).resolve().parent

def run(args,**kw):return subprocess.run(args,check=True,**kw)
def api(p):return json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/{p}']))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

runinfo=api(f'actions/runs/{build}')
assert runinfo['head_sha']==source and runinfo['conclusion']=='success' and runinfo['name']=='Build'
env=os.environ.copy()
env['RELEASE_INSTALL_ROOT']=str(Path(env['RUNNER_TEMP'])/'stable-install')
env['RELEASE_PROFILE']=str(Path(env['RUNNER_TEMP'])/'stable-profile')
Path(env['RELEASE_PROFILE']).mkdir(parents=True,exist_ok=True)
env['RELEASE_EXPECT_STABLE']='1.0.3' if mode=='preflight' else '1.0.4'
env['RELEASE_EXPECT_BETA']='1.0.4-dev.3' if mode=='preflight' else '1.0.4'
summaries=[]
for version in ['1.0.3','1.0.4-dev.3','1.0.4']:
    destination=output/version
    destination.mkdir()
    published=version!='1.0.4' or mode=='postrelease'
    if published:
        release=api('releases/tags/v'+version)
        assert not release['draft']
        name=f'Scrcpy-Harmony-{version}-{platform}-{arch}.{ext}'
        asset=next(a for a in release['assets'] if a['name']==name)
        expected=asset['digest'].removeprefix('sha256:')
        assert len(expected)==64
        installer=destination/name
        run(['gh','release','download','v'+version,'--repo',repo,'--pattern',name,'--dir',str(destination)])
    else:
        run(['gh','run','download',str(build),'--repo',repo,'--name',artifact,'--dir',str(destination/'artifact')])
        candidates=list((destination/'artifact').rglob(f'Scrcpy Harmony-{version}-{platform}-{arch}.{ext}'))
        assert len(candidates)==1
        installer=candidates[0]
        reportname=f'verification-{platform}-{arch}.'+('json' if platform=='win' else 'txt')
        paths=list((destination/'artifact').rglob(reportname));assert len(paths)==1
        text=paths[0].read_text(encoding='utf-8-sig')
        if platform=='win':
            report=json.loads(text);assert report['sourceCommit']==source
            expected=report['sha256']
        else:
            assert f'sourceCommit={source}' in text
            expected=next(line.split()[0] for line in text.splitlines() if line.endswith(installer.name))
    assert sha(installer)==expected
    if version!='1.0.3':env['RELEASE_PROFILE_EXPECT']='preserved'
    run(['node',str(tools/'install-check.mjs'),str(installer),version,str(destination/'evidence'),expected],env=env)
    summaries.append(json.loads((destination/'evidence'/'report.json').read_text()))
assert all(s['passed'] and not s['local'] for s in summaries)
(output/'summary.json').write_text(json.dumps(dict(mode=mode,source=source,build=build,platform=platform,arch=arch,passed=True,versions=[dict(version=s['version'],scenarios=len(s['scenarios']),settingsPreserved=s.get('settingsPreserved',False)) for s in summaries]),indent=2)+'\n')
