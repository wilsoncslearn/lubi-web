// Real Obsidian acceptance, NOT the mock-host preview. All data is synthetic.
// Never open/read the owner's Vault, configuration, journal or credentials.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { startApp, seed, browserOptions, testPassword, output, delay } from './support.mjs';

if(process.platform!=='win32')throw new Error('This acceptance requires Windows and the installed Obsidian executable; it is never reported as a skipped pass.');
process.env.TZ='Asia/Shanghai';
const testDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
const executable=process.env.LUBI_OBSIDIAN_EXE||'C:/Program Files/Obsidian/Obsidian.exe';
assert(existsSync(executable),'Install Obsidian or set LUBI_OBSIDIAN_EXE.');
const temporary=mkdtempSync(join(tmpdir(),'lubi-native-'));
const profile=join(temporary,'profile'),vault=join(temporary,'synthetic-vault'),config=join(vault,'.obsidian'),pluginDir=join(config,'plugins/lubi');
for(const dir of [profile,pluginDir])mkdirSync(dir,{recursive:true});
writeFileSync(join(temporary,'SYNTHETIC-TEST-ONLY.txt'),'Owned isolated acceptance fixture. No real Vault or owner configuration is copied.\n');
const artifacts=join(output,'native');mkdirSync(artifacts,{recursive:true});
const errors={native:[],web:[]};
const report={kind:'real Obsidian Electron vs production Web; synthetic fixtures only',platform:process.platform,at:new Date().toISOString(),fixtureDate:testDate,clock:'Real shared Windows clock; no native clock/timer replacement',steps:[],visual:[],errors,isolatedProfileVerified:false,isolatedVaultVerified:false};
const record=()=>writeFileSync(join(artifacts,'native-report.json'),JSON.stringify(report,null,2));
let nativeApp,nativeProcess,nativePage,webApp,webBrowser,webContext,webPage;
let nativeLogs='';
const samePath=(a,b)=>resolve(a).replaceAll('\\','/').toLowerCase()===resolve(b).replaceAll('\\','/').toLowerCase();
const normalizeText=s=>s.replace(/\s+/g,' ').trim();
async function until(fn,message){for(let n=0;n<160;n++){if(await fn())return;await delay(100);}throw new Error(message||'Condition did not become true');}
async function step(name,fn){const started=Date.now();try{await fn();report.steps.push({name,passed:true,milliseconds:Date.now()-started});console.log('PASS '+name);}catch(e){report.steps.push({name,passed:false,error:e.stack});throw e;}finally{record();}}
async function root(page){const locator=page.locator('.lubi-root');await locator.waitFor();return locator;}
async function settle(page){await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());await page.evaluate(()=>document.fonts.ready);await delay(250);}
async function styles(locator){return locator.evaluate(root=>{const result={};for(const selector of [':scope','.lubi-topbar','.lubi-topbar-cta','.lubi-task-title','.lubi-attention-card','.lubi-panel-title','.lubi-attention-empty','.lubi-body','.lubi-task input[type="checkbox"]','svg','.modal-title','.modal-header','.modal-content','.modal-header-button','.lubi-kind-seg','.lubi-cat-pills','.lubi-field','.lubi-kbd','.lubi-modal-actions','input','input[type=date]','input[type=time]','select','button.mod-cta']){const e=selector===':scope'?root:root.querySelector(selector);if(!e)continue;const s=getComputedStyle(e),r=e.getBoundingClientRect();result[selector]={rect:{width:r.width,height:r.height,x:r.x,y:r.y},css:Object.fromEntries(['font-family','font-size','font-weight','line-height','letter-spacing','padding','margin','border-radius','box-shadow','stroke-width','background-color','color','box-sizing','appearance','border-color','border-width','display','position','top','right','bottom','left','min-height','max-height','background-image','background-size','background-position','background-repeat','opacity','font-synthesis','font-feature-settings','-webkit-font-smoothing','overflow','overflow-x','overflow-y','flex-direction','flex-shrink','flex-grow'].map(k=>[k,s.getPropertyValue(k)]))};}return result;});}
async function compare(name,a,b){
  await settle(nativePage);await settle(webPage);
  const left=await a.screenshot({path:join(artifacts,'obsidian-'+name+'.png'),animations:'disabled'}),right=await b.screenshot({path:join(artifacts,'web-'+name+'.png'),animations:'disabled'});
  const native=PNG.sync.read(left),web=PNG.sync.read(right);const width=Math.max(native.width,web.width),height=Math.max(native.height,web.height);
  const pad=image=>{const p=new PNG({width,height});p.data.fill(255);PNG.bitblt(image,p,0,0,image.width,image.height,0,0);return p;};
  const x=pad(native),y=pad(web),diff=new PNG({width,height});const pixels=pixelmatch(x.data,y.data,diff.data,width,height,{threshold:.12});
  writeFileSync(join(artifacts,'diff-'+name+'.png'),PNG.sync.write(diff));
  const textEqual=normalizeText(await a.innerText())===normalizeText(await b.innerText());
  const result={name,native:{width:native.width,height:native.height},web:{width:web.width,height:web.height},sameDimensions:native.width===web.width&&native.height===web.height,textEqual,differentPixels:pixels,totalPixels:width*height,ratio:pixels/(width*height)};
  result.passed=result.sameDimensions&&textEqual&&result.ratio<.025;report.visual.push(result);
  if(!result.passed){result.nativeStyles=await styles(a);result.webStyles=await styles(b);writeFileSync(join(artifacts,'obsidian-'+name+'.html'),await a.evaluate(e=>e.outerHTML));writeFileSync(join(artifacts,'web-'+name+'.html'),await b.evaluate(e=>e.outerHTML));}
  console.log('COMPARE '+name+': '+(100*result.ratio).toFixed(4)+'%, sameSize='+result.sameDimensions+', sameText='+textEqual);record();
}
async function listDay(page){await page.locator('.lubi-topbar-tabs').getByRole('button',{name:'计划',exact:true}).click();await page.locator('[data-lubi-focus="schedule:list"]').click();await page.locator('[data-lubi-focus="planning-period:day"]').click();await delay(200);}

