import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { getSettings } from './vault.js';
import { readSecret } from './secrets.js';

export const privateAddress = (ip: string): boolean => {
  const family=isIP(ip);if(!family)return true;
  if(family===6){
    let value=ip.toLowerCase();
    if(value.includes('.')){const index=value.lastIndexOf(':');const bytes=value.slice(index+1).split('.').map(Number);value=value.slice(0,index+1)+((bytes[0]<<8)|bytes[1]).toString(16)+':'+((bytes[2]<<8)|bytes[3]).toString(16);}
    const parts=value.split('::'),left=parts[0].split(':').filter(Boolean),right=(parts[1]||'').split(':').filter(Boolean);
    const groups=(parts.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left).map(n=>parseInt(n,16));
    if(groups.slice(0,5).every(n=>n===0)&&groups[5]===0xffff)return privateAddress([groups[6]>>8,groups[6]&255,groups[7]>>8,groups[7]&255].join('.'));
    // Only native global unicast. Exclude translation/tunnelling and documentation ranges.
    return groups[0]<0x2000||groups[0]>=0x3fff||groups[0]===0x2002||(groups[0]===0x2001&&(groups[1]<=0x1ff||groups[1]===0xdb8));
  }
  const [a,b,c]=ip.split('.').map(Number);
  return a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||
    (a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113);
};
/** Only an explicitly configured AI origin and the public release API are reachable. DNS is pinned. */
export function registerNetwork(app: FastifyInstance, db: DatabaseSync): void {
  app.post('/api/network/request', async (req, reply) => {
    const body = req.body as { url?: string; method?: string; headers?: Record<string,string>; body?: string };
    let url: URL;
    try { url=new URL(body.url || ''); } catch { return reply.code(400).send({error:'无效的接口地址'}); }
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.hash) return reply.code(400).send({error:'接口地址不受支持'});
    const endpoint = getSettings(db).data.aiEndpoint;
    let configuredOrigin='';try { configuredOrigin=new URL(String(endpoint)).origin; } catch { /* no configured origin */ }
    const release = url.origin==='https://api.github.com' && url.pathname.startsWith('/repos/') && (body.method || 'GET')==='GET';
    if (!release && url.origin!==configuredOrigin) return reply.code(403).send({error:'请先在设置中保存此 AI 接口；不允许代理任意地址。'});
    const local = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if (local && process.env.LUBI_ALLOW_LOCAL_AI!=='1') return reply.code(403).send({error:'本机 AI 需在服务端显式设置 LUBI_ALLOW_LOCAL_AI=1。'});
    if (url.protocol==='http:' && !local) return reply.code(403).send({error:'远程 AI 必须使用 HTTPS。'});
    const hostname=url.hostname.replace(/^\[|\]$/g,'');
    const addresses = isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await lookup(hostname,{all:true});
    const selected=addresses.find(a=>local || !privateAddress(a.address));
    if (!selected || (!local && addresses.some(a=>privateAddress(a.address)))) return reply.code(403).send({error:'不允许访问内网或特殊网络地址。'});
    const headers: Record<string,string> = {'accept':'application/json','user-agent':'Lubi-Web/1.8'};
    for(const [key,value] of Object.entries(body.headers || {})) {
      if (!['authorization','content-type','accept'].includes(key.toLowerCase())) continue;
      if (typeof value!=='string' || /[\r\n]/.test(value)) return reply.code(400).send({error:'无效的请求头'});
      if (!release || key.toLowerCase()!=='authorization') headers[key.toLowerCase()]=value;
    }
    if(headers.authorization?.startsWith('Bearer lubi-web-key:')){try{headers.authorization='Bearer '+readSecret(db,headers.authorization.slice('Bearer lubi-web-key:'.length));}catch{return reply.code(400).send({error:'选中的服务端密钥不可用，请检查密钥库及密钥文件。'});}}
    const method=body.method || 'GET';
    if (!['GET','POST'].includes(method) || (release && method!=='GET') || (body.body?.length || 0)>2_000_000) return reply.code(400).send({error:'请求超出允许范围'});
    try {
      const result = await new Promise<{status:number;headers:http.IncomingHttpHeaders;text:string}>((resolve,reject)=>{
        const request=(url.protocol==='https:'?https:http).request(url,{
          method,headers,timeout:45000,signal:AbortSignal.timeout(45000),
          lookup:((_host: string,options: any,callback: Function)=>options?.all ? callback(null,[{address:selected.address,family:selected.family}]) : callback(null,selected.address,selected.family)) as any,
        },response=>{
          const chunks:Buffer[]=[];let length=0;
          response.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>8_388_608){response.destroy();reject(new Error('Response limit'));}else chunks.push(chunk);});
          response.on('end',()=>resolve({status:response.statusCode||502,headers:{'content-type':response.headers['content-type']},text:Buffer.concat(chunks).toString('utf8')}));
          response.on('error',reject);
        });
        request.on('timeout',()=>request.destroy(new Error('Timeout')));request.on('error',reject);request.end(body.body);
      });
      reply.header('cache-control','no-store');return result;
    } catch { return reply.code(502).send({error:'接口请求失败或超时；请核对地址、服务与 HTTPS 证书。未绕过证书验证。'}); }
  });
}
