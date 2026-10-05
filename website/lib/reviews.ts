import { collectionReasons, validateQuestions, type QuestionsCapture } from './questions';
export type Review = { id:string; itemId:string; feedback:string; feedbackDate:string; sku:string; rateType:string;
  isDefault:boolean; textKind:'content'|'default'|'template'|'empty'; images:string[]; video:string; textTruncated:boolean;
  append:null|{feedback:string;date:string;intervalDay:string;reply:string;images:string[];video:string};
  sources:{scope:string;page:number;profile?:string}[] };
export const reviewScopeLabels:Record<string,string>={all:'普通列表',append:'追评列表',media:'图/视频补采',good:'好评补采',neutral:'中评补采',bad:'差评补采'};
const scopeKeys=Object.keys(reviewScopeLabels);
export type ReviewPage = {scope:string;page:number;profile?:string;pageSize?:number;returned:number;added:number;uniqueAdded:number|null;hasNext:boolean|null;total:number|null;totalPage:number|null};
export type ReviewScope = {scope:string;pages:number;readCount:number;total:number|null;platformTotal:string;
  uniqueAdded:number|null;initialTotal:number|null;totalChanged:boolean;profile?:string;pageSize?:number;
  timePeriod:string;folded:number|null;history:string;complete:boolean;ended:boolean;reason:string};
export type ReviewsCapture = {itemId:string;status:string;items:Review[];scopes:ReviewScope[];message:string;capturedAt:string;qa?:QuestionsCapture|null;
  coverage?:{mode:'recent';discoveryDone:boolean;availableScopes:string[];supplementalAdded:number;fullCoverageVerified:false;requestProfile?:string;retainedCount?:number;addedSinceStart?:number};
  pageTrace?:ReviewPage[];job?:{id:string;state:string;stage?:string;canResume:boolean;updatedAt:string;nextRunAt:string;reason?:string;verificationPending?:boolean};progress?:{nextPage:number;scope:string;savedCount:number}};
