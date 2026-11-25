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
