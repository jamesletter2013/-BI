const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'algorithm-version.json'),'utf8'));
const core=fs.readFileSync(path.join(root,'public/core.js'),'utf8');
const content=core.slice(core.indexOf(version.calculationSourceStart));
assert.equal(crypto.createHash('sha256').update(content).digest('hex'),version.calculationSourceSha256,'核心算法校验值不匹配');
assert.equal(require('../public/core.js').SEED.length,0,'公开版不能内置真实商品资料');
assert.equal(fs.existsSync(path.join(root,'public/catalog.js')),false,'不能包含实际商品资料快照');
for(const file of ['public/index.html','public/app.js','public/styles.css','public/core.js','public/catalog-loader.js']){
 const text=fs.readFileSync(path.join(root,file),'utf8');
 assert(!/\/Users\/|[A-Z]{4}1047|JXSSXLA|appgprj_|siwc_bypass|\.chatgpt\.site/.test(text),`发现不应公开的资料标记：${file}`);
}
console.log('发布检查通过：算法校验一致，默认无真实商品资料，无本机路径或原部署标识。');
