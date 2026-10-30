#!/usr/bin/env python3
"""One-off dev.3 publisher. Only prepare/verify are read-only on GitHub.

No token lookup, shell interpolation, asset replacement or tag movement.
All release reads after discovery use the persisted numeric Release ID.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from urllib.parse import quote
import zipfile


CI_JOBS = {'test', 'lint', 'windows-package', 'macos-package-arm64', 'macos-package-x64'}
BUILD_JOBS = {'build (windows-latest, x64)', 'build (macos-15, arm64)', 'build (macos-15-intel, x64)'}
PLATFORMS = {
    'windows-latest': ('win-x64.exe', 'latest.yml', 'verification-win-x64.json'),
    'macos-15': ('mac-arm64.dmg', 'latest-mac.yml', 'verification-mac-arm64.txt'),
    'macos-15-intel': ('mac-x64.dmg', 'latest-x64-mac.yml', 'verification-mac-x64.txt'),
}
APP_UPDATE_PATHS = {
    'windows-latest': 'win-unpacked/resources/app-update.yml',
    'macos-15': 'mac-arm64/Scrcpy Harmony.app/Contents/Resources/app-update.yml',
    'macos-15-intel': 'mac/Scrcpy Harmony.app/Contents/Resources/app-update.yml',
}


class VerificationError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def digest(path, algorithm='sha256'):
    hasher = hashlib.new(algorithm)
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode()


def write_identical(path, data):
    """Persist new local evidence; never silently replace different bytes."""
    path = Path(path)
    require(not path.is_symlink(), f'Symlink destination refused: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.is_file() and path.read_bytes() == data, f'Existing file differs: {path}')
    else:
        with path.open('xb') as stream:
            stream.write(data)


def atomic_json(path, value):
    """Replace local state/snapshots atomically, never release assets."""
    path = Path(path)
    require(not path.is_symlink(), f'Symlink destination refused: {path}')
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temp = Path(stream.name)
        stream.write(json_bytes(value))
    os.replace(temp, path)


def safe_extract(archive, destination):
    """Validate the entire ZIP before writing; only plain files/directories."""
    destination = Path(destination)
    require(not destination.exists(), f'Extraction destination already exists: {destination}')
    entries = []
    seen = set()
    with zipfile.ZipFile(archive) as zipped:
        require(len(zipped.infolist()) <= 100, 'Unexpectedly many ZIP entries')
        require(sum(i.file_size for i in zipped.infolist()) <= 4 * 1024 ** 3, 'ZIP exceeds 4 GiB limit')
        for entry in zipped.infolist():
            name = entry.filename
            parts = name.rstrip('/').split('/')
            require(name and '\\' not in name and '\x00' not in name and ':' not in name,
                    f'Unsafe ZIP entry: {name!r}')
            require(not PurePosixPath(name).is_absolute() and all(p not in ('', '.', '..') for p in parts),
                    f'Unsafe ZIP path: {name!r}')
            key = '/'.join(parts).casefold()
            require(key not in seen, f'Duplicate ZIP path: {name!r}')
            seen.add(key)
            mode = entry.external_attr >> 16
            kind = stat.S_IFMT(mode)
            require(kind in (0, stat.S_IFREG, stat.S_IFDIR), f'Non-regular ZIP entry: {name!r}')
            require(not (entry.flag_bits & 1), 'Encrypted ZIP entries refused')
            require(not entry.is_dir() or kind != stat.S_IFREG, 'Conflicting ZIP entry type')
            require(entry.is_dir() or kind != stat.S_IFDIR, 'Conflicting ZIP entry type')
            entries.append((entry, parts))
        # Catch a/file vs a before any extraction, regardless of entry order.
        file_keys = {'/'.join(p).casefold() for e, p in entries if not e.is_dir()}
        for _, parts in entries:
            require(all('/'.join(parts[:n]).casefold() not in file_keys for n in range(1, len(parts))),
                    'ZIP file/directory collision')
        destination.mkdir(parents=True)
        for entry, parts in entries:
            target = destination.joinpath(*parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(entry) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)


def classify_artifact_files(files, required, artifact_root, optional_paths):
    """Keep all four unique release files; ignore only known builder sidecars."""
    optional = {'builder-debug.yml', 'app-update.yml'}
    names = [path.name for path in files]
    require(len(names) == len(set(names)), f'Duplicate artifact basenames: {names}')
    require(required <= set(names) and set(names) <= required | optional,
            f'Unexpected or missing artifact files: {names}')
    selected = {path.name: path for path in files if path.name in required}
    ignored = sorted((path for path in files if path.name in optional), key=lambda path: path.as_posix())
    require(all(path.relative_to(artifact_root).as_posix() in optional_paths for path in ignored),
            'Unexpected auxiliary configuration path')
    return selected, ignored


class Publisher:
    def __init__(self, config_path):
        self.config_path = Path(config_path).resolve()
        self.c = json.loads(self.config_path.read_text())
        required = {'repo', 'version', 'tag', 'source_sha', 'baseline_sha', 'ci_run', 'build_run',
                    'preparation_pr', 'stable_tag', 'repo_dir', 'work_dir', 'notes_file', 'release_name'}
        require(set(self.c) == required, f'Config keys must be exactly: {sorted(required)}')
        require(self.c['repo'] == 'MonsterXia/scrcpy-harmony', 'Unexpected repository')
        require(self.c['version'] == '1.0.4-dev.3' and self.c['tag'] == 'v1.0.4-dev.3', 'Only dev.3 is supported')
        require(self.c['stable_tag'] == 'v1.0.3', 'Unexpected stable tag')
        for key in ('source_sha', 'baseline_sha'):
            require(re.fullmatch('[0-9a-f]{40}', self.c[key]) is not None, f'{key} must be a full SHA')
        for key in ('ci_run', 'build_run', 'preparation_pr'):
            require(type(self.c[key]) is int and self.c[key] > 0, f'{key} must be a positive integer')
        for key in ('repo_dir', 'work_dir', 'notes_file'):
            require(Path(self.c[key]).is_absolute(), f'{key} must be absolute')
        self.repo_dir = Path(self.c['repo_dir']).resolve()
        self.root = Path(self.c['work_dir'])
        require(not self.root.is_symlink() and self.root.resolve().is_relative_to(self.repo_dir / 'release'),
                'work_dir must be inside the ignored repository release directory')
        self.root.mkdir(parents=True, exist_ok=True)
        self.assets_dir = self.root / 'verified-assets'
        self.state_path = self.root / 'release-state.json'
        self.prepared_path = self.root / 'prepared.json'
        self.identity = {k: v for k, v in self.c.items() if k not in ('notes_file', 'repo_dir', 'work_dir')}

    def gh(self, *args, output=None, input_data=None, allow404=False):
        # gh handles its normal environment/keychain authentication. Never request or print tokens.
        read_download = output is not None and args[0] == 'api' and (
            '--method' not in args or args[args.index('--method') + 1] == 'GET')
        attempts = 3 if read_download else 1
        for attempt in range(attempts):
            if attempt:
                output.seek(0)
                output.truncate()
                time.sleep(attempt)
            result = subprocess.run(['gh', *args], cwd=self.repo_dir, input=input_data,
                                    stdout=output if output is not None else subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=1800)
            if not result.returncode:
                return result.stdout
            error = result.stderr.decode(errors='replace')
            if allow404 and re.search(r'HTTP 404\b', error):
                return None
            transient = re.search(r'\bEOF\b|connection reset|TLS handshake timeout|HTTP (408|502|503|504)\b', error)
            if read_download and transient and attempt + 1 < attempts:
                print('Retrying read-only download after a transport failure.', flush=True)
                continue
            # gh errors can include temporary signed redirect credentials.
            error = re.sub(r'(https?://[^\s?\"]+)\?[^\s\"]+', r'\1?[redacted]', error)
            raise VerificationError('gh failed: ' + error[-3000:])

    def api(self, path, method='GET', data=None, allow404=False):
        endpoint = path if path.startswith('https://') else f"repos/{self.c['repo']}/{path}"
        args = ['api', endpoint, '--method', method]
        payload = None
        if data is not None:
            args += ['--input', '-']
            payload = json_bytes(data)
        raw = self.gh(*args, input_data=payload, allow404=allow404)
        return None if raw is None else json.loads(raw)

    def pages(self, path, key=None):
        items = []
        for page in range(1, 100):
            separator = '&' if '?' in path else '?'
            data = self.api(f'{path}{separator}per_page=100&page={page}')
            batch = data[key] if key else data
            require(isinstance(batch, list), 'Invalid paginated API result')
            items.extend(batch)
            if len(batch) < 100:
                return items
        raise VerificationError('Pagination limit exceeded')

    def check_latest(self):
        latest = self.api('releases/latest')
        require(latest['tag_name'] == self.c['stable_tag'] and not latest['draft'] and not latest['prerelease'],
                'Stable Latest has changed')

    def verify_source(self, require_merged):
        evidence = {}
        for key, name, expected in [('ci_run', 'CI', CI_JOBS), ('build_run', 'Build', BUILD_JOBS)]:
            run = self.api(f"actions/runs/{self.c[key]}")
            require(run['head_sha'] == self.c['source_sha'] and run['name'] == name
                    and run['status'] == 'completed' and run['conclusion'] == 'success',
                    f'{name} must have completed successfully on configured source SHA')
            require(run['repository']['full_name'] == self.c['repo'] and
                    run['head_repository']['full_name'] == self.c['repo'], 'Unexpected run repository')
            jobs = self.pages(f"actions/runs/{self.c[key]}/jobs?filter=latest", 'jobs')
            require(len(jobs) == len(expected) and {j['name'] for j in jobs} == expected,
                    f'Unexpected {name} jobs')
            require(all(j['status'] == 'completed' and j['conclusion'] == 'success' for j in jobs),
                    f'{name} contains unsuccessful jobs')
            evidence[key] = {'run': run, 'jobs': jobs}
        pr = self.api(f"pulls/{self.c['preparation_pr']}")
        require(pr['head']['sha'] == self.c['source_sha'] and pr['base']['ref'] == 'master'
                and pr['base']['repo']['full_name'] == self.c['repo']
                and pr['head']['repo']['full_name'] == self.c['repo'], 'Preparation PR source/base differs')
        if require_merged:
            require(pr['merged'] and pr['merged_at'], 'Preparation PR must be merged before release mutation')
            compare = self.api(f"compare/{self.c['source_sha']}...master")
            require(compare['merge_base_commit']['sha'] == self.c['source_sha'], 'Source is not in master history')
        compare = self.api(f"compare/{self.c['baseline_sha']}...{self.c['source_sha']}")
        require(compare['merge_base_commit']['sha'] == self.c['baseline_sha'], 'Source does not descend from baseline')
        # Read the actual source commit, not the mutable local checkout.
        for name in ('package.json', 'package-lock.json'):
            record = self.api(f"contents/{name}?ref={self.c['source_sha']}")
            data = json.loads(base64.b64decode(record['content']))
            require(data['version'] == self.c['version'], f'{name} version differs')
            if name == 'package-lock.json':
                require(data['packages']['']['version'] == self.c['version'], 'Lock root version differs')
        self.check_latest()
        evidence['preparation_pr'] = pr
        atomic_json(self.root / 'source-check.json', evidence)
        return evidence

    def yaml(self, path):
        # js-yaml is already installed in this repository. JSON_SCHEMA excludes executable types.
        program = "const fs=require('fs'),y=require('js-yaml');process.stdout.write(JSON.stringify(y.load(fs.readFileSync(process.argv[1],'utf8'),{schema:y.JSON_SCHEMA})));"
        result = subprocess.run(['node', '-e', program, str(path)], cwd=self.repo_dir,
                                check=True, capture_output=True, text=True, timeout=30)
        return json.loads(result.stdout)

    def expected_names(self):
        names = {'release-validation.json', 'SHA256SUMS.txt'}
        for suffix, metadata, report in PLATFORMS.values():
            installer = f"Scrcpy-Harmony-{self.c['version']}-{suffix}"
            names.update((installer, installer + '.blockmap', metadata, report))
        require(len(names) == 14, 'Internal asset count differs')
        return names

    def copy_asset(self, source, name):
        target = self.assets_dir / name
        require(source.is_file() and not source.is_symlink() and source.stat().st_size > 0, f'Invalid asset: {source}')
        if target.exists():
            require(not target.is_symlink() and digest(target) == digest(source), f'Existing asset differs: {name}')
        else:
            with source.open('rb') as incoming, target.open('xb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
        return target

    def prepare(self):
        self.verify_source(require_merged=False)
        artifacts = self.pages(f"actions/runs/{self.c['build_run']}/artifacts", 'artifacts')
        require(len(artifacts) == 3 and {a['name'] for a in artifacts} == set(PLATFORMS), 'Unexpected Build artifacts')
        stable_artifacts = []
        for artifact in artifacts:
            require(not artifact['expired'] and artifact['workflow_run']['head_sha'] == self.c['source_sha'],
                    'Artifact source/expiry differs')
            require(re.fullmatch(r'sha256:[0-9a-f]{64}', artifact.get('digest', '')) is not None,
                    'GitHub artifact digest missing')
            stable_artifacts.append({k: artifact[k] for k in ('id', 'name', 'digest', 'size_in_bytes')})
        stable_artifacts.sort(key=lambda a: a['name'])
        write_identical(self.root / 'artifact-manifest.json', json_bytes(stable_artifacts))
        self.assets_dir.mkdir(exist_ok=True)
        require(not self.assets_dir.is_symlink(), 'Assets directory symlink refused')
        installers, signatures, ignored_files = [], {}, []
        for artifact in artifacts:
            archive = self.root / f"artifact-{artifact['id']}.zip"
            require(not archive.is_symlink(), 'Archive symlink refused')
            if not archive.exists():
                with tempfile.NamedTemporaryFile(dir=self.root, delete=False) as stream:
                    temp = Path(stream.name)
                    try:
                        self.gh('api', f"repos/{self.c['repo']}/actions/artifacts/{artifact['id']}/zip", output=stream)
                    except BaseException:
                        temp.unlink(missing_ok=True)
                        raise
                require('sha256:' + digest(temp) == artifact['digest'], 'Downloaded artifact ZIP digest mismatch')
                os.replace(temp, archive)
            require('sha256:' + digest(archive) == artifact['digest'], 'Cached artifact ZIP digest mismatch')
            # Fresh disposable extraction also avoids trusting cached extracted files.
            with tempfile.TemporaryDirectory(prefix='extract-', dir=self.root) as tempdir:
                extracted = Path(tempdir) / artifact['name']
                safe_extract(archive, extracted)
                files = [p for p in extracted.rglob('*') if p.is_file()]
                suffix, metadata_name, report_name = PLATFORMS[artifact['name']]
                original = f"Scrcpy Harmony-{self.c['version']}-{suffix}"
                expected = {original, original + '.blockmap', metadata_name, report_name}
                optional_paths = {f"{self.c['version']}/builder-debug.yml",
                                  f"{self.c['version']}/{APP_UPDATE_PATHS[artifact['name']]}"}
                by_name, ignored = classify_artifact_files(files, expected, extracted, optional_paths)
                ignored_files.extend({'artifact': artifact['name'], 'path': p.relative_to(extracted).as_posix(),
                                      'size': p.stat().st_size, 'sha256': digest(p),
                                      'reason': 'electron-builder auxiliary configuration; excluded from release assets'}
                                     for p in ignored)
                name = original.replace('Scrcpy Harmony', 'Scrcpy-Harmony')
                installer = self.copy_asset(by_name[original], name)
                self.copy_asset(by_name[original + '.blockmap'], name + '.blockmap')
                item = {'name': name, 'size': installer.stat().st_size, 'sha256': digest(installer)}
                installers.append(item)
                metadata = self.yaml(by_name[metadata_name])
                require(metadata['version'] == self.c['version'] and len(metadata['files']) == 1, 'YAML version/files differ')
                entry = metadata['files'][0]
                sha512 = base64.b64encode(bytes.fromhex(digest(installer, 'sha512'))).decode()
                require(entry['url'] == name and metadata['path'] == name, 'YAML target differs')
                require(type(entry['size']) is int and entry['size'] == item['size'], 'YAML size differs')
                require(entry['sha512'] == sha512 and metadata['sha512'] == sha512, 'YAML SHA512 differs')
                self.copy_asset(by_name[metadata_name], metadata_name)
                text = by_name[report_name].read_text(encoding='utf-8-sig')
                run_url = f"https://github.com/{self.c['repo']}/actions/runs/{self.c['build_run']}"
                if report_name.endswith('.json'):
                    report = json.loads(text)
                    require(report['sourceCommit'] == self.c['source_sha'] and report['runUrl'] == run_url
                            and report['installationAndStartup'] == 'passed' and report['installer'] == original
                            and report['sha256'] == item['sha256'], 'Windows source report differs')
                    require(report['authenticodeStatus'] in {'Valid', 'UnknownError', 'NotSigned', 'HashMismatch',
                            'NotTrusted', 'NotSupportedFileFormat', 'Incompatible'}, 'Unknown Authenticode status')
                    require('signer' in report, 'Missing Windows signer evidence')
                    signatures['windows-x64'] = {k: report[k] for k in ('authenticodeStatus', 'signer')}
                else:
                    lines = text.splitlines()
                    for key, value in [('sourceCommit', self.c['source_sha']), ('runUrl', run_url), ('installationAndStartup', 'passed')]:
                        require([line for line in lines if line.startswith(key + '=')] == [f'{key}={value}'],
                                f'macOS {key} report differs')
                    hashes = [re.match(r'^([0-9a-f]{64})  (.+)$', line) for line in lines]
                    hashes = [match for match in hashes if match]
                    require(len(hashes) == 1 and hashes[0][1] == item['sha256']
                            and PurePosixPath(hashes[0][2]).name == original, 'macOS installer hash report differs')
                    exits = {}
                    for key in ('codesignDetailsExit', 'codesignVerifyExit', 'gatekeeperExit', 'staplerExit'):
                        values = [line[len(key) + 1:] for line in lines if line.startswith(key + '=')]
                        require(len(values) == 1 and values[0].isdigit(), f'Missing or duplicate {key}')
                        exits[key] = int(values[0])
                    require(exits['codesignDetailsExit'] == 0 and exits['codesignVerifyExit'] == 0, 'macOS signature must pass strict verification before publication')
                    signatures[suffix.removesuffix('.dmg')] = {
                        **exits, 'details': [line for line in lines if any(marker in line for marker in
                            ('Signature=', 'not signed', 'TeamIdentifier=', 'source='))]}
                self.copy_asset(by_name[report_name], report_name)
        require({p.name for p in self.assets_dir.iterdir()} <= self.expected_names(), 'Unexpected local asset')
        base_assets = self.inventory(exclude={'release-validation.json', 'SHA256SUMS.txt'})
        require(len(base_assets) == 12, 'Expected 12 source assets')
        report = {'version': self.c['version'], 'sourceCommit': self.c['source_sha'],
                  'ciRun': f"https://github.com/{self.c['repo']}/actions/runs/{self.c['ci_run']}",
                  'buildRun': f"https://github.com/{self.c['repo']}/actions/runs/{self.c['build_run']}",
                  'preparationPr': self.c['preparation_pr'], 'prerelease': True, 'latest': False,
                  'installationAndStartup': 'passed on all three platforms',
                  'signingNote': 'macOS strict signature verification is required; Developer ID, notarization and OS trust are recorded separately. Installation/startup does not imply OS trust approval.',
                  'installers': sorted(installers, key=lambda a: a['name']), 'signatures': signatures,
                  'assets': base_assets, 'artifactDigests': stable_artifacts,
                  'ignoredArtifactFiles': sorted(ignored_files, key=lambda item: (item['artifact'], item['path'])),
                  'scope': 'CI and Build evidence; no additional device, manual visual, long-duration or cross-firmware acceptance is implied.'}
        write_identical(self.assets_dir / 'release-validation.json', json_bytes(report))
        checksums = ''.join(f"{a['sha256']}  {a['name']}\n" for a in self.inventory(exclude={'SHA256SUMS.txt'}))
        write_identical(self.assets_dir / 'SHA256SUMS.txt', checksums.encode())
        prepared = {'identity': self.identity, 'assets': self.inventory(), 'artifactDigests': stable_artifacts}
        require({a['name'] for a in prepared['assets']} == self.expected_names(), 'Final asset set differs')
        write_identical(self.prepared_path, json_bytes(prepared))
        print(f'Prepared and verified 14 assets in {self.assets_dir}. No GitHub mutation performed.')

    def inventory(self, exclude=frozenset()):
        result = []
        for path in sorted(self.assets_dir.iterdir()):
            require(path.is_file() and not path.is_symlink(), f'Unexpected non-file asset: {path.name}')
            if path.name not in exclude:
                result.append({'name': path.name, 'size': path.stat().st_size, 'sha256': digest(path)})
        return result

    def prepared(self):
        data = json.loads(self.prepared_path.read_text())
        require(data['identity'] == self.identity, 'Config differs from prepared identity')
        require(data['assets'] == self.inventory(), 'Local assets changed after preparation')
        require({a['name'] for a in data['assets']} == self.expected_names(), 'Prepared asset set differs')
        return {a['name']: a for a in data['assets']}

    def notes(self):
        body = Path(self.c['notes_file']).read_text()
        require(body.strip() and self.c['version'] in body and self.c['source_sha'] in body, 'Release notes must include version and full source SHA')
        return body

    def read_release(self, release_id):
        release = self.api(f'releases/{release_id}')
        require(release['id'] == release_id, 'Release ID differs')
        release['assets'] = self.pages(f'releases/{release_id}/assets')
        return release

    def check_tag(self, allow_missing=False):
        ref = self.api(f"git/ref/tags/{quote(self.c['tag'], safe='')}", allow404=allow_missing)
        if ref is not None:
            require(ref['object']['type'] == 'commit' and ref['object']['sha'] == self.c['source_sha'],
                    'Existing tag does not point directly to the source SHA; never move it')
        return ref

    def validate_release(self, release):
        require(release['tag_name'] == self.c['tag'] and release['target_commitish'] == self.c['source_sha']
                and release['prerelease'] and release['name'] == self.c['release_name']
                and release['body'] == self.notes(), 'Existing release metadata differs; never overwrite it')

    def validate_assets(self, release, expected, complete):
        actual = {a['name']: a for a in release['assets']}
        require(len(actual) == len(release['assets']), 'Duplicate remote asset names')
        require(set(actual) <= set(expected), 'Unexpected remote assets; never delete them')
        if complete:
            require(set(actual) == set(expected), 'Remote release must contain exactly all 14 expected assets')
        for name, remote in actual.items():
            local = expected[name]
            require(remote['state'] == 'uploaded' and remote['size'] == local['size']
                    and remote.get('digest') == 'sha256:' + local['sha256'],
                    f'Existing remote asset differs or is incomplete; never overwrite: {name}')
        return actual

    def save_state(self, release):
        state = {'identity': self.identity, 'release_id': release['id'],
                 'notes_sha256': hashlib.sha256(self.notes().encode()).hexdigest()}
        write_identical(self.state_path, json_bytes(state))

    def from_state(self):
        state = json.loads(self.state_path.read_text())
        require(state['identity'] == self.identity and state['notes_sha256'] == hashlib.sha256(self.notes().encode()).hexdigest(),
                'Config or release notes differ from saved release state')
        release = self.read_release(state['release_id'])
        self.validate_release(release)
        self.check_tag()
        return release

    def draft(self):
        expected = self.prepared()
        self.verify_source(require_merged=True)
        body = self.notes()
        if self.state_path.exists():
            release = self.from_state()
        else:
            # Listing includes drafts; the /releases/tags endpoint intentionally is never used.
            matches = [r for r in self.pages('releases') if r['tag_name'] == self.c['tag']]
            require(len(matches) <= 1, 'Multiple releases match the configured tag')
            if matches:
                release = self.read_release(matches[0]['id'])
                self.validate_release(release)
                self.check_tag()
                self.validate_assets(release, expected, complete=not release['draft'])
            else:
                if self.check_tag(allow_missing=True) is None:
                    self.api('git/refs', 'POST', {'ref': 'refs/tags/' + self.c['tag'], 'sha': self.c['source_sha']})
                self.check_tag()
                release = self.api('releases', 'POST', {'tag_name': self.c['tag'], 'target_commitish': self.c['source_sha'],
                    'name': self.c['release_name'], 'body': body, 'draft': True, 'prerelease': True, 'make_latest': 'false'})
                # Save ID immediately: even a later verification failure can be inspected safely.
                self.save_state(release)
                release = self.read_release(release['id'])
                self.validate_release(release)
            self.save_state(release)
        self.validate_assets(release, expected, complete=not release['draft'])
        self.check_latest()
        print(f"Release ID {release['id']} ({'draft' if release['draft'] else 'already published'}): {release['html_url']}")

    def upload(self):
        expected = self.prepared()
        self.verify_source(require_merged=True)
        release = self.from_state()
        actual = self.validate_assets(release, expected, complete=not release['draft'])
        if not release['draft']:
            print('Already published with the same asset manifest; no upload performed.')
            return
        for name in sorted(expected):
            # Re-read before each upload; never replace any existing asset, even an incomplete one.
            release = self.from_state()
            require(release['draft'], 'Release stopped being a draft during upload')
            actual = self.validate_assets(release, expected, complete=False)
            if name in actual:
                continue
            path = self.assets_dir / name
            require(digest(path) == expected[name]['sha256'], 'Local upload file changed')
            endpoint = f"https://uploads.github.com/repos/{self.c['repo']}/releases/{release['id']}/assets?name={quote(name, safe='')}"
            self.gh('api', endpoint, '--method', 'POST', '--header', 'Content-Type: application/octet-stream', '--input', str(path))
            after = self.from_state()
            actual = self.validate_assets(after, expected, complete=False)
            require(name in actual, f'Uploaded asset not visible: {name}')
            print(f'Uploaded and verified metadata: {name}', flush=True)
        self.validate_assets(self.from_state(), expected, complete=True)
        self.check_latest()

    @staticmethod
    def release_fingerprint(release):
        return {k: release.get(k) for k in ('id', 'tag_name', 'target_commitish', 'name', 'body', 'draft',
                'prerelease', 'updated_at')} | {'assets': sorted(
                    [{k: a.get(k) for k in ('id', 'name', 'state', 'size', 'digest', 'updated_at')} for a in release['assets']],
                    key=lambda a: a['name'])}

    def verify_publish(self, publish):
        expected = self.prepared()
        self.verify_source(require_merged=True)
        release = self.from_state()
        assets = self.validate_assets(release, expected, complete=True)
        # Download each asset by numeric ID so private drafts work too. Never trust a cache here.
        with tempfile.TemporaryDirectory(prefix='release-download-', dir=self.root) as tempdir:
            for name, asset in sorted(assets.items()):
                path = Path(tempdir) / name
                with path.open('xb') as output:
                    self.gh('api', f"repos/{self.c['repo']}/releases/assets/{asset['id']}",
                            '--header', 'Accept: application/octet-stream', output=output)
                require(path.stat().st_size == expected[name]['size'] and digest(path) == expected[name]['sha256'],
                        f'Redownloaded asset bytes differ: {name}')
                print(f'Redownloaded and verified: {name}', flush=True)
        current = self.from_state()
        require(self.release_fingerprint(current) == self.release_fingerprint(release), 'Release changed during download verification')
        self.validate_assets(current, expected, complete=True)
        self.prepared()  # Final local immutable-manifest check.
        self.check_latest()
        verified = {'identity': self.identity, 'release_id': current['id'], 'downloadedAssetsVerified': 14,
                    'assetDigests': {name: item['sha256'] for name, item in expected.items()},
                    'verifiedAt': datetime.now(timezone.utc).isoformat()}
        atomic_json(self.root / 'remote-verification.json', verified)
        if publish and current['draft']:
            # The only release update this tool permits: publish the already-verified fixed ID.
            self.api(f"releases/{current['id']}", 'PATCH', {'draft': False, 'prerelease': True, 'make_latest': 'false'})
        after = self.from_state()
        self.validate_assets(after, expected, complete=True)
        self.check_latest()
        if publish:
            require(not after['draft'] and after['prerelease'], 'Release publication not confirmed')
            atomic_json(self.root / 'release-after.json', after)
            atomic_json(self.root / 'publication-audit.json', verified | {'published_at': after['published_at'],
                        'latest': self.c['stable_tag'], 'url': after['html_url']})
            print(f"Published pre-release verified: {after['html_url']}; Latest remains {self.c['stable_tag']}.")
        else:
            print(f"Verified all 14 remote assets; release remains {'draft' if after['draft'] else 'published'}. No GitHub mutation performed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('prepare', 'draft', 'upload', 'verify-publish'))
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--publish', action='store_true', help='With verify-publish only: publish after a fresh complete verification')
    args = parser.parse_args()
    require(not args.publish or args.phase == 'verify-publish', '--publish is only allowed with verify-publish')
    publisher = Publisher(args.config)
    if args.phase == 'verify-publish':
        publisher.verify_publish(args.publish)
    else:
        getattr(publisher, args.phase)()


if __name__ == '__main__':
    try:
        main()
    except (VerificationError, OSError, KeyError, ValueError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        print(f'STOP: {error}', file=sys.stderr)
        sys.exit(1)
