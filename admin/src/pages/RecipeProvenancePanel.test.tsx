import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecipeProvenancePanel } from './RecipeProvenancePanel';
import { safeRecipeSourceUrl } from './recipeReviewModel';

describe('recipe provenance diagnostics', () => {
  it('keeps unrecorded evidence unknown without claiming original ownership', () => {
    const html = renderToStaticMarkup(<RecipeProvenancePanel recipe={{}} />);
    expect(html).toContain('未记录'); expect(html).toContain('尚未读取检查结果');
    expect(html).not.toContain('DietDigiDose-Original');
  });
  it('shows imported evidence and separates publication checks from legal and nutritional review', () => {
    const html = renderToStaticMarkup(<RecipeProvenancePanel recipe={{ source: 'wikibooks_zh', serving_size: 4,
      source_url: 'https://example.org/source', data_license: 'CC-BY-SA-4.0', source_revision: 'revision-1',
      source_attribution: '原作者', source_content_hash: 'source-hash', nutrition_basis: 'unknown', diagnostics: { publicationIssues: [] } }} />);
    for (const value of ['wikibooks_zh', 'CC-BY-SA-4.0', 'revision-1', '原作者', 'source-hash', 'unknown', 'noopener noreferrer', '不等于已发布']) expect(html).toContain(value);
  });
  it('renders unsafe or malformed links as text, never anchors', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,attack', '/relative', 'https://user:secret@example.org']) {
      expect(safeRecipeSourceUrl(value)).toBeNull();
      expect(renderToStaticMarkup(<RecipeProvenancePanel recipe={{ source_url: value }} />)).not.toContain('<a ');
    }
    expect(safeRecipeSourceUrl('https://example.org/source')).toBe('https://example.org/source');
  });
  it('shows blockers rather than an approval badge', () => {
    const html = renderToStaticMarkup(<RecipeProvenancePanel recipe={{ diagnostics: { publicationIssues: ['missing_license', 'missing_serving_size'] } }} />);
    expect(html).toContain('缺少许可记录；缺少有效份数'); expect(html).not.toContain('通过现有发布字段校验');
  });
});
