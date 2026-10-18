// Independent reference rendering: original plugin + original in-memory test host,
// with separately recorded native Obsidian host primitives (see test/fixtures/).
// Uses synthetic fixtures only. No user's Vault is loaded.
import './prepare-upstream.mjs';
import * as O from '../packages/plugin-runtime/test/helpers/mock-obsidian.js';
import { demoData, seedVault } from '../packages/plugin-runtime/test/helpers/demo-data.mjs';
import { build } from 'esbuild';
import Module, { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const vendor=join(root,'packages/plugin-runtime');
await build({entryPoints:[join(vendor,'src/main.ts')],bundle:true,platform:'node',format:'cjs',external:['obsidian'],outfile:join(vendor,'test/.out/reference.cjs'),logLevel:'silent'});
const load=Module._load;Module._load=function(name,...rest){return name==='obsidian'?O:load.call(this,name,...rest);};
const NativeDate=Date;const fixed=new NativeDate(2026,9,18,14,0,0).getTime();
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
const LubiPlugin=createRequire(import.meta.url)(join(vendor,'test/.out/reference.cjs')).default;
const app=new O.App();seedVault(app.vault,demoData(new Date(),840));
const plugin=new LubiPlugin(app,{id:'lubi',version:'1.8.0'});plugin._data={onboardingDone:true,legacyScanDone:true};
await plugin.onload();for(const fn of app.workspace._ready)await fn();await plugin.tasks.load();
const view=await plugin.activateView('tasks','2026-10-18');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const style=readFileSync(join(vendor,'styles.css'),'utf8');
const preview=readFileSync(join(vendor,'test/helpers/preview.mjs'),'utf8');
const shim=preview.split('const shim = `')[1].split('`;')[0];
const nativeHost=readFileSync(join(root,'test/fixtures/native-host-1.13.7.css'),'utf8');
view.contentEl.classList.add('view-content');
const gantt=(await build({entryPoints:[join(vendor,'src/ui/ganttLabels.ts')],bundle:true,write:false,format:'iife',globalName:'LubiGanttLabels',logLevel:'silent'})).outputFiles[0].text;
const out=join(root,'test/.out/reference');mkdirSync(out,{recursive:true});
function freeze(el){const copy=el.cloneNode(true);copy.querySelectorAll('[data-icon] svg').forEach(svg=>svg.classList.add('svg-icon'));const originals=el.querySelectorAll('input,textarea,select');copy.querySelectorAll('input,textarea,select').forEach((field,i)=>{const original=originals[i];if(field.tagName==='TEXTAREA')field.textContent=original.value;else if(field.tagName==='SELECT'){for(const o of field.options)o.toggleAttribute('selected',o.value===original.value);}else if(field.type==='checkbox')field.toggleAttribute('checked',original.checked);else field.setAttribute('value',original.value);});return copy.outerHTML;}
const boot=`for(const el of document.querySelectorAll('[data-scroll-target]'))el.scrollTop=Number(el.dataset.scrollTarget)||0;for(const b of document.querySelectorAll('.lubi-week-body'))b.parentElement.style.setProperty('--lubi-week-sbw',Math.max(0,b.offsetWidth-b.clientWidth)+'px');LubiGanttLabels.fitGanttLabels(document);LubiGanttLabels.updateGanttNow(document);document.fonts?.ready.then(()=>LubiGanttLabels.fitGanttLabels(document));`;
const write=(name)=>writeFileSync(join(out,name+'.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${shim}${nativeHost}${style}</style><body class="theme-light"><div class="workspace-leaf-content">${freeze(view.contentEl)}</div><script>${gantt};addEventListener('load',()=>{${boot}})</script></body></html>`);
for(const mode of ['list','calendar','gantt'])for(const period of ['day','week','month']){view.tasksState.scheduleView=mode;view.tasksState.period=period;view.show('tasks','2026-10-18');await delay(220);write(mode+'-'+period);}
for(const period of ['week','month','year']){view.review.period=period;view.review.display='chart';view.show('review','2026-10-18');await delay(220);write('review-'+period);}
await view.onClose();plugin.onunload();O.window?.close?.();
console.log('Generated 12 independent original-plugin pages with native-measured host primitives and synthetic data.');
process.exit(0);
