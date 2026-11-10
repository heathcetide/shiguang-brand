"""Create a public business projection; keep nutrition source tables in the private archive."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile


def build(root: Path):
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    def read(name):
        content = (root / name).read_bytes()
        if hashlib.sha256(content).hexdigest() != manifest[name]:
            raise ValueError(f'Checksum mismatch: {name}')
        return json.loads(content)
    archive = root / 'baseline-sources.zip'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != manifest[archive.name]:
        raise ValueError('Baseline checksum mismatch')
    with zipfile.ZipFile(archive) as z:
        baseline = {n: json.loads(z.read(f'clean/{n}.json')) for n in ['ingredients', 'recipes', 'kitchenware']}
    data = {name: read(f'{name}.json') for name in ['concepts', 'ingredient-forms', 'aliases', 'legacy-map', 'recipe-concepts', 'methods']}
    data.update(version='concept-base-1.0.0-rc.2', baseline=baseline,
                manifest_sha256=hashlib.sha256((root / 'manifest.json').read_bytes()).hexdigest())
    return data


if __name__ == '__main__':
    root = Path(sys.argv[1])
    output = root / 'runtime-input.json'
    output.write_text(json.dumps(build(root), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(output)
    print(hashlib.sha256(output.read_bytes()).hexdigest())
