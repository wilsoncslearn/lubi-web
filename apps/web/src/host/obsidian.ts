import { Vault, TFile, TFolder, normalizePath, api } from './vault';
import icons from './icons.json';
export { TFile, TFolder, normalizePath };

// These are host API implementations. Plugin UI/core/services are reused verbatim.
const P:any=Node.prototype, E:any=Element.prototype;
function attributes(el:any,options:any={}) {
  if(typeof options==='string')options={cls:options};
  if(options.cls)el.setAttribute('class',Array.isArray(options.cls)?options.cls.join(' '):options.cls);
  if(options.text!==undefined)el.textContent=String(options.text);
  for(const name of ['type','href','title','placeholder'])if(options[name]!==undefined)el.setAttribute(name,options[name]);
  if(options.value!==undefined)el.value=options.value;
  for(const [key,value] of Object.entries(options.attr||{}))if(value!==null&&value!==undefined)el.setAttribute(key,String(value));
  return el;
}
P.createEl=function(tag:string,options?:any,callback?:Function){const el=attributes(document.createElement(tag),options);this.appendChild(el);callback?.(el);return el;};
P.createDiv=function(options?:any,callback?:Function){return this.createEl('div',options,callback);};
P.createSpan=function(options?:any,callback?:Function){return this.createEl('span',options,callback);};
P.createSvg=function(tag:string,options?:any){const el=attributes(document.createElementNS('http://www.w3.org/2000/svg',tag),options);this.appendChild(el);return el;};
P.empty=function(){while(this.firstChild)this.removeChild(this.firstChild);};
P.setText=function(text:unknown){this.textContent=String(text??'');};
E.addClass=function(...classes:string[]){this.classList.add(...classes.flatMap(c=>c.split(/\s+/)).filter(Boolean));};
E.removeClass=function(...classes:string[]){this.classList.remove(...classes.flatMap(c=>c.split(/\s+/)).filter(Boolean));};
E.toggleClass=function(cls:string,value:boolean){this.classList.toggle(cls,value);};
E.hasClass=function(cls:string){return this.classList.contains(cls);};
E.setAttr=function(name:string,value:any){if(value===null)this.removeAttribute(name);else this.setAttribute(name,String(value));};
E.setAttrs=function(values:Record<string,unknown>){for(const [k,v] of Object.entries(values))this.setAttr(k,v);};
E.show=function(){this.style.display='';};E.hide=function(){this.style.display='none';};
E.setCssProps=function(values:Record<string,string>){for(const [k,v] of Object.entries(values))this.style.setProperty(k,v);};
Object.assign(globalThis,{createDiv:(o?:any)=>attributes(document.createElement('div'),o),createSpan:(o?:any)=>attributes(document.createElement('span'),o),createEl:(tag:string,o?:any)=>attributes(document.createElement(tag),o)});

