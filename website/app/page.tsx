'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Upload, X, MessageSquarePlus } from 'lucide-react';
import { ProductInformation } from '@/components/product-information';
import { ImageGallery } from '@/components/image-gallery';
import { QuestionsPanel } from '@/components/questions-panel';
import { ProductParameters } from '@/components/product-parameters';
import { ReviewsPanel } from '@/components/reviews-panel';
import { ProductDetails } from '@/components/product-details';
import { OpportunityPanel, type OpportunityPanelHandle } from '@/components/opportunity-panel';
import { hostAIAdapter } from '@/lib/host-ai-adapter';
import { hasAnalysisData, pushScopeLabels, type AnalysisInput, type ReviewPushScope } from '@/lib/analysis-packet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { validateReviews, type ReviewsCapture } from '@/lib/reviews';
import { requestSavedReviews } from '@/lib/review-export';
import { validateQuestions, type QuestionsCapture } from '@/lib/questions';

import { normalizeParameters, normalizeShopMetrics, type ProductParameter } from '@/lib/product-parameters';

const initialUrl = '';
type CaptureStatus = 'success' | 'blocked' | 'failed';
type ProductCapture = {
  categoryPath?:string; categorySource?:string; listedAt?:string; listedAtSource?:string;
  parameters?:ProductParameter[]; shopMetrics?:ProductParameter[]; reviewData:ReviewsCapture|null; qa:QuestionsCapture|null;
  schemaVersion:number; status:CaptureStatus; sourceUrl:string; finalUrl:string; title:string; shop:string; price:string;
  sales:string; reviewCount:string; shopRating:string; positiveRate:string; serviceScore:string; itemId:string; skuId:string;
  mainImages:string[]; skuImages:string[]; detailImages:string[]; skuOptions:string[]; attributes:string[]; pageText:string; capturedAt:string; message:string;
};
type ModelContextApi = { registerTool:(tool:{name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown}, options?:{signal?:AbortSignal})=>void|Promise<void> };
const blankCapture:ProductCapture = { reviewData:null,qa:null,schemaVersion:3,status:'failed',sourceUrl:'',finalUrl:'',title:'',shop:'',price:'',sales:'',reviewCount:'',shopRating:'',positiveRate:'',serviceScore:'',itemId:'',skuId:'',mainImages:[],skuImages:[],detailImages:[],skuOptions:[],attributes:[],pageText:'',capturedAt:'',message:'' };
const cleanString=(v:unknown,max=1000)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
function cleanList(v:unknown,maxItems:number,maxLength:number,urls=false){if(!Array.isArray(v))return [];return [...new Set(v.map(x=>cleanString(x,maxLength)).filter(x=>x&&(!urls||/^https?:\/\//i.test(x))))].slice(0,maxItems)}
function validateCapture(value:unknown):ProductCapture|null{if(!value||typeof value!=='object')return null;const x=value as Record<string,unknown>;const status=['success','blocked','failed'].includes(String(x.status))?x.status as CaptureStatus:'failed';return {categoryPath:cleanString(x.categoryPath,500),categorySource:cleanString(x.categorySource,120),listedAt:cleanString(x.listedAt,40),listedAtSource:cleanString(x.listedAtSource,120),parameters:Array.isArray(x.parameters)?normalizeParameters(x.parameters):undefined,shopMetrics:normalizeShopMetrics(x.shopMetrics),reviewData:validateReviews(x.reviewData,cleanString(x.itemId,40)),qa:validateQuestions(x.qa),schemaVersion:Number(x.schemaVersion)||1,status,sourceUrl:cleanString(x.sourceUrl,3000),finalUrl:cleanString(x.finalUrl,3000),title:typeof x.title==='string'?x.title.replace(/[\t\r\n]+/g,' ').trim().slice(0,300):'',shop:cleanString(x.shop,160),price:cleanString(x.price,80),sales:cleanString(x.sales,60),reviewCount:cleanString(x.reviewCount,60),shopRating:cleanString(x.shopRating,60),positiveRate:cleanString(x.positiveRate,60),serviceScore:normalizeShopMetrics(x.shopMetrics).find(row=>row.name==='客服满意度')?.value||'',itemId:cleanString(x.itemId,40),skuId:cleanString(x.skuId,40),mainImages:cleanList(x.mainImages,12,3000,true),skuImages:cleanList(x.skuImages,80,3000,true),detailImages:cleanList(x.detailImages,120,3000,true),skuOptions:cleanList(x.skuOptions,100,80),attributes:cleanList(x.attributes,100,200),pageText:cleanString(x.pageText,18000),capturedAt:cleanString(x.capturedAt,80),message:cleanString(x.message,300)}}
function idsFromUrl(value:string){try{const p=new URL(value);return {itemId:p.searchParams.get('id')||'',skuId:p.searchParams.get('skuId')||''}}catch{return {itemId:'',skuId:''}}}
function isProductUrl(value:string){return /^https:\/\/[^/]*(taobao|tmall)\.com\//i.test(value)}
export default function Home(){
  const discussion=useRef<OpportunityPanelHandle>(null);
  const [reviewPushScope,setReviewPushScope]=useState<ReviewPushScope>('bad');
  const [reviewProgress,setReviewProgress]=useState<ReviewsCapture|null>(null);
  const activeItem=useRef('');
  const [loadingSaved,setLoadingSaved]=useState(false);
  useEffect(()=>{function receive(e:MessageEvent){
    if(e.source!==window||e.origin!==window.location.origin)return;
    if(e.data?.type==='TAOA_REVIEW_ERROR'){setNotice(cleanString(e.data.message,300));return}
    let raw:unknown,item='';
    if(e.data?.type==='TAOA_PRODUCT_CAPTURE'){item=cleanString(e.data.payload?.itemId,40);activeItem.current=item;raw=e.data.payload?.reviewData}
    else if(e.data?.type==='TAOA_REVIEW_PROGRESS'){item=cleanString(e.data.payload?.itemId,40);raw=e.data.payload}
    else return;
    if(item!==activeItem.current)return;
    const safe=validateReviews(raw,item);if(!safe){if(e.data?.type==='TAOA_PRODUCT_CAPTURE')setReviewProgress(null);return;}
    setReviewProgress(previous=>previous?.itemId===item&&previous.job?.updatedAt&&safe.job?.updatedAt&&previous.job.updatedAt>safe.job.updatedAt?previous:safe);
    setCapture(previous=>previous?.itemId===item
      && !(previous.reviewData?.job?.updatedAt && safe.job?.updatedAt && previous.reviewData.job.updatedAt > safe.job.updatedAt)
      ?{...previous,reviewData:safe,qa:safe.qa||previous.qa}:previous);
  }window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[]);

  const [url,setUrl]=useState(initialUrl); const [capture,setCapture]=useState<ProductCapture|null>(null); const [questionsFresh,setQuestionsFresh]=useState(true); const [reviewFile,setReviewFile]=useState(''); const [checking,setChecking]=useState(false); const [notice,setNotice]=useState(''); const [sales,setSales]=useState(''); const [reviews,setReviews]=useState(''); const [rating,setRating]=useState(''); const [note,setNote]=useState(''); const [preview,setPreview]=useState<{src:string;label:string}|null>(null);
  useEffect(()=>{window.localStorage.removeItem('taoa-last-capture');function receive(e:MessageEvent){if(e.source!==window||e.origin!==window.location.origin)return;if(e.data?.type==='TAOA_CAPTURE_STARTED'){setQuestionsFresh(false);document.documentElement.dataset.taoaCaptureRequest='started';setChecking(true);setNotice('采集器已接收任务，正在后台读取商品页…')}if(e.data?.type==='TAOA_PRODUCT_CAPTURE'){document.documentElement.dataset.taoaCaptureRequest='done';const safe=validateCapture(e.data.payload);if(!safe)return;setQuestionsFresh(true);setCapture(safe);setSales(safe.sales);setReviews(safe.reviewCount);setRating(safe.shopRating);setChecking(false);if(isProductUrl(safe.sourceUrl))setUrl(safe.sourceUrl);setNotice(safe.status==='success'?'商品页面采集完成；评价和问答的读取范围见各自板块。':safe.message||'页面采集未完成。')}if(e.data?.type==='TAOA_CAPTURE_ERROR'){setQuestionsFresh(false);document.documentElement.dataset.taoaCaptureRequest='done';setChecking(false);setNotice(cleanString(e.data.message,300)||'采集器未能启动。')}if(e.data?.type==='TAOA_DOWNLOAD_RESULT'){const downloaded=Number(e.data.downloaded)||0;const failed=Number(e.data.failed)||0;setNotice(failed?`已打包 ${downloaded} 张，${failed} 张读取失败。`:`已打包 ${downloaded} 张图片并开始下载。`)}if(e.data?.type==='TAOA_DOWNLOAD_ERROR'){setNotice(cleanString(e.data.message,300)||'图片打包失败，请确认已重新加载最新版采集器。')}}window.addEventListener('message',receive);window.postMessage({type:'TAOA_REQUEST_CAPTURE'},window.location.origin);return()=>window.removeEventListener('message',receive)},[]);
  useEffect(()=>{const context=(document as Document&{modelContext?:ModelContextApi}).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();const r=context.registerTool({name:'stage_product_url',title:'填写待分析商品链接',description:'把一个淘宝或天猫商品链接填入竞品分析工作台。',inputSchema:{type:'object',properties:{productUrl:{type:'string'}},required:['productUrl'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){const p=typeof input==='object'&&input!==null&&'productUrl'in input&&typeof input.productUrl==='string'?input.productUrl.trim():'';if(!isProductUrl(p))throw new Error('请输入有效的淘宝或天猫商品链接。');setUrl(p);setNotice('商品链接已填入。');return {status:'staged',productUrl:p}}},{signal:lifecycle.signal});void Promise.resolve(r).catch(()=>undefined);return()=>lifecycle.abort()},[]);
  const data=capture||blankCapture;const ids=idsFromUrl(url);const itemId=data.itemId||ids.itemId||'待识别';const isSuccess=data.status==='success'&&Boolean(data.capturedAt);
  const liveReviews=reviewProgress||(questionsFresh&&!checking?data.reviewData:null);
  const liveQa=liveReviews?.qa||(questionsFresh&&!checking?data.qa:null);
  const productFresh=!checking&&questionsFresh&&(!liveReviews?.itemId||liveReviews.itemId===data.itemId);
  const analysisItem=liveReviews?.itemId||(productFresh?data.itemId:activeItem.current)||'';
  const analysisInput:AnalysisInput={itemId:analysisItem,title:productFresh?data.title:'',price:productFresh?data.price:'',capturedAt:productFresh?data.capturedAt:'',
    categoryPath:productFresh?data.categoryPath:'',categorySource:productFresh?data.categorySource:'',listedAt:productFresh?data.listedAt:'',listedAtSource:productFresh?data.listedAtSource:'',
    sourceUrl:productFresh?data.sourceUrl:'',shop:productFresh?data.shop:'',sales:productFresh?sales:'',reviewCount:productFresh?reviews:'',shopRating:productFresh?rating:'',positiveRate:productFresh?data.positiveRate:'',serviceScore:productFresh?data.serviceScore:'',
    parameters:productFresh?data.parameters:[],shopMetrics:productFresh?data.shopMetrics:[],attributes:productFresh?data.attributes:[],pageText:productFresh?data.pageText:'',mainImages:productFresh?data.mainImages:[],skuImages:productFresh?data.skuImages:[],detailImages:productFresh?data.detailImages:[],skuOptions:productFresh?data.skuOptions:[],
    note,reviewData:liveReviews,qa:liveQa,collecting:checking};
  useEffect(()=>{setReviewPushScope('bad');setNote('')},[analysisItem]);
  // Read only the extension's saved checkpoint if a pushed update was missed.
  // This status request never starts or resumes a collector job.
  useEffect(()=>{
    if(liveReviews?.job?.state!=='running')return;
    const item=liveReviews.itemId;
    function refresh(){if(document.visibilityState==='visible'&&activeItem.current===item)window.postMessage({type:'TAOA_REVIEW_STATUS',itemId:item},window.location.origin)}
    const timer=window.setInterval(refresh,10000);
    document.addEventListener('visibilitychange',refresh);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh)};
  },[liveReviews?.itemId,liveReviews?.job?.id,liveReviews?.job?.state]);
  function controlCollection(action:'pause'|'resume'){
    if(!liveReviews?.job)return;
    const label=liveReviews.job.stage==='qa'?'问大家':'评价';
    setNotice(action==='pause'?`正在暂停${label}，当前已发请求结束后保存进度。`:`正在继续已保存的${label}进度。`);
    window.postMessage({type:'TAOA_REVIEW_CONTROL',itemId:liveReviews.itemId,jobId:liveReviews.job.id,action},window.location.origin);
  }
  function startCapture(){if(!isProductUrl(url)){setNotice('请输入有效的淘宝或天猫商品链接。');return}activeItem.current=idsFromUrl(url).itemId;setReviewProgress(null);setQuestionsFresh(false);document.documentElement.dataset.taoaCaptureRequest='pending';setChecking(true);setNotice('正在请求采集器后台读取商品页…');window.postMessage({type:'TAOA_START_CAPTURE',url},window.location.origin);window.setTimeout(()=>{if(document.documentElement.dataset.taoaCaptureRequest==='pending'){setChecking(false);setNotice('未检测到淘啊竞品采集器。请先重新加载采集器扩展。')}},3000)}
  function downloadImages(images:string[],group:'main'|'detail'|'sku'){const label=group==='sku'?'SKU图':group==='main'?'主图':'详情图';if(!images.length){setNotice(`暂无${label}可下载。`);return}setNotice(`正在打包 ${images.length} 张${label}…`);window.postMessage({type:'TAOA_DOWNLOAD_IMAGES',urls:images,group,itemId:itemId==='待识别'?'':itemId},window.location.origin)}
  async function loadSavedReviews(){
    if(checking||loadingSaved)return;
    const target=/^[1-9]\d{0,31}$/.test(url.trim())?url.trim():isProductUrl(url)?idsFromUrl(url).itemId:'';
    if(!/^[1-9]\d{0,31}$/.test(target)){setNotice('请先填写商品链接或商品 ID。');return}
    setLoadingSaved(true);activeItem.current=target;setNotice('正在读取当前浏览器已保存的评价，不发起采集…');
    try{
      const saved=await requestSavedReviews(target);
      if(activeItem.current!==target)return;
      setReviewProgress(saved);
      if(capture?.itemId!==target){setCapture({...blankCapture,itemId:target,reviewData:saved,qa:saved.qa||null});setSales('');setReviews('');setRating('');setQuestionsFresh(Boolean(saved.qa))}
      else if(saved.qa){setCapture(previous=>previous?{...previous,qa:saved.qa||previous.qa}:previous);setQuestionsFresh(true)}
      setNotice(`已读取本地保存的 ${saved.items.length} 条评价；未重新采集，可以导出明细。`);
    }catch(error){if(activeItem.current===target)setNotice(error instanceof Error?error.message:'读取失败，原数据未改动。')}
    finally{setLoadingSaved(false)}
  }
  function startAnalysis(){discussion.current?.pushData()}
  const statusText=isSuccess?'采集完成':data.status==='blocked'?'页面访问受限':'等待采集';
  return <main className="workbench min-h-screen text-foreground"><div className="mx-auto max-w-[1620px] px-4 pb-10 pt-6 sm:px-6 lg:px-8">
    <header className="workbench-header mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[24px] font-bold tracking-tight text-foreground">竞品分析</h1><p className="mt-1 text-sm text-muted-foreground">输入商品链接或 ID，采集后推送资料准备分析</p></div><div className="flex flex-wrap items-center gap-2"><span id="push-review-label" className="text-sm font-medium">评价推送</span><Select value={reviewPushScope} onValueChange={value=>setReviewPushScope((value||'bad') as ReviewPushScope)} items={Object.entries(pushScopeLabels).map(([value,label])=>({value,label}))}><SelectTrigger aria-labelledby="push-review-label" className="h-10 bg-white"><SelectValue/></SelectTrigger><SelectContent>{Object.entries(pushScopeLabels).map(([key,label])=><SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select><button type="button" onClick={startAnalysis} disabled={!hasAnalysisData(analysisInput)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40"><MessageSquarePlus className="size-4"/>一键推送到分析对话</button></div></header>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(290px,.82fr)_minmax(360px,1.04fr)_minmax(360px,1.12fr)]">
      <div className="grid min-w-0 content-start gap-4">
        <ProductInformation
          url={url} onUrlChange={setUrl} checking={checking} loadingSaved={loadingSaved}
          onCapture={startCapture} onLoadSaved={loadSavedReviews} onAnalyze={startAnalysis}
          product={data} itemId={itemId} status={isSuccess?'页面采集完成':'采集状态：'+statusText}
          sales={sales} reviews={reviews} rating={rating} note={note}
          onSalesChange={setSales} onReviewsChange={setReviews} onRatingChange={setRating} onNoteChange={setNote}
        />
        <ReviewsPanel platformLabel={(!reviewProgress||reviewProgress.itemId===data.itemId)?data.reviewCount:""}
          data={liveReviews} checking={checking} onControl={controlCollection}
          supplement={<details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-sm font-semibold">评价文件补充（备用）</summary>
            <label className="mt-2.5 flex min-h-[88px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white text-center">
              <Upload className="size-5 text-primary"/><span className="mt-1 text-sm font-medium text-muted-foreground">{reviewFile||'上传商品评价数据'}</span>
              <span className="mt-1 text-xs text-muted-foreground">支持 XLSX、XLS、CSV，最大 20MB</span>
              <input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={e=>setReviewFile(e.target.files?.[0]?.name||'')}/>
            </label>
            <p className="mt-2 rounded-lg bg-secondary p-2.5 text-xs leading-5 text-muted-foreground">此备用入口目前只记录文件名，尚未解析附件，也不会计入已采集数量。</p>
          </details>}
        />
      </div>
      <div className="grid min-w-0 content-start gap-4">
        <ImageGallery kind="main" images={data.mainImages} onDownload={()=>downloadImages(data.mainImages,'main')} onPreview={(src,label)=>setPreview({src,label})}/>
        <ImageGallery kind="sku" images={data.skuImages} onDownload={()=>downloadImages(data.skuImages,'sku')} onPreview={(src,label)=>setPreview({src,label})}/>
        <ProductDetails images={data.detailImages} onDownload={()=>downloadImages(data.detailImages,'detail')} onPreview={(src,label)=>setPreview({src,label})}/>
      </div>
      <div className="grid min-w-0 content-start gap-4">
        <ProductParameters attributes={data.attributes} parameters={data.parameters} pageText={data.pageText} checking={checking}/>
        <QuestionsPanel key={liveReviews?.itemId||data.itemId} itemId={data.itemId} qa={liveQa} reviewData={liveReviews} checking={checking} onControl={controlCollection}/>
      </div>
      <OpportunityPanel ref={discussion} key={analysisItem||'empty'} input={analysisInput} reviewScope={reviewPushScope} hostAI={hostAIAdapter}/>
    </div>{preview&&<div role="dialog" aria-modal="true" aria-label={preview.label} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/85 p-4" onClick={()=>setPreview(null)}><button type="button" onClick={()=>setPreview(null)} aria-label="关闭大图" className="absolute right-5 top-5 grid size-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"><X className="size-5"/></button><div className="flex max-h-[94vh] max-w-[94vw] flex-col items-center" onClick={e=>e.stopPropagation()}><img src={preview.src} alt={preview.label} className="max-h-[88vh] max-w-[94vw] object-contain" referrerPolicy="no-referrer"/><p className="mt-3 rounded-full bg-black/40 px-3 py-1 text-sm text-white">{preview.label}</p></div></div>}{notice&&<p role="status" className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{notice}</p>}<footer className="mt-4 flex justify-between px-1 text-sm text-muted-foreground"><span>数据仅保存在当前浏览器与本地扩展</span><a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">查看原商品链接 <ExternalLink className="size-3"/></a></footer>
  </div></main>
}
