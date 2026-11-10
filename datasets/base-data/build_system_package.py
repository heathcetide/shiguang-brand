"""Portable reference data plus original platform content; excludes personal and interaction data."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
from community_content import build as community

ROOT = Path(__file__).resolve().parents[2]
VERSION = 'system-data-2026-09-15.2'


def build(output):
    output = Path(output)
    if output.exists():
        raise FileExistsError(output)
    (output / 'data/nutrition').mkdir(parents=True)
    (output / 'scripts').mkdir()
    base = ROOT / 'artifacts/base-data/concept-base-1.0.0-rc.2/runtime-input.json'
    if hashlib.sha256(base.read_bytes()).hexdigest() != '2923b05b517736f57bca1786a31cba9bfcbc63fdf453a174b90bc65ab15d7a46':
        raise ValueError('Baseline input changed')
    shutil.copy2(base, output / 'data/runtime-input.json')
    enrichment = ROOT / 'artifacts/base-data/concept-enrichment-2026-09-15.2'
    for name in json.loads((enrichment / 'manifest.json').read_text(encoding='utf8')):
        shutil.copy2(enrichment / name, output / 'data/nutrition' / name)
    shutil.copy2(enrichment / 'manifest.json', output / 'data/nutrition/manifest.json')
    (output / 'data/community.json').write_text(json.dumps(community(), ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    for script in ['import-concept-runtime.mjs', 'import-nutrition-enrichment.mjs', 'import-community-content.mjs', 'import-system-data.mjs']:
        shutil.copy2(ROOT / 'server/scripts' / script, output / 'scripts' / script)
    (output / 'package.json').write_text(json.dumps({'name':'dietdigidose-system-data', 'version':'1.0.0', 'private':True, 'type':'module',
        'scripts':{'check':'node scripts/import-system-data.mjs','import':'node scripts/import-system-data.mjs --apply'},
        'dependencies':{'pg':'8.17.2'}},indent=2)+'\n')
    (output / 'README.md').write_text('''# 食光烙记 · 可导入基础数据与平台社区内容

版本：system-data-2026-09-15.2。

## 包含什么

- 1,079 个食材概念入口、385 个菜品入口/389 种做法、261 项厨具。
- 31 个形态营养参考、20 道家常菜估算与缺项，其中 8 道具备四项主要营养的整份/每份值。
- 3 个有统计口径的平台数据榜单、4 个平台活动、12 个平台常见问题、12 条平台参考答复。
- 稳定逻辑 ID、来源和称量说明、散列清单、事务导入脚本。

不包含账号凭据、个人库存或饮食记录、用户帖子和评论、点赞或报名名单。原社区 100 条演示“寻味”内容也不混入本包。不伪造参与人数、点赞或专家认证。CN6 原始表不在本包中。

## 导入条件

目标是使用食光烙记当前数据结构的 PostgreSQL 数据库（以 2026-09-15 已部署版本为准），不是任意空数据库。先运行本项目数据库初始化/迁移，并准备一个已有、启用的管理员账号。Node.js 22、pnpm；无须安装新数据库服务。

解压后，在包目录运行：

```sh
pnpm install --ignore-scripts
# 通过环境设置 DATABASE_URL；不要把密码写进版本库。
# 多个管理员时，设置 COMMUNITY_AUTHOR_ID 为目标管理员 ID。
pnpm check
pnpm import
```

`pnpm check` 完整演练后回滚；PostgreSQL 序列可能前进，不会留下业务记录。`pnpm import` 在一个事务中提交；任一步失败均回滚。稳定 ID 会映射到目标库 ID，不要求与原系统的数字 ID 相同。同一完整包再次导入为无操作，不覆盖后来用户编辑。

已有完整 rc2 概念目录时保持原目录；只有部分目录时停止，需先核对。营养绑定会检查原方原料和步骤，修改过的配方不会被静默覆盖。

活动以首次导入时刻为基准：2 个立即开始，另外 2 个分别在 3 天和 7 天后开始。可在首次导入前设置 `COMMUNITY_ACTIVATION_AT` 为带时区的 ISO 时间；再次导入不顺延日期。旧活动不会自动变成新活动。

## 来源与限制

基础百科/做法来源及授权保存在 runtime-input.json 中各记录的 source 字段。营养来源、适用形态、原始选中样品及授权见 data/nutrition/。平台活动和问答是本项目编辑内容，明确标注发布身份；它们不是用户经历或专家审定结论。

参考配方仍不参加自动营养配餐。食材概念不直接继承特定形态的通用营养，缺失值不是零。目录中同名概念不会仅凭名称强行合并。
''', encoding='utf8')
    files = {f.relative_to(output).as_posix():hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(output.rglob('*')) if f.is_file()}
    (output / 'manifest.json').write_text(json.dumps({'version':VERSION,'files':files},ensure_ascii=False,sort_keys=True,indent=2)+'\n', encoding='utf8')
    with zipfile.ZipFile(output.parent / (VERSION + '.zip'), 'w') as z:
        for f in sorted(output.rglob('*')):
            if f.is_file():
                info = zipfile.ZipInfo(VERSION+'/'+f.relative_to(output).as_posix(), (2026,9,15,0,0,0))
                info.compress_type=zipfile.ZIP_DEFLATED
                z.writestr(info,f.read_bytes())
    return output.parent / (VERSION + '.zip')


if __name__ == '__main__':
    print(build(ROOT / 'artifacts/base-data' / VERSION))