export function setIcon(el:HTMLElement,name:string){
  const alias:Record<string,string>={'bar-chart-3':'chart-column','more-horizontal':'ellipsis','more-vertical':'ellipsis-vertical'};
  el.setAttribute('data-icon',name);el.innerHTML=(icons as Record<string,string>)[name]||(icons as Record<string,string>)[alias[name]]||(icons as Record<string,string>)['circle-help']||'';
  const svg=el.querySelector('svg');svg?.setAttribute('aria-hidden','true');svg?.classList.add('svg-icon');
}
export class Notice {
  noticeEl:HTMLDivElement;private timer?:number;
  constructor(message:string|DocumentFragment,duration=5000){
    let host=document.querySelector<HTMLElement>('.notice-container');if(!host){host=document.body.createDiv({cls:'notice-container'});}
    this.noticeEl=host.createDiv({cls:'notice lubi-notice',attr:{role:'status','aria-live':'polite'}});
    if(typeof message==='string')this.noticeEl.textContent=message;else this.noticeEl.append(message);
    if(duration>0)this.timer=window.setTimeout(()=>this.hide(),duration);
  }
  hide(){if(this.timer)clearTimeout(this.timer);this.noticeEl.remove();}
  setMessage(message:string){this.noticeEl.textContent=message;return this;}
}
const modalStack:Modal[]=[];
let nextModalId=0;
export class Modal {
  containerEl:HTMLElement;bgEl:HTMLElement;modalEl:HTMLElement;headerEl:HTMLElement;titleEl:HTMLElement;contentEl:HTMLElement;
  private previous:HTMLElement|null=null;private opened=false;
  private onKey=(event:KeyboardEvent)=>{
    if(modalStack.at(-1)!==this||document.querySelector('.web-login-overlay'))return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();}
    if(event.key==='Tab'){
      const items=[...this.modalEl.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex="0"]')].filter(x=>!x.hasAttribute('disabled')&&x.getClientRects().length>0);
      if(!items.length){event.preventDefault();this.modalEl.focus();return;}
      const first=items[0],last=items.at(-1)!;
      if(event.shiftKey && (document.activeElement===first || !this.modalEl.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  };
  constructor(public app:App){
    this.containerEl=document.createElement('div');this.containerEl.className='modal-container';
    const bg=this.bgEl=this.containerEl.createDiv({cls:'modal-bg'});bg.addEventListener('mousedown',()=>{if(modalStack.at(-1)===this)this.close();});
    this.modalEl=this.containerEl.createDiv({cls:'modal',attr:{role:'dialog','aria-modal':'true',tabindex:'-1'}});
    const id='web-dialog-'+(++nextModalId);
    this.containerEl.createSpan({text:'关闭',attr:{id:id+'-close',hidden:''}});
    const close=this.modalEl.createEl('button',{cls:'modal-header-button mod-raised clickable-icon',attr:{type:'button','aria-labelledby':id+'-close'}});setIcon(close,'x');close.addEventListener('click',()=>this.close());
    this.headerEl=this.modalEl.createDiv({cls:'modal-header'});this.titleEl=this.headerEl.createDiv({cls:'modal-title',attr:{id}});this.modalEl.setAttribute('aria-labelledby',id);
    this.contentEl=this.modalEl.createDiv({cls:'modal-content'});
  }
  setTitle(title:string){this.titleEl.textContent=title;return this;}
  onOpen():void|Promise<void>{}
  onClose():void{}
  open(){
    if(this.opened)return;this.opened=true;this.previous=document.activeElement as HTMLElement;
    if(modalStack.length)modalStack.at(-1)!.containerEl.inert=true;
    modalStack.push(this);document.body.append(this.containerEl);document.addEventListener('keydown',this.onKey);
    const root=document.getElementById('root');if(root)root.inert=true;
    this.containerEl.style.zIndex=String(1000+modalStack.length*10);
    try{void this.onOpen();}catch(error){this.close();throw error;}
    requestAnimationFrame(()=>{if(this.opened&&!this.modalEl.contains(document.activeElement))(this.contentEl.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),[autofocus]')||this.modalEl).focus();});
  }
  close(){
    if(!this.opened)return;this.opened=false;this.onClose();this.containerEl.remove();document.removeEventListener('keydown',this.onKey);
    const index=modalStack.indexOf(this);if(index>=0)modalStack.splice(index,1);
    if(modalStack.length)modalStack.at(-1)!.containerEl.inert=false;
    const root=document.getElementById('root');if(root)root.inert=modalStack.length>0;
    if(this.previous?.isConnected)this.previous.focus();
  }
}
export class Menu {
  private items:{title:string;icon?:string;callback?:()=>unknown;disabled?:boolean;separator?:boolean}[]=[];
  addItem(fn:Function){const item:any={title:'',setTitle(v:string){this.title=v;return this;},setIcon(v:string){this.icon=v;return this;},onClick(v:()=>unknown){this.callback=v;return this;},setDisabled(v:boolean){this.disabled=v;return this;},setSection(){return this;}};fn(item);this.items.push(item);return this;}
  addSeparator(){this.items.push({title:'',separator:true});return this;}
  showAtMouseEvent(event:MouseEvent){this.showAtPosition({x:event.clientX,y:event.clientY});}
  showAtPosition({x,y}:{x:number;y:number}){
    document.querySelector('.menu')?.remove();const menu=document.body.createDiv({cls:'menu',attr:{role:'menu'}});
    const close=()=>{menu.remove();document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keys);};
    const outside=(e:Event)=>{if(!menu.contains(e.target as Node))close();};
    const buttons:HTMLButtonElement[]=[];
    for(const item of this.items){if(item.separator){menu.createEl('hr');continue;}
      const b=menu.createEl('button',{cls:'menu-item',attr:{role:'menuitem',type:'button'}});b.disabled=!!item.disabled;
      if(item.icon)setIcon(b.createSpan({cls:'menu-item-icon'}),item.icon);b.createSpan({text:item.title});
      b.addEventListener('click',()=>{close();item.callback?.();});buttons.push(b);
    }
    const keys=(e:KeyboardEvent)=>{const i=buttons.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='Escape'){e.preventDefault();close();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}};
    const box=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,innerWidth-box.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-box.height-8))+'px';
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keys);buttons[0]?.focus();
  }
}
export class TextComponent {
  inputEl:HTMLInputElement|HTMLTextAreaElement;
  constructor(parent:HTMLElement,tag:'input'|'textarea'='input'){this.inputEl=parent.createEl(tag) as HTMLInputElement; if(tag==='input')this.inputEl.setAttribute('type','text');}
  setValue(value:string){this.inputEl.value=value;return this;}getValue(){return this.inputEl.value;}
  setPlaceholder(value:string){this.inputEl.placeholder=value;return this;}setDisabled(value:boolean){this.inputEl.disabled=value;return this;}
  onChange(fn:(value:string)=>unknown){this.inputEl.addEventListener('input',()=>fn(this.inputEl.value));return this;}
}
export class DropdownComponent {
  selectEl:HTMLSelectElement;constructor(parent:HTMLElement){this.selectEl=parent.createEl('select');}
  addOption(value:string,text:string){this.selectEl.createEl('option',{value,text});return this;}
  addOptions(values:Record<string,string>){for(const [v,t] of Object.entries(values))this.addOption(v,t);return this;}
  setValue(value:string){this.selectEl.value=value;return this;}getValue(){return this.selectEl.value;}
  onChange(fn:(value:string)=>unknown){this.selectEl.addEventListener('change',()=>fn(this.selectEl.value));return this;}
  setDisabled(value:boolean){this.selectEl.disabled=value;return this;}
}
class ToggleComponent {
  toggleEl:HTMLElement;private value=false;private changed?:(v:boolean)=>unknown;
  constructor(parent:HTMLElement){this.toggleEl=parent.createDiv({cls:'checkbox-container',attr:{role:'checkbox',tabindex:'0'}});this.toggleEl.addEventListener('click',()=>{this.setValue(!this.value);this.changed?.(this.value);});this.toggleEl.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();this.toggleEl.click();}});}
  setValue(v:boolean){this.value=!!v;this.toggleEl.toggleClass('is-enabled',this.value);this.toggleEl.setAttribute('aria-checked',String(this.value));return this;}
  onChange(fn:(v:boolean)=>unknown){this.changed=fn;return this;}
}
class ButtonComponent {
  buttonEl:HTMLButtonElement;extraSettingsEl:HTMLButtonElement;
  constructor(parent:HTMLElement,extra=false){this.buttonEl=parent.createEl('button',{type:'button',cls:extra?'extra-setting-button clickable-icon':''});this.extraSettingsEl=this.buttonEl;this.buttonEl.addEventListener('mousedown',e=>e.preventDefault());}
  setButtonText(value:string){this.buttonEl.setText(value);return this;}setCta(){this.buttonEl.addClass('mod-cta');return this;}
  setWarning(){this.buttonEl.addClass('mod-warning');return this;}setDisabled(v:boolean){this.buttonEl.disabled=v;return this;}
  setIcon(name:string){setIcon(this.buttonEl,name);return this;}setTooltip(text:string){this.buttonEl.setAttribute('aria-label',text);return this;}
  onClick(fn:(event:MouseEvent)=>unknown){this.buttonEl.addEventListener('click',fn);return this;}
}
export class Setting {
  settingEl:HTMLElement;infoEl:HTMLElement;nameEl:HTMLElement;descEl:HTMLElement;controlEl:HTMLElement;
  constructor(parent:HTMLElement){this.settingEl=parent.createDiv({cls:'setting-item'});this.infoEl=this.settingEl.createDiv({cls:'setting-item-info'});this.nameEl=this.infoEl.createDiv({cls:'setting-item-name'});this.descEl=this.infoEl.createDiv({cls:'setting-item-description'});this.controlEl=this.settingEl.createDiv({cls:'setting-item-control'});}
  setName(v:string){this.nameEl.setText(v);return this;}setDesc(v:string|DocumentFragment){this.descEl.empty();typeof v==='string'?this.descEl.setText(v):this.descEl.append(v);return this;}
  setHeading(){this.settingEl.addClass('setting-item-heading');return this;}
  addText(fn:(v:TextComponent)=>unknown){fn(new TextComponent(this.controlEl));return this;}
  addTextArea(fn:(v:TextComponent)=>unknown){fn(new TextComponent(this.controlEl,'textarea'));return this;}
  addDropdown(fn:(v:DropdownComponent)=>unknown){fn(new DropdownComponent(this.controlEl));return this;}
  addToggle(fn:(v:ToggleComponent)=>unknown){fn(new ToggleComponent(this.controlEl));return this;}
  addButton(fn:(v:ButtonComponent)=>unknown){fn(new ButtonComponent(this.controlEl));return this;}
  addExtraButton(fn:(v:ButtonComponent)=>unknown){fn(new ButtonComponent(this.controlEl,true));return this;}
}
export class SecretStorage {
  private names=new Set<string>();
  async initialize(){const result=await api('/secrets');this.names=new Set(result.names);}
  getSecret(id:string){return this.names.has(id)?'lubi-web-key:'+id:null;}listSecrets(){return [...this.names];}
  async setSecret(id:string,value:string){await api('/secrets/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({value})});this.names.add(id);}
  async deleteSecret(id:string){await api('/secrets/'+encodeURIComponent(id),{method:'DELETE'});this.names.delete(id);}
  clear(){this.names.clear();}
}
export class SecretComponent extends DropdownComponent {
  constructor(app:App,parent:HTMLElement){
    super(parent);this.selectEl.setAttribute('aria-label','服务端密钥');
    const refresh=()=>{this.selectEl.replaceChildren();this.addOption('','选择服务端密钥…');for(const id of app.secretStorage.listSecrets())this.addOption(id,id);};refresh();
    const add=parent.createEl('button',{text:'新增密钥',type:'button'});add.addEventListener('mousedown',e=>e.preventDefault());
    add.onclick=()=>{const modal=new Modal(app);modal.setTitle('服务端加密密钥库');modal.modalEl.addClass('lubi-modal','web-secret-modal');modal.contentEl.createEl('p',{text:'密钥在服务端本地加密保存，不在下载文件中，也不会从服务器回传浏览器；与 Obsidian 系统钥匙串独立。请一并保管数据库和服务端密钥文件。'});
      const name=modal.contentEl.createEl('label',{text:'密钥名称',cls:'web-secret-label'}).createEl('input',{attr:{'aria-label':'密钥名称',placeholder:'my-ai-key',pattern:'[a-z0-9-]{1,64}',maxlength:'64',autocomplete:'off'}});
      const value=modal.contentEl.createEl('label',{text:'密钥内容',cls:'web-secret-label'}).createEl('input',{type:'password',attr:{'aria-label':'密钥内容',autocomplete:'new-password'}});
      const status=modal.contentEl.createEl('p',{attr:{role:'status'}});const save=modal.contentEl.createEl('button',{text:'保存密钥',type:'button',cls:'mod-cta'});
      save.onclick=async()=>{const id=name.value.trim();if(!/^[a-z0-9-]{1,64}$/.test(id)||!value.value.trim()){status.setText('请填写有效名称和密钥。');return;}if(app.secretStorage.listSecrets().includes(id)){status.setText('名称已存在。为避免覆盖，请使用新的名称。');return;}save.disabled=true;try{await app.secretStorage.setSecret(id,value.value);value.value='';refresh();this.setValue(id);this.selectEl.dispatchEvent(new Event('change',{bubbles:true}));modal.close();new Notice('密钥已加密保存');}catch(e){status.setText((e as Error).message);}finally{save.disabled=false;}};modal.open();};
    const remove=parent.createEl('button',{text:'删除选中密钥',type:'button'});remove.onclick=()=>{const id=this.getValue();if(!id)return;const modal=new Modal(app);modal.setTitle('删除密钥？');modal.contentEl.createEl('p',{text:'删除 '+id+' 后，使用它的 AI 请求将需要重新配置。此操作不可撤销。'});const cancel=modal.contentEl.createEl('button',{text:'取消',type:'button'});cancel.onclick=()=>modal.close();const confirm=modal.contentEl.createEl('button',{text:'确认删除',type:'button'});confirm.onclick=async()=>{confirm.disabled=true;try{await app.secretStorage.deleteSecret(id);refresh();this.setValue('');this.selectEl.dispatchEvent(new Event('change',{bubbles:true}));modal.close();}catch(e){new Notice((e as Error).message);confirm.disabled=false;}};modal.open();};
  }
}
export class PluginSettingTab {containerEl:HTMLElement;constructor(public app:App,public plugin:any){this.containerEl=document.createElement('div');}display(){}hide(){} }
export class WorkspaceLeaf {
  view:any;type='';constructor(public app:App){}
  async setViewState(state:{type:string}){this.type=state.type;const factory=this.app.workspace.factories.get(state.type);if(!factory)throw new Error('Unknown view');this.view=factory(this);await this.view.onOpen();this.app.workspace.active=this;}
  async openFile(file:TFile){
    const modal=new Modal(this.app);modal.setTitle(file.path);modal.modalEl.addClass('lubi-modal','web-file-modal');
    const text=await this.app.vault.read(file);let savedText=text,saving=false,closing=false;
    modal.contentEl.createEl('p',{cls:'web-host-note',text:'原始文本编辑。保存会影响相关任务／日记；发生并发冲突时不会覆盖另一窗口。可下载保留本地草稿。'});
    const field=modal.contentEl.createEl('textarea',{cls:'web-file-editor',attr:{'aria-label':'文件内容',spellcheck:'false'}});field.value=text;
    const bar=modal.contentEl.createDiv({cls:'web-file-actions'});const status=bar.createSpan({attr:{role:'status'}});
    const download=bar.createEl('button',{text:'下载文件',type:'button'});download.onclick=()=>downloadText(file.name,field.value);
    const save=bar.createEl('button',{text:'保存',cls:'mod-cta',type:'button'});save.onclick=async()=>{save.disabled=true;saving=true;const draft=field.value;try{if(file.extension==='json')JSON.parse(draft);await this.app.vault.modify(file,draft);savedText=draft;status.setText(field.value===draft?'已保存':'上一版本已保存，当前修改尚未保存');}catch(e){status.setText((e as Error).message);}finally{save.disabled=false;saving=false;}};
    field.addEventListener('input',()=>status.setText(field.value===savedText?'':'尚未保存'));
    const warn=(event:BeforeUnloadEvent)=>{if(field.value!==savedText){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);modal.onClose=()=>window.removeEventListener('beforeunload',warn);
    const close=modal.close.bind(modal);modal.close=()=>{if(saving){new Notice('正在保存，请稍候再关闭。');return;}if(closing||field.value===savedText){close();return;}const ask=new Modal(this.app);ask.setTitle('文件还有未保存的修改');ask.contentEl.createEl('p',{text:'继续编辑或下载草稿可保留这些修改。丢弃不会改动服务器上的文件。'});const keep=ask.contentEl.createEl('button',{text:'继续编辑',type:'button'});keep.onclick=()=>ask.close();const discard=ask.contentEl.createEl('button',{text:'丢弃未保存修改',type:'button'});discard.onclick=()=>{closing=true;ask.close();close();};ask.open();};
    modal.containerEl.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!saving)save.click();}});
    modal.open();
  }}
