const $=id=>document.getElementById(id);
const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
let offset=0;
async function api(path){const token=localStorage.getItem('adminToken');if(!token)throw new Error('请先通过上方链接登录管理后台，再回到此页。');const r=await fetch('/data-lab/api/'+path,{headers:{Authorization:'Bearer '+token}});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}
function raw(parent,title,data){const box=document.createElement('details');box.append(el('summary',title),el('pre',JSON.stringify(data,null,2)));parent.append(box);}
async function show(id){try{const d=await api('concept?id='+encodeURIComponent(id));const p=$('detail');p.replaceChildren(el('h2',d.concept.name_zh),el('p',d.concept.id));
 if(d.forms.length){p.append(el('h3','原料形态'));for(const f of d.forms){p.append(el('p',f.display_name));raw(p,'状态与来源',f);}}
 if(d.recipe){p.append(el('h3','做法'));if(!d.methods.length)p.append(el('p','目前只有百科概念，尚无来源做法。'));for(const m of d.methods){const box=el('section','');box.className='card';box.append(el('h3',(m.id===d.recipe.primary_method_id?'主要做法 · ':'其他做法 · ')+m.title));box.append(el('p',m.servings?m.servings+' 人份':'份量：暂无数据'));const ul=el('ul','');for(const i of m.ingredients)ul.append(el('li',(i.name||'未识别原料')+' '+(i.amount_text||'用量未明确')));box.append(ul);const steps=el('ol','');for(const s of m.steps)steps.append(el('li',s.text));box.append(steps);raw(box,'厨具需求与缺项', {equipment:m.equipment_requirements,missing:m.missing_fields});box.append(el('p','营养：尚未确认整份配方的全部来源及重量。'));p.append(box);}}
 p.append(el('h3','营养来源'));if(!d.nutrition_links.length&&!d.cn6_candidates.length)p.append(el('p','暂无已关联营养来源。'));
 for(const l of [...d.nutrition_links,...d.cn6_candidates]){const b=el('button',(l.source_name||l.source_food_id)+(l.scope?' · 有条件参考':' · 待核对候选'));b.onclick=async()=>{try{const n=await api('nutrition?id='+encodeURIComponent(l.source_food_id));raw(p,'营养原始记录 · '+l.source_food_id,n);}catch(e){$('message').textContent=e.message;}};p.append(b);if(l.scope)p.append(el('p',l.scope));}
 raw(p,'概念出处与分类',d.concept);
}catch(e){$('message').textContent=e.message;}}
async function search(){try{const d=await api('concepts?'+new URLSearchParams({q:$('q').value,kind:$('kind').value,offset:String(offset)}));$('count').textContent='共 '+d.total+' 项';$('list').replaceChildren();for(const x of d.items){const b=el('button',x.name);b.append(el('div',x.id));b.onclick=()=>show(x.id);$('list').append(b);}$('more').hidden=offset+40>=d.total;$('message').textContent='同名结果可能对应不同概念，请查看形态与出处。';}catch(e){$('message').textContent=e.message;}}
$('search').onsubmit=e=>{e.preventDefault();offset=0;search();};$('more').onclick=()=>{offset+=40;search();};
api('summary').then(s=>{$('summary').hidden=false;$('summary').textContent=`${s.version} ｜ 原料形态 ${s.ingredient_forms} ｜ 有做法的食谱 ${s.recipes_with_methods} ｜ 具体做法 ${s.methods} ｜ CN6食品 ${s.cn6_source_foods}`;search();}).catch(e=>{$('message').textContent=e.message;});
