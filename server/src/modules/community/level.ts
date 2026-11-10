import type { LevelSource } from "./types.js";

export type UserLevel={level:number;title:string;xp:number;baseXp:number;adjustmentXp:number;nextXp:number|null;progress:number};
export type UserLevelRule={levels:Array<{level:number;title:string;requiredXp:number}>;xp:{dietRecord:number;streakDay:number;recipeFavorite:number;communityPost:number;follower:number;dailyCheckIn:number}};

export const DEFAULT_RULE: UserLevelRule = { levels: [
  { level:1,title:"健康新芽",requiredXp:0 },{ level:2,title:"轻食探索者",requiredXp:150 },
  { level:3,title:"健康达人",requiredXp:450 },{ level:4,title:"营养生活家",requiredXp:900 },
  { level:5,title:"食光大师",requiredXp:1800 },
],xp:{ dietRecord:10,streakDay:15,recipeFavorite:5,communityPost:30,follower:20,dailyCheckIn:5 } };

function valid(value: unknown): value is UserLevelRule { if(!value||typeof value!=="object")return false; const candidate=value as Partial<UserLevelRule>;
  if(!Array.isArray(candidate.levels)||candidate.levels.length<2||!candidate.xp||typeof candidate.xp!=="object")return false;
  const weights=[candidate.xp.dietRecord,candidate.xp.streakDay,candidate.xp.recipeFavorite,candidate.xp.communityPost,candidate.xp.follower,candidate.xp.dailyCheckIn];
  return candidate.levels.every((item,index)=>item?.level===index+1&&typeof item.title==="string"&&Number.isInteger(item.requiredXp)
    &&(index===0?item.requiredXp===0:item.requiredXp>candidate.levels![index-1]!.requiredXp))
    &&Object.keys(candidate.xp).length===6&&weights.every((weight)=>Number.isInteger(weight)&&weight!>=0); }
export function levelRuleFrom(value: string | null): UserLevelRule { if (!value) return structuredClone(DEFAULT_RULE); try {
  const stored:unknown=JSON.parse(value); const parsed=stored&&typeof stored==="object"?{...stored,xp:{...((stored as Partial<UserLevelRule>).xp||{}),
    dailyCheckIn:(stored as Partial<UserLevelRule>).xp?.dailyCheckIn??DEFAULT_RULE.xp.dailyCheckIn}}:stored;
  return valid(parsed)?parsed:structuredClone(DEFAULT_RULE); } catch { return structuredClone(DEFAULT_RULE); } }

export function levelFrom(source: LevelSource, now = new Date()): UserLevel { const configured=levelRuleFrom(source.ruleJson); const recorded=new Set(source.dietDates);
  let streak=0; const day=new Date(now); while(recorded.has(`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}`)) {
    streak+=1; day.setDate(day.getDate()-1); }
  const baseXp=source.dietRecordCount*configured.xp.dietRecord+streak*configured.xp.streakDay+source.favoriteCount*configured.xp.recipeFavorite
    +source.postCount*configured.xp.communityPost+source.followerCount*configured.xp.follower+source.checkInCount*configured.xp.dailyCheckIn;
  const xp=Math.max(0,baseXp+source.adjustmentXp); const current=[...configured.levels].reverse().find((item)=>xp>=item.requiredXp) ?? configured.levels[0]!;
  const next=configured.levels.find((item)=>item.level===current.level+1) ?? null; return { level:current.level,title:current.title,xp,baseXp,
    adjustmentXp:source.adjustmentXp,nextXp:next?.requiredXp ?? null,progress:next?Math.min(100,Math.round(((xp-current.requiredXp)/(next.requiredXp-current.requiredXp))*100)):100 }; }

export function checkInReward(source: LevelSource) { return levelRuleFrom(source.ruleJson).xp.dailyCheckIn; }
