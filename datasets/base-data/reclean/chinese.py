"""Pinned, platform-independent character conversion (no phrase/state rewriting)."""
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def character_table():
    table = {}
    source = Path(__file__).with_name('opencc') / 'TSCharacters.txt'
    for line in source.read_text(encoding='utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        traditional, simplified = line.split('\t')
        # OpenCC orders alternatives by preference; retain character boundaries.
        table[ord(traditional)] = simplified.split(' ')[0]
    return table


def simplify(value):
    return value.translate(character_table())
