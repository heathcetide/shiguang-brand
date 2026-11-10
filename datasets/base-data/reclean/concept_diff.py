"""Compare immutable concept releases, including primary-method changes."""
import argparse
import json
import zipfile
from pathlib import Path


def compare(before, after):
    result = {}
    with zipfile.ZipFile(before) as a, zipfile.ZipFile(after) as b:
        for name in ['concepts.json', 'ingredient-forms.json', 'recipe-concepts.json', 'methods.json', 'nutrition-links.json', 'nutrition-observations.json']:
            old = {r['id']: r for r in json.loads(a.read(name))}
            new = {r['id']: r for r in json.loads(b.read(name))}
            result[name] = {'added': sorted(new.keys()-old.keys()), 'removed': sorted(old.keys()-new.keys()),
                            'changed': [{'id': i, 'fields': sorted(k for k in old[i].keys() | new[i].keys() if old[i].get(k) != new[i].get(k))}
                                        for i in sorted(old.keys() & new.keys()) if old[i] != new[i]]}
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('before'); p.add_argument('after'); p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    with a.output.open('x', encoding='utf-8') as f:
        json.dump(compare(a.before, a.after), f, ensure_ascii=False, indent=2)