const text=(x:unknown,n=5000)=>typeof x==='string'?x.trim().slice(0,n):'';
const object=(x:unknown):Record<string,unknown>|null=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null;
const id=(x:unknown)=>typeof x==='string'&&/^[1-9]\d{0,31}$/.test(x);
const count=(x:unknown)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0?x:null;
const profile=(x:unknown)=>['pc-all50-v1','pc-filter20-v1','pc-legacy20-v1'].includes(String(x))?String(x):undefined;
const pageSize=(x:unknown)=>x===20||x===50?x:undefined;
function media(x:unknown){try{const u=new URL(text(x,3000));return u.protocol==='https:'&&!u.username&&!u.password&&['alicdn.com','taobao.com','tmall.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d))?u.href:''}catch{return ''}}
const images=(x:unknown)=>Array.isArray(x)?[...new Set(x.map(media).filter(Boolean))].slice(0,20):[];
const isDefault=(s:string)=>/该用户.{0,8}(?:未|没有).{0,8}(?:评价|评论)|系统默认(?:好评|评价)|此用户没有填写评价|^\d+天内买家未作出评价[。！!]?$/u.test(s);
const textKind=(s:string):Review['textKind']=>!s?'empty':isDefault(s)?'default':/^该用户觉得商品非常好[，,]给出好评[。！!]?$/u.test(s)?'template':'content';
export const reviewHasContent=(r:Review)=>textKind(r.feedback)==='content'||textKind(r.append?.feedback||'')==='content';
export function reviewCounts(items:Review[]){return {total:items.length,
  content:items.filter(r=>textKind(r.feedback)==='content').length,
  default:items.filter(r=>textKind(r.feedback)==='default').length,
  template:items.filter(r=>textKind(r.feedback)==='template').length,
  empty:items.filter(r=>textKind(r.feedback)==='empty').length,
  append:items.filter(r=>textKind(r.append?.feedback||'')==='content').length,
  contentRecords:items.filter(reviewHasContent).length};}
export function validateReviews(value:unknown,itemId:string):ReviewsCapture|null{
  const x=object(value);if(!x||!id(itemId)||x.itemId!==itemId||!Array.isArray(x.items))return null;
  const seen=new Set<string>();const items:Review[]=[];let dropped=false;
  for(const raw of x.items.slice(0,10000)){
    const r=object(raw);if(!r||r.itemId!==itemId||!id(r.id)){dropped=true;continue}
    const key=r.id as string;if(seen.has(key)){dropped=true;continue}seen.add(key);
    const a=object(r.append),feedback=text(r.feedback);
    items.push({id:key,itemId,feedback,feedbackDate:text(r.feedbackDate,100),sku:text(r.sku,500),rateType:text(typeof r.rateType==='number'?String(r.rateType):r.rateType,30),
      isDefault:isDefault(feedback),textKind:textKind(feedback),images:images(r.images),video:media(r.video),textTruncated:r.textTruncated===true,
      append:a?{feedback:text(a.feedback),date:text(a.date,100),intervalDay:text(a.intervalDay,30),reply:text(a.reply),images:images(a.images),video:media(a.video)}:null,
      sources:Array.isArray(r.sources)?r.sources.map(object).filter(s=>s&&scopeKeys.includes(String(s.scope))&&count(s.page)!==null&&Number(s.page)>0&&Number(s.page)<=1000).slice(-100).map(s=>({scope:s!.scope as string,page:s!.page as number,profile:profile(s!.profile)})):[]});
  }
  const seenScopes=new Set<string>();
  const scopes:ReviewScope[]=Array.isArray(x.scopes)?x.scopes.slice(0,6).map(object).filter(s=>{if(!s||!scopeKeys.includes(String(s.scope))||seenScopes.has(String(s.scope)))return false;seenScopes.add(String(s.scope));return true}).map(s=>({
    scope:s!.scope as string,pages:count(s!.pages)||0,readCount:count(s!.readCount)||0,total:count(s!.total),platformTotal:text(s!.platformTotal,60),profile:profile(s!.profile),pageSize:pageSize(s!.pageSize),
    uniqueAdded:count(s!.uniqueAdded),initialTotal:count(s!.initialTotal),totalChanged:s!.totalChanged===true,
    timePeriod:text(s!.timePeriod,100),folded:count(s!.folded),history:text(s!.history,60),complete:s!.complete===true&&s!.totalChanged!==true,
    ended:s!.ended===true||s!.complete===true||s!.reason==='count_mismatch',reason:text(s!.reason,60)})):[];
  const states=['complete_scope','empty_scope','partial','blocked','unavailable'];
  let status=states.includes(String(x.status))?String(x.status):'unavailable';
  const complete=['all','append'].every(k=>scopes.some(s=>s.scope===k))&&scopes.every(s=>s.complete);
  if((status==='complete_scope'||status==='empty_scope')&&(!complete||dropped||x.items.length>10000||(status==='empty_scope'&&items.length>0)))status=items.length?'partial':'unavailable';
  const j=object(x.job),p=object(x.progress);
  const job=j&&typeof j.id==='string'&&/^[a-f0-9-]{36}$/.test(j.id)&&['running','paused','complete','exhausted'].includes(String(j.state))
    ?{id:j.id,state:String(j.state),stage:j.stage==='qa'?'qa':'reviews',canResume:j.canResume===true,updatedAt:text(j.updatedAt,80),nextRunAt:text(j.nextRunAt,80),
      reason:collectionReasons.has(String(j.reason))?String(j.reason):undefined,verificationPending:j.verificationPending===true}:undefined;
  const progress=p&&[...scopeKeys,''].includes(String(p.scope))?{nextPage:count(p.nextPage)||1,
    scope:scopes.some(s=>s.scope===p.scope&&s.ended)?'':String(p.scope),savedCount:items.length}:undefined;
  const pageTrace:ReviewPage[]=Array.isArray(x.pageTrace)?x.pageTrace.slice(-100).map(object).filter(p=>p&&scopeKeys.includes(String(p.scope))&&count(p.page)!==null&&count(p.returned)!==null&&count(p.added)!==null).map(p=>({
    scope:String(p!.scope),page:count(p!.page)!,returned:count(p!.returned)!,added:count(p!.added)!,
    uniqueAdded:count(p!.uniqueAdded),profile:profile(p!.profile),pageSize:pageSize(p!.pageSize),
    hasNext:typeof p!.hasNext==='boolean'?p!.hasNext:null,total:count(p!.total),totalPage:count(p!.totalPage)})):[];
  const c=object(x.coverage);
  const retained=c&&count(c.retainedCount)!==null&&Number(c.retainedCount)<=items.length?Number(c.retainedCount):undefined;
  const coverage:ReviewsCapture['coverage']=c?.mode==='recent'?{mode:'recent',discoveryDone:c.discoveryDone===true,
    availableScopes:Array.isArray(c.availableScopes)?[...new Set(c.availableScopes.filter((s):s is string=>typeof s==='string'&&scopeKeys.slice(2).includes(s)))]:[],
    supplementalAdded:items.filter(r=>r.sources.some(s=>scopeKeys.slice(2).includes(s.scope))&&!r.sources.some(s=>['all','append'].includes(s.scope))).length,
    fullCoverageVerified:false,requestProfile:profile(c.requestProfile),retainedCount:retained,
    addedSinceStart:retained===undefined?undefined:items.length-retained}:undefined;
  return{itemId,status,items,scopes,message:text(x.message,500),capturedAt:text(x.capturedAt,80),job,progress,pageTrace,coverage,qa:validateQuestions(x.qa)};
}

// Export only pagination evidence, never raw requests, identities or review text.
export function reviewDiagnostic(data:ReviewsCapture,platformLabel:string){
  const safe=validateReviews(data,data.itemId);
  if(!safe)throw new Error('评价数据无法校验');
  return{schemaVersion:1,itemId:safe.itemId,capturedAt:safe.capturedAt,platformLabel:text(platformLabel,60),
    uniqueRead:safe.items.length,counts:reviewCounts(safe.items),status:safe.status,message:safe.message,scopes:safe.scopes,
    pagination:safe.pageTrace,coverage:safe.coverage,traceLimit:100};
}
