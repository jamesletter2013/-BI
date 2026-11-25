const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../public/core.js');
const catalog=[{code:'DEMO-SKU-001',name:'演示小号',tmall:null,sale:1200,cost:500},{code:'DEMO-SKU-002',name:'演示中号',tmall:null,sale:1800,cost:600},{code:'DEMO-SKU-003',name:'演示大号',tmall:null,sale:2400,cost:800}];
test('同一编码不同名称逐行保留并计算减钱及毛利',()=>{
 const rows=C.calculatePaste('SKU\t价格\tsku商家编码\n演示小号\t20.00\tDEMO-SKU-001\n演示小号✅\t25.00\tDEMO-SKU-001',catalog);
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.skuName),['演示小号','演示小号✅']);assert.deepEqual(rows.map(r=>r.difference),[800,1300]);assert.equal(rows[0].jstMargin,7/12);
});
test('两列、列顺序互换及逐字段换行输入',()=>{
 for(const value of ['20.00\tDEMO-SKU-001','DEMO-SKU-001 20.00','演示小号\n20.00\nDEMO-SKU-001\n12/64'])assert.equal(C.calculatePaste(value,catalog)[0].difference,800);
});
test('零值和负减钱有效，缺失不能转为零',()=>{
 assert.equal(C.calculatePaste('0 DEMO-SKU-001',catalog)[0].difference,-1200);
 assert.equal(C.calculatePaste('12.00 DEMO-SKU-001',catalog)[0].difference,0);
 assert.equal(C.calculatePaste('价格\tsku商家编码\n\tDEMO-SKU-001',catalog)[0].difference,null);
 assert.equal(C.calculatePaste('20.00 UNKNOWN-SKU',catalog)[0].difference,null);
});
test('毛利独立于天猫价格并保留成本原始精度',()=>{
 const cases=[[1000,0,1],[1000,1500,-0.5],[0,0,null],[null,300,null],[1000,null,null],[1000,1234.56,-0.23456]];
 for(const [sale,cost,expected] of cases){const row=C.calculatePaste('价格\tsku商家编码\n\tDEMO-SKU-001',[{code:'DEMO-SKU-001',sale,cost}])[0];assert.equal(row.difference,null);expected===null?assert.equal(row.jstMargin,null):assert(Math.abs(row.jstMargin-expected)<1e-12);}
});
test('相同编码冲突价格阻止整批导入，空白输入不覆盖原值',()=>{
 const map={code:0,sale:1,cost:2,name:-1};
 assert.equal(C.buildImport([['DEMO-SKU-001','12.00','5.00'],['demo-sku-001','13.00','5.00']],map,'jst',catalog,'测试').problems.length,1);
 const result=C.buildImport([['DEMO-SKU-001','13.00','']],map,'jst',catalog,'测试');
 assert.equal(result.rows[0].sale,1300);assert.equal(result.rows[0].cost,500);
});

test('组合成本保留四位精度，卖价舍入到分，缺失和零值分开处理',()=>{
 assert.equal(C.bundleSaleFromCost(937),3123);
 assert.equal(C.bundleSaleFromCost(1234.56),4115);
 assert.equal(C.bundleSaleFromCost(3456.78),11523);
 assert.equal(C.bundleSaleFromCost(0.15),1);
 assert.equal(C.bundleSaleFromCost(0),0);
 for(const missing of [null,undefined,NaN,Infinity,-1])assert.equal(C.bundleSaleFromCost(missing),null);
});

test('普通商品保留原卖价，卖价缺失不能自动套组合公式',()=>{
 const ordinary={code:'DEMO-SKU-REGULAR',kind:'single',tmall:5000,sale:1750,cost:1234.56};
 assert.equal(C.resolvePricing(ordinary).sale,1750);
 assert.equal(C.difference(ordinary),3250);
 assert.equal(C.resolvePricing({...ordinary,cost:null}).sale,1750);
 assert.equal(C.resolvePricing({...ordinary,sale:null}).sale,null);
 const inferred={code:'DEMO-SKU-NOT-A-BUNDLE',sale:null,cost:937};
 assert.equal(C.resolvePricing(inferred).kind,'single');
 assert.equal(C.resolvePricing(inferred).sale,null);
});

