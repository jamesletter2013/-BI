import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
assert.equal(manifest.version,'1.3.8');
assert.equal(manifest.options_page,'listing-diagnostics.html');
assert(!manifest.optional_host_permissions,'Personal API host permissions must not return');
for(const ref of [manifest.background.service_worker,manifest.options_page,manifest.devtools_page,...Object.values(manifest.icons),...manifest.content_scripts.flatMap(s=>s.js)])assert(fs.existsSync(path.join(root,'extension',ref)),`Missing manifest file: ${ref}`);
for(const ref of ['extension/api-background.js','extension/api-settings.html','website/app/api','website/app/account','website/app/admin','website/lib/auth','website/lib/credits'])assert(!fs.existsSync(path.join(root,ref)),`Removed module still present: ${ref}`);
const hosting=JSON.parse(fs.readFileSync(path.join(root,'website/.openai/hosting.json')));
assert.deepEqual(hosting,{d1:null,r2:null});
const files=[];
function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules','dist','.wrangler','.next','.vinext'].includes(ent.name))continue;const full=path.join(dir,ent.name);if(ent.isSymbolicLink())throw Error(`Unexpected symlink: ${full}`);if(ent.isDirectory())walk(full);else files.push(full);}}
walk(root);
assert.equal(files.filter(p=>/^(?:\.env|\.dev\.vars)|\.(pem|key|har|tsbuildinfo)$/.test(path.basename(p))).length,0,'Unexpected sensitive/generated file path');
const secretPattern=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{30,}|sk-(?:proj-)?[a-zA-Z0-9_-]{30,}|sb_secret_[a-zA-Z0-9_-]{15,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/;
const secrets=files.filter(p=>/\.(json|js|mjs|ts|tsx|html|css|md|txt)$/.test(p)).filter(p=>secretPattern.test(fs.readFileSync(p,'utf8')));
assert.equal(secrets.length,0,'Potential credential; inspect before upload');
const delivery=JSON.parse(fs.readFileSync(path.join(root,'FILE-MANIFEST.json')));
for(const file of delivery.files){
  assert(!path.isAbsolute(file.path)&&!file.path.split('/').includes('..'));
  const bytes=fs.readFileSync(path.join(root,file.path));
  assert.equal(bytes.length,file.bytes,file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
}
console.log(`PASS: ${files.length} files scanned; ${delivery.files.length} handoff files match; no common credential patterns; no personal AI modules. Basic scan is not a security audit.`);
