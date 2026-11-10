"""Build a references-only supplement from shipped inputs; never infer recipe bindings."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import zipfile

from reclean.enrich_core import CORE, encoded, scalar, sha
from source_coverage import ARCHIVE, EVIDENCE, ROOT, TFDA_EVIDENCE, TFDA_NAMES, audit, read_package

VERSION = 'concept-enrichment-2026-10-03.1'
BASE_SHA = '5bc9345bf6e232e34a0c6cbd4091d55f1a7f1ecce3f2e930f847431c19db3f30'
TFDA_SHA = 'c1ef5502ceceead6d5ce3b7ee21fe544702b1e508be73b196fce2cf0e61985cb'
ROWS_SHA = '89b5d83967ec9d65d349b098d8087b656bd0a91a798ecb5e59ce40fc1ab77541'
TFDA_URL = 'https://data.gov.tw/dataset/8543'
SELECTIONS = Path(__file__).with_name('evidence') / 'tfda-expansion-selections.json'
ROWS = Path(__file__).with_name('evidence') / 'tfda-expansion-rows.json'
IMPORTER = ROOT / 'server/scripts/import-nutrition-enrichment.mjs'


def select_rows(tfda, selections):
    """Extract unmodified core observations, retaining positions in the locked archive."""
    if sha(Path(tfda).read_bytes()) != TFDA_SHA:
        raise ValueError('TFDA archive checksum mismatch')
    with zipfile.ZipFile(tfda) as archive:
        raw = archive.read('20_5.json')
        rows = json.loads(raw.decode('utf-8-sig'))
    codes = {s['source_food_id'] for s in selections}
    return {'archive_sha256': TFDA_SHA, 'member': '20_5.json', 'member_sha256': sha(raw),
            'source_url': TFDA_URL, 'download_url': 'https://data.fda.gov.tw/data/opendata/export/20/json',
            'source_license': '政府資料開放授權條款-第1版',
            'records': [{'source_position': i, 'row': row} for i, row in enumerate(rows)
                        if row['整合編號'] in codes and row['分析項'] in TFDA_NAMES.values()]}


def new_profiles(catalogue, selections, evidence):
    if evidence['archive_sha256'] != TFDA_SHA:
        raise ValueError('TFDA evidence origin mismatch')
    forms = {f['id']: f for f in catalogue['ingredient-forms']}
    grouped = defaultdict(list)
    for row in evidence['records']:
        grouped[row['row']['整合編號']].append(row)
    profiles = []
    for selection in selections:
        form = forms[selection['ingredient_form_id']]
        if form['display_name'] != selection['expected_form_name']:
            raise ValueError('Catalogue form identity mismatch')
        code = selection['source_food_id']
        rows = grouped[code]
        if len(rows) != 4 or any(r['row']['樣品名稱'] != selection['source_name'] or
                                 r['row']['內容物描述'] != selection['source_description'] for r in rows):
            raise ValueError('TFDA sample identity mismatch')
        nutrients = {}
        for key, name in TFDA_NAMES.items():
            observations = [r for r in rows if r['row']['分析項'] == name]
            if len(observations) != 1 or observations[0]['row']['含量單位'] != CORE[key][1]:
                raise ValueError('TFDA nutrient identity/unit mismatch')
            observation = observations[0]
            nutrients[key] = {'amount': scalar(observation['row']['每100克含量']), 'unit': CORE[key][1],
                              'observation_id': f"TFDA-OBS:{code}:{observation['source_position']}"}
        profiles.append({'id': f"ENRICH-PROFILE:{form['id']}:TFDA:{code}",
            'ingredient_form_id': form['id'], 'ingredient_concept_id': form['concept_id'],
            'display_name': selection['source_name'], 'scope': selection['scope'],
            'source_food_id': 'TFDA:' + code, 'source_name': selection['source_name'], 'source_kind': 'TFDA',
            'source_description': selection['source_description'], 'source_url': TFDA_URL,
            'source_license': evidence['source_license'], 'basis': 'per_100g_source_prepared_sample',
            'nutrients_per_100g': nutrients, 'binding_status': 'scoped_reference',
            'match_reason': selection['match_reason'], 'requires_scope_confirmation': True,
            'automatic_runtime_binding': False, 'professional_review_performed': False})
    if len({p['id'] for p in profiles}) != len(profiles):
        raise ValueError('Duplicate sample selection')
    return profiles


def build(output, tfda=None):
    if sha(ARCHIVE.read_bytes()) != BASE_SHA:
        raise ValueError('Base archive checksum mismatch')
    data = read_package(ARCHIVE)
    selections = json.loads(SELECTIONS.read_bytes())
    if sha(ROWS.read_bytes()) != ROWS_SHA:
        raise ValueError('TFDA selected evidence checksum mismatch')
    evidence = json.loads(ROWS.read_bytes())
    if tfda is not None and select_rows(tfda, selections) != evidence:
        raise ValueError('Selected rows differ from original TFDA archive')
    additions = new_profiles(data['catalogue'], selections, evidence)
    profiles = data['nutrition-profiles'] + additions
    # The old archive also contains rejected candidates; keep each original row only once.
    rows = {}
    for item in data['tfda-selected-records'] + json.loads(TFDA_EVIDENCE.read_bytes())['records'] + evidence['records']:
        position = item['source_position']
        if position in rows and rows[position] != item:
            raise ValueError('Contradicting TFDA original row')
        rows[position] = item
    data.update({'version': VERSION, 'nutrition-profiles': profiles,
                 'tfda-selected-records': [rows[i] for i in sorted(rows)]})
    report = audit(data, json.loads(EVIDENCE.read_bytes()))
    if report['profiles_missing_source_observations']:
        raise ValueError('Supplement has missing source observations')
    with zipfile.ZipFile(ARCHIVE) as archive:
        prefix = 'system-data-2026-09-15.2/data/nutrition/'
        unchanged = ['recipe-nutrition.json', 'recipe-inputs.json', 'recipe-weighing-contracts.json',
                     'equipment-role-updates.json', 'duplicate-review.json', 'source-selected-records.json',
                     'matching-decisions.json']
        payload = {name: archive.read(prefix + name) for name in unchanged}
        payload['previous-source.lock.json'] = archive.read(prefix + 'source.lock.json')
    summary = {'version': VERSION, 'parent_version': 'concept-enrichment-2026-09-15.2',
        'import_mode': 'scoped_reference_additions', 'scoped_profiles': len(profiles),
        'new_profiles_this_round': len(additions), 'recipes_assessed': 20, 'core_complete_recipes': 8,
        'incomplete_recipes': 12, 'recipe_results_changed': False, 'runtime_applied': False,
        'concepts_with_scoped_nutrition_reference': report['concepts_with_scoped_nutrition_reference']}
    payload.update({'summary.json': encoded(summary), 'nutrition-profiles.json': encoded(profiles),
        'tfda-selected-records.json': encoded(data['tfda-selected-records']),
        'foundation-source-record.json': EVIDENCE.read_bytes(), 'sample-selections.json': SELECTIONS.read_bytes(),
        'source-coverage.json': encoded(report), 'source.lock.json': encoded({
            'parent_archive': ARCHIVE.name, 'parent_archive_sha256': BASE_SHA,
            'tfda_archive_sha256': TFDA_SHA, 'tfda_download_url': evidence['download_url'],
            'tfda_member': evidence['member'], 'tfda_member_sha256': evidence['member_sha256'],
            'selection_sha256': sha(SELECTIONS.read_bytes()), 'selected_rows_sha256': sha(ROWS.read_bytes()),
            'foundation_evidence_sha256': sha(EVIDENCE.read_bytes())}),
        'import-nutrition-enrichment.mjs': IMPORTER.read_bytes()})
    payload['README.md'] = (f'# 通用食材营养样品补充 {VERSION}\n\n'
        f'{len(additions)} 个新增样品；累计 {len(profiles)} 个限定范围参考，覆盖 '
        f'{report["concepts_with_scoped_nutrition_reference"]} 个食材概念。\n\n'
        '本包仅追加食材营养参考。20 份配方计算原样保留用于核对，导入时不写菜谱、厨具或通用营养列。'
        '参考需要确认品种、加工、可食部与称量条件，不自动绑定食材。原方仍为 8 份完整四项估算。\n\n'
        '来源：[TFDA](https://data.gov.tw/dataset/8543)，政府資料開放授權條款-第1版；'
        '原有 USDA 来源及快照保留在来源锁和证据文件中。所有值可逐项核对，不补零。\n\n'
        '在初始化并已有概念目录的 PostgreSQL 上，使用含本版本脚本的仓库运行：\n\n'
        '```sh\nENRICHMENT_MANIFEST_SHA256="$(shasum -a 256 /绝对路径/补充包/manifest.json | cut -d " " -f 1)" '
        'node server/scripts/import-nutrition-enrichment.mjs /绝对路径/补充包\n```\n\n'
        '通过外部 SHA256 核对 ZIP 后再解压。命令从环境读取 DATABASE_URL，默认演练回滚；'
        '加 --apply 才提交。重复执行不写入，冲突回滚，拒绝降级。新安装先导入基础目录；'
        '本包不替代基础安装包。以后不要使用历史 ZIP 自带旧导入器覆盖新引用。\n').encode()
    payload['manifest.json'] = encoded({name: sha(raw) for name, raw in sorted(payload.items())})
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x') as archive:
        for name, raw in sorted(payload.items()):
            info = zipfile.ZipInfo(VERSION + '/' + name, (2026, 10, 3, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    return {'archive': str(output), 'sha256': sha(output.read_bytes()),
            'manifest_sha256': sha(payload['manifest.json']), **summary}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--tfda', type=Path, help='Also compare every selected row with the locked full source archive')
    args = parser.parse_args()
    print(json.dumps(build(args.output, args.tfda), ensure_ascii=False, indent=2))