test('明确的组合使用总成本计算，忽略原基本售价，修改成本后重新求值',()=>{
 const bundle={code:'DEMO-SKU-BUNDLE',kind:'bundle',tmall:5000,cost:937,sale:9999900};
 assert.equal(C.resolvePricing(bundle).sale,3123);
 assert.equal(C.difference(bundle),1877);
 assert.equal(C.resolvePricing({...bundle,cost:1234.56}).sale,4115);
 const missing=C.resolvePricing({...bundle,cost:null});
 assert.equal(missing.sale,null);assert.match(missing.issue,/成本/);
 assert.equal(C.resolvePricing({...bundle,cost:0}).sale,0);
});

test('组合导入按父编码去重，不累加子件行，缺成本组合仍保留',()=>{
 const map={code:0,cost:1,name:2,sale:-1,tmall:-1};
 const source=[['DEMO-SKU-KIT-A','9.37','演示组合甲','DEMO-SKU-CHILD-A'],['demo-sku-kit-a','9.37','演示组合甲','DEMO-SKU-CHILD-B'],['DEMO-SKU-KIT-EMPTY','','待补成本组合','DEMO-SKU-CHILD-C'],['DEMO-SKU-KIT-ZERO','0','零成本组合','DEMO-SKU-CHILD-D']];
 const snapshot=JSON.stringify(catalog);
 const result=C.buildImport(source,map,'bundle',catalog,'虚构组合资料');
 assert.equal(result.problems.length,0);assert.equal(result.preview.length,3);assert.equal(result.added,3);assert.equal(result.rows.length,catalog.length+3);
 const lookup=new Map(result.rows.map(r=>[C.normalize(r.code),r]));
 assert.equal(C.resolvePricing(lookup.get('DEMO-SKU-KIT-A')).cost,937);
 assert.equal(C.resolvePricing(lookup.get('DEMO-SKU-KIT-A')).sale,3123);
 assert.equal(lookup.get('DEMO-SKU-KIT-EMPTY').kind,'bundle');
 assert.equal(lookup.get('DEMO-SKU-KIT-EMPTY').cost,null);assert.equal(lookup.get('DEMO-SKU-KIT-EMPTY').sale,null);
 assert.equal(C.resolvePricing(lookup.get('DEMO-SKU-KIT-ZERO')).sale,0);
 assert(!lookup.has('DEMO-SKU-CHILD-A'));
 for(const row of catalog){const preserved=lookup.get(C.normalize(row.code));assert.equal(preserved.sale,row.sale);assert.equal(preserved.cost,row.cost);}
 assert.equal(JSON.stringify(catalog),snapshot);
});

test('组合自动映射父编码和总成本列，不选择子件字段',()=>{
 const headers=['组合商品编码','组合商品名称','组合成本价','商品编码','子商品成本价','数量','基本售价'];
 assert.equal(C.findColumn(headers,'code','bundle'),0);
 assert.equal(C.findColumn(headers,'cost','bundle'),2);
 assert.equal(C.findColumn(headers,'name','bundle'),1);
 assert.equal(C.detectHeader([['虚构资料说明'],headers],'bundle'),1);
});

test('组合总成本冲突及普通与组合同码均阻止导入',()=>{
 const map={code:0,cost:1,name:2,sale:-1,tmall:-1};
 assert(C.buildImport([['DEMO-SKU-CONFLICT','4.44','组合'],['demo-sku-conflict','4.45','组合']],map,'bundle',[],'虚构冲突').problems.length>0);
 assert(C.buildImport([['DEMO-SKU-001','4.44','组合']],map,'bundle',catalog,'虚构跨类型冲突').problems.length>0);
 const bundle={code:'DEMO-SKU-KIT-ONLY',kind:'bundle',cost:444,sale:1480,tmall:null};
 assert(C.buildImport([[bundle.code,'20.00','4.44']],{code:0,sale:1,cost:2,name:-1,tmall:-1},'jst',[bundle],'虚构反向冲突').problems.length>0);
});

