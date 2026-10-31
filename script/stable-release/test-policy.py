import unittest
from release_policy import upgrade_paths, verify_windows_signature, verify_mac_signature

class PolicyTests(unittest.TestCase):
    def test_each_old_version_upgrades_directly_in_separate_profile(self):
        paths=upgrade_paths()
        self.assertEqual({p['versions'][0] for p in paths},{'1.0.3','1.0.4-dev.3'})
        self.assertEqual(len({p['profile'] for p in paths}),len(paths))
        for p in paths:
            self.assertEqual(len(p['versions']),2)
            self.assertEqual(p['versions'][1],'1.0.4')

    def test_only_unsigned_windows_without_signer_is_accepted(self):
        verify_windows_signature({'authenticodeStatus':'NotSigned','signer':None})
        for status in ['HashMismatch','UnknownError','NotTrusted','Valid']:
            with self.subTest(status=status),self.assertRaises(ValueError):
                verify_windows_signature({'authenticodeStatus':status,'signer':None})
        with self.assertRaises(ValueError):
            verify_windows_signature({'authenticodeStatus':'NotSigned','signer':'unexpected'})

    def test_mac_requires_adhoc_and_both_success_exits(self):
        verify_mac_signature('Signature=adhoc\nTeamIdentifier=not set',{'codesignDetailsExit':0,'codesignVerifyExit':0})
        for text,exits in [('Signature=invalid',{'codesignDetailsExit':0,'codesignVerifyExit':0}),('Signature=adhoc',{'codesignDetailsExit':1,'codesignVerifyExit':0}),('Signature=adhoc',{'codesignDetailsExit':0,'codesignVerifyExit':1})]:
            with self.subTest(text=text,exits=exits),self.assertRaises(ValueError):verify_mac_signature(text,exits)

if __name__=='__main__':unittest.main()
