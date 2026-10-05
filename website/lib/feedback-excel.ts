import type { Workbook } from 'exceljs';
import { reviewDetails } from './review-export';
import { reviewScopeLabels, type ReviewsCapture } from './reviews';
import { ratingLabels, reviewRating } from './review-rating';
import { validateQuestions, type QuestionsCapture } from './questions';

type Cell = string | number;
type ExportSheet = { name: string; headers: string[]; widths: number[]; rows: Cell[][] };
export type FeedbackExport = { filename: string; count: number; sheets: ExportSheet[] };
const stamp = (time: string) => time.replace(/[^0-9TZ-]/g, '-');
const statusLabels: Record<string,string> = { complete:'问题数量已核对', complete_scope:'当前入口已读完', empty_scope:'当前入口无评价', partial:'部分已读', blocked:'访问受限', unavailable:'未完成', empty:'暂无问答', not_found:'未发现入口' };
function notes(rows: Cell[][]): ExportSheet {
  return { name:'导出说明', headers:['项目','说明'], widths:[24,90], rows };
}

export function reviewExcel(data: ReviewsCapture, at = new Date().toISOString()): FeedbackExport {
  const snapshot = reviewDetails(data, at);
  return { filename:`评价明细-${snapshot.itemId}-${stamp(at)}.xlsx`, count:snapshot.items.length, sheets:[{
    name:'评价明细', headers:['序号','商品 ID','评价 ID','评价类型','评价时间','SKU 规格','原评内容','追评时间','追评内容','默认评价','正文类型','原文已截断','读取来源'],
    widths:[8,24,26,14,24,40,70,24,70,14,16,16,40],
    rows:snapshot.items.map((row,i)=>[i+1,row.itemId,row.id,ratingLabels[reviewRating(row.rateType)],row.feedbackDate,row.sku,row.feedback,row.append?.date||'',row.append?.feedback||'',row.isDefault?'是':'否',({content:'有正文',default:'默认/未填写',template:'统一文案',empty:'无正文'})[row.textKind],row.textTruncated?'是':'否',row.sources.map(s=>`${reviewScopeLabels[s.scope]||s.scope} 第 ${s.page} 页`).join('\n')]),
  },notes([
    ['商品 ID',snapshot.itemId],['采集更新时间',snapshot.capturedAt],['导出时间',at],['已存独立评价',snapshot.items.length],
    ['当前状态',statusLabels[snapshot.status]||snapshot.status],['导出范围','导出时已保存的全部评价，不受界面筛选或展开数量影响；追评与原评同一行，不重复计数。'],
    ['完整性','当前快照，不代表平台全部评价；未采集到的内容不补写。'],['隐私','不含买家身份、登录凭据或接口密钥。'],
    ['表格安全','商品/评价 ID 和采集文本按文本保存，保留长 ID，不执行文本中的公式。'],
  ])] };
}

export function questionsExcel(data: QuestionsCapture, itemId: string, at = new Date().toISOString()): FeedbackExport {
  if (!/^[1-9]\d{0,31}$/.test(itemId)) throw new Error('无法确定商品 ID，未导出问答。');
  const safe=validateQuestions(data);
  if (!safe || safe.items.length!==data.items.length || safe.items.some((q,i)=>q.answers.length!==data.items[i].answers.length)) {
    throw new Error('问答校验未通过，未导出不完整明细。');
  }
  const answers=safe.items.reduce((n,q)=>n+q.answers.length,0);
  const rows:Cell[][]=[];
  safe.items.forEach((q,i)=>{
    // A question with no captured answer still gets a row. Equal answer text is not deduplicated here.
    const list=q.answers.length?q.answers:[''];
    list.forEach((answer,j)=>rows.push([i+1,itemId,q.id||'',q.question,q.answers.length?j+1:'',q.answerIds?.[j]||'',answer,q.answerTotal??'未知',q.answers.length,q.answers.length?'已读取':q.answerTotal===0?'来源标注无回答':'尚未读取回答']));
  });
  return { filename:`问大家-${itemId}-${stamp(at)}.xlsx`, count:safe.items.length, sheets:[{
    name:'问题与回答', headers:['问题序号','商品 ID','问题 ID','问题','回答序号','回答 ID','回答内容','标注回答数','已存回答数','读取情况'],
    widths:[12,24,26,60,12,26,85,16,16,24], rows,
  },notes([
    ['商品 ID',itemId],['采集更新时间',safe.capturedAt],['导出时间',at],['已存问题',safe.items.length],['已存回答',answers],
    ['当前状态',statusLabels[safe.status]||safe.status],['导出范围','全部已保存问题和回答；每条回答单独一行，问题信息重复显示便于筛选；无回答的问题也保留。'],
    ['完整性','当前快照，不代表平台全部问答；标注回答数不是实读数量。'],['隐私','不含买家身份、登录凭据或接口密钥。'],
  ])] };
}

export async function buildFeedbackWorkbook(data: FeedbackExport): Promise<Workbook> {
  // Loaded on demand: Excel generation does not upload records or require an API.
  const ExcelJS = await import('exceljs');
  const book = new ExcelJS.default.Workbook();
  book.creator='TAOA 竞品工作台';
  for (const table of data.sheets) {
    const sheet=book.addWorksheet(table.name,{views:[{state:'frozen',ySplit:1}]});
    sheet.columns=table.headers.map((header,i)=>({header,width:table.widths[i]||24}));
    for (const values of table.rows) sheet.addRow(values.map(value=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,''):value));
    sheet.getRow(1).height=28;
    sheet.getRow(1).eachCell(cell=>{
      cell.font={bold:true,color:{argb:'FFFFFFFF'}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFC74305'}};
    });
    sheet.eachRow((row,index)=>{
      row.alignment={vertical:'top',wrapText:true};
      if(index>1) row.eachCell(cell=>{
        // Passing strings rather than formula/hyperlink objects keeps imported content inert.
        if(typeof cell.value==='string') cell.numFmt='@';
        if(index%2===0) cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF4EC'}};
      });
    });
    sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:table.headers.length}};
  }
  return book;
}

export async function downloadFeedbackExcel(data: FeedbackExport) {
  const book=await buildFeedbackWorkbook(data);
  const bytes=await book.xlsx.writeBuffer();
  const blob=new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=data.filename;document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
