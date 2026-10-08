// Run after `npm ci` inside website. Rebuilds only this exported copy.
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'website/package.json'));
const {build}=require('esbuild');
const entries=[
  ['product-facts','product-facts-runtime','TAOAFACTS',false],
  ['listing-facts','listing-facts-runtime','TAOALISTING',false],
  ['category-resolver','category-runtime','TAOACATEGORY',true],
  ['qa-executor','qa-runtime','TAOAQA',false],
  ['review-executor','reviews-runtime','TAOAREVIEWS',false],
  ['combined-executor','feedback-runtime','TAOAFEEDBACK',false],
  ['review-jobs','review-jobs-runtime','TAOAJOBS',false],
];
for(const [entry,out,globalName,minify] of entries){
  await build({entryPoints:[path.join(root,'extension/src',`${entry}.mjs`)],
    outfile:path.join(root,'extension',`${out}.js`),bundle:true,format:'iife',globalName,
    platform:'browser',target:'chrome109',minify,sourcemap:false,legalComments:'none'});
}
console.log('Rebuilt 7 extension runtimes. No product, AI or account requests were made.');
