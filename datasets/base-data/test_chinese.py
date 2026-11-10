import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from reclean.chinese import simplify


class ChineseTests(unittest.TestCase):
    def test_characters_preserve_states_units_and_supplementary_unicode(self):
        self.assertEqual(simplify('馬鈴薯 雞胸肉（熟） １００g 𣎴'), '马铃薯 鸡胸肉（熟） １００g 𣎴')
        self.assertNotEqual(simplify('雞胸肉（熟）'), simplify('雞肉'))
        self.assertEqual(simplify(''), '')
        self.assertEqual(simplify('土豆'), '土豆')

    def test_converter_runs_outside_repository_with_packaged_dictionary(self):
        source = Path(__file__).with_name('reclean')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            shutil.copy(source / 'chinese.py', target)
            shutil.copytree(source / 'opencc', target / 'opencc')
            result = subprocess.run([sys.executable, '-c',
                                     "from chinese import simplify; assert simplify('馬鈴薯𣎴') == '马铃薯𣎴'"],
                                    cwd=target, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_dictionary_matches_pinned_source_notice(self):
        source = Path(__file__).with_name('reclean') / 'opencc'
        digest = hashlib.sha256((source / 'TSCharacters.txt').read_bytes()).hexdigest()
        self.assertIn('`' + digest + '`', (source / 'README.md').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
