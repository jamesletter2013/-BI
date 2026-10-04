import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),extension=path.join(root,'extension');
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
assert.equal(manifest.version,'1.0.12');
for(const ref of [manifest.background.service_worker,...Object.values(manifest.icons),...manifest.content_scripts.flatMap(s=>s.js)])assert(fs.existsSync(path.join(extension,ref)),`Missing manifest file: ${ref}`);
const files=[];
function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules','dist','.wrangler','.next','.vinext'].includes(ent.name))continue;const full=path.join(dir,ent.name);if(ent.isDirectory())walk(full);else files.push(full)}}
walk(root);
assert.equal(files.filter(p=>/^\.env|\.(pem|key|har|tsbuildinfo)$/.test(path.basename(p))).length,0,'Unexpected secret or generated file path');
const secrets=files.filter(p=>/\.(json|js|mjs|ts|tsx|html|css|md)$/.test(p)).filter(p=>/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{30,}|sk-(?:proj-)?[a-zA-Z0-9_-]{30,}/.test(fs.readFileSync(p,'utf8')));
assert.equal(secrets.length,0,'Potential credential; inspect before upload');
console.log(`PASS: ${files.length} files; manifest references present; no common credential patterns or forbidden artifacts. Basic scan only, not a guarantee of absence of sensitive data.`);
