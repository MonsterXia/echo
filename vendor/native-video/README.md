# HOScrcpy device resources

`manifest.json` pins the official HOScrcpy v1.0.16-beta release's SDK
1.0.18-beta archive and six ARM64 device libraries, including each byte size
and SHA-256. The archive was downloaded from the upstream release itself.
The publisher's release description explicitly identifies it as the SDK for
developer integration. The upstream repository declares MIT; `LICENSE` is
preserved verbatim, including its unfilled copyright placeholder. No author
or broader license grant is invented here. Native-library sources and a
separate native-component license are not provided by that archive.

`node script/native-video-resources.mjs` verifies the archive and extracts
only the pinned `.so` entries into ignored `resources/native-video/` with
the manifest and notices. It uses Node built-ins, not Java or a JAR utility.
The application distribution includes these native files and notices only;
the desktop neither bundles nor executes the SDK Java classes/JRE. Builds
validate the native resources again before copying them.

These signed native libraries run as UITest extensions on the phone.
Compatibility depends on the device loader and firmware. File naming alone
does not establish compatibility: the client probes candidates in order and
remembers a successful one for that driver. On the tested device, the April
2026 6.6 library worked while the June 2026 one did not. Unsupported devices
use JPEG. Desktop preparation verifies SHA-256/ELF; signature acceptance is
performed by the device, not claimed as an offline signature verification.

Sources:
- https://gitcode.com/OpenHarmonyToolkitsPlaza/HOScrcpy/releases/tag/v1.0.16-beta
- https://api.gitcode.com/api/v5/repos/OpenHarmonyToolkitsPlaza/HOScrcpy/releases
- https://gitcode.com/OpenHarmonyToolkitsPlaza/HOScrcpy/blob/main/LICENSE
