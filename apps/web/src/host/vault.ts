export type DocumentRow = { path:string; kind:'file'|'folder'; text:string; revision:number; mtime:number; deleted:number };
let authenticationEpoch=0;
export async function api<T=any>(path:string, init:RequestInit = {}):Promise<T> {
  const startedInEpoch=authenticationEpoch;
  let response:Response;
  try { response=await fetch('/api'+path,{...init,credentials:'same-origin',headers:{...(init.body?{'content-type':'application/json'}:{}),...init.headers}}); }
  catch { throw new Error('无法连接后端，未保存；请恢复连接后重试。'); }
  if (!response.ok) {
    const value=await response.json().catch(()=>({}));
    if(response.status===401 && !path.startsWith('/auth/') && startedInEpoch===authenticationEpoch) window.dispatchEvent(new Event('lubi-auth-required'));
    throw new Error(value.error || `请求失败（${response.status}）`);
  }
  if(path==='/auth/login')authenticationEpoch++;
  return response.status===204?undefined as T:response.json();
}
export const normalizePath=(p:string)=>p.replace(/\\/g,'/').replace(/\/+/g,'/').replace(/^\/|\/$/g,'');
export class TAbstractFile { name:string;revision?:number; constructor(public path:string){this.name=path.split('/').pop()||'';} }
export class TFile extends TAbstractFile {
  basename:string;extension:string;stat:{ctime:number;mtime:number;size:number};
  constructor(path:string,row?:DocumentRow){super(path);this.revision=row?.revision;const dot=this.name.lastIndexOf('.');this.basename=dot<0?this.name:this.name.slice(0,dot);this.extension=dot<0?'':this.name.slice(dot+1);this.stat={ctime:row?.mtime||Date.now(),mtime:row?.mtime||Date.now(),size:new TextEncoder().encode(row?.text||'').length};}
}
export class TFolder extends TAbstractFile { children:TAbstractFile[]=[];isRoot(){return !this.path;} }
export class Vault {
  configDir='.obsidian';
  private files=new Map<string,DocumentRow>();
  private events=new Map<string,Set<(...args:any[])=>void>>();
  private writes=new Map<string,Promise<any>>();
  private revision=0;
  private refreshing=false;
  private timer?:number;
  onDownload?:(path:string,text:string)=>void;
  async initialize(){const snapshot=await api<{documents:DocumentRow[];revision:number}>('/vault/snapshot');this.files=new Map(snapshot.documents.map(d=>[d.path,d]));this.revision=snapshot.revision;}
  start(){this.timer=window.setInterval(()=>{if(!document.hidden) void this.sync().catch(()=>{});},5000);}
  stop(){if(this.timer)clearInterval(this.timer);}
  on(event:string,fn:(...args:any[])=>void){let listeners=this.events.get(event);if(!listeners){listeners=new Set();this.events.set(event,listeners);}listeners.add(fn);return ()=>listeners!.delete(fn);}
  offref(dispose:()=>void){dispose();}
  private emit(event:string,...args:any[]){for(const fn of this.events.get(event)||[])fn(...args);}
  async sync(){
    if(this.refreshing)return;this.refreshing=true;
    try {const result=await api<{documents:DocumentRow[];revision:number}>('/vault/changes?since='+this.revision);for(const row of result.documents)this.accept(row,true);this.revision=result.revision;}
    finally{this.refreshing=false;}
  }
  private accept(row:DocumentRow,emit=false){
    const old=this.files.get(row.path);if(old && old.revision>=row.revision)return;
    this.files.set(row.path,row);
    if(emit)this.emit(row.deleted?'delete':old&&!old.deleted?'modify':'create',row.kind==='folder'?new TFolder(row.path):new TFile(row.path,row));
  }
  getAbstractFileByPath(path:string):TFile|TFolder|null {
    path=normalizePath(path);const row=this.files.get(path);
    if(row && !row.deleted && row.kind==='file')return new TFile(path,row);
    const prefix=path?path+'/':'';
    const children=[...this.files.values()].filter(f=>!f.deleted && f.path.startsWith(prefix) && f.path!==path);
    if((row && !row.deleted && row.kind==='folder')||children.length||!path){
      const folder=new TFolder(path);folder.revision=row?.revision;const names=new Set(children.map(f=>f.path.slice(prefix.length).split('/')[0]));
      folder.children=[...names].map(name=>this.getAbstractFileByPath(prefix+name)!).filter(Boolean);return folder;
    }
    return null;
  }
  getMarkdownFiles(){return [...this.files.values()].filter(r=>!r.deleted&&r.kind==='file'&&r.path.endsWith('.md')).map(r=>new TFile(r.path,r));}
  getFiles(){return [...this.files.values()].filter(r=>!r.deleted&&r.kind==='file').map(r=>new TFile(r.path,r));}
  getName(){return 'Lubi Web';}
  private async fresh(path:string){const row=await api<DocumentRow>('/vault/file?path='+encodeURIComponent(path));this.accept(row);return row;}
  private stamp(file:TFile,row:DocumentRow){file.revision=row.revision;file.stat.mtime=row.mtime;file.stat.size=new TextEncoder().encode(row.text).length;}
  async read(file:TFile){const row=await this.fresh(file.path);this.stamp(file,row);return row.text;}
  async cachedRead(file:TFile){const row=this.files.get(file.path);if(!row||row.deleted)return this.read(file);this.stamp(file,row);return row.text;}
  private enqueue<T>(path:string,work:()=>Promise<T>):Promise<T>{
    const result=(this.writes.get(path)||Promise.resolve()).catch(()=>{}).then(work);this.writes.set(path,result);
    void result.finally(()=>{if(this.writes.get(path)===result)this.writes.delete(path);}).catch(()=>{});return result;
  }
  private async put(path:string,text:string,expectedRevision:number,kind:'file'|'folder'='file'){
    const row=await api<DocumentRow>('/vault/file',{method:'PUT',body:JSON.stringify({path,text,kind,expectedRevision})});this.accept(row,true);return row;
  }
  async create(path:string,text:string){
    path=normalizePath(path);const file=await this.enqueue(path,async()=>new TFile(path,await this.put(path,text,0)));
    if(/^Lubi-导出-.*\.json$/.test(path))this.onDownload?.(path,text);return file;
  }
  async createFolder(path:string){path=normalizePath(path);if(this.getAbstractFileByPath(path) instanceof TFolder)return;await this.enqueue(path,()=>this.put(path,'',0,'folder'));}
  async modify(file:TFile,text:string){return this.enqueue(file.path,async()=>{const expected=file.revision??(await this.fresh(file.path)).revision;const row=await this.put(file.path,text,expected);this.stamp(file,row);});}
  async process(file:TFile,fn:(text:string)=>string){return this.enqueue(file.path,async()=>{const row=await this.fresh(file.path);const text=fn(row.text);const saved=await this.put(file.path,text,row.revision);this.stamp(file,saved);return text;});}
  async delete(file:TAbstractFile){return this.enqueue(file.path,async()=>{const expected=file.revision??(await this.fresh(file.path)).revision;const deleted=await api<DocumentRow>('/vault/file',{method:'DELETE',body:JSON.stringify({path:file.path,expectedRevision:expected})});this.accept(deleted,true);});}
  adapter={
    exists:async(path:string)=>!!this.getAbstractFileByPath(normalizePath(path)),
    read:async(path:string)=>this.read(new TFile(normalizePath(path))),
    write:async(path:string,text:string)=>{path=normalizePath(path);const file=this.getAbstractFileByPath(path);if(file instanceof TFile)await this.modify(file,text);else await this.create(path,text);},
    mkdir:async(path:string)=>this.createFolder(path),
    remove:async(path:string)=>{const file=this.getAbstractFileByPath(path);if(file)await this.delete(file);},
    list:async(path:string)=>{const folder=this.getAbstractFileByPath(path);const children=folder instanceof TFolder?folder.children:[];return{files:children.filter(x=>x instanceof TFile).map(x=>x.path),folders:children.filter(x=>x instanceof TFolder).map(x=>x.path)};},
    stat:async(path:string)=>{const row=this.files.get(normalizePath(path));return row&&!row.deleted?{type:row.kind,mtime:row.mtime,ctime:row.mtime,size:new TextEncoder().encode(row.text).length}:null;},
  };
}
