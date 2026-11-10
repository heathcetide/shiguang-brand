# Final signed APK security gate

Related work: [#107](https://github.com/AdlinZ/DietDigiDose/issues/107), [#219](https://github.com/AdlinZ/DietDigiDose/issues/219).

The Android workflow runs `scripts/check-apk-security.py` **after signing and copying the final distribution APK, before uploading any distribution artifact**. The existing signature/package/version verification remains in place. The gate re-verifies the actual distribution copy with the trusted channel certificate, and checks its checksum again immediately before upload. A missing SDK tool, decoding failure, unrecognized security value or rejected policy stops the job. There is no warning-only mode.

## What is checked

- The final APK's decoded manifest, not app.config.js or the prebuild manifest: package/version identity, no instrumentation, `debuggable` and `testOnly` disabled.
- An explicit false `usesCleartextTraffic`, plus a mandatory network security XML with an explicit denying base and localhost policy. A network security config can override the manifest flag, so nested domain exceptions are also rejected, including explicit localhost exceptions. The explicit localhost entry also suppresses Android 17+’s implicit localhost cleartext exception; behavior still needs ordinary-device verification. Every referenced resource variant must contain an explicit cleartext-denying base config; a modern target SDK does not make older Android runtime defaults safe. Resource-valued booleans require review rather than being guessed.
- Both legacy backup XML and Android 12+ cloud/device-transfer XML. Every storage domain must be excluded in every packaged resource variant, even when `allowBackup=false`. Custom backup agents and new transfer modes require explicit review.
- All exported activities, aliases, services, receivers and providers, including implicit exports and currently disabled components. The checked-in `scripts/apk-security-policy.json` is a justified allowlist, not a wildcard. MainActivity retains the launcher and existing `dietdigidose`/package custom-scheme links. AndroidX's profile receiver must retain `android.permission.DUMP`; Expo's clipboard provider is limited to its package-specific authority and dedicated `.clipboard/` cache. New exports or expanded intent filters fail until reviewed.
- Archive entries for environment files, keystores/private-key file extensions, embedded PEM private-key material, and source maps. Scans cover decompressed entry bytes and chunk boundaries. Ordinary public certificates (including Expo Updates certificates), public config and key-header strings without material are permitted. This is a bounded accidental-packaging check, not a comprehensive credential/obfuscation scanner.

The gate uses Python's standard library and the workflow's existing Android SDK `apksigner`, `apkanalyzer` and `aapt2`. It does not download tools. AAPT2's actual resource table resolves numeric/symbolic references and resource-path shortening; **all** XML configurations are decoded from the APK. Security-relevant attributes are cross-checked per element against AAPT2’s compiled-value XML tree, so conflicting raw XML attribute text cannot conceal an unsafe compiled value. Missing resources, resource aliases and unfamiliar dump formats fail closed. Never bypass the gate to accommodate a new SDK format: update the parser with representative fixtures and rerun tests.

`apk-security-report.json` accompanies a passing APK. It records the verified source commit supplied by the workflow, SHA-256 and size of the final APK, actual matching package/version, signing certificate, policy hash, decoded-manifest/resource hashes, checked exports and limitations. This binds build evidence; it is not independently signed provenance. Failed runs replace any stale passing report and never upload the APK.

## Backup behavior

`withAndroidArtifactSecurity` writes the rules consumed by prebuild and sets `allowBackup=false`. It also supplies the explicit release network policy; the already-approved local/simulator HTTP opt-in remains unchanged and cannot pass this release gate. Shared preferences (including SecureStore), databases (including AsyncStorage), files, app roots, external app files and device-protected equivalents are excluded from cloud backup and device transfer. This intentionally prevents OS restore of local settings, offline drafts/records and login credentials onto a new/reinstalled device. Server-synced records can be fetched after login. It does not erase existing app data or alter ordinary same-package, same-signature upgrade retention. Some OEMs disregard `allowBackup=false` for device transfer, which is why XML exclusions are required as well.

## Verification and release checklist

Run `pnpm test:release` (also included in `pnpm test:all`). The Node wrapper runs the Python fixture suite on Linux and Windows, checks the plugin's actual policy/copy functions, and guards release-step ordering. To run just the artifact fixtures: `python3 -m unittest discover -s scripts -p 'test_apk_security.py' -v`.

The fixtures are synthetic ZIP APKs with Android SDK-style decoded output supplied at the tool boundary. They exercise the production ZIP scanner, manifest/resource parsers, policy evaluation, identity/signature-output checks, fail-closed behavior and report generation. They do **not** prove that a newly built APK or a particular installed SDK has passed. This PR does not build an app, create keys, reserve build numbers/tags, publish an APK or deploy a manifest.

Before distributing the next authorized preview/candidate:

1. Confirm the final signed APK passes this gate with the actual installed Android SDK. Retain its JSON report, build identity and checksums. If an additional legitimate export appears, review its permission/filter/resource surface before editing the allowlist.
2. On ordinary, non-rooted Android devices, verify HTTPS/TLS failures and cleartext rejection across the real network stacks; platform manifest policy is best-effort and does not prove arbitrary native socket behavior.
3. Check cloud backup/restore and device-to-device transfer on representative Android versions/OEMs: credentials and local health data must not reappear. Confirm the intended lost-local-state/relogin behavior.
4. Complete same-signature upgrade/install and data-retention checks from #107/#219. Keep those issues open until their device acceptance requirements are met.

For a manual release, run the same gate on the final signed APK with explicit `--apk`, `--report`, `--source-sha`, `--application-id`, `--version-code`, `--version-name`, `--certificate-sha256` and SDK tool paths. Use the trusted channel certificate, never a digest learned only from the candidate itself. Run it **before uploading the APK**; the existing server manifest publication tool's hosted-download validation does not substitute for this gate.

References: [APK Analyzer](https://developer.android.com/tools/apkanalyzer), [AAPT2](https://developer.android.com/tools/aapt2), [network security configuration](https://developer.android.com/privacy-and-security/security-config), [Android Auto Backup](https://developer.android.com/identity/data/autobackup), [application manifest flags](https://developer.android.com/guide/topics/manifest/application-element).
