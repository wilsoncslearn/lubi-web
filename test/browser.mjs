import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { startApp, seed, browserOptions, testPassword, testDate, output, delay } from './support.mjs';

process.env.TZ='Asia/Shanghai';
execFileSync(process.execPath,['scripts/reference-pages.mjs'],{stdio:'inherit'});
const app=await startApp();await seed(app);
const browser=await chromium.launch(await browserOptions());
const context=await browser.newContext({viewport:{width:1400,height:1000},deviceScaleFactor:1,timezoneId:'Asia/Shanghai',locale:'zh-CN',colorScheme:'light'});
const page=await context.newPage();page.setDefaultTimeout(10000);
await page.clock.setFixedTime(new Date('2026-10-18T06:00:00Z'));
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={platform:process.platform,browser:browser.version(),fixture:'synthetic only; 2026-10-18 14:00 Asia/Shanghai',steps:[],visual:[],errors};
mkdirSync(join(output,'screenshots'),{recursive:true});
const record=()=>writeFileSync(join(output,'browser-report.json'),JSON.stringify(report,null,2));
async function step(name,fn){const start=Date.now();try{await fn();report.steps.push({name,passed:true,milliseconds:Date.now()-start});console.log('PASS '+name);}catch(e){report.steps.push({name,passed:false,error:e.stack});await page.screenshot({path:join(output,'screenshots','failure.png'),fullPage:true});writeFileSync(join(output,'failure-dom.html'),await page.content());throw e;}finally{record();}}
async function until(fn,message='condition did not become true'){for(let i=0;i<80;i++){if(await fn())return;await delay(100);}throw new Error(message);}
const store=async()=>JSON.parse((await app.json('/vault/file?path='+encodeURIComponent('任务/任务数据.json'))).text);
const journal=async(date=testDate)=>(await app.json('/vault/file?path='+encodeURIComponent(`日记/${date}.md`))).text;
const snapshot=()=>app.json('/vault/snapshot');
const modal=()=>page.locator('.modal').last();
const taskRow=title=>page.locator('.lubi-task').filter({has:page.getByRole('button',{name:'编辑 '+title,exact:true})});
async function menu(label){await page.locator('.lubi-more-btn').click();await page.locator('.menu').getByRole('menuitem',{name:label,exact:true}).click();}
async function close(){await page.keyboard.press('Escape');await delay(100);}
async function listDay(){await page.locator('.lubi-topbar-tabs').getByRole('button',{name:'计划',exact:true}).click();await page.locator('[data-lubi-focus="schedule:list"]').click();await page.locator('[data-lubi-focus="planning-period:day"]').click();await delay(150);}
async function createTask(title,extra=async()=>{}){await page.locator('.lubi-topbar-cta').click();await page.getByPlaceholder('要做什么',{exact:true}).fill(title);await extra();await page.locator('[data-lubi-focus="task:save"]').click();await until(async()=>!(await page.locator('.modal').count()),'new task did not save');return (await store()).tasks.find(t=>t.title===title);}
async function shot(name){await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());await delay(200);await page.screenshot({path:join(output,'screenshots',name+'.png'),fullPage:true,animations:'disabled'});}
let savedTask,exportFile;
let mockAi;let aiRequests=[];
try{
  await step('Authentication and real production bundle',async()=>{
    await page.goto(app.base);await page.getByLabel('访问密码').fill(testPassword);await page.getByRole('button',{name:'进入工作区'}).click();await page.locator('.lubi-root').waitFor();await page.getByRole('button',{name:'AI 创建任务',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>!!window.__lubi),false,'production build must not expose a test runtime');
    await until(async()=>await page.locator('.lubi-task').count()>0);
    const size=await page.evaluate(()=>({height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth}));assert.deepEqual(size,{height:1000,width:1400},'host must not add a blank overflow region');
  });
  await step('All nine planning views and independent original-plugin screenshot comparison',async()=>{
    const reference=await context.newPage();await reference.clock.setFixedTime(new Date('2026-10-18T06:00:00Z'));
    for(const mode of ['list','calendar','gantt'])for(const period of ['day','week','month']){
      const name=mode+'-'+period;await page.locator(`[data-lubi-focus="schedule:${mode}"]`).click();await page.locator(`[data-lubi-focus="planning-period:${period}"]`).click();await delay(220);await shot(name);
      await reference.goto(pathToFileURL(resolve(output,'reference',name+'.html')).href);await delay(200);
      const ref=join(output,'screenshots','reference-'+name+'.png');await reference.screenshot({path:ref,animations:'disabled'});
      const a=PNG.sync.read(readFileSync(join(output,'screenshots',name+'.png'))),b=PNG.sync.read(readFileSync(ref));assert.equal(a.width,b.width);assert.equal(a.height,b.height);
      const diff=new PNG({width:a.width,height:a.height});const pixels=pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:.12});
      writeFileSync(join(output,'screenshots','diff-'+name+'.png'),PNG.sync.write(diff));report.visual.push({name,reference:'unchanged original plugin / original mock host / independently native-calibrated host primitives',differentPixels:pixels,totalPixels:a.width*a.height,ratio:pixels/(a.width*a.height)});
      assert(pixels/(a.width*a.height)<.025,`${name}: ${(100*pixels/(a.width*a.height)).toFixed(2)}% pixels differ from the original reference`);
    }
    await reference.close();
  });
  await step('Review week/month/year and chart/table controls',async()=>{
    await page.locator('.lubi-topbar-tabs').getByRole('button',{name:'回顾',exact:true}).click();
    for(const [id,label] of [['week','周'],['month','月'],['year','年']]){await page.locator('.lubi-review .lubi-toolbar').getByRole('button',{name:label,exact:true}).click();await delay(180);assert(await page.locator('.lubi-review').innerText());await shot('review-'+id);}
    await page.locator('.lubi-chart-mode').getByRole('button',{name:'表格',exact:true}).click();assert(await page.locator('.lubi-review table').count());await listDay();
  });
  await step('Narrow screen, dark theme, keyboard and focus-safe modal',async()=>{
    await page.setViewportSize({width:390,height:844});await shot('mobile-list');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
    await page.keyboard.press('n');await page.getByPlaceholder('要做什么',{exact:true}).waitFor();const rect=await modal().boundingBox();assert(rect.x>=0&&rect.x+rect.width<=391);await shot('mobile-new-task');await close();
    await page.setViewportSize({width:1400,height:1000});await menu('设置');await page.getByRole('button',{name:'切换明 / 暗主题'}).click();await close();assert(await page.locator('body').evaluate(e=>e.classList.contains('theme-dark')));await shot('dark-list');await menu('设置');await page.getByRole('button',{name:'切换明 / 暗主题'}).click();await close();
  });
  if(process.env.LUBI_BROWSER_ONLY==='visual'){console.log('Visual-only verification requested.');}
  else{
  await step('All thirteen original registered commands are reachable without losing a form draft',async()=>{
    await page.keyboard.press('Control+p');await page.getByRole('combobox',{name:'搜索 Lubi 命令'}).waitFor();assert.equal(await page.locator('.web-command-list [role=option]').count(),13);
    await page.getByRole('combobox',{name:'搜索 Lubi 命令'}).fill('回顾');await page.keyboard.press('Enter');await page.locator('.lubi-review').waitFor();await listDay();
    await page.locator('.lubi-topbar-cta').click();await page.getByPlaceholder('要做什么',{exact:true}).fill('命令面板不可丢失的草稿');await page.keyboard.press('Control+p');await page.getByRole('combobox',{name:'搜索 Lubi 命令'}).fill('不应存在的命令');await page.getByText('没有匹配的命令',{exact:true}).waitFor();await close();assert.equal(await page.getByPlaceholder('要做什么',{exact:true}).inputValue(),'命令面板不可丢失的草稿');await modal().getByRole('button',{name:'取消',exact:true}).click();await until(async()=>!(await page.locator('.modal').count()),'draft modal must close after explicit cancel');
  });
  await step('Create and edit a task: plan, project, notes and location persist',async()=>{
    const before=await journal();
    savedTask=await createTask('浏览器验收任务',async()=>{
      await page.getByPlaceholder('如 45min / 2.5h',{exact:true}).fill('1h');await modal().locator('.lubi-extras-toggles button').filter({hasText:'备注'}).click();await page.getByLabel('备注',{exact:true}).fill('这是合成测试，不是真实用户内容。');
      await modal().locator('.lubi-extras-toggles button').filter({hasText:'项目'}).click();await page.getByLabel('新项目名称',{exact:true}).fill('浏览器验收项目');await page.getByRole('button',{name:'创建项目',exact:true}).click();await until(async()=>!!(await store()).projects?.some(p=>p.title==='浏览器验收项目'));
      await page.locator('[data-task-location="input"]').fill('测试会议室');await page.getByLabel('计划开始时间',{exact:true}).fill('16:00');
    });
    assert.equal(savedTask.estimate,60);assert.equal(savedTask.location,'测试会议室');assert(savedTask.project);assert.equal(savedTask.start,'16:00');assert.equal(await journal(),before,'planning must not fabricate actual time');
    await taskRow(savedTask.title).getByRole('button',{name:'编辑 '+savedTask.title,exact:true}).click();assert.equal(await page.getByLabel('备注',{exact:true}).inputValue(),'这是合成测试，不是真实用户内容。');await page.getByLabel('备注',{exact:true}).fill('已编辑，刷新仍应保留。');await page.locator('[data-lubi-focus="task:save"]').click();await until(async()=>(await store()).tasks.find(t=>t.id===savedTask.id)?.notes==='已编辑，刷新仍应保留。');await page.reload();await taskRow(savedTask.title).waitFor();
  });
  await step('Real pointer drag, undo and Escape cancellation persist no accidental records',async()=>{
    const before=await journal();await page.locator('[data-lubi-focus="schedule:gantt"]').click();await page.locator('[data-lubi-focus="planning-period:day"]').click();
    const bar=page.locator(`.lubi-gantt-row[data-task-id="${savedTask.id}"] .lubi-gantt-bar`);await bar.scrollIntoViewIfNeeded();
    const box=await bar.boundingBox(),plot=await bar.locator('..').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+plot.width/48,box.y+box.height/2,{steps:8});await page.mouse.up();
    await until(async()=>(await store()).tasks.find(t=>t.id===savedTask.id).start==='16:30');await page.locator('.notice').filter({hasText:savedTask.title}).getByRole('button',{name:'撤销',exact:true}).click();await until(async()=>(await store()).tasks.find(t=>t.id===savedTask.id).start==='16:00');
    await bar.scrollIntoViewIfNeeded();const again=await bar.boundingBox();await page.mouse.move(again.x+again.width/2,again.y+again.height/2);await page.mouse.down();await page.mouse.move(again.x+again.width/2+plot.width/48,again.y+again.height/2,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();await delay(200);assert.equal((await store()).tasks.find(t=>t.id===savedTask.id).start,'16:00');assert.equal(await journal(),before);await listDay();
  });
  await step('Actual time is separate from plan and completion; Markdown survives',async()=>{
    const old=await app.json('/vault/file?path='+encodeURIComponent('日记/'+testDate+'.md'));
    await app.json('/vault/file','PUT',{path:old.path,kind:'file',text:old.text+'\n## 不相关的正文\n必须保留的手写内容。\n',expectedRevision:old.revision});
    await taskRow(savedTask.title).locator('.lubi-task-start').click();await page.locator('[data-actual="minutes"]').fill('25min');await page.locator('[data-actual="start"]').fill('16:00');assert.equal(await page.locator('.lubi-completion-choice input[type="checkbox"]').isChecked(),false);
    await page.locator('[data-lubi-focus="task:save"]').click();await until(async()=>(await journal()).includes('任务:: '+savedTask.id));
    let task=(await store()).tasks.find(t=>t.id===savedTask.id);assert.equal(task.estimate,60);assert.notEqual(task.status,'done');assert.match(await journal(),/必须保留的手写内容。/);assert.match(await journal(),/预计用时:: 1h/);
    const before=await journal();await taskRow(savedTask.title).getByRole('checkbox').check();await until(async()=>(await store()).tasks.find(t=>t.id===savedTask.id).status==='done');assert.equal(await journal(),before,'completion must not fabricate another record');
    await shot('actual-time-completion');
  });
  await step('Independent actual entry splits midnight without changing its estimate',async()=>{
    await page.locator('.lubi-topbar-cta').click();await page.getByPlaceholder('要做什么',{exact:true}).fill('跨午夜合成记录');await page.locator('[data-actual="minutes"]').fill('30min');await page.locator('[data-actual="start"]').fill('23:45');await page.locator('[data-lubi-focus="task:save"]').click();
    await until(async()=>(await journal()).includes('跨午夜合成记录')&&(await journal('2026-10-19')).includes('跨午夜合成记录'));assert.match(await journal(),/23:45.*跨午夜合成记录.*时长:: 15min/);assert.match(await journal('2026-10-19'),/00:00.*跨午夜合成记录.*时长:: 15min/);
  });
  await step('Spending entry remains money, not fabricated actual time',async()=>{
    await page.locator('.lubi-topbar-cta').click();await modal().locator('[data-lubi-focus="seg:money"]').click();await page.getByPlaceholder('午饭 / 地铁 / 书').fill('合成支出');await page.getByPlaceholder('0.00',{exact:true}).fill('18.5');await modal().getByRole('button',{name:/^记下/}).click();await until(async()=>(await journal()).includes('合成支出'));assert.match(await journal(),/合成支出.*金额:: 18.5/);
  });
  await step('Recurrence and background Agent handoff use original state transitions',async()=>{
    const before=await journal();const task=await createTask('合成后台重复任务',async()=>{await page.getByLabel('重复',{exact:true}).selectOption('daily');await modal().locator('.lubi-extras-toggles button').filter({hasText:'执行方式'}).click();await page.getByLabel('执行方式',{exact:true}).selectOption('background');});
    assert.equal(task.repeat.kind,'daily');assert.equal(task.executor,'background');
    await taskRow(task.title).hover();await taskRow(task.title).locator('[data-background-action="running"]').click();await page.locator(`.lubi-background-card [data-task-id="${task.id}"]`).waitFor();await page.locator(`.lubi-background-card [data-task-id="${task.id}"] [data-background-action="review"]`).click();const row=page.locator(`.lubi-attention-card [data-task-id="${task.id}"]`);await row.waitFor();await row.locator('[data-review-action="accept"]').click();await until(async()=>(await store()).tasks.find(t=>t.id===task.id).doneDates.includes(testDate));assert.equal(await journal(),before);assert.equal((await store()).tasks.find(t=>t.id===task.id).backgroundRuns[testDate].phase,'accepted');
  });
  await step('JSON import validates before adding and preserves existing tasks',async()=>{
    const before=(await store()).tasks.length;await page.getByRole('button',{name:'JSON 任务导入',exact:true}).click();await page.getByLabel('JSON 任务数据').fill('{bad');await modal().getByRole('button',{name:'导入',exact:true}).click();await modal().getByRole('alert').waitFor();assert.equal((await store()).tasks.length,before);
    await page.getByLabel('JSON 任务数据').fill(JSON.stringify({tasks:[{title:'JSON 合成任务',category:'学习',date:testDate,start:'',estimate:35,location:'图书馆'}]}));await modal().getByRole('button',{name:'导入',exact:true}).click();await until(async()=>(await store()).tasks.length===before+1);assert.equal((await store()).tasks.find(t=>t.title==='JSON 合成任务').location,'图书馆');
  });
  await step('Settings, named encrypted AI key, model discovery and AI task creation',async()=>{
    mockAi=createServer((req,res)=>{let text='';req.on('data',c=>text+=c);req.on('end',()=>{aiRequests.push({path:req.url,auth:req.headers.authorization,text});res.setHeader('content-type','application/json');res.end(req.url.endsWith('/models')?JSON.stringify({data:[{id:'synthetic-model'}]}):JSON.stringify({choices:[{message:{content:JSON.stringify({title:'AI 合成任务',category:'学习',date:testDate,start:'17:00',estimate:40,location:'合成地点',confidence:'high',explanation:'仅用于本地自动测试',subtasks:[]})}}]}));});});mockAi.listen(0,'127.0.0.1');await once(mockAi,'listening');
    await menu('设置');const details=page.locator('details').filter({has:page.getByLabel('AI 接口地址',{exact:true})});if(await details.count())await details.evaluate(e=>e.open=true);
    await page.getByLabel('AI 接口地址',{exact:true}).fill(`http://127.0.0.1:${mockAi.address().port}/v1`);await page.getByLabel('AI 模型',{exact:true}).fill('synthetic-model');await page.getByRole('button',{name:'新增密钥',exact:true}).click();await page.getByLabel('密钥名称',{exact:true}).fill('browser-test-key');await page.getByLabel('密钥内容',{exact:true}).fill('synthetic-persistent-secret');await page.getByRole('button',{name:'保存密钥',exact:true}).click();await until(async()=>(await app.json('/vault/settings')).data.aiKeySecret==='browser-test-key');await page.getByRole('button',{name:'获取模型列表',exact:true}).click();await until(()=>aiRequests.some(r=>r.path.endsWith('/models')));assert.equal(aiRequests.at(-1).auth,'Bearer synthetic-persistent-secret');await close();await page.reload();await page.locator('.lubi-root').waitFor();
    assert(!JSON.stringify(await app.json('/vault/settings')).includes('synthetic-persistent-secret'));assert(!JSON.stringify(await app.json('/vault/export')).includes('synthetic-persistent-secret'));
    await page.getByRole('button',{name:'AI 创建任务',exact:true}).click();await page.getByLabel('任务描述',{exact:true}).fill('今天17点在合成地点学习40分钟');await modal().getByRole('button',{name:'AI 解析',exact:true}).click();await page.getByRole('button',{name:'使用这些信息创建任务',exact:true}).click();await page.getByPlaceholder('要做什么',{exact:true}).waitFor();assert.equal(await page.getByPlaceholder('要做什么',{exact:true}).inputValue(),'AI 合成任务');await page.locator('[data-lubi-focus="task:save"]').click();await until(async()=>(await store()).tasks.some(t=>t.title==='AI 合成任务'));assert.equal(aiRequests.at(-1).auth,'Bearer synthetic-persistent-secret');await shot('ai-result-saved');
  });
  await step('Budget, outcome acceptance, linked note and weekly review are durable',async()=>{
    await menu('工作复盘与整理');await page.getByLabel('查看对象',{exact:true}).selectOption('t:'+savedTask.id);await page.getByLabel('总预算（分钟；0 表示未设置）',{exact:true}).fill('150');await page.getByRole('button',{name:'保存预算',exact:true}).click();await until(async()=>(await store()).tasks.find(t=>t.id===savedTask.id).budgetMinutes===150);
    await page.getByLabel('查看对象',{exact:true}).selectOption('t:'+savedTask.id);await page.getByLabel('关联笔记／成果（每行 [[笔记#区块]] 或 https 链接）',{exact:true}).fill('[[日记/'+testDate+']]');await page.getByLabel('验收清单（每行 - [ ] 条件；完成后改为 - [x]）',{exact:true}).fill('- [x] 浏览器合成验收');await page.getByLabel('本次交付记录',{exact:true}).selectOption('accepted');await page.getByRole('button',{name:'保存成果与验收',exact:true}).click();await until(async()=>(await store()).tasks.find(t=>t.id===savedTask.id).outcome?.history?.length===1);
    await page.getByLabel('查看对象',{exact:true}).selectOption('t:'+savedTask.id);await page.getByRole('button',{name:'打开 [[日记/'+testDate+']]',exact:true}).click();await page.getByLabel('文件内容').waitFor();assert((await page.getByLabel('文件内容').inputValue()).includes('必须保留的手写内容。'));await close();
    await page.getByRole('button',{name:'周复盘',exact:true}).click();await page.getByLabel('本周发现：保留什么、减少什么？',{exact:true}).fill('保留专注，减少切换。');await page.getByLabel('下周行动（每行一项，不会自动排期）',{exact:true}).fill('合成周报行动');await page.getByRole('checkbox',{name:'同时创建这些未安排任务（相同周＋相同原文不重复）'}).check();await page.getByRole('button',{name:'保存周报',exact:true}).click();await until(async()=>(await store()).tasks.some(t=>t.title==='合成周报行动')&&(await snapshot()).documents.some(d=>d.path.startsWith('Lubi-复盘/')&&d.text.includes('保留专注')));assert((await snapshot()).documents.some(d=>d.path.startsWith('Lubi-复盘/')&&d.text.includes('保留专注')));await shot('weekly-review');await close();
  });
  await step('Backlog batch rescheduling, undo and confirmed split preserve the original',async()=>{
    const before=await journal(),task=(await store()).tasks.find(t=>t.title==='合成周报行动');await menu('工作复盘与整理');await page.getByRole('button',{name:'待整理',exact:true}).click();await page.getByRole('checkbox',{name:/^合成周报行动/}).check();await page.getByLabel('安排到',{exact:true}).fill('2026-10-20');await page.getByRole('button',{name:'批量改期',exact:true}).click();await until(async()=>(await store()).tasks.find(t=>t.id===task.id).date==='2026-10-20');await until(async()=>!(await page.locator('.lubi-product-modal [aria-busy="true"]').count()));await page.getByRole('button',{name:'撤销最近一次整理',exact:true}).click();await until(async()=>(await store()).tasks.find(t=>t.id===task.id).date==='');await page.getByRole('checkbox',{name:/^合成周报行动/}).check();await page.getByLabel('拆分为更小的行动（先只选一个原任务，每行一个新行动）',{exact:true}).fill('合成行动一\n合成行动二');await page.getByRole('button',{name:'拆分并归档原任务',exact:true}).click();await modal().getByRole('button',{name:'确认拆分',exact:true}).click();await until(async()=>(await store()).tasks.some(t=>t.title==='合成行动二'));assert.equal((await store()).tasks.find(t=>t.id===task.id).archived,true);assert.equal(await journal(),before);await close();
  });
  await step('Live timer survives reload, requires confirmation and does not complete tasks',async()=>{
    const task=(await store()).tasks.find(t=>t.title==='JSON 合成任务');await menu('工作复盘与整理');await page.getByRole('button',{name:'实时计时',exact:true}).click();await page.getByLabel('关联任务',{exact:true}).selectOption(task.id);await page.getByRole('button',{name:'开始计时',exact:true}).click();await until(async()=>!!(await app.json('/vault/settings')).data.focusTimer);
    await page.clock.setFixedTime(new Date('2026-10-18T06:02:00Z'));await close();await page.reload();await page.locator('.lubi-root').waitFor();await menu('工作复盘与整理');await page.getByRole('button',{name:'实时计时',exact:true}).click();await page.getByRole('button',{name:'暂停并预览',exact:true}).click();await page.getByRole('checkbox',{name:'我已核对以上各段为真实本人投入'}).check();await page.getByRole('button',{name:'确认保存实际记录',exact:true}).click();await until(async()=>!(await app.json('/vault/settings')).data.focusTimer);assert.equal((await store()).tasks.find(t=>t.id===task.id).status,'todo');assert.match(await journal(),/JSON 合成任务.*时长:: 2min/);await close();await page.clock.setFixedTime(new Date('2026-10-18T06:00:00Z'));
  });
  await step('Original data export and isolated recovery never overwrite active files',async()=>{
    const wait=page.waitForEvent('download');await menu('导出数据 JSON');const download=await wait;exportFile=join(output,'synthetic-plugin-export.json');await download.saveAs(exportFile);const data=JSON.parse(readFileSync(exportFile,'utf8'));assert.equal(data.format,'lubi-data');assert(data.taskStore.tasks.some(t=>t.id===savedTask.id));assert(data.records.length>0);
    const before=(await snapshot()).documents.filter(d=>d.kind==='file').map(d=>[d.path,d.text]);await menu('工作复盘与整理');await page.getByRole('button',{name:'数据恢复',exact:true}).click();await page.getByLabel('选择完整导出 JSON',{exact:true}).setInputFiles(exportFile);await modal().getByText(/个任务 · .*条记录/).waitFor();await page.getByRole('checkbox',{name:'已核对预览，确认创建隔离恢复副本'}).check();await page.getByRole('button',{name:'开始隔离恢复',exact:true}).click();await until(async()=>(await snapshot()).documents.some(d=>d.path.endsWith('/恢复说明.md')));const after=await snapshot();for(const [path,text] of before)assert.equal(after.documents.find(d=>d.path===path).text,text,path);await shot('isolated-restore');await close();
  });
  await step('Web backup preserves arbitrary Markdown and restores through a validated UI',async()=>{
    const before=(await snapshot()).documents.filter(d=>d.kind==='file').map(d=>[d.path,d.text]);await menu('设置');const wait=page.waitForEvent('download');await page.getByRole('button',{name:'下载 Web 文件备份',exact:true}).click();const download=await wait;const file=join(output,'synthetic-vault-export.json');await download.saveAs(file);await page.getByRole('button',{name:'恢复 Web 文件备份',exact:true}).click();await page.getByLabel('选择 Web 文件备份',{exact:true}).setInputFiles(file);await modal().getByText(/个文件 · .*个文件夹/).waitFor();await modal().getByRole('checkbox',{name:'已核对，创建隔离副本',exact:true}).check();await page.getByRole('button',{name:'确认隔离恢复 Web 文件',exact:true}).click();await modal().getByText(/已恢复到 Lubi-Web恢复/).waitFor();const after=await snapshot();for(const [path,text] of before)assert.equal(after.documents.find(d=>d.path===path).text,text);await close();await close();
  });
  await step('A stale Markdown editor cannot overwrite a newer external edit after polling',async()=>{
    await menu('打开日记文件');const editor=page.getByLabel('文件内容',{exact:true});const old=await editor.inputValue();const file=await app.json('/vault/file?path='+encodeURIComponent('日记/'+testDate+'.md'));const external=file.text+'\n外部合成修改，不能被旧编辑器覆盖。\n';await app.json('/vault/file','PUT',{path:file.path,kind:'file',text:external,expectedRevision:file.revision});await delay(5500);await editor.fill(old+'\n本地未保存的草稿。\n');await modal().getByRole('button',{name:'保存',exact:true}).click();await modal().getByRole('status').filter({hasText:'其他窗口修改'}).waitFor();assert.equal(await journal(),external);assert((await editor.inputValue()).includes('本地未保存的草稿。'));await close();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert((await editor.inputValue()).includes('本地未保存的草稿。'));await close();await page.getByRole('button',{name:'丢弃未保存修改',exact:true}).click();
  });
  await step('Raw JSON validation, downloadable drafts and Ctrl-S never discard unsaved content',async()=>{
    const path='任务/任务数据.json',before=await app.json('/vault/file?path='+encodeURIComponent(path));await menu('设置');await page.getByRole('button',{name:'查看 Web 文件',exact:true}).click();await modal().getByRole('button',{name:path,exact:true}).click();const editor=page.getByLabel('文件内容',{exact:true});await editor.fill('{broken');await modal().getByRole('button',{name:'保存',exact:true}).click();await until(async()=>!!(await modal().getByRole('status').innerText()));assert.equal((await app.json('/vault/file?path='+encodeURIComponent(path))).text,before.text);const waiting=page.waitForEvent('download');await modal().getByRole('button',{name:'下载文件',exact:true}).click();const download=await waiting;const file=join(output,'synthetic-invalid-json-draft.txt');await download.saveAs(file);assert.equal(readFileSync(file,'utf8'),'{broken');const draft=before.text+'\n';await editor.fill(draft);await editor.press('Control+s');await modal().getByRole('status').filter({hasText:'已保存'}).waitFor();assert.equal((await app.json('/vault/file?path='+encodeURIComponent(path))).text,draft);await close();await close();await close();
  });
  await step('Save failures retain drafts; reauthentication traps focus and ignores stale 401 responses',async()=>{
    let pendingPoll;await page.route('**/api/vault/changes?since=*',route=>{if(!pendingPoll){pendingPoll=route;return;}return route.continue();});await until(()=>!!pendingPoll,'Expected an old-session poll to be in flight');
    await listDay();await page.locator('.lubi-topbar-cta').click();await page.getByPlaceholder('要做什么',{exact:true}).fill('失败后必须保留的草稿');await page.route('**/api/vault/file',route=>route.request().method()==='PUT'?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'合成并发冲突'})}):route.continue());await page.locator('[data-lubi-focus="task:save"]').click();await modal().getByRole('alert').filter({hasText:'合成并发冲突'}).waitFor();assert.equal(await page.getByPlaceholder('要做什么',{exact:true}).inputValue(),'失败后必须保留的草稿');await page.unroute('**/api/vault/file');
    await page.evaluate(()=>fetch('/api/auth/logout',{method:'POST'}));await page.locator('[data-lubi-focus="task:save"]').click();await page.getByLabel('访问密码',{exact:true}).waitFor();await page.keyboard.press('Tab');assert(await page.getByRole('button',{name:'进入工作区'}).evaluate(e=>e===document.activeElement),'authentication must retain its own focus');await page.keyboard.press('Tab');assert(await page.getByLabel('访问密码',{exact:true}).evaluate(e=>e===document.activeElement));await page.keyboard.press('Escape');assert.equal(await page.getByPlaceholder('要做什么',{exact:true}).inputValue(),'失败后必须保留的草稿');await page.getByLabel('访问密码',{exact:true}).fill(testPassword);await page.getByRole('button',{name:'进入工作区'}).click();await until(async()=>!(await page.locator('.web-login').count()));await pendingPoll.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'合成延迟旧会话响应'})});await delay(250);assert.equal(await page.locator('.web-login').count(),0,'A late 401 from the old session must not invalidate the new login');await page.unroute('**/api/vault/changes?since=*');await page.locator('[data-lubi-focus="task:save"]').click();await until(async()=>(await store()).tasks.some(t=>t.title==='失败后必须保留的草稿'));
  });
  }
  await step('No uncaught browser runtime errors',async()=>assert.deepEqual(errors,[]));
  report.passed=true;console.log(`Browser checks passed (${report.steps.length}); ${report.visual.length} independent screenshot comparisons.`);
}catch(error){report.passed=false;console.error(error);process.exitCode=1;}
finally{record();if(mockAi)await new Promise(resolve=>mockAi.close(resolve));await context.close();await browser.close();await app.stop();}
