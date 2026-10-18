import './prepare-upstream.mjs';
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const cwd=fileURLToPath(new URL('../packages/plugin-runtime/',import.meta.url));
const env={...process.env,LUBI_TEST_PLUGIN:join(cwd,'test/.out/plugin.cjs')};
const types=process.argv.slice(2).length?process.argv.slice(2):['core','smoke'];
const run=args=>{const result=spawnSync(process.execPath,args,{cwd,stdio:'inherit',env});if(result.status!==0)process.exit(result.status||1);};
run(['scripts/build-tests.mjs']);
if(types.includes('layout')){
  env.LUBI_REQUIRE_BROWSER='1';
  if(!env.LUBI_BROWSER){
    const {chromium}=await import('playwright');
    const playwrightBrowser=chromium.executablePath();
    // Headless Shell treats --window-size as the viewport, as upstream's CLI
    // assertions require. Unified Chrome includes toolbar/screen constraints.
    const cache=join(playwrightBrowser,'../../..');
    const shell=existsSync(cache)?readdirSync(cache).filter(x=>x.startsWith('chromium_headless_shell-')).sort().reverse().map(x=>join(cache,x,process.platform==='win32'?'chrome-headless-shell-win64/chrome-headless-shell.exe':'chrome-headless-shell-linux64/chrome-headless-shell')).find(existsSync):undefined;
    const candidates=[shell,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome',playwrightBrowser].filter(Boolean);
    env.LUBI_BROWSER=candidates.find(existsSync);
  }
  if(!existsSync(env.LUBI_BROWSER))throw new Error('A real Chromium browser is required. Run npx playwright install chromium, or set LUBI_BROWSER.');
  if(process.platform==='linux'&&process.env.LUBI_NO_SANDBOX==='1'){const script=join(cwd,'test/.out/layout-browser.sh');const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";writeFileSync(script,'#!/bin/sh\nexec '+quote(env.LUBI_BROWSER)+' --no-sandbox "$@"\n',{mode:0o700});env.LUBI_BROWSER=script;}
  run(['test/helpers/preview.mjs']);
}
for(const type of types){if(!['core','smoke','layout'].includes(type))throw new Error('Unknown test group: '+type);run(['--test',...(type==='layout'?['--test-concurrency=1']:[]),...readdirSync(join(cwd,'test',type)).filter(x=>x.endsWith('.mjs')).sort().map(x=>`test/${type}/${x}`)]);}
