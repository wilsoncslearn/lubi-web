import LubiPlugin from '../../../packages/plugin-runtime/src/main';
import manifest from '../../../packages/plugin-runtime/manifest.json';
import { App, Notice, downloadText } from './host/obsidian';
import { api } from './host/vault';
import './host/host.css';
import './plugin.css';

const root=document.getElementById('root')!;
let app:App|undefined;
let opening=false;
const theme=localStorage.getItem('lubi-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
document.body.className='theme-'+theme;
function message(text:string){root.replaceChildren();const panel=root.createDiv({cls:'web-boot'});panel.createEl('h1',{text:'Lubi'});panel.createEl('p',{text});}
function login(resume=false){
  if(document.querySelector('.web-login'))return;
  const previousFocus=document.activeElement as HTMLElement|null;
  const suspended=resume?[root,...document.querySelectorAll<HTMLElement>('.modal-container')].map(element=>({element,inert:element.inert})):[];
  for(const {element} of suspended)element.inert=true;
  if(!resume)root.replaceChildren();
  const host=(resume?document.body:root).createDiv({cls:'web-login'+(resume?' web-login-overlay':'')});
  const form=host.createEl('form',{cls:'web-login-card'});form.createEl('span',{text:'LUBI / PRIVATE WORKSPACE',cls:'web-eyebrow'});
  form.createEl('h1',{text:resume?'继续你的工作。':'开始记录。'});
  form.createEl('p',{text:resume?'会话已过期。重新登录后，未保存的表单仍在原处。':'与插件相同的计划、记录与回顾，保存在独立数据库。'});
  const label=form.createEl('label',{text:'访问密码',attr:{for:'login-password'}});
  const input=label.createEl('input',{type:'password',attr:{id:'login-password',autocomplete:'current-password',required:'',minlength:'16','aria-label':'访问密码'}});
  const status=form.createEl('p',{cls:'web-login-error',attr:{role:'alert'}});
  const submit=form.createEl('button',{text:'进入工作区',type:'submit',cls:'web-primary'});
  form.createEl('small',{text:'本地启动密码见项目的 .env.local；不会发送到第三方。'});
  form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;status.textContent='';try{await api('/auth/login',{method:'POST',body:JSON.stringify({password:input.value})});input.value='';host.remove();for(const {element,inert} of suspended)if(element.isConnected)element.inert=inert;if(resume&&previousFocus?.isConnected)previousFocus.focus();if(!resume)await mount();else new Notice('已重新登录，请重试刚才未保存的操作。');}catch(error){status.textContent=(error as Error).message;}finally{submit.disabled=false;}});
  if(resume)form.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();}else if(event.key==='Tab'){if(event.shiftKey&&document.activeElement===input){event.preventDefault();submit.focus();}else if(!event.shiftKey&&document.activeElement===submit){event.preventDefault();input.focus();}}});
  input.focus();
}
async function upgradePrompt():Promise<void>{
  const legacy=await api('/vault/legacy-status');
  if(!legacy.targetEmpty || (!legacy.tasks&&!legacy.records&&!legacy.projects))return;
  message('检测到旧版 Web 数据');const host=root.querySelector('.web-boot')!;
  host.createEl('p',{text:`${legacy.projects} 个项目 · ${legacy.tasks} 个任务 · ${legacy.records} 条记录。升级将保留旧表和事务备份，不读取或修改 Obsidian Vault。`});
  await new Promise<void>(resolve=>{
    const status=host.createEl('p',{attr:{role:'status'}});
    const upgrade=host.createEl('button',{text:'保留旧数据并升级到完整模式',type:'button',cls:'web-primary'});
    upgrade.onclick=async()=>{upgrade.disabled=true;try{await api('/vault/upgrade-legacy',{method:'POST'});resolve();}catch(error){status.textContent=(error as Error).message;upgrade.disabled=false;}};
  });
}
async function mount(){
  if(opening)return;opening=true;
  try{
    await upgradePrompt();message('正在打开工作区…');
    const host=new App();await host.vault.initialize();await host.secretStorage.initialize();host.vault.onDownload=downloadText;
    root.replaceChildren();const plugin=new LubiPlugin(host as any,manifest as any);
    await plugin.onload();for(const ready of host.workspace.ready)await ready();
    await plugin.activateView();host.bindCommandShortcut();host.vault.start();app=host;
    if(import.meta.env.DEV || import.meta.env.VITE_LUBI_TEST==='1') (window as any).__lubi={app:host,plugin,view:host.workspace.active?.view};
  }catch(error){message('打开失败：'+(error as Error).message);const retry=root.querySelector('.web-boot')!.createEl('button',{text:'重试',type:'button'});retry.onclick=()=>void mount();}
  finally{opening=false;}
}
window.addEventListener('lubi-auth-required',()=>login(true));
window.addEventListener('unhandledrejection',event=>{new Notice('操作未完成：'+(event.reason instanceof Error?event.reason.message:'请稍后重试。'),8000);});
window.addEventListener('beforeunload',()=>app?.vault.stop());
message('正在连接…');
api('/auth/me').then(()=>mount()).catch(()=>login());