try{
  await step('Create independent synthetic Vault, unchanged native plugin and Web fixture',async()=>{
    webApp=await startApp();await seed(webApp,new Date(testDate+'T14:00:00+08:00'));
    const snapshot=await webApp.json('/vault/snapshot');for(const d of snapshot.documents){const file=join(vault,d.path);if(d.kind==='folder')mkdirSync(file,{recursive:true});else{mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,d.text,'utf8');}}
    const vendor=resolve('packages/plugin-runtime');
    await build({entryPoints:[join(vendor,'src/main.ts')],bundle:true,platform:'node',format:'cjs',external:['obsidian','electron'],outfile:join(pluginDir,'main.js'),logLevel:'warning'});
    copyFileSync(join(vendor,'manifest.json'),join(pluginDir,'manifest.json'));copyFileSync(join(vendor,'styles.css'),join(pluginDir,'styles.css'));
    writeFileSync(join(pluginDir,'data.json'),JSON.stringify({onboardingDone:true,legacyScanDone:true}));
    writeFileSync(join(config,'community-plugins.json'),JSON.stringify(['lubi']));
    writeFileSync(join(config,'core-plugins.json'),'[]');
    writeFileSync(join(config,'app.json'),JSON.stringify({safeMode:false,showInlineTitle:true}));
    writeFileSync(join(config,'appearance.json'),JSON.stringify({theme:'moonstone',baseFontSize:16}));
    const id=randomBytes(8).toString('hex');
    writeFileSync(join(profile,'obsidian.json'),JSON.stringify({vaults:{[id]:{path:vault,ts:Date.now(),open:true}},updateDisabled:true,language:'zh'}));
    // Only public executable archives, never obsidian.json or any user settings.
    const publicRuntimeDir=join(process.env.APPDATA,'obsidian');
    const archives=existsSync(publicRuntimeDir)?readdirSync(publicRuntimeDir).filter(x=>/^obsidian-\d+\.\d+\.\d+\.asar$/.test(x)).sort((a,b)=>{const av=a.match(/\d+/g).map(Number),bv=b.match(/\d+/g).map(Number);for(let i=0;i<3;i++)if(av[i]!==bv[i])return bv[i]-av[i];return 0;}):[];
    if(archives[0]){const src=join(publicRuntimeDir,archives[0]);copyFileSync(src,join(profile,archives[0]));const bytes=readFileSync(src),header=JSON.parse(bytes.subarray(16,16+bytes.readUInt32LE(12)).toString('utf8')),entry=header.files['package.json'],offset=8+bytes.readUInt32LE(4)+Number(entry.offset),meta=JSON.parse(bytes.subarray(offset,offset+entry.size).toString('utf8'));report.publicRuntime={archive:archives[0],packageVersion:meta.version,sha256:createHash('sha256').update(bytes).digest('hex')};}
  });
  await step('Launch real Obsidian with dedicated user-data-dir; verify both isolation paths',async()=>{
    // Main-process inspection is unavailable in this installer, so the _electron
    // driver cannot attach to main. Use its loopback Chromium CDP endpoint,
    // not a modified executable or a copied owner profile.
    const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const debugPort=probe.address().port;await new Promise(r=>probe.close(r));
    nativeProcess=spawn(executable,['--user-data-dir='+profile,'--remote-debugging-port='+debugPort,'--remote-debugging-address=127.0.0.1','--force-device-scale-factor=1','--lang=zh-CN','--disable-background-timer-throttling'],{env:{...process.env,ELECTRON_ENABLE_LOGGING:'1'},stdio:['ignore','pipe','pipe']});
    nativeProcess.stdout.on('data',b=>nativeLogs+=b);nativeProcess.stderr.on('data',b=>nativeLogs+=b);
    await until(async()=>{if(nativeProcess.exitCode!==null)throw Error('Owned Obsidian exited: '+nativeLogs.slice(-3000));try{return(await fetch('http://127.0.0.1:'+debugPort+'/json/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},'Owned Obsidian CDP did not become ready');
    const log=join(profile,'obsidian.log');await until(()=>existsSync(log)&&readFileSync(log,'utf8').includes(profile),'Dedicated bootstrap log was not produced');
    assert(readFileSync(log,'utf8').includes('Loaded updated app package '+join(profile,report.publicRuntime.archive)),'Native bootstrap did not load its public runtime from the dedicated profile');
    report.isolatedProfileVerified=true;report.profileVerification='Explicit --user-data-dir plus bootstrap log proving the public runtime loaded from that exact fresh profile';
    report.nativeConsole=[];
    nativeApp=await chromium.connectOverCDP('http://127.0.0.1:'+debugPort);const context=nativeApp.contexts()[0];
    await until(()=>context.pages().length>0,'No native window');nativePage=context.pages().find(p=>p.url().includes('index.html'))||context.pages()[0];nativePage.setDefaultTimeout(15000);nativePage.on('pageerror',e=>errors.native.push(e.stack||e.message));nativePage.on('console',m=>{if(m.type()==='error')report.nativeConsole.push(m.text());});
    await nativePage.waitForFunction(()=>window.app?.vault?.adapter?.getBasePath,undefined,{timeout:60000});
    const actualVault=await nativePage.evaluate(()=>app.vault.adapter.getBasePath());assert(samePath(actualVault,vault),'Refusing to interact: native Vault is not the synthetic fixture');report.isolatedVaultVerified=true;
    // Trust only this newly created synthetic Vault, after both paths were verified.
    // Never dismiss a trust prompt for an owner's real Vault.
    await nativePage.waitForFunction(()=>!!app.plugins?.plugins?.lubi||[...document.querySelectorAll('.modal button')].some(e=>/信任.*启用插件|Trust author and enable plugins/i.test(e.textContent)),undefined,{timeout:20000});
    const trust=nativePage.getByRole('button',{name:/信任仓库作者并启用插件|Trust author and enable plugins/i});if(await trust.isVisible())await trust.click();
    await nativePage.waitForFunction(()=>!!app.plugins?.plugins?.lubi?.tasks,undefined,{timeout:30000});
    // Fresh Obsidian can open its own startup dialog in a secondary about:blank
    // popout. That popout becomes activeWindow; subsequent plugin modals would
    // correctly open THERE instead of the pane being automated. Close only such
    // startup windows belonging to this proven isolated browser, never an owner
    // window. Preserve their message as diagnostic evidence.
    report.startupPopouts=[];
    for(const popup of context.pages())if(popup!==nativePage&&popup.url()==='about:blank'&&await popup.evaluate(()=>document.body.classList.contains('is-popout-modal'))){report.startupPopouts.push(await popup.locator('body').innerText());await popup.close();}
    await nativePage.bringToFront();
    await nativePage.waitForFunction(()=>activeWindow===window);

    await nativePage.waitForFunction(()=>app.workspace.layoutReady&&!document.body.classList.contains('in-progress'),undefined,{timeout:60000});
    report.nativeWorkspaceReady=true;
    // Native and Web use the same real Windows clock. Do not replace clocks or
    // timers inside the native shell; only the synthetic fixture date is chosen.
    const cdp=await context.newCDPSession(nativePage);await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'});
    await nativePage.evaluate(async(day)=>{if(!app.plugins.plugins.lubi)await app.plugins.enablePluginAndSave('lubi');const p=app.plugins.plugins.lubi;if(!p)throw Error('Native plugin failed to load');await p.tasks.load();await p.activateView('tasks',day);app.workspace.leftSplit?.collapse();app.workspace.rightSplit?.collapse();document.body.classList.remove('theme-dark');document.body.classList.add('theme-light');},testDate);
    await (await root(nativePage)).locator('.lubi-task').first().waitFor();
    await delay(400);for(const popup of context.pages())if(popup!==nativePage&&popup.url()==='about:blank'){await popup.waitForFunction(()=>document.body.classList.contains('is-popout-modal'));report.startupPopouts.push(await popup.locator('body').innerText());await popup.close();}await nativePage.bringToFront();await nativePage.waitForFunction(()=>activeWindow===window);
    // Wait for the owned application to finish activating before setting its real
    // window bounds. Never resize or focus the owner's existing Obsidian window.
    const resize=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','& {'+readFileSync(resolve('test/native-window.ps1'),'utf8')+'} '+nativeProcess.pid+' ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(\"'+Buffer.from(await nativePage.title()).toString('base64')+'\")))'],{encoding:'utf8',timeout:20000});assert.equal(resize.status,0,'Owned native window resize: '+resize.stderr);await delay(700);
    report.nativeViewport=await nativePage.evaluate(()=>({width:innerWidth,height:innerHeight,ratio:devicePixelRatio}));assert.equal(report.nativeViewport.width,1440,'Native main window, not a startup popout, must be resized');
    await settle(nativePage);await nativePage.screenshot({path:join(artifacts,'obsidian-full-window.png'),animations:'disabled'});
    report.nativeVersion=await nativePage.evaluate(()=>typeof window.appVersion==='string'?window.appVersion:null)||report.publicRuntime.packageVersion;report.nativeVersionSource='Native appVersion or package.json of the exact public archive verified in the dedicated bootstrap log';
    report.nativeUserAgent=await nativePage.evaluate(()=>navigator.userAgent);
    assert(report.nativeVersion,'Could not verify native Obsidian runtime version');
  });
  await step('Authenticate production Web with identical native viewport and pane geometry',async()=>{
    webBrowser=await chromium.launch(await browserOptions());report.webBrowser=webBrowser.version();
    const bounds=await (await root(nativePage)).boundingBox();assert(bounds.width>900&&bounds.height>600);report.paneBounds=bounds;
    webContext=await webBrowser.newContext({viewport:{width:report.nativeViewport.width,height:report.nativeViewport.height},deviceScaleFactor:1,timezoneId:'Asia/Shanghai',locale:'zh-CN',colorScheme:'light'});
    webPage=await webContext.newPage();webPage.setDefaultTimeout(15000);webPage.on('pageerror',e=>errors.web.push(e.stack||e.message));
    await webPage.goto(webApp.base);
    // The source mixes viewport @media and pane @container queries. Match BOTH
    // the real viewport and fractional pane origin; never rescale screenshots or
    // change plugin CSS. This wrapper exists only in the comparison fixture.
    await webPage.addStyleTag({content:`#root{position:fixed;left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;height:${bounds.height}px;}`});
    report.webComparisonGeometry='Identical viewport and #root pane rectangle; upstream UI and shipped Web CSS unchanged';
    await webPage.getByLabel('访问密码').fill(testPassword);await webPage.getByRole('button',{name:'进入工作区'}).click();await (await root(webPage)).locator('.lubi-task').first().waitFor();
  });
  await step('Capture all nine native plugin panes against all nine Web panes',async()=>{
    for(const mode of ['list','calendar','gantt'])for(const period of ['day','week','month']){
      for(const page of [nativePage,webPage]){await page.locator(`[data-lubi-focus="schedule:${mode}"]`).click();await page.locator(`[data-lubi-focus="planning-period:${period}"]`).click();}
      if(!report.hostPrimitives)report.hostPrimitives={native:await styles(await root(nativePage)),web:await styles(await root(webPage))};
      await compare(mode+'-'+period,await root(nativePage),await root(webPage));
    }
  });
  await step('Native and Web review periods expose the same calculated content',async()=>{
    for(const page of [nativePage,webPage])await page.locator('.lubi-topbar-tabs').getByRole('button',{name:'回顾',exact:true}).click();
    for(const label of ['周','月','年']){
      for(const page of [nativePage,webPage])await page.locator('.lubi-review .lubi-toolbar').getByRole('button',{name:label,exact:true}).click();
      await settle(nativePage);await settle(webPage);assert.equal(normalizeText(await nativePage.locator('.lubi-review').innerText()),normalizeText(await webPage.locator('.lubi-review').innerText()),label+' review');
    }
    for(const page of [nativePage,webPage])await listDay(page);
  });
  await step('Compare real task-modal content, dimensions and native primitive styling',async()=>{
    for(const page of [nativePage,webPage]){await page.locator('.lubi-topbar-cta').click();await page.getByPlaceholder('要做什么',{exact:true}).waitFor();}
    await compare('new-task-modal',nativePage.locator('.lubi-task-modal'),webPage.locator('.lubi-task-modal'));
    report.modalPrimitives={native:await styles(nativePage.locator('.lubi-task-modal')),web:await styles(webPage.locator('.lubi-task-modal'))};
    report.modalPseudo={};for(const [name,page] of [['native',nativePage],['web',webPage]])report.modalPseudo[name]=await page.locator('.lubi-task-modal').evaluate(root=>{const result={};for(const selector of ['input[type=date]','input[type=time]'])for(const pseudo of ['::-webkit-calendar-picker-indicator','::-webkit-datetime-edit']){const s=getComputedStyle(root.querySelector(selector),pseudo);result[selector+pseudo]=Object.fromEntries(['position','top','left','right','bottom','padding','margin','width','height','font-family','font-size','color','display','opacity'].map(k=>[k,s.getPropertyValue(k)]));}for(const selector of ['.modal-bg','.modal-container']){const s=getComputedStyle(selector==='.modal-container'?root.parentElement:root.parentElement.querySelector(selector));result[selector]=Object.fromEntries(['background-color','opacity','padding','display','align-items','justify-content'].map(k=>[k,s.getPropertyValue(k)]));}return result;});
    report.nativeDateRules=await nativePage.evaluate(()=>{const result=[];const visit=rules=>{for(const r of rules){if(r.selectorText&&/input\[type=['"]?date/.test(r.selectorText)&&(!r.selectorText.includes('lubi'))&&r.style)result.push({selector:r.selectorText,style:r.style.cssText});if(r.cssRules)visit(r.cssRules);}};for(const sheet of document.styleSheets)try{visit(sheet.cssRules);}catch{}return result;});
    report.modalGeometry={native:await nativePage.locator('.lubi-task-modal').boundingBox(),web:await webPage.locator('.lubi-task-modal').boundingBox()};
    for(const page of [nativePage,webPage])await page.keyboard.press('Escape');
  });
  await step('Dark native theme matches the planning pane and task form',async()=>{
    report.beforeDarkNative=await nativePage.evaluate(()=>({ready:app.workspace.layoutReady,classes:document.body.className,active:activeWindow===window}));
    for(const page of [nativePage,webPage]){await listDay(page);await page.evaluate(()=>{document.body.classList.remove('theme-light');document.body.classList.add('theme-dark');});}
    await compare('dark-list-day',await root(nativePage),await root(webPage));report.darkHostPrimitives={native:await styles(await root(nativePage)),web:await styles(await root(webPage))};
    for(const page of [nativePage,webPage]){await page.locator('.lubi-topbar-cta').click();await page.getByPlaceholder('要做什么',{exact:true}).waitFor();}
    await compare('dark-new-task-modal',nativePage.locator('.lubi-task-modal'),webPage.locator('.lubi-task-modal'));report.darkModalPrimitives={native:await styles(nativePage.locator('.lubi-task-modal')),web:await styles(webPage.locator('.lubi-task-modal'))};
    for(const page of [nativePage,webPage]){await page.keyboard.press('Escape');await page.evaluate(()=>{document.body.classList.remove('theme-dark');document.body.classList.add('theme-light');});}
  });
  await step('Both actual clients create, persist and complete a task without inventing actual time',async()=>{
    const nativeStore=async()=>{for(let attempt=0;attempt<100;attempt++){try{return JSON.parse(readFileSync(join(vault,'任务/任务数据.json'),'utf8'));}catch(error){if(!(error instanceof SyntaxError)&&error.code!=='ENOENT')throw error;if(attempt===99)throw error;await delay(25);}}};
    const webStore=async()=>JSON.parse((await webApp.json('/vault/file?path='+encodeURIComponent('任务/任务数据.json'))).text);
    const title='原生与网页双端合成验收任务';
    for(const [label,page,store,journal] of [
      ['Obsidian',nativePage,async()=>nativeStore(),async()=>readFileSync(join(vault,'日记/'+testDate+'.md'),'utf8')],
      ['Web',webPage,webStore,async()=>(await webApp.json('/vault/file?path='+encodeURIComponent('日记/'+testDate+'.md'))).text]
    ]){
      const before=await journal();await page.locator('.lubi-topbar-cta').click();await page.getByPlaceholder('要做什么',{exact:true}).fill(title);await page.getByPlaceholder('如 45min / 2.5h',{exact:true}).fill('1h');await page.getByLabel('计划开始时间',{exact:true}).fill('16:00');await page.locator('[data-lubi-focus="task:save"]').click();
      await until(async()=>(await store()).tasks.some(t=>t.title===title),label+' task persistence');let task=(await store()).tasks.find(t=>t.title===title);assert.equal(task.estimate,60);assert.equal(task.start,'16:00');assert.equal(await journal(),before,label+' plan must not invent actual time');
      const row=page.locator('.lubi-task').filter({has:page.getByRole('button',{name:'编辑 '+title,exact:true})});await row.locator('.lubi-task-start').click();await page.locator('[data-actual="minutes"]').fill('25min');await page.locator('[data-actual="start"]').fill('16:00');await page.locator('[data-lubi-focus="task:save"]').click();
      await until(async()=>(await journal()).includes('任务:: '+task.id),label+' actual persistence');task=(await store()).tasks.find(t=>t.id===task.id);assert.equal(task.estimate,60);assert.notEqual(task.status,'done');assert.match(await journal(),/预计用时:: 1h/);
      const actual=await journal();await row.getByRole('checkbox').check();await until(async()=>(await store()).tasks.find(t=>t.id===task.id).status==='done',label+' completion');assert.equal(await journal(),actual,label+' completion must not invent records');
    }
  });
  await step('Native screenshot and runtime-error acceptance',async()=>{
    assert.deepEqual(errors.web,[],'Web runtime errors');assert.deepEqual(errors.native,[],'Native runtime errors');
    assert(report.visual.every(x=>x.passed),'Native comparison outside the 2.5% tolerance, dimensions/content mismatch; see native-report.json. No perfect-parity claim is made.');
  });
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;console.error(error);process.exitCode=1;
  for(const [name,page] of [['native',nativePage],['web',webPage]])if(page&&!page.isClosed())try{await page.screenshot({path:join(artifacts,name+'-failure.png')});writeFileSync(join(artifacts,name+'-failure.html'),await page.content());}catch{}
}finally{
  if(webContext)await webContext.close();if(webBrowser)await webBrowser.close();if(nativeApp)await nativeApp.close().catch(()=>{});
  if(nativeProcess&&nativeProcess.exitCode===null){const done=once(nativeProcess,'close');spawnSync('taskkill.exe',['/PID',String(nativeProcess.pid),'/T','/F'],{stdio:'ignore'});await done;}
  if(webApp)await webApp.stop();writeFileSync(join(artifacts,'native-bootstrap.log'),nativeLogs);await delay(300);
  const parent=realpathSync(tmpdir()),owned=realpathSync(temporary),child=relative(parent,owned);assert(child&&!child.startsWith('..')&&!isAbsolute(child)&&basename(child).startsWith('lubi-native-'));
  try{await rm(owned,{recursive:true,force:true,maxRetries:25,retryDelay:200});report.fixtureCleaned=true;}catch(e){report.fixtureCleaned=false;report.cleanupError=e.message;process.exitCode=1;}
  record();
}
