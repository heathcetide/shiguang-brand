"""Minimal kitchenware projection; no product fields or upstream prose."""
import json
import unicodedata

CONCEPT_FIELDS = {'concept_id', 'name_zh', 'category_zh', 'source_release', 'source_url'}
ALIAS_FIELDS = {'alias_id', 'concept_id', 'alias', 'language', 'source_method', 'review_status'}


def check(condition, message):
    if not condition:
        raise ValueError(message)


def key(value):
    return unicodedata.normalize('NFKC', value).strip().casefold()


def validate(concepts, aliases):
    check(len(concepts) == 241 and len(aliases) == 271, 'Unexpected kitchenware projection counts')
    ids = {r['concept_id'] for r in concepts}
    check(len(ids) == len(concepts) and all(ids), 'Duplicate kitchenware concept ID')
    check(len({r['alias_id'] for r in aliases}) == len(aliases), 'Duplicate kitchenware alias ID')
    for row in concepts:
        check(set(row) == CONCEPT_FIELDS, 'Unexpected kitchenware concept fields')
        check(all(isinstance(v, str) and v.strip() for v in row.values()), 'Empty kitchenware concept field')
    for row in aliases:
        check(set(row) == ALIAS_FIELDS, 'Unexpected kitchenware alias fields')
        check(row['concept_id'] in ids, 'Orphan kitchenware alias')
        check(all(isinstance(v, str) and v.strip() for v in row.values()), 'Empty kitchenware alias field')
        check(row['review_status'] == 'needs_semantic_review', 'Unreviewed kitchenware alias promoted')


def project(archive):
    source_concepts = [json.loads(line) for line in archive.read('canonical-concepts-v4.jsonl').splitlines()]
    source_aliases = [json.loads(line) for line in archive.read('concept-aliases-v4.jsonl').splitlines()]
    concepts = [dict(concept_id=r['concept_id'], name_zh=r['preferred_name_zh'],
                     category_zh=r['concept_category'], source_release=r['source_release'],
                     source_url='https://github.com/AdlinZ/DietDigiDose/issues/66#issuecomment-5491772751')
                for r in source_concepts if r['concept_level'] == 'type']
    aliases = [dict(alias_id=r['alias_id'], concept_id=r['concept_id'], alias=r['alias'],
                   language=r['language'], source_method=r['source'], review_status='needs_semantic_review')
               for r in source_aliases if r['alias_type'] == 'synonym']
    validate(concepts, aliases)
    lookup = {}
    for row in concepts:
        lookup.setdefault(key(row['name_zh']), set()).add(row['concept_id'])
    for row in aliases:
        lookup.setdefault(key(row['alias']), set()).add(row['concept_id'])
    collisions = {name: sorted(ids) for name, ids in sorted(lookup.items()) if len(ids) > 1}
    return concepts, aliases, {
        'concepts': len(concepts), 'aliases_pending_semantic_review': len(aliases),
        'normalized_name_collisions': collisions,
        'product_records_included': 0, 'upstream_definitions_included': 0,
        'license_status': 'no_blanket_license_asserted',
        'classification_status': 'source_category_reference_not_capability_mapping',
    }


def jsonl(rows):
    return ('\n'.join(sorted(json.dumps(r, ensure_ascii=False, sort_keys=True) for r in rows)) + '\n').encode('utf-8')
