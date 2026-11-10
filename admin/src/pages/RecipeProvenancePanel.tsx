import { safeRecipeSourceUrl } from './recipeReviewModel';

export type RecipeProvenance = {
  serving_size?: number | null;
  source?: string | null;
  source_url?: string | null;
  data_license?: string | null;
  source_revision?: string | null;
  source_attribution?: string | null;
  source_content_hash?: string | null;
  nutrition_basis?: string | null;
  diagnostics?: { publicationIssues: string[] };
};
const issueLabels: Record<string, string> = {
  missing_title: '缺少名称', missing_license: '缺少许可记录', missing_serving_size: '缺少有效份数',
  missing_time: '缺少用时', missing_ingredients: '缺少原料', missing_steps: '步骤不足', missing_kitchenware_mapping: '缺少厨具要求',
};
const recorded = (value: unknown) => value == null || value === '' ? '未记录' : String(value);

export function RecipeProvenancePanel({ recipe }: { recipe: RecipeProvenance }) {
  const sourceUrl = safeRecipeSourceUrl(recipe.source_url);
  return <section className="space-y-3" aria-label="来源与发布检查">
    <h3 className="font-semibold">来源与版本（只读）</h3>
    <dl className="space-y-2 break-words">
      {([
        ['来源标识', recipe.source], ['声明份数', recipe.serving_size], ['许可记录', recipe.data_license],
        ['来源版本', recipe.source_revision], ['署名', recipe.source_attribution], ['来源内容哈希', recipe.source_content_hash],
        ['营养依据', recipe.nutrition_basis],
      ] as const).map(([label, value]) => <div key={label}><dt className="admin-muted">{label}</dt><dd>{recorded(value)}</dd></div>)}
      <div><dt className="admin-muted">来源链接</dt><dd>{sourceUrl
        ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{recipe.source_url}</a>
        : recorded(recipe.source_url)}</dd></div>
    </dl>
    <h3 className="font-semibold">发布字段检查</h3>
    <p>{!recipe.diagnostics ? '尚未读取检查结果' : recipe.diagnostics.publicationIssues.length
      ? recipe.diagnostics.publicationIssues.map(issue => issueLabels[issue] || issue).join('；') : '通过现有发布字段校验'}</p>
    <p className="admin-muted">字段校验不等于已发布、许可合规确认或营养已核验。公开浏览还取决于发布与质量审核；制作流程需在下方单独审核，个人计划还需核对实际用量、厨具与时间。</p>
  </section>;
}
