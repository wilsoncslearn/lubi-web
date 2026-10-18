import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { vaultPath } from './vault.js';

type CopyFile={path:string;kind:'file'|'folder';text:string};
function validate(value:unknown):CopyFile[]{
  const raw=value as {format?:unknown;version?:unknown;documents?:unknown};
  if(!raw||raw.format!=='lubi-web-vault'||raw.version!==1||!Array.isArray(raw.documents)||raw.documents.length>20000)throw new Error('请选择 Lubi Web 文件备份（lubi-web-vault v1），插件数据导出请使用「数据恢复」。');
  if(Buffer.byteLength(JSON.stringify(raw))>25*1024*1024)throw new Error('备份超过 25MiB；较大的工作区请使用 SQLite 备份／隔离恢复命令。');
  const files=new Map<string,CopyFile>();
  for(const item of raw.documents){
    if(!item||typeof item!=='object'||!['file','folder'].includes(item.kind)||typeof item.text!=='string'||(item.kind==='folder'&&item.text!==''))throw new Error('备份包含无效的文件条目。');
    const path=vaultPath(item.path);if(files.has(path))throw new Error('备份包含重复路径。');if(Buffer.byteLength(item.text)>4194304)throw new Error('单个文件超过 4MiB。');files.set(path,{path,kind:item.kind,text:item.text});
  }
  for(const file of files.values()){const parts=file.path.split('/');for(let i=1;i<parts.length;i++)if(files.get(parts.slice(0,i).join('/'))?.kind==='file')throw new Error('备份中的文件和文件夹路径冲突。');}
  return [...files.values()];
}
export function registerVaultRestore(app:FastifyInstance,db:DatabaseSync){
  app.post('/api/vault/restore/preview',{bodyLimit:26*1024*1024},async(req,reply)=>{
    try{const files=validate((req.body as {snapshot?:unknown})?.snapshot);return{files:files.filter(x=>x.kind==='file').length,folders:files.filter(x=>x.kind==='folder').length,bytes:files.reduce((n,x)=>n+Buffer.byteLength(x.text),0),mode:'isolated-copy',settingsIncluded:false};}
    catch(e){return reply.code(400).send({error:(e as Error).message});}
  });
  app.post('/api/vault/restore',{bodyLimit:26*1024*1024},async(req,reply)=>{
    const body=req.body as {snapshot?:unknown;confirmed?:boolean};if(body?.confirmed!==true)return reply.code(400).send({error:'请先核对预览并确认隔离恢复。'});
    let files:CopyFile[];try{files=validate(body.snapshot);}catch(e){return reply.code(400).send({error:(e as Error).message});}
    const root='Lubi-Web恢复/'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
    try{for(const file of files)vaultPath(root+'/'+file.path);}catch{return reply.code(400).send({error:'恢复后的路径过长，未写入任何文件。'});}
    db.exec('BEGIN IMMEDIATE');
    try{
      const revision=()=> (db.prepare('UPDATE vault_clock SET revision=revision+1 WHERE id=1 RETURNING revision').get() as {revision:number}).revision;
      const write=(path:string,kind:string,text:string)=>db.prepare('INSERT INTO vault_documents VALUES(?,?,?,?,?,0)').run(path,kind,text,revision(),Date.now());
      const folders=new Set<string>();
      for(const file of [{path:root,kind:'folder',text:''},...files.map(x=>({...x,path:root+'/'+x.path}))]){const parts=file.path.split('/');for(let i=1;i<parts.length;i++)folders.add(parts.slice(0,i).join('/'));if(file.kind==='folder')folders.add(file.path);}
      for(const path of [...folders].sort((a,b)=>a.length-b.length||a.localeCompare(b))){const old=db.prepare('SELECT kind FROM vault_documents WHERE path=? AND deleted=0').get(path) as {kind:string}|undefined;if(old?.kind==='file')throw new Error('恢复目录发生冲突。');if(!old){db.prepare('DELETE FROM vault_documents WHERE path=? AND deleted=1').run(path);write(path,'folder','');}}
      for(const file of files)if(file.kind==='file')write(root+'/'+file.path,'file',file.text);
      write(root+'/Web恢复说明-'+randomUUID()+'.md','file','# Web Vault 隔离恢复\n\n所有备份文件以原始文本复制到此目录；当前任务、日记、设置、密钥和删除历史未改变。\n\n这份文件备份不含设置与密钥。请先检查内容；如需切换到恢复副本，手动在设置中选择此目录下的任务文件和日记文件夹。没有自动合并、去重或覆盖。\n');
      db.exec('COMMIT');return{ok:true,root,files:files.filter(f=>f.kind==='file').length};
    }catch(e){db.exec('ROLLBACK');return reply.code(409).send({error:'恢复未写入任何文件：'+(e as Error).message});}
  });
}
