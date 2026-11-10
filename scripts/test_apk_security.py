"""Synthetic APK fixtures run the production gate; no build, key or SDK download."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import warnings
import xml.etree.ElementTree as ET
import zipfile

SCRIPT = Path(__file__).with_name('check-apk-security.py')
spec = importlib.util.spec_from_file_location('apk_security', SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
FIXTURES = Path(__file__).with_name('fixtures') / 'apk-security'
CERT = 'ab' * 32
# Independent expected IDs, not values learned from the APK being inspected.
FRAMEWORK_ATTRIBUTE_IDS = {
    'versionCode': '0x0101021b', 'versionName': '0x0101021c',
    'minSdkVersion': '0x0101020c', 'targetSdkVersion': '0x01010270',
    'debuggable': '0x0101000f', 'testOnly': '0x01010272',
    'usesCleartextTraffic': '0x010104ec', 'networkSecurityConfig': '0x01010527',
    'allowBackup': '0x01010280', 'backupAgent': '0x0101027f',
    'fullBackupContent': '0x010104eb', 'dataExtractionRules': '0x0101063e',
    'name': '0x01010003', 'exported': '0x01010010', 'permission': '0x01010006',
    'authorities': '0x01010018', 'scheme': '0x01010027', 'resource': '0x01010025',
    'value': '0x01010024', 'protectionLevel': '0x01010009',
}
# Exact receiver from the already-integrated firebase-messaging 24.0.1 manifest.
# Keep independent literal expectations rather than importing policy constants.
FIREBASE_RECEIVER_XML = '''<receiver
    android:name="com.google.firebase.iid.FirebaseInstanceIdReceiver"
    android:exported="true"
    android:permission="com.google.android.c2dm.permission.SEND">
  <intent-filter><action android:name="com.google.android.c2dm.intent.RECEIVE"/></intent-filter>
  <meta-data android:name="com.google.android.gms.cloudmessaging.FINISHED_AFTER_HANDLED" android:value="true"/>
</receiver>'''


class AndroidNetworkPolicySourceTest(unittest.TestCase):
    def test_localhost_domain_declares_exact_match_for_android_release_lint(self):
        policy = ET.parse(gate.ROOT / 'client/plugins/android-security/ddd_network_security_config.xml').getroot()
        domains = policy.findall('.//domain')
        self.assertEqual(len(domains), 1)
        self.assertEqual((domains[0].text or '').strip(), 'localhost')
        self.assertEqual(domains[0].attrib, {'includeSubdomains': 'false'})
        self.assertEqual(policy.find('base-config').get('cleartextTrafficPermitted'), 'false')
        self.assertEqual(policy.find('domain-config').get('cleartextTrafficPermitted'), 'false')


class ApkSecurityTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.apk = Path(self.directory.name) / 'final-signed.apk'
        self.manifest = (FIXTURES / 'AndroidManifest.xml').read_text()
        self.table = (FIXTURES / 'resources.txt').read_text()
        rules = gate.ROOT / 'client/plugins/android-security'
        self.resources = {
            'res/xml/ddd_backup_rules.xml': (rules / 'ddd_backup_rules.xml').read_text(),
            'res/xml/ddd_data_extraction_rules.xml': (rules / 'ddd_data_extraction_rules.xml').read_text(),
            'res/xml/network_security_config.xml': (rules / 'ddd_network_security_config.xml').read_text(),
            'res/xml-v28/network_security_config.xml': (rules / 'ddd_network_security_config.xml').read_text(),
            'res/xml/clipboard_provider_paths.xml': '<paths><cache-path name="clipboard_files" path=".clipboard/"/></paths>',
        }
        self.assets = {'assets/index.android.bundle': b'public app configuration',
                       'assets/expo-updates.pem': b'-----BEGIN CERTIFICATE-----\n' + b'A' * 96 + b'\n-----END CERTIFICATE-----',
                       'assets/app.config.json': b'{"EXPO_PUBLIC_BACKEND_BASE_URL":"https://example.org"}',
                       'classes.dex': b'crypto code: -----BEGIN PRIVATE KEY----- (no key material)'}
        self.signature = f'Verifies\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: {CERT}\n'
        self.args = SimpleNamespace(apk=str(self.apk), source_sha='12' * 20, application_id='com.dietdigidose.app.preview',
                                    version_code='264101', version_name='1.0.6', certificate_sha256=CERT,
                                    apkanalyzer='apkanalyzer', aapt2='aapt2', apksigner='apksigner')
        self.calls = []
        self.typed_overrides = {}

    def build_fixture(self):
        with zipfile.ZipFile(self.apk, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('AndroidManifest.xml', self.manifest)
            archive.writestr('resources.arsc', self.table)
            for name, content in (self.resources | self.assets).items():
                archive.writestr(name, content)

    def runner(self, command):
        self.calls.append(command)
        self.assertEqual(command[-1], str(self.apk), 'Inspect the final APK, never generated source XML')
        if command[0] == 'apksigner':
            self.assertEqual(command[1:-1], ['verify', '--verbose', '--print-certs'])
            return self.signature
        if command[:3] == ['aapt2', 'dump', 'resources']:
            return self.table
        if command[:4] == ['aapt2', 'dump', 'xmltree', '--file']:
            path = command[4]
            if path in self.typed_overrides:
                return self.typed_overrides[path]
            text = self.manifest if path == 'AndroidManifest.xml' else self.resources[path]
            return self.typed_dump(text)
        if command[1:3] == ['manifest', 'print']:
            return self.manifest
        self.assertEqual(command[:4], ['apkanalyzer', 'resources', 'xml', '--file'])
        return self.resources[command[4].lstrip('/')]

    def typed_dump(self, text):
        root, lines = ET.fromstring(text), []
        # AAPT2 namespace scopes add two spaces; element content adds four.
        namespaced = any(name.startswith(gate.ANDROID) for node in root.iter() for name in node.attrib)
        if namespaced:
            lines.append('N: android=http://schemas.android.com/apk/res/android (line=1)')

        def emit(element, indent):
            prefix = ' ' * indent
            lines.append(f'{prefix}E: {element.tag} (line=1)')
            def order(item):
                name = item[0]
                identifier = FRAMEWORK_ATTRIBUTE_IDS.get(name.removeprefix(gate.ANDROID)) if name.startswith(gate.ANDROID) else None
                # Actual AAPT2 emits ID-bearing attributes first, sorted by ID,
                # followed by the contiguous no-resource-ID attribute group.
                return (identifier is None, int(identifier or '0', 16))

            for name, value in sorted(element.attrib.items(), key=order):
                identifier = FRAMEWORK_ATTRIBUTE_IDS.get(name.removeprefix(gate.ANDROID)) if name.startswith(gate.ANDROID) else None
                name = name.replace(gate.ANDROID, 'http://schemas.android.com/apk/res/android:')
                if identifier is not None:
                    name += '(' + identifier + ')'
                typed = value.replace('@ref/', '@')
                if typed not in ('true', 'false') and not typed.startswith('@') and not typed.isdecimal():
                    typed = '"' + typed + '"'
                lines.append(f'{prefix}  A: {name}={typed} (Raw: "{value}")')
            if (element.text or '').strip():
                value = re.sub(r'\s+', ' ', element.text)
                lines.append(f"{prefix}    T: '{value}'")
            for child in element:
                emit(child, indent + 4)
                if (child.tail or '').strip():
                    value = re.sub(r'\s+', ' ', child.tail)
                    lines.append(f"{prefix}    T: '{value}'")

        emit(root, 2 if namespaced else 0)
        return '\n'.join(lines)

    def inspect(self):
        self.build_fixture()
        return gate.inspect_apk(self.args, self.runner)

    def rejects(self, message):
        with self.assertRaisesRegex(gate.GateError, message):
            self.inspect()

    def test_safe_final_apk_report_binds_identity_and_every_variant(self):
        report = self.inspect()
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(report['sourceCommit'], self.args.source_sha)
        self.assertEqual(report['apkSha256'], gate.digest(self.apk))
        self.assertEqual(report['applicationId'], self.args.application_id)
        self.assertEqual(report['versionCode'], self.args.version_code)
        self.assertEqual(report['signerCertificateSha256'], CERT)
        self.assertEqual(set(report['decodedResourcesSha256']), set(self.resources))
        self.assertEqual(set(report['compiledXmlSha256']), set(self.resources) | {'AndroidManifest.xml'})
        for path, digest in report['compiledXmlSha256'].items():
            source = self.manifest if path == 'AndroidManifest.xml' else self.resources[path]
            self.assertEqual(digest, gate.hashlib.sha256(self.typed_dump(source).encode()).hexdigest())
        self.assertEqual(len(report['exportedComponents']), 3)

    def test_cli_success_writes_bound_report_and_rejection_replaces_it(self):
        self.build_fixture()
        report = Path(self.directory.name) / 'report.json'
        arguments = ['--report', str(report)]
        for name, value in vars(self.args).items():
            arguments += ['--' + name.replace('_', '-'), str(value)]
        production_inspect = gate.inspect_apk
        with patch.object(gate, 'inspect_apk', side_effect=lambda args: production_inspect(args, self.runner)):
            self.assertEqual(gate.main(arguments), 0)
            self.assertEqual(json.loads(report.read_text())['apkSha256'], gate.digest(self.apk))
            self.manifest = self.manifest.replace('<application ', '<application android:debuggable="true" ')
            self.build_fixture()
            self.assertEqual(gate.main(arguments), 1)
            self.assertEqual(json.loads(report.read_text())['status'], 'failed')

    def test_malformed_or_unresolved_manifest_fails_closed(self):
        original = self.manifest
        for manifest in ['<manifest', original.replace('android:minSdkVersion="24"', 'android:minSdkVersion="@integer/min"'),
                         original.replace('<manifest ', '<!DOCTYPE manifest [<!ENTITY e "bad">]><manifest ')]:
            with self.subTest(manifest=manifest[:40]):
                self.manifest = manifest
                self.rejects('XML|SDK')

    def test_multiple_signers_or_missing_signature_evidence_fail(self):
        for signature in ['', self.signature + f'Signer #2 certificate SHA-256 digest: {CERT}\n']:
            with self.subTest(signature=signature):
                self.signature = signature
                self.rejects('signer')

    def test_current_apksigner_v2_output_preserves_trusted_identity(self):
        # Current Android SDK output observed in preview build #130.
        self.signature = ('Verifies\n'
                          'Verified using v1 scheme (JAR signing): false\n'
                          'Verified using v2 scheme (APK Signature Scheme v2): true\n'
                          'Verified using v3 scheme (APK Signature Scheme v3): false\n'
                          'Verified using v3.1 scheme (APK Signature Scheme v3.1): false\n'
                          'Verified using v3.2 scheme (APK Signature Scheme v3.2): false\n'
                          'Verified using v4 scheme (APK Signature Scheme v4): false\n'
                          'Verified for SourceStamp: false\n'
                          'Number of signers: 1\n'
                          'V2 Signer: certificate DN: CN=DietDigiDose HTTPS Preview\n'
                          f'V2 Signer: certificate SHA-256 digest: {CERT.upper()}\n')
        self.assertEqual(self.inspect()['signerCertificateSha256'], CERT)

    def test_signature_requires_unambiguous_success_and_single_signer_count(self):
        original = self.signature
        cases = [original.replace('Verifies\n', ''), original.replace('Verifies', 'DOES NOT VERIFY'),
                 original.replace('Number of signers: 1\n', ''),
                 original.replace('Number of signers: 1', 'Number of signers: 2'),
                 original + 'Number of signers: 1\n', original + 'Number of signers: unknown\n',
                 original + 'Verifies\n']
        for signature in cases:
            with self.subTest(signature=signature):
                self.signature = signature
                self.rejects('signer')

    def test_current_signer_wrong_malformed_or_mixed_evidence_fails_closed(self):
        prefix = ('Verifies\n'
                  'Verified using v2 scheme (APK Signature Scheme v2): true\n'
                  'Number of signers: 1\n')
        trusted = f'V2 Signer: certificate SHA-256 digest: {CERT}\n'
        stamp = f'Source Stamp Signer: certificate SHA-256 digest: {CERT}\n'
        cases = [trusted.replace(CERT, 'cd' * 32), trusted.replace(CERT, 'g' * 64), trusted.replace(CERT, CERT[:-1]),
                 trusted + trusted, trusted + f'Signer #1 certificate SHA-256 digest: {CERT}\n',
                 trusted.replace('V2 Signer:', 'Unknown Signer:'),
                 trusted + f'Unknown Signer: certificate SHA-256 digest: {CERT}\n',
                 trusted.replace('V2 Signer:', 'V2 Signer #1:') + trusted.replace('V2 Signer:', 'V2 Signer #2:'),
                 trusted.replace('V2 Signer:', 'V3.1 Signer: (minSdkVersion=33, maxSdkVersion=35)'),
                 stamp, trusted + stamp, trusted.replace(CERT, 'cd' * 32) + stamp]
        for evidence in cases:
            with self.subTest(evidence=evidence):
                self.signature = prefix + evidence
                self.rejects('signer')

    def test_current_signer_requires_verified_v2_scheme(self):
        verified = 'Verified using v2 scheme (APK Signature Scheme v2): true\n'
        for scheme in ['', 'Verified using v2 scheme (APK Signature Scheme v2): false\n',
                       verified + 'Verified using v2 scheme (APK Signature Scheme v2): false\n', verified * 2,
                       'Verified using v3 scheme (APK Signature Scheme v3): true\n']:
            with self.subTest(scheme=scheme):
                self.signature = f'Verifies\n{scheme}Number of signers: 1\nV2 Signer: certificate SHA-256 digest: {CERT}\n'
                self.rejects('signer')

    def test_candidate_package_and_relative_main_activity(self):
        self.manifest = self.manifest.replace('.app.preview', '.app').replace('com.dietdigidose.app.MainActivity', '.MainActivity')
        self.args.application_id = 'com.dietdigidose.app'
        self.assertEqual(self.inspect()['status'], 'passed')

    def test_named_references_and_resource_path_shortening(self):
        self.manifest = self.manifest.replace('@ref/0x7f120001', '@xml/ddd_backup_rules')
        self.table = self.table.replace('res/xml/ddd_backup_rules.xml', 'res/a.xml')
        self.resources['res/a.xml'] = self.resources.pop('res/xml/ddd_backup_rules.xml')
        self.assertEqual(self.inspect()['status'], 'passed')

    def test_missing_network_config_cannot_rely_on_runtime_defaults(self):
        self.manifest = self.manifest.replace(' android:networkSecurityConfig="@ref/0x7f120003"', '')
        self.rejects('Explicit network security config')

    def test_compiled_manifest_boolean_cannot_disagree_with_decoded_raw_value(self):
        self.manifest = self.manifest.replace('<application ', '<application android:debuggable="false" ')
        dump = self.typed_dump(self.manifest)
        self.typed_overrides['AndroidManifest.xml'] = dump.replace('debuggable(0x0101000f)=false (Raw: "false")', 'debuggable(0x0101000f)=true (Raw: "false")')
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_compiled_export_name_cannot_disagree_with_allowlisted_raw_name(self):
        dump = self.typed_dump(self.manifest)
        self.typed_overrides['AndroidManifest.xml'] = dump.replace('name(0x01010003)="com.dietdigidose.app.preview.MainActivity" (Raw:', 'name(0x01010003)="com.dietdigidose.app.preview.UnreviewedActivity" (Raw:', 1)
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_every_checked_manifest_framework_attribute_requires_its_expected_id(self):
        for name, identifier in FRAMEWORK_ATTRIBUTE_IDS.items():
            source = f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:{name}="safe"/>'
            dump = self.typed_dump(source)
            gate.check_typed_xml(ET.fromstring(source), dump, {})
            for replacement in ['', '(0x0101ffff)', '(0x00000000)']:
                with self.subTest(name=name, replacement=replacement):
                    bad = dump.replace('(' + identifier + ')', replacement)
                    with self.assertRaisesRegex(gate.GateError, 'Android attribute resource ID mismatch'):
                        gate.check_typed_xml(ET.fromstring(source), bad, {})

    def test_framework_id_cannot_be_aliased_by_another_manifest_attribute_name(self):
        for name, identifier in FRAMEWORK_ATTRIBUTE_IDS.items():
            for alias in ['android:label', 'label']:
                with self.subTest(name=name, alias=alias):
                    source = f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" {alias}="safe"/>'
                    dump = self.typed_dump(source).replace('label=', 'label(' + identifier + ')=')
                    with self.assertRaisesRegex(gate.GateError, 'Android attribute resource ID mismatch'):
                        gate.check_typed_xml(ET.fromstring(source), dump, {})

    def test_duplicate_nonzero_manifest_attribute_resource_ids_fail_closed(self):
        for attributes, identifier in [
                ('android:name="safe" android:label="unsafe"', '0x01010003'),
                ('android:description="safe" android:label="unsafe"', '0x01010001')]:
            with self.subTest(attributes=attributes):
                source = f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" {attributes}/>'
                dump = self.typed_dump(source).replace('label=', 'label(' + identifier + ')=')
                if 'description=' in dump:
                    dump = dump.replace('description=', 'description(' + identifier + ')=')
                with self.assertRaisesRegex(gate.GateError, 'Duplicate compiled XML attribute resource ID'):
                    gate.check_typed_xml(ET.fromstring(source), dump, {})

    def manifest_dump_with_attribute_ids(self, identifiers):
        root, lines = ET.Element('manifest'), ['E: manifest (line=1)']
        for index, identifier in enumerate(identifiers):
            name = 'attr' + str(index)
            root.set(name, 'safe')
            suffix = '' if identifier is None else f'(0x{identifier:08x})'
            lines.append(f'  A: {name}{suffix}="safe"')
        return root, '\n'.join(lines)

    def test_manifest_attribute_order_allows_remapped_package_order_and_contiguous_zero_ids(self):
        for identifiers in [
                [0x02010001, 0x02010002, 0x0101ff01, 0x0101ff02, 0x7f010001, None, 0],
                [0x7f010001, 0x0101ff01, 0x02010001, 0x02010002, 0, None],
                [None, 0, 0x02010001, 0x0101ff01]]:
            with self.subTest(identifiers=identifiers):
                root, dump = self.manifest_dump_with_attribute_ids(identifiers)
                gate.check_typed_xml(root, dump, {})

    def test_manifest_attribute_order_rejects_interleaved_package_or_zero_groups(self):
        for identifiers in [
                [0x02010001, 0x0101ff01, 0x02010002],
                [0x0101ff01, None, 0x0101ff02],
                [None, 0x0101ff01, 0],
                [0, 0x7f010001, None],
                [0x7f010001, 0x02010001, 0x7f010002]]:
            with self.subTest(identifiers=identifiers):
                root, dump = self.manifest_dump_with_attribute_ids(identifiers)
                with self.assertRaisesRegex(gate.GateError, 'package groups must be contiguous'):
                    gate.check_typed_xml(root, dump, {})

    def test_manifest_attribute_order_rejects_descending_ids_within_each_package(self):
        for identifiers in [[0x0101ff02, 0x0101ff01], [0x7f010002, 0x7f010001],
                            [0x02010002, 0x02010001], [0x02010001, 0x0101ff02, 0x0101ff01]]:
            with self.subTest(identifiers=identifiers):
                root, dump = self.manifest_dump_with_attribute_ids(identifiers)
                with self.assertRaisesRegex(gate.GateError, 'IDs must increase within each package group'):
                    gate.check_typed_xml(root, dump, {})

    def test_compiled_xml_unknown_format_or_omitted_elements_fail_closed(self):
        for dump in ['future unsupported format', 'E: manifest (line=1)']:
            with self.subTest(dump=dump):
                self.typed_overrides['AndroidManifest.xml'] = dump
                self.rejects('compiled XML|element count')

    def test_compiled_resource_reference_cannot_point_to_different_policy(self):
        dump = self.typed_dump(self.manifest)
        self.typed_overrides['AndroidManifest.xml'] = dump.replace('networkSecurityConfig(0x01010527)=@0x7f120003', 'networkSecurityConfig(0x01010527)=@0x7f120002')
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_compiled_backup_path_cannot_disagree_with_decoded_raw_value(self):
        path = 'res/xml/ddd_backup_rules.xml'
        self.typed_overrides[path] = self.typed_dump(self.resources[path]).replace('path="." (Raw: ".")', 'path="unrelated" (Raw: ".")', 1)
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_forged_raw_suffix_inside_compiled_value_is_rejected(self):
        path = 'res/xml/clipboard_provider_paths.xml'
        self.typed_overrides[path] = self.typed_dump(self.resources[path]).replace('path=".clipboard/" (Raw: ".clipboard/")', 'path=".clipboard/" (Raw: "x/../../../secret" (Raw: ".clipboard/")')
        self.rejects('Ambiguous compiled security attribute')

    def test_compiled_network_policy_cannot_disagree_with_raw_value(self):
        path = 'res/xml/network_security_config.xml'
        self.typed_overrides[path] = self.typed_dump(self.resources[path]).replace('cleartextTrafficPermitted=false (Raw: "false")', 'cleartextTrafficPermitted=true (Raw: "false")')
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_replay_captured_cli16_buildtools37_output_runs_the_full_gate(self):
        # This replays real SDK output, not SDK execution or a signed release APK.
        fixture = json.loads((FIXTURES / 'tool-output-cmdline16-buildtools37.json').read_text())
        self.signature, self.table = fixture['signature'], fixture['resourceTable']
        self.manifest = fixture['xml']['AndroidManifest.xml']['decoded']
        self.resources = {path: record['decoded'] for path, record in fixture['xml'].items()
                          if path != 'AndroidManifest.xml'}
        self.typed_overrides = {path: record['compiled'] for path, record in fixture['xml'].items()}
        # Fixed trust pin for this disposable fixture, never derived from a candidate APK.
        self.args.certificate_sha256 = '00a12d93573328ab5c266d38db30585c9e7d91fa02811235b7389f13d851a16a'
        report = self.inspect()
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(len(report['exportedComponents']), 4)
        self.assertIn('com.google.firebase.iid.FirebaseInstanceIdReceiver',
                      [item['name'] for item in report['exportedComponents']])
        self.assertEqual(len(report['compiledXmlSha256']), 6)
        self.assertEqual(set(report['decodedResourcesSha256']), set(self.resources))
        for path, dump in self.typed_overrides.items():
            self.assertEqual(report['compiledXmlSha256'][path], gate.hashlib.sha256(dump.encode()).hexdigest())
        self.assertIn('res/xml/ddd_network_security_config.xml', report['decodedResourcesSha256'])
        self.assertIn('res/xml-v28/ddd_network_security_config.xml', report['decodedResourcesSha256'])

    def test_observed_cli16_text_omission_uses_only_compiled_apk_text(self):
        # Verbatim AAPT2 37 network XML dump from a genuinely compiled APK.
        dump = ("E: network-security-config (line=2)\n"
                "    E: base-config (line=3)\n"
                "      A: cleartextTrafficPermitted=false\n"
                "    E: domain-config (line=5)\n"
                "      A: cleartextTrafficPermitted=false\n"
                "        E: domain (line=6)\n"
                "          A: includeSubdomains=false\n"
                "            T: 'localhost'\n")
        for path in ('res/xml/network_security_config.xml', 'res/xml-v28/network_security_config.xml'):
            self.resources[path] = self.resources[path].replace('>localhost</domain>', ' />')
            self.typed_overrides[path] = dump
        report = self.inspect()
        self.assertEqual(report['status'], 'passed')
        for path in self.typed_overrides:
            self.assertEqual(report['compiledXmlSha256'][path], gate.hashlib.sha256(dump.encode()).hexdigest())
            self.assertEqual(report['decodedResourcesSha256'][path],
                             gate.hashlib.sha256(self.resources[path].encode()).hexdigest())

    def test_domain_text_missing_from_compiled_tree_cannot_use_decoded_or_source_text(self):
        path = 'res/xml/network_security_config.xml'
        source = self.resources[path]
        self.typed_overrides[path] = self.typed_dump(source).replace("            T: 'localhost'", '')
        for decoded in (source, source.replace('>localhost</domain>', ' />')):
            with self.subTest(decoded_text='localhost' in decoded):
                self.resources[path] = decoded
                self.rejects('domain text is missing')

    def test_each_qualified_variant_requires_its_own_compiled_localhost_text(self):
        for path in ('res/xml/network_security_config.xml', 'res/xml-v28/network_security_config.xml'):
            with self.subTest(path=path):
                source = self.resources[path]
                self.resources[path] = source.replace('>localhost</domain>', ' />')
                self.typed_overrides[path] = self.typed_dump(source).replace("T: 'localhost'", "T: 'example.org'")
                self.rejects('Explicit localhost policy')
                self.resources[path] = source
                self.typed_overrides.clear()

    def test_nonempty_decoded_domain_text_must_match_compiled_text(self):
        path = 'res/xml/network_security_config.xml'
        source = self.resources[path]
        for decoded, compiled in (('example.org', 'localhost'), ('localhost', 'example.org')):
            with self.subTest(decoded=decoded, compiled=compiled):
                self.resources[path] = source.replace('>localhost</domain>', f'>{decoded}</domain>')
                self.typed_overrides[path] = self.typed_dump(source).replace("T: 'localhost'", f"T: '{compiled}'")
                self.rejects('Compiled/decoded network domain text mismatch')

    def test_network_domain_ascii_spaces_match_android_trim_behavior(self):
        path = 'res/xml/network_security_config.xml'
        self.resources[path] = self.resources[path].replace('>localhost</domain>', '>  localhost  </domain>')
        self.assertEqual(self.inspect()['status'], 'passed')

    def test_network_domain_nbsp_cannot_masquerade_as_localhost(self):
        path = 'res/xml/network_security_config.xml'
        source = self.resources[path]
        dump = self.typed_dump(source)
        for value in ['\u00a0localhost', 'localhost\u00a0']:
            for decoded in [value, '']:
                with self.subTest(value=value, decoded=decoded):
                    self.resources[path] = source.replace('>localhost</domain>', f'>{decoded}</domain>')
                    self.typed_overrides[path] = dump.replace("T: 'localhost'", f"T: '{value}'")
                    self.rejects('Explicit localhost policy')

    def test_network_domain_nbsp_is_not_erased_during_raw_compiled_comparison(self):
        path = 'res/xml/network_security_config.xml'
        source = self.resources[path]
        dump = self.typed_dump(source)
        for value in ['\u00a0localhost', 'localhost\u00a0']:
            for decoded, compiled in [(value, 'localhost'), ('localhost', value)]:
                with self.subTest(decoded=decoded, compiled=compiled):
                    self.resources[path] = source.replace('>localhost</domain>', f'>{decoded}</domain>')
                    self.typed_overrides[path] = dump.replace("T: 'localhost'", f"T: '{compiled}'")
                    self.rejects('Compiled/decoded network domain text mismatch')

    def test_ambiguous_malformed_or_empty_domain_text_fails_closed(self):
        path = 'res/xml/network_security_config.xml'
        dump = self.typed_dump(self.resources[path])
        self.resources[path] = self.resources[path].replace('>localhost</domain>', ' />')
        for text in ('localhost', '"localhost"', "'localhost", "'localhost' trailing", "'local'host'",
                     "'localhost' (Raw: 'localhost')", "'localhost\\'", "'local\"host'", "'localhost\t'",
                     "''", "'   '", "'local\nhost'"):
            with self.subTest(text=text):
                self.typed_overrides[path] = dump.replace("T: 'localhost'", 'T: ' + text)
                self.rejects('ambiguous compiled XML|Ambiguous compiled network|domain text is missing')

    def test_domain_text_cannot_be_misplaced_or_borrowed_from_ancestor(self):
        path = 'res/xml/network_security_config.xml'
        dump = self.typed_dump(self.resources[path])
        text = "            T: 'localhost'"
        for spaces in (0, 4, 8, 10, 14, 16):
            with self.subTest(spaces=spaces):
                self.typed_overrides[path] = dump.replace(text, ' ' * spaces + "T: 'localhost'")
                self.rejects('domain text is missing|compiled XML indentation|Misplaced compiled XML text|network text outside domain')
        self.typed_overrides[path] = dump.replace(text, '').replace(
            '    E: base-config', "    T: 'localhost'\n    E: base-config")
        self.rejects('network text outside domain')

    def test_duplicate_domain_text_records_fail_even_when_identical(self):
        path = 'res/xml/network_security_config.xml'
        dump = self.typed_dump(self.resources[path])
        for extra in ('localhost', '', 'example.org'):
            with self.subTest(extra=extra):
                self.typed_overrides[path] = dump + f"\n            T: '{extra}'"
                self.rejects('domain text is missing or duplicated')

    def test_domain_text_is_bound_to_its_own_sibling(self):
        path = 'res/xml/network_security_config.xml'
        source = self.resources[path].replace('</domain-config>', '<domain>example.org</domain></domain-config>')
        self.resources[path] = source.replace('>localhost</domain>', ' />')
        dump = self.typed_dump(source)
        self.typed_overrides[path] = dump.replace("            T: 'localhost'\n", '').replace(
            "T: 'example.org'", "T: 'localhost'")
        self.rejects('domain text is missing')
        self.resources[path] = source
        self.typed_overrides[path] = dump.replace("T: 'localhost'", "T: 'replacement'").replace(
            "T: 'example.org'", "T: 'localhost'")
        self.rejects('network domain text mismatch')

    def test_same_element_order_with_different_compiled_hierarchy_fails(self):
        path = 'res/xml/network_security_config.xml'
        self.typed_overrides[path] = self.typed_dump(self.resources[path]).replace(
            '        E: domain ', '    E: domain ').replace(
            '          A: includeSubdomains', '      A: includeSubdomains').replace(
            '            T:', '        T:')
        self.rejects('Compiled/decoded XML hierarchy differs')

    def test_nested_elements_inside_domain_are_not_supported(self):
        path = 'res/xml/network_security_config.xml'
        source = self.resources[path]
        for content in ('<nested>localhost</nested>', 'localhost<nested/>', '<domain>localhost</domain>'):
            with self.subTest(content=content):
                self.resources[path] = source.replace('>localhost</domain>', f'>{content}</domain>')
                self.rejects('Unsupported nested network domain structure')

    def test_include_subdomains_is_cross_checked_against_compiled_value(self):
        path = 'res/xml/network_security_config.xml'
        source = self.resources[path]
        dump = self.typed_dump(source)
        for value in ('true', '@0x7f990001'):
            with self.subTest(value=value):
                self.typed_overrides[path] = dump.replace('includeSubdomains=false', 'includeSubdomains=' + value)
                self.rejects('Compiled/decoded security attribute mismatch: includeSubdomains')
        self.typed_overrides[path] = '\n'.join(line for line in dump.splitlines() if 'includeSubdomains' not in line)
        self.rejects('security attribute is missing')
        self.typed_overrides[path] = dump
        self.resources[path] = source.replace(' includeSubdomains="false"', '')
        self.rejects('security attribute is missing')

    def test_unknown_or_misplaced_dump_structure_is_not_ignored(self):
        path = 'res/xml/network_security_config.xml'
        dump = self.typed_dump(self.resources[path])
        cases = [dump + '\n    X: ignored', dump + '\n    N: malformed',
                 dump + '\n    N: unused=urn:unused (line=1)',
                 dump.replace('    E: base-config', '\tE: base-config'),
                 dump.replace('      A: cleartextTrafficPermitted', '    A: cleartextTrafficPermitted'),
                 dump + '\n          A: includeSubdomains=false',
                 "T: 'localhost'\n" + dump]
        for malformed in cases:
            with self.subTest(dump=malformed):
                self.typed_overrides[path] = malformed
                self.rejects('compiled XML')

    def test_structurally_valid_text_in_other_xml_does_not_change_policy(self):
        root = ET.fromstring(self.manifest)
        root.text = 'Unrelated manifest text'
        self.manifest = ET.tostring(root, encoding='unicode')
        self.assertEqual(self.inspect()['status'], 'passed')

    def test_forged_outer_text_record_cannot_terminate_a_domain_string(self):
        path = 'res/xml/network_security_config.xml'
        dump = self.typed_dump(self.resources[path])
        self.resources[path] = self.resources[path].replace('>localhost</domain>', ' />')
        # Indistinguishable from an unescaped malicious domain string containing
        # a quote and newline. Never accept this ambiguous network dump.
        for text in ('ignored', '', ' '):
            with self.subTest(text=text):
                self.typed_overrides[path] = dump + f"\n    T: '{text}'"
                self.rejects('network text outside domain')

    def test_namespace_scopes_preserve_hierarchy_without_becoming_elements(self):
        path = 'res/xml/network_security_config.xml'
        dump = self.typed_dump(self.resources[path])
        self.typed_overrides[path] = ('N: unused=urn:unused (line=1)\n'
                                      + '\n'.join('  ' + line for line in dump.splitlines()))
        self.assertEqual(self.inspect()['status'], 'passed')

    def test_debuggable_testonly_and_unresolved_flags_fail(self):
        original = self.manifest
        for flag in ['debuggable="true"', 'testOnly="true"', 'debuggable="@bool/release_debug"']:
            with self.subTest(flag=flag):
                self.manifest = original.replace('<application ', '<application android:' + flag + ' ')
                self.rejects('debuggable|testOnly')

    def test_cleartext_manifest_missing_true_or_reference_fail(self):
        original = self.manifest
        for replacement in ['', 'android:usesCleartextTraffic="true"', 'android:usesCleartextTraffic="@bool/cleartext"']:
            with self.subTest(value=replacement):
                self.manifest = original.replace('android:usesCleartextTraffic="false"', replacement)
                self.rejects('Cleartext|usesCleartextTraffic')

    def test_override_in_qualified_network_resource_fails(self):
        self.resources['res/xml-v28/network_security_config.xml'] = '<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain>localhost</domain></domain-config></network-security-config>'
        self.rejects('permits cleartext')

    def test_nested_network_override_and_unresolved_boolean_fail(self):
        for value in ['true', '@bool/cleartext']:
            with self.subTest(value=value):
                self.resources['res/xml/network_security_config.xml'] = f'<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config><domain>localhost</domain><domain-config cleartextTrafficPermitted="{value}"/></domain-config></network-security-config>'
                self.rejects('cleartext')

    def test_modern_target_cannot_hide_older_runtime_cleartext_defaults(self):
        for config in ['<network-security-config/>', '<network-security-config><base-config/></network-security-config>']:
            with self.subTest(config=config):
                self.resources['res/xml/network_security_config.xml'] = config
                self.rejects('cleartext')

    def test_missing_localhost_policy_cannot_enable_newer_runtime_default(self):
        for invalid in ['', '<debug-overrides><domain>localhost</domain></debug-overrides>']:
            with self.subTest(invalid=invalid):
                self.resources['res/xml/network_security_config.xml'] = '<network-security-config><base-config cleartextTrafficPermitted="false"/>' + invalid + '</network-security-config>'
                self.rejects('Explicit localhost policy')

    def test_alternate_network_reference_is_checked(self):
        self.manifest = self.manifest.replace('@ref/0x7f120003', '@xml/another_network')
        self.table += '\n    resource 0x7f120005 xml/another_network\n      () (file) res/other.xml type=XML\n'
        self.resources['res/other.xml'] = '<network-security-config><base-config cleartextTrafficPermitted="true"/></network-security-config>'
        self.rejects('permits cleartext')

    def test_missing_resource_alias_and_unknown_decoder_output_fail_closed(self):
        original = self.table
        for replacement in ['() @xml/other', '() @0x7f120099', '() unreadable-format', '']:
            with self.subTest(value=replacement):
                self.table = original.replace('() (file) res/xml/ddd_backup_rules.xml type=XML', replacement)
                self.rejects('Unresolved|Unsupported')
        self.table = original
        self.resources.pop('res/xml/ddd_backup_rules.xml')
        self.rejects('absent')

    def test_allowbackup_false_does_not_bypass_missing_rules(self):
        for attribute in ['fullBackupContent', 'dataExtractionRules']:
            with self.subTest(attribute=attribute):
                saved = self.manifest
                import re
                self.manifest = re.sub(r' android:' + attribute + '="[^"]*"', '', saved)
                self.rejects('reference is missing')
                self.manifest = saved

    def test_each_sensitive_domain_required_for_both_transports(self):
        key = 'res/xml/ddd_data_extraction_rules.xml'
        original = self.resources[key]
        for domain in sorted(gate.DOMAINS):
            for occurrence in [0, 1]:
                with self.subTest(domain=domain, occurrence=occurrence):
                    needle = f'<exclude domain="{domain}" path="." />'
                    before, after = original.split(needle, 1)
                    self.resources[key] = (before + after if occurrence == 0 else before + needle + after.replace(needle, '', 1))
                    self.rejects('every sensitive storage domain')
        self.resources[key] = original

    def test_legacy_and_alternate_backup_rules_fail(self):
        self.resources['res/xml/ddd_backup_rules.xml'] = '<full-backup-content><exclude domain="sharedpref" path="SecureStore"/></full-backup-content>'
        self.rejects('every sensitive storage domain')
        self.setUp()
        self.manifest = self.manifest.replace('@ref/0x7f120002', '@xml/another_backup')
        self.table += '\n    resource 0x7f120005 xml/another_backup\n      () (file) res/other.xml type=XML\n'
        self.resources['res/other.xml'] = '<data-extraction-rules><cloud-backup/></data-extraction-rules>'
        self.rejects('Both cloud-backup')

    def test_qualified_backup_variant_cannot_reenable_transfer(self):
        self.table = self.table.replace('() (file) res/xml/ddd_data_extraction_rules.xml type=XML', '() (file) res/xml/ddd_data_extraction_rules.xml type=XML\n      (v31) (file) res/xml-v31/backup.xml type=XML')
        self.resources['res/xml-v31/backup.xml'] = '<data-extraction-rules><cloud-backup/><device-transfer/></data-extraction-rules>'
        self.rejects('every sensitive storage domain')

    def test_custom_backup_agent_and_enabled_backup_fail(self):
        original = self.manifest
        self.manifest = original.replace('<application ', '<application android:backupAgent=".CustomBackup" ')
        self.rejects('Custom backup')
        self.manifest = original.replace('android:allowBackup="false"', 'android:allowBackup="true"')
        self.rejects('Backup must be disabled')

    def test_unknown_exports_including_implicit_and_aliases_fail(self):
        original = self.manifest
        for component in [
            '<activity android:name=".Debug" android:exported="true"/>',
            '<activity-alias android:name=".Alias" android:targetActivity=".MainActivity" android:exported="true"/>',
            '<provider android:name=".Leak" android:exported="true"/>',
            '<service android:name=".Implicit"><intent-filter><action android:name="oops"/></intent-filter></service>',
            '<receiver android:name=".Receiver" android:exported="true" android:enabled="false"/>',
        ]:
            with self.subTest(component=component):
                self.manifest = original.replace('</application>', component + '</application>')
                self.rejects('Unapproved exported')

    def test_known_component_cannot_expand_deep_links_or_remove_launcher(self):
        original = self.manifest
        for before, after in [('android:scheme="dietdigidose"', 'android:scheme="https"'),
                              ('android.intent.action.VIEW', 'android.intent.action.SEND'),
                              ('android.intent.category.LAUNCHER', 'android.intent.category.DEFAULT')]:
            with self.subTest(after=after):
                self.manifest = original.replace(before, after)
                self.rejects('deep-link|launcher')

    def test_profile_receiver_must_retain_permission(self):
        self.manifest = self.manifest.replace(' android:permission="android.permission.DUMP"', '')
        self.rejects('DUMP permission')

    def test_exact_existing_firebase_receiver_is_reported_as_static_integration(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        report = self.inspect()
        self.assertEqual(len(report['exportedComponents']), 4)
        entry = next(item for item in report['exportedComponents']
                     if item['name'] == 'com.google.firebase.iid.FirebaseInstanceIdReceiver')
        self.assertEqual(entry['type'], 'receiver')
        self.assertIn('static manifest validation only', entry['reason'])

    def test_firebase_exception_cannot_allow_other_classes_or_component_types(self):
        original = self.manifest
        cases = [FIREBASE_RECEIVER_XML.replace('FirebaseInstanceIdReceiver', value)
                 for value in ['FirebaseInstanceIdReceiverExtra', 'AnotherReceiver', 'firebaseinstanceidreceiver']]
        cases += [FIREBASE_RECEIVER_XML.replace('com.google.firebase.iid.FirebaseInstanceIdReceiver', value)
                  for value in ['.FirebaseInstanceIdReceiver', 'FirebaseInstanceIdReceiver',
                                'com.google.firebase.messaging.FirebaseMessagingService']]
        cases += [FIREBASE_RECEIVER_XML.replace('<receiver', '<' + tag).replace('</receiver>', '</' + tag + '>')
                  for tag in ['service', 'activity', 'activity-alias', 'provider']]
        for receiver in cases:
            with self.subTest(receiver=receiver):
                self.manifest = original.replace('</application>', receiver + '</application>')
                self.rejects('Unapproved exported')

    def test_firebase_requires_exact_explicit_receiver_attributes(self):
        original = self.manifest
        cases = [FIREBASE_RECEIVER_XML.replace('android:exported="true"', value)
                 for value in ['', 'android:exported="false"', 'android:exported="@bool/exported"']]
        cases += [FIREBASE_RECEIVER_XML.replace('android:permission="com.google.android.c2dm.permission.SEND"', value)
                  for value in ['', 'android:permission="android.permission.DUMP"',
                                'android:permission="com.google.android.c2dm.permission.RECEIVE"',
                                'android:permission="@string/send_permission"']]
        cases += [FIREBASE_RECEIVER_XML.replace('<receiver', '<receiver ' + attribute)
                  for attribute in ['android:enabled="false"', 'android:directBootAware="true"',
                                    'android:process=":remote"', 'android:visibleToInstantApps="true"',
                                    'android:isolatedProcess="true"', 'unknown="unexpected"']]
        for receiver in cases:
            with self.subTest(receiver=receiver):
                self.manifest = original.replace('</application>', receiver + '</application>')
                self.rejects('Firebase receiver attributes')

    def test_firebase_filter_cannot_gain_actions_categories_data_or_attributes(self):
        original = self.manifest
        approved = '<intent-filter><action android:name="com.google.android.c2dm.intent.RECEIVE"/></intent-filter>'
        cases = ['', approved * 2, '<intent-filter/>',
                 approved.replace('RECEIVE', 'REGISTRATION'),
                 approved.replace('<intent-filter>', '<intent-filter android:priority="1000">'),
                 approved.replace('<intent-filter>', '<intent-filter android:autoVerify="true">'),
                 approved.replace('/>', ' android:enabled="true"/>'),
                 approved.replace('/>', '><category android:name="other"/></action>')]
        cases += [approved.replace('</intent-filter>', extra + '</intent-filter>') for extra in [
            '<action android:name="com.google.android.c2dm.intent.RECEIVE"/>',
            '<action android:name="com.google.android.c2dm.intent.REGISTRATION"/>',
            '<category android:name="com.dietdigidose.app.preview"/>',
            '<data android:scheme="dietdigidose"/>', '<unknown/>', '<intent-filter/>']]
        for filtered in cases:
            with self.subTest(filtered=filtered):
                receiver = FIREBASE_RECEIVER_XML.replace(approved, filtered)
                self.manifest = original.replace('</application>', receiver + '</application>')
                self.rejects('Firebase receiver|intent-filter')

    def test_firebase_metadata_cannot_change_or_be_duplicated(self):
        original = self.manifest
        approved = ('<meta-data android:name="com.google.android.gms.cloudmessaging.FINISHED_AFTER_HANDLED" '
                    'android:value="true"/>')
        cases = ['', approved * 2, approved.replace('FINISHED_AFTER_HANDLED', 'OTHER'),
                 approved.replace('android:value="true"', 'android:value="false"'),
                 approved.replace('android:value="true"', 'android:value="@bool/handled"'),
                 approved.replace('android:value="true"', 'android:resource="@xml/ddd_backup_rules"'),
                 approved.replace(' android:value="true"', ''),
                 approved.replace('/>', ' android:resource="@xml/ddd_backup_rules"/>'),
                 approved.replace('/>', '><meta-data android:name="unexpected"/></meta-data>')]
        for metadata in cases:
            with self.subTest(metadata=metadata):
                receiver = FIREBASE_RECEIVER_XML.replace(approved, metadata)
                self.manifest = original.replace('</application>', receiver + '</application>')
                self.rejects('Firebase receiver')

    def test_firebase_receiver_rejects_extra_children_or_duplicate_components(self):
        original = self.manifest
        cases = [FIREBASE_RECEIVER_XML * 2]
        cases += [FIREBASE_RECEIVER_XML.replace('</receiver>', child + '</receiver>') for child in [
            '<unknown/>', '<receiver android:name=".Hidden" android:exported="true"/>',
            '<action android:name="com.google.android.c2dm.intent.RECEIVE"/>']]
        for receiver in cases:
            with self.subTest(receiver=receiver):
                self.manifest = original.replace('</application>', receiver + '</application>')
                self.rejects('Firebase receiver|Duplicate manifest component')

    def test_firebase_cannot_be_protected_by_app_local_send_permission(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        original = self.manifest
        for protection in ['', 'normal', 'dangerous', 'signature', 'signature|privileged']:
            with self.subTest(protection=protection):
                declaration = ('<permission android:name="com.google.android.c2dm.permission.SEND" '
                               f'android:protectionLevel="{protection}"/>')
                self.manifest = original.replace('</manifest>', declaration + '</manifest>')
                self.rejects('shadows Firebase SEND')

    def test_firebase_cannot_use_app_local_overlapping_permission_tree(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        original = self.manifest
        for name in ['com.google', 'com.google.android', 'com.google.android.c2dm',
                     'com.google.android.c2dm.permission', 'com.google.android.c2dm.permission.SEND']:
            with self.subTest(name=name):
                declaration = f'<permission-tree android:name="{name}"/>'
                self.manifest = original.replace('</manifest>', declaration + '</manifest>')
                self.rejects('shadows Firebase SEND')

    def test_firebase_rejects_ambiguous_permission_definition_names(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        original = self.manifest
        for tag in ['permission', 'permission-tree']:
            for name in ['', 'android:name="@string/permission_name"', 'android:name=" "']:
                with self.subTest(tag=tag, name=name):
                    self.manifest = original.replace('</manifest>', f'<{tag} {name}/></manifest>')
                    self.rejects('Unresolved manifest permission definition')

    def test_firebase_allows_uses_permission_and_unrelated_permission_definitions(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        declarations = ('<uses-permission android:name="com.google.android.c2dm.permission.SEND"/>'
                        '<permission android:name="com.dietdigidose.app.preview.INTERNAL" android:protectionLevel="signature"/>'
                        '<permission-tree android:name="com.google.android.c2dm.permissions"/>'
                        '<permission-tree android:name="com.google.android.c2dm.permission.SEND.extra"/>')
        self.manifest = self.manifest.replace('</manifest>', declarations + '</manifest>')
        self.assertEqual(self.inspect()['status'], 'passed')

    def test_firebase_compiled_metadata_value_cannot_disagree_with_raw(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        dump = self.typed_dump(self.manifest)
        for value in ['false', '@0x7f120001', '1', '"true" (Raw: "false"']:
            with self.subTest(value=value):
                self.typed_overrides['AndroidManifest.xml'] = dump.replace('value(0x01010024)=true (Raw:', f'value(0x01010024)={value} (Raw:')
                self.rejects('Compiled/decoded security attribute mismatch|Ambiguous compiled security attribute')

    def test_firebase_booleans_cannot_be_compiled_strings_with_matching_text(self):
        original = self.manifest
        for attribute in ['exported', 'value']:
            with self.subTest(attribute=attribute):
                self.manifest = original.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
                dump = self.typed_dump(self.manifest)
                # Use the final matching value so exported targets Firebase, not
                # a previously reviewed launcher/profile-installer component.
                name = attribute + '(' + FRAMEWORK_ATTRIBUTE_IDS[attribute] + ')'
                before, after = dump.rsplit(name + '=true (Raw:', 1)
                self.typed_overrides['AndroidManifest.xml'] = before + name + '="true" (Raw:' + after
                self.rejects('Firebase boolean attributes must use compiled booleans')

    def test_firebase_compiled_permission_definition_cannot_hide_behind_raw(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        self.manifest = self.manifest.replace('</manifest>', '<permission android:name="com.example.SAFE"/></manifest>')
        self.typed_overrides['AndroidManifest.xml'] = self.typed_dump(self.manifest).replace(
            'name(0x01010003)="com.example.SAFE" (Raw:', 'name(0x01010003)="com.google.android.c2dm.permission.SEND" (Raw:')
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_firebase_compiled_security_attributes_require_framework_ids(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        dump = self.typed_dump(self.manifest)
        for name in ['name', 'exported', 'permission', 'value']:
            identifier = FRAMEWORK_ATTRIBUTE_IDS[name]
            for replacement in ['', '(0x0101ffff)']:
                with self.subTest(name=name, replacement=replacement):
                    before, after = dump.rsplit(name + '(' + identifier + ')=', 1)
                    self.typed_overrides['AndroidManifest.xml'] = before + name + replacement + '=' + after
                    self.rejects('Android attribute resource ID mismatch')

    def test_firebase_permission_and_exported_ids_cannot_be_reordered(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        lines = self.typed_dump(self.manifest).splitlines()
        name_index = next(i for i, line in enumerate(lines) if '="com.google.firebase.iid.FirebaseInstanceIdReceiver"' in line)
        self.assertIn('permission(0x01010006)', lines[name_index + 1])
        self.assertIn('exported(0x01010010)', lines[name_index + 2])
        lines[name_index + 1], lines[name_index + 2] = lines[name_index + 2], lines[name_index + 1]
        self.typed_overrides['AndroidManifest.xml'] = '\n'.join(lines)
        self.rejects('IDs must increase within each package group')

    def test_firebase_permission_shadow_cannot_hide_behind_an_aliased_framework_name_id(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        original = self.manifest
        for tag, value in [('permission', 'com.google.android.c2dm.permission.SEND'),
                           ('permission-tree', 'com.google.android.c2dm.permission')]:
            with self.subTest(tag=tag):
                declaration = f'<{tag} android:label="{value}"/>'
                self.manifest = original.replace('</manifest>', declaration + '</manifest>')
                self.typed_overrides['AndroidManifest.xml'] = self.typed_dump(self.manifest).replace(
                    'android:label=', 'android:label(0x01010003)=')
                self.rejects('Android attribute resource ID mismatch')

    def test_firebase_compiled_only_attributes_cannot_escape_exact_subtree_check(self):
        self.manifest = self.manifest.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        dump = self.typed_dump(self.manifest)
        anchors = [
            'A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.google.firebase.iid.FirebaseInstanceIdReceiver"',
            'A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.google.android.c2dm.intent.RECEIVE"',
            'A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.google.android.gms.cloudmessaging.FINISHED_AFTER_HANDLED"',
        ]
        for anchor in anchors:
            with self.subTest(anchor=anchor):
                lines = dump.splitlines()
                index = next(i for i, line in enumerate(lines) if anchor in line)
                indent = len(lines[index]) - len(lines[index].lstrip())
                while index + 1 < len(lines) and lines[index + 1].startswith(' ' * indent + 'A: '):
                    index += 1
                lines.insert(index + 1, ' ' * indent + 'A: http://schemas.android.com/apk/res/android:enabled=false')
                self.typed_overrides['AndroidManifest.xml'] = '\n'.join(lines)
                self.rejects('Compiled/decoded security attribute is missing')
        lines = dump.splitlines()
        action_index = next(i for i, line in enumerate(lines) if anchors[1] in line)
        filter_index = action_index - 2
        self.assertIn('E: intent-filter', lines[filter_index])
        indent = len(lines[filter_index]) - len(lines[filter_index].lstrip())
        lines.insert(filter_index + 1, ' ' * (indent + 2) + 'A: http://schemas.android.com/apk/res/android:priority=0x3e8')
        self.typed_overrides['AndroidManifest.xml'] = '\n'.join(lines)
        self.rejects('Compiled/decoded security attribute is missing')

    def test_firebase_compiled_or_decoded_nonempty_text_is_not_ignored(self):
        original = self.manifest
        receiver = FIREBASE_RECEIVER_XML.replace('</intent-filter>', 'unexpected</intent-filter>')
        self.manifest = original.replace('</application>', receiver + '</application>')
        self.rejects('Unexpected compiled Firebase receiver text')
        # Even when a decoder omits text, AAPT2's text must still reject it.
        self.typed_overrides['AndroidManifest.xml'] = self.typed_dump(self.manifest)
        self.manifest = original.replace('</application>', FIREBASE_RECEIVER_XML + '</application>')
        self.rejects('Unexpected compiled Firebase receiver text')
        # Likewise a compiled-text omission must not erase decoded content.
        self.typed_overrides['AndroidManifest.xml'] = self.typed_dump(self.manifest)
        self.manifest = original.replace('</application>', receiver + '</application>')
        self.rejects('Unexpected decoded Firebase receiver text')

    def test_clipboard_resource_cannot_expose_private_files(self):
        self.resources['res/xml/clipboard_provider_paths.xml'] = '<paths><files-path name="clipboard_files" path="."/></paths>'
        self.rejects('dedicated cache')

    def test_private_files_and_source_maps_fail_without_secret_output(self):
        original = copy.deepcopy(self.assets)
        cases = {'assets/.env.production': b'TOKEN=never-print-me', 'assets/release.jks': b'key',
                 'assets/credentials.json': b'{}', 'assets/index.android.bundle.map': b'{}',
                 'assets/encrypted-key-asset.txt': b'-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,1234567890ABCDEF\n\n' + b'A' * 96 + b'\n-----END RSA PRIVATE KEY-----',
                 'assets/renamed-public.pem': b'-----BEGIN RSA PRIVATE KEY-----\n' + b'A' * 96 + b'\n-----END RSA PRIVATE KEY-----',
                 'assets/config.json': b'{"private_key":"-----BEGIN PRIVATE KEY-----\\n' + b'A' * 96 + b'\\n-----END PRIVATE KEY-----"}',
                 'assets/inline.js': b'//# sourceMappingURL=data:application/json;base64,aaaa'}
        for name, value in cases.items():
            with self.subTest(name=name):
                self.assets = original | {name: value}
                with self.assertRaises(gate.GateError) as caught:
                    self.inspect()
                self.assertNotIn('never-print-me', str(caught.exception))

    def test_private_key_scan_crosses_chunk_boundary(self):
        self.assets['assets/large.bin'] = b'x' * (1024 * 1024 - 12) + b'-----BEGIN PRIVATE KEY-----\n' + b'A' * 96 + b'\n-----END PRIVATE KEY-----'
        self.rejects('private key')

    def test_wrong_signature_identity_and_instrumentation_fail(self):
        self.signature = self.signature.replace(CERT, 'cd' * 32)
        self.rejects('signer')
        self.signature = f'Verifies\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: {CERT}\n'
        self.args.version_code = '264102'
        self.rejects('package/version')
        self.args.version_code = '264101'
        self.manifest = self.manifest.replace('</manifest>', '<instrumentation android:name=".Test"/></manifest>')
        self.rejects('Instrumentation')

    def test_duplicate_or_traversal_archive_entries_fail(self):
        self.assets['../secret'] = b'bad'
        self.rejects('Unsafe')
        self.assets.pop('../secret')
        self.build_fixture()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            with zipfile.ZipFile(self.apk, 'a') as archive:
                archive.writestr('AndroidManifest.xml', self.manifest)
        with self.assertRaisesRegex(gate.GateError, 'Duplicate'):
            gate.inspect_apk(self.args, self.runner)

    def test_tool_failure_is_fatal_and_does_not_expose_output(self):
        self.build_fixture()
        with patch.object(gate.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'tool', output='secret')):
            with self.assertRaisesRegex(gate.GateError, 'inspection command failed') as caught:
                gate.inspect_apk(self.args)
        self.assertNotIn('secret', str(caught.exception))

    def test_apk_mutation_while_inspecting_is_rejected(self):
        self.build_fixture()
        def mutate(command):
            result = self.runner(command)
            if command[0] == 'apksigner':
                with self.apk.open('ab') as output:
                    output.write(b'changed')
            return result
        with self.assertRaisesRegex(gate.GateError, 'changed while'):
            gate.inspect_apk(self.args, mutate)

    def test_cli_tool_unavailable_removes_stale_success_report_and_exits_nonzero(self):
        self.build_fixture()
        report = Path(self.directory.name) / 'report.json'
        report.write_text('{"status":"passed"}')
        arguments = [sys.executable, str(SCRIPT), '--report', str(report)]
        for name, value in vars(self.args).items():
            arguments += ['--' + name.replace('_', '-'), str(value) if name != 'apksigner' else str(Path(self.directory.name) / 'missing-tool')]
        result = subprocess.run(arguments, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(report.read_text())['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
