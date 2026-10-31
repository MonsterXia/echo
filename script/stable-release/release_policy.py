def upgrade_paths():
    return [dict(profile='from-stable',versions=('1.0.3','1.0.4')),
            dict(profile='from-dev',versions=('1.0.4-dev.3','1.0.4'))]

def verify_windows_signature(report):
    if report.get('authenticodeStatus')!='NotSigned' or report.get('signer') is not None:
        raise ValueError('This release requires Windows NotSigned with no signer')

def verify_mac_signature(text,exits):
    if text.splitlines().count('Signature=adhoc')!=1 or exits.get('codesignDetailsExit')!=0 or exits.get('codesignVerifyExit')!=0:
        raise ValueError('This release requires valid ad-hoc signing with both signature checks passing')