class Workspace {
  leaves:WorkspaceLeaf[]=[];factories=new Map<string,(leaf:WorkspaceLeaf)=>any>();ready:(()=>unknown)[]=[];active?:WorkspaceLeaf;
  constructor(private app:App){}
  onLayoutReady(fn:()=>unknown){this.ready.push(fn);}
  getLeavesOfType(type:string){return this.leaves.filter(l=>l.type===type);}
  getLeaf(){const leaf=new WorkspaceLeaf(this.app);this.leaves.push(leaf);return leaf;}
  async openLinkText(link:string,_source:string,_newLeaf=false){const path=normalizePath(link.split('#')[0]);const direct=this.app.vault.getAbstractFileByPath(path)||this.app.vault.getAbstractFileByPath(path+'.md');const file=direct instanceof TFile?direct:this.app.vault.getMarkdownFiles().find(f=>f.basename===path);if(file)await this.getLeaf().openFile(file);else new Notice('Web Vault 中找不到文件：'+path);}
  revealLeaf(leaf:WorkspaceLeaf){this.active=leaf;}
  getActiveViewOfType(type:any){return this.active?.view instanceof type?this.active.view:null;}
}
export class App {
  vault=new Vault();workspace=new Workspace(this);secretStorage=new SecretStorage();plugin:any;
  setting={open:()=>{},openTabById:(_id:string)=>{
    const tab=this.plugin?.settingTabs[0];if(!tab)return;
    const modal=new Modal(this);modal.setTitle('Lubi 设置');modal.modalEl.addClass('web-settings-modal');
    modal.contentEl.createEl('p',{cls:'web-host-note',text:'独立 Web 数据库，不连接原 Vault。临时 AI Key 仅在当前会话；命名密钥由服务端本地加密保存，与 Obsidian 钥匙串独立。桌面插件安装由 Obsidian 管理。'});
    const actions=modal.contentEl.createDiv({cls:'web-settings-actions'});
    const theme=actions.createEl('button',{text:'切换明 / 暗主题',type:'button'});theme.onclick=()=>{const dark=document.body.classList.toggle('theme-dark');document.body.classList.toggle('theme-light',!dark);localStorage.setItem('lubi-theme',dark?'dark':'light');};
    const commands=actions.createEl('button',{text:'命令面板（Ctrl / ⌘ + P）',type:'button'});commands.onclick=()=>this.showCommands();
    const files=actions.createEl('button',{text:'查看 Web 文件',type:'button'});files.onclick=()=>this.showFiles();
    const backup=actions.createEl('button',{text:'下载 Web 文件备份',type:'button'});backup.onclick=()=>void api('/vault/export').then(value=>downloadText('lubi-web-vault.json',JSON.stringify(value,null,2))).catch(e=>new Notice(e.message));
    const restore=actions.createEl('button',{text:'恢复 Web 文件备份',type:'button'});restore.onclick=()=>this.restoreFiles();
    const logout=actions.createEl('button',{text:'退出登录',type:'button'});logout.onclick=async()=>{await api('/auth/logout',{method:'POST'});this.secretStorage.clear();location.reload();};
    tab.display();modal.contentEl.append(tab.containerEl);modal.onClose=()=>tab.hide();modal.open();
  }};
  bindCommandShortcut(){
    const handler=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='p'&&!document.querySelector('.web-login')){event.preventDefault();event.stopPropagation();this.showCommands();}};
    document.addEventListener('keydown',handler,true);this.plugin.register(()=>document.removeEventListener('keydown',handler,true));
  }
  showCommands(){
    const existing=document.querySelector<HTMLInputElement>('.web-command-palette input');if(existing){existing.focus();return;}
    const commands=(this.plugin?.commands||[]).filter((command:any)=>typeof command.callback==='function');if(!commands.length)return;
    const modal=new Modal(this);modal.setTitle('Lubi 命令面板');modal.modalEl.addClass('lubi-modal','web-command-palette');
    const id='web-command-list-'+(++nextModalId);
    const search=modal.contentEl.createEl('input',{type:'text',attr:{'aria-label':'搜索 Lubi 命令',role:'combobox','aria-expanded':'true','aria-autocomplete':'list','aria-controls':id,placeholder:'输入命令名称…'}});
    const list=modal.contentEl.createDiv({cls:'web-command-list',attr:{id,role:'listbox','aria-label':'Lubi 命令'}});let filtered:any[]=[],selected=0;
    const execute=(command:any)=>{modal.close();try{Promise.resolve(command.callback()).catch(error=>new Notice('命令未完成：'+(error as Error).message));}catch(error){new Notice('命令未完成：'+(error as Error).message);}};
    const mark=()=>{list.querySelectorAll<HTMLElement>('[role=option]').forEach((row,i)=>{row.classList.toggle('is-selected',i===selected);row.setAttribute('aria-selected',String(i===selected));if(i===selected){search.setAttribute('aria-activedescendant',row.id);row.scrollIntoView({block:'nearest'});}});};
    const render=()=>{const query=search.value.trim().toLocaleLowerCase();filtered=commands.filter((c:any)=>c.name.toLocaleLowerCase().includes(query)||c.id.toLocaleLowerCase().includes(query));selected=0;list.empty();search.removeAttribute('aria-activedescendant');for(const [i,c] of filtered.entries()){const row=list.createEl('button',{type:'button',text:c.name,cls:'web-command-item',attr:{id:id+'-'+i,role:'option',tabindex:'-1','aria-selected':'false'}});row.addEventListener('click',()=>execute(c));}if(!filtered.length)list.createEl('p',{text:'没有匹配的命令',attr:{role:'status'}});mark();};
    search.addEventListener('input',render);search.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(filtered.length){selected=(selected+(event.key==='ArrowDown'?1:-1)+filtered.length)%filtered.length;mark();}}else if(event.key==='Enter'){event.preventDefault();if(filtered[selected])execute(filtered[selected]);}});
    modal.contentEl.createEl('small',{cls:'web-host-note',text:'↑ ↓ 选择 · Enter 执行 · Esc 返回；仅运行原插件注册的命令。'});render();modal.open();
  }
  restoreFiles(){
    const modal=new Modal(this);modal.setTitle('恢复 Web 文件备份');modal.modalEl.addClass('lubi-modal','web-secret-modal');
    modal.contentEl.createEl('p',{text:'只复制到新的隔离目录，不覆盖当前文件。此备份保留日记正文，但不含设置、密钥或删除历史；整库备份请用 npm run backup。'});
    const input=modal.contentEl.createEl('label',{text:'选择 Web 文件备份'}).createEl('input',{type:'file',attr:{accept:'.json,application/json','aria-label':'选择 Web 文件备份'}});
    const status=modal.contentEl.createEl('p',{attr:{role:'status'}});const label=modal.contentEl.createEl('label');const checked=label.createEl('input',{type:'checkbox'});label.append(' 已核对，创建隔离副本');
    const save=modal.contentEl.createEl('button',{text:'确认隔离恢复 Web 文件',type:'button',cls:'mod-cta'});save.disabled=true;
    let draft:any,generation=0;
    input.onchange=async()=>{const current=++generation;draft=undefined;checked.checked=false;save.disabled=true;status.setText('正在校验…');try{const file=input.files?.[0];if(!file){status.setText('请选择备份文件。');return;}if(file.size>25*1024*1024)throw new Error('文件超过 25MiB，请使用 SQLite 备份／隔离恢复命令。');const raw=JSON.parse(await file.text());const result=await api('/vault/restore/preview',{method:'POST',body:JSON.stringify({snapshot:raw})});if(current!==generation)return;draft=raw;status.setText(`${result.files} 个文件 · ${result.folders} 个文件夹；不会应用设置或密钥。`);}catch(e){if(current===generation)status.setText((e as Error).message);}};
    checked.onchange=()=>save.disabled=!draft||!checked.checked;
    save.onclick=async()=>{if(!draft||!checked.checked)return;save.disabled=true;input.disabled=true;try{const result=await api('/vault/restore',{method:'POST',body:JSON.stringify({snapshot:draft,confirmed:true})});draft=undefined;checked.checked=false;await this.vault.initialize();status.setText('已恢复到 '+result.root+'；当前任务与日记未改变。');const show=modal.contentEl.createEl('button',{text:'查看恢复文件',type:'button'});show.onclick=()=>this.showFiles();}catch(e){status.setText((e as Error).message);save.disabled=false;}finally{input.disabled=false;}};modal.open();
  }
  showFiles(){const modal=new Modal(this);modal.setTitle('Web Vault 文件');modal.modalEl.addClass('lubi-modal');const list=modal.contentEl.createDiv({cls:'web-files'});for(const file of this.vault.getFiles().sort((a,b)=>a.path.localeCompare(b.path))){const b=list.createEl('button',{text:file.path,type:'button'});b.onclick=()=>void this.workspace.getLeaf().openFile(file);}if(!list.childElementCount)list.createEl('p',{text:'还没有文件。新建任务或记录后会自动保存。'});modal.open();}
}
export class Plugin {
  settingTabs:any[]=[];commands:any[]=[];private disposers:(()=>void)[]=[];private settingsRevision=0;
  constructor(public app:App,public manifest:any){app.plugin=this;}
  async loadData(){const value=await api('/vault/settings');this.settingsRevision=value.revision;return value.data;}
  async saveData(data:unknown){const value=await api('/vault/settings',{method:'PUT',body:JSON.stringify({data,expectedRevision:this.settingsRevision})});this.settingsRevision=value.revision;}
  registerView(type:string,factory:(leaf:WorkspaceLeaf)=>any){this.app.workspace.factories.set(type,factory);}
  addRibbonIcon(_icon:string,_name:string,_callback:()=>unknown){return document.createElement('button');}
  addSettingTab(tab:any){this.settingTabs.push(tab);}addCommand(command:any){this.commands.push(command);}
  registerEvent(disposer:()=>void){this.disposers.push(disposer);}register(fn:()=>void){this.disposers.push(fn);}
  unload(){for(const dispose of this.disposers)dispose();this.app.vault.stop();}
}
export class ItemView {
  app:App;containerEl:HTMLElement;contentEl:HTMLElement;
  constructor(public leaf:WorkspaceLeaf){this.app=leaf.app;this.containerEl=document.createElement('div');this.containerEl.className='workspace-leaf-content';this.contentEl=this.containerEl.createDiv({cls:'view-content'});document.getElementById('root')!.append(this.containerEl);}
}
export const Platform={isDesktopApp:false,isMobileApp:false,isWin:navigator.platform.startsWith('Win'),isMacOS:/Mac/.test(navigator.platform)};
export class FileSystemAdapter {}
export const apiVersion='1.13.7';
export const requireApiVersion=(minimum:string)=>{const a=apiVersion.split('.').map(Number),b=minimum.split('.').map(Number);for(let i=0;i<3;i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0);}return true;};
export async function requestUrl(options:any){
  const input=typeof options==='string'?{url:options}:options;
  const response=await api('/network/request',{method:'POST',body:JSON.stringify({url:input.url,method:input.method||'GET',headers:input.headers,body:input.body})});
  if(input.throw!==false && response.status>=400)throw new Error(`接口返回 HTTP ${response.status}`);
  let json:any;try{json=JSON.parse(response.text);}catch{json=null;}
  return {...response,json,arrayBuffer:new TextEncoder().encode(response.text).buffer};
}
export function downloadText(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:name.endsWith('.json')?'application/json':'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