test('合并备份保留商品类型，组合恢复后仍按成本计算',()=>{
 const map={code:0,name:1,tmall:2,sale:3,cost:4,kind:5};
 const rows=[['DEMO-SKU-BACKUP-REGULAR','普通备份','50.00','22.50','3.50','普通商品'],['DEMO-SKU-BACKUP-KIT','组合备份','50.00','999.00','12.3456','组合装'],['DEMO-SKU-BACKUP-EMPTY','缺成本组合','50.00','','','组合装']];
 const result=C.buildImport(rows,map,'combined',[],'虚构备份');assert.equal(result.problems.length,0);assert.equal(result.rows.length,3);
 const lookup=new Map(result.rows.map(r=>[C.normalize(r.code),r]));
 assert.equal(C.resolvePricing(lookup.get('DEMO-SKU-BACKUP-REGULAR')).sale,2250);
 const bundle=lookup.get('DEMO-SKU-BACKUP-KIT');assert.equal(bundle.kind,'bundle');assert.equal(bundle.cost,1234.56);assert.equal(C.resolvePricing(bundle).sale,4115);
 const empty=lookup.get('DEMO-SKU-BACKUP-EMPTY');assert.equal(empty.kind,'bundle');assert.equal(C.resolvePricing(empty).sale,null);
});

test('仅负减钱显示一口价更正，零值、正值和缺价行留空',()=>{
 const source=[{code:'DEMO-SKU-CORRECT',sale:1980,cost:null},{code:'DEMO-SKU-SALE-ZERO',sale:0,cost:0},{code:'DEMO-SKU-SALE-EMPTY',sale:null,cost:500}];
 const snapshot=JSON.stringify(source);
 const input='SKU\t价格\tsku商家编码\n负减钱\t19.00\tDEMO-SKU-CORRECT\n零减钱\t19.80\tDEMO-SKU-CORRECT\n正减钱\t20.00\tDEMO-SKU-CORRECT\n缺天猫价\t\tDEMO-SKU-CORRECT\n零卖价\t0.00\tDEMO-SKU-SALE-ZERO\n缺卖价\t1.00\tDEMO-SKU-SALE-EMPTY\n未知编码\t1.00\tDEMO-SKU-NOT-FOUND';
 const rows=C.calculatePaste(input,source);
 assert.deepEqual(rows.map(r=>r.difference),[-80,0,20,null,0,null,null]);
 assert.deepEqual(rows.map(r=>r.correctedTmall),[3600,null,null,null,null,null,null]);
 assert.equal(rows[0].tmall,1900);assert.equal(rows[0].sale,1980);
 assert.equal(JSON.stringify(source),snapshot,'更正价不能回写原商品价格');
});

test('组合负减钱更正使用已取整有效卖价，不使用基本售价或未舍入中间值',()=>{
 const source=[{code:'DEMO-SKU-CORRECT-KIT',kind:'bundle',cost:937,sale:9999900,tmall:3000},{code:'DEMO-SKU-CORRECT-EMPTY',kind:'bundle',cost:null,sale:9999900,tmall:3000}];
 const snapshot=JSON.stringify(source);
 const rows=C.calculatePaste('SKU\t价格\tsku商家编码\n负值组合✅\t30.00\tDEMO-SKU-CORRECT-KIT\n正值组合\t40.00\tDEMO-SKU-CORRECT-KIT\n缺成本组合\t30.00\tDEMO-SKU-CORRECT-EMPTY',source);
 assert.equal(rows[0].sale,3123);assert.equal(rows[0].difference,-123);assert.equal(rows[0].correctedTmall,5678);
 assert.equal(rows[1].sale,3123);assert.equal(rows[1].difference,877);assert.equal(rows[1].correctedTmall,null);
 assert.equal(rows[2].sale,null);assert.equal(rows[2].difference,null);assert.equal(rows[2].correctedTmall,null);
 assert.equal(JSON.stringify(source),snapshot);
});
