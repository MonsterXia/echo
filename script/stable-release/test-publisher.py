import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-stable.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class StableTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.config = dict(repo='MonsterXia/scrcpy-harmony', version='1.0.4', tag='v1.0.4',
            source_sha='a'*40, baseline_sha='b'*40, ci_run=1, build_run=2, preparation_pr=79,
            stable_tag='v1.0.3', repo_dir=str(self.repo), work_dir=str(self.repo/'release'/'audit'),
            notes_file=str(self.repo/'notes.md'), release_name='Scrcpy Harmony 1.0.4')
        (self.repo/'notes.md').write_text('1.0.4 '+ 'a'*40)
        self.path = self.repo/'config.json'
        self.path.write_text(json.dumps(self.config))

    def publisher(self): return m.Publisher(self.path)

    def test_only_stable_target(self):
        self.assertEqual(self.publisher().c['tag'], 'v1.0.4')
        self.config.update(version='1.0.4-dev.3', tag='v1.0.4-dev.3')
        self.path.write_text(json.dumps(self.config))
        with self.assertRaises(m.VerificationError): self.publisher()

    def test_metadata_requires_non_prerelease(self):
        p = self.publisher()
        r = dict(tag_name='v1.0.4', target_commitish='a'*40, prerelease=False,
                 name=p.c['release_name'], body=p.notes())
        p.validate_release(r)
        r['prerelease'] = True
        with self.assertRaises(m.VerificationError): p.validate_release(r)

    def test_latest_transition_and_unrelated_release_rejected(self):
        p = self.publisher()
        with patch.object(p, 'api', return_value=dict(tag_name='v1.0.3',draft=False,prerelease=False)):
            p.check_latest()
        with patch.object(p, 'api', return_value=dict(tag_name='v1.0.5',draft=False,prerelease=False)):
            with self.assertRaises(m.VerificationError): p.check_latest()
        p.state_path.write_text('{}')
        with patch.object(p, 'from_state', return_value={'draft': False}), patch.object(p, 'api', return_value=dict(tag_name='v1.0.4',draft=False,prerelease=False)):
            p.check_latest()

    def test_publish_sets_stable_latest_and_checks_it(self):
        p = self.publisher()
        r = dict(id=5, draft=True, prerelease=False, assets=[], html_url='https://example.test', published_at='now')
        seen = []
        def api(route, method='GET', data=None):
            if method == 'PATCH':
                seen.append(data)
                r['draft'] = data['draft']
                r['prerelease'] = data['prerelease']
            return dict(r)
        with patch.object(p,'prepared',return_value={}), patch.object(p,'verify_source'), patch.object(p,'from_state',side_effect=lambda:dict(r)), patch.object(p,'validate_assets',return_value={}), patch.object(p,'api',side_effect=api), patch.object(p,'check_latest') as latest:
            p.verify_publish(True)
            self.assertEqual(seen,[{'draft':False,'prerelease':False,'make_latest':'true'}])
            self.assertEqual(latest.call_count,2)
            audit=json.loads((p.root/'publication-audit.json').read_text())
            self.assertEqual(audit['latest'],'v1.0.4')

    def test_wrong_source_tag_is_never_moved(self):
        p=self.publisher()
        with patch.object(p,'api',return_value={'object':{'type':'commit','sha':'f'*40}}) as api:
            with self.assertRaises(m.VerificationError):p.check_tag()
            self.assertEqual(api.call_count,1)

if __name__ == '__main__': unittest.main()
