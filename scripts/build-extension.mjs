import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'website/package.json'));
const {build}=require('esbuild');
for(const [entry,output,name] of [['qa-executor','qa-runtime','TAOAQA'],['review-executor','reviews-runtime','TAOAREVIEWS'],['combined-executor','feedback-runtime','TAOAFEEDBACK'],['review-jobs','review-jobs-runtime','TAOAJOBS']]){
  await build({entryPoints:[path.join(root,'extension/src',`${entry}.mjs`)],outfile:path.join(root,'extension',`${output}.js`),bundle:true,format:'iife',globalName:name,platform:'browser',target:'chrome109',minify:false,sourcemap:false,legalComments:'none'});
}
console.log('Built extension runtimes locally; no platform requests.');
