"""Offline tests only: fake credentials, mocked network, temporary output files."""
import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'generate.py'
spec = importlib.util.spec_from_file_location('aicost_generate', SCRIPT)
generate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generate)
TEST_KEY = 'offline-test-key-not-a-real-credential'


class ImageGenerationTests(unittest.TestCase):
    def cli(self, args):
        output = io.StringIO()
        with patch.dict(os.environ, {'AICOST_API_KEY': TEST_KEY}, clear=True), patch('sys.argv', ['generate.py', *args]), contextlib.redirect_stdout(output):
            generate.main()
        return output.getvalue()

    def test_environment_takes_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'secrets.env').write_text('AICOST_API_KEY=file-test-value\n')
            with patch.dict(os.environ, {'AICOST_API_KEY': '  env-test-value  '}, clear=True):
                self.assertEqual(generate.load_api_key(root), 'env-test-value')

    def test_file_supports_quotes_comments_and_export_without_loading_other_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'secrets.env').write_text('# local test\nOTHER_KEY=unrelated\nexport AICOST_API_KEY="file-test-value" # comment\n')
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(generate.load_api_key(root), 'file-test-value')

    def test_blank_key_is_missing_and_never_echoes_file_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'secrets.env').write_text('OTHER_KEY=must-not-be-printed\nAICOST_API_KEY=\n')
            with patch.dict(os.environ, {}, clear=True), self.assertRaises(SystemExit) as failure:
                generate.load_api_key(root)
            self.assertIn('Missing AICOST_API_KEY', str(failure.exception))
            self.assertNotIn('must-not-be-printed', str(failure.exception))

    def test_check_does_not_make_requests_or_display_key(self):
        with patch.object(generate, 'open_request', side_effect=AssertionError('network forbidden')):
            output = self.cli(['--check'])
        data = json.loads(output)
        self.assertEqual(data['credential'], 'configured')
        self.assertFalse(data['network_request'])
        self.assertNotIn(TEST_KEY, output)

    def test_dry_run_does_not_load_credentials_make_requests_or_write_images(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'background.jpg'
            with patch.object(generate, 'load_api_key', side_effect=AssertionError('credentials forbidden')), patch.object(generate, 'open_request', side_effect=AssertionError('network forbidden')):
                output = self.cli(['--prompt', 'warm kitchen', '--out', str(out), '--dry-run'])
            data = json.loads(output)
            self.assertEqual(data['endpoint'], generate.BASE + '/images/generations')
            self.assertEqual(data['fields']['model'], 'gpt-image-2')
            self.assertEqual(data['fields']['size'], '3072x1728')
            self.assertFalse(data['network_request'])
            self.assertFalse(out.exists())

    def test_generation_uses_original_defaults_and_saves_base64_response(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'nested' / 'background.jpg'
            payload = {'data': [{'b64_json': base64.b64encode(b'offline-image-bytes').decode()}]}
            with patch.object(generate, 'http_json', return_value=payload) as request:
                output = self.cli(['--prompt', 'warm kitchen', '--out', str(out)])
            self.assertEqual(out.read_bytes(), b'offline-image-bytes')
            self.assertEqual(output.strip(), str(out.resolve()))
            self.assertEqual(request.call_args.args[:3], ('POST', generate.BASE + '/images/generations', TEST_KEY))
            self.assertEqual(request.call_args.args[3]['n'], 1)

    def test_reference_image_selects_edit_endpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / 'reference.png'
            image.write_bytes(b'local-reference')
            out = Path(directory) / 'edited.jpg'
            payload = {'data': [{'b64_json': base64.b64encode(b'edited-image').decode()}]}
            with patch.object(generate, 'multipart_edit', return_value=payload) as edit, patch.object(generate, 'http_json', side_effect=AssertionError('wrong endpoint')):
                self.cli(['--prompt', 'warmer lighting', '--image', str(image), '--out', str(out)])
            self.assertEqual(edit.call_args.args[0], generate.BASE + '/images/edits')
            self.assertEqual(edit.call_args.args[3], [image.resolve()])
            self.assertEqual(out.read_bytes(), b'edited-image')

    def test_image_download_never_receives_api_authentication(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'download.jpg'
            with patch.object(generate, 'open_request', return_value=io.BytesIO(b'public-image')) as request:
                generate.resolve_payload({'data': [{'url': 'https://cdn.example.test/result.jpg?signature=test'}]}, TEST_KEY, out, 'jpeg')
            image_request = request.call_args.args[0]
            self.assertIsNone(image_request.get_header('Authorization'))
            self.assertEqual(out.read_bytes(), b'public-image')

    def test_non_https_download_is_rejected_before_network_access(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(generate, 'open_request') as request, self.assertRaises(SystemExit):
                generate.resolve_payload({'data': [{'url': 'http://cdn.example.test/result.jpg'}]}, TEST_KEY, Path(directory) / 'out.jpg', 'jpeg')
            request.assert_not_called()

    def test_authenticated_redirects_cannot_change_origin_or_downgrade_https(self):
        handler = generate.SafeRedirectHandler()
        request = urllib.request.Request(generate.BASE + '/images/generations', headers={'Authorization': 'Bearer ' + TEST_KEY})
        for target in ['https://elsewhere.example.test/result', 'https://www.aicost.me:444/result', 'http://www.aicost.me/result']:
            with self.subTest(target=target), self.assertRaises(urllib.error.HTTPError):
                handler.redirect_request(request, None, 302, 'Found', {}, target)

    def test_same_origin_redirect_retains_authentication(self):
        handler = generate.SafeRedirectHandler()
        request = urllib.request.Request(generate.BASE + '/images/generations', headers={'Authorization': 'Bearer ' + TEST_KEY})
        redirected = handler.redirect_request(request, None, 302, 'Found', {}, 'https://www.aicost.me/result')
        self.assertEqual(redirected.get_header('Authorization'), 'Bearer ' + TEST_KEY)

    def test_edit_does_not_retry_auth_rate_limit_or_server_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / 'reference.png'
            image.write_bytes(b'local-reference')
            for code in [401, 403, 429, 500, 503]:
                error = urllib.error.HTTPError(generate.BASE, code, 'test error', {}, io.BytesIO(b'error involving image[]'))
                with self.subTest(code=code), patch.object(generate, 'open_request', side_effect=error) as request, self.assertRaises(urllib.error.HTTPError):
                    generate.multipart_edit(generate.BASE + '/images/edits', TEST_KEY, {'model': 'gpt-image-2'}, [image])
                self.assertEqual(request.call_count, 1)

    def test_explicit_image_array_rejection_retries_the_original_compatibility_field(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / 'reference.png'
            image.write_bytes(b'local-reference')
            error = urllib.error.HTTPError(generate.BASE, 422, 'test error', {}, io.BytesIO(b'Unsupported field image[]; expected image'))
            with patch.object(generate, 'open_request', side_effect=[error, io.BytesIO(b'{"data": []}')]) as request:
                generate.multipart_edit(generate.BASE + '/images/edits', TEST_KEY, {'model': 'gpt-image-2'}, [image])
            self.assertEqual(request.call_count, 2)
            self.assertIn(b'name="image[]"', request.call_args_list[0].args[0].data)
            self.assertIn(b'name="image"', request.call_args_list[1].args[0].data)

    def test_async_result_polls_without_resubmitting_generation(self):
        payload = {'task_id': 'test-task'}
        responses = [{'status': 'processing'}, {'data': [{'b64_json': base64.b64encode(b'async-image').decode()}]}]
        with tempfile.TemporaryDirectory() as directory, patch.object(generate.time, 'sleep'), patch.object(generate.time, 'monotonic', return_value=0), patch.object(generate, 'http_json', side_effect=responses) as request, contextlib.redirect_stderr(io.StringIO()):
            out = Path(directory) / 'async.jpg'
            generate.resolve_payload(payload, TEST_KEY, out, 'jpeg')
            self.assertEqual(out.read_bytes(), b'async-image')
            self.assertEqual(request.call_count, 2)
            self.assertTrue(all(call.args[0] == 'GET' for call in request.call_args_list))

    def test_async_failure_stops_polling(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(generate.time, 'sleep'), patch.object(generate, 'http_json', return_value={'status': 'failed'}) as request, contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            generate.resolve_payload({'task_id': 'failed-test-task'}, TEST_KEY, Path(directory) / 'out.jpg', 'jpeg')
        self.assertEqual(request.call_count, 1)

    def test_provider_errors_redact_the_key(self):
        error = urllib.error.HTTPError(generate.BASE, 401, 'unauthorized', {}, io.BytesIO(('bad key: ' + TEST_KEY).encode()))
        with tempfile.TemporaryDirectory() as directory, patch.object(generate, 'http_json', side_effect=error), self.assertRaises(SystemExit) as failure:
            self.cli(['--prompt', 'warm kitchen', '--out', str(Path(directory) / 'out.jpg')])
        self.assertNotIn(TEST_KEY, str(failure.exception))
        self.assertIn('[REDACTED]', str(failure.exception))


if __name__ == '__main__':
    unittest.main()
