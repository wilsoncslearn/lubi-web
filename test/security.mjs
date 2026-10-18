import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { privateAddress } from '../apps/api/src/network.ts';
import { SessionStore } from '../apps/api/src/sessions.ts';
import { startApp } from './support.mjs';

test('Network classification rejects IPv4, mapped IPv6, translation, special and private ranges',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.5.4','192.168.1.1','169.254.169.254','100.100.100.200','0.0.0.0','224.0.0.1','198.18.1.2','192.0.2.1','198.51.100.1','203.0.113.1','::','::1','::ffff:127.0.0.1','::ffff:7f00:1','0:0:0:0:0:ffff:a00:1','::ffff:ac10:101','64:ff9b::7f00:1','2002:7f00:1::','2001:db8::1','fc00::1','fe80::1','fec0::1','ff02::1','not-an-ip'])assert.equal(privateAddress(ip),true,ip);
  for(const ip of ['1.1.1.1','8.8.8.8','192.0.78.24','198.51.1.1','203.0.12.1','2606:4700:4700::1111','2001:4860:4860::8888','::ffff:808:808'])assert.equal(privateAddress(ip),false,ip);
});
test('Hashed sessions survive reopen, expire, revoke and invalidate when the password changes',()=>{
  const folder=mkdtempSync(join(tmpdir(),'lubi-auth-test-'));const path=join(folder,'test.db');let db;
  try{
    db=new DatabaseSync(path);let sessions=new SessionStore(db,'synthetic-original-password');const token=randomBytes(32).toString('hex');const expires=Date.now()+60000;sessions.set(token,expires);assert.equal(sessions.get(token),expires);assert(!JSON.stringify(db.prepare('SELECT * FROM web_sessions').all()).includes(token));db.close();
    db=new DatabaseSync(path);sessions=new SessionStore(db,'synthetic-original-password');assert.equal(sessions.get(token),expires);sessions.delete(token);assert.equal(sessions.get(token),undefined);sessions.set(token,Date.now()-1);sessions.cleanup();assert.equal(sessions.get(token),undefined);sessions.set(token,expires);
    sessions=new SessionStore(db,'synthetic-replacement-password');assert.equal(sessions.get(token),undefined);assert.equal(sessions.get('bad-token'),undefined);
  }finally{db?.close();rmSync(folder,{recursive:true,force:true});}
});
test('Named AI keys are encrypted, never readable/exported, and resolved only inside the proxy',async()=>{
  const app=await startApp();let received='';const mock=createServer((req,res)=>{received=req.headers.authorization||'';res.setHeader('content-type','application/json');res.end('{}');});mock.listen(0,'127.0.0.1');await once(mock,'listening');
  try{
    const value='synthetic-key-only-!@#';assert.equal((await fetch(app.base+'/api/secrets')).status,401);
    await app.json('/secrets/test-key','PUT',{value});assert.deepEqual(await app.json('/secrets'),{names:['test-key']});assert.equal((await app.request('/secrets/test-key','PUT',{value:'must-not-overwrite'})).status,409);assert.equal((await app.request('/secrets/invalid%2Fname','PUT',{value})).status,400);
    const db=new DatabaseSync(join(app.folder,'isolated.db'),{readOnly:true});assert(!JSON.stringify(db.prepare('SELECT * FROM web_secrets').all()).includes(value));db.close();assert(!JSON.stringify(await app.json('/vault/export')).includes(value));assert(existsSync(join(app.folder,'isolated-credentials.key')));assert.equal(readFileSync(join(app.folder,'isolated-credentials.key')).length,32);
    const url=`http://127.0.0.1:${mock.address().port}/v1`;await app.json('/vault/settings','PUT',{data:{aiEndpoint:url,aiKeySecret:'test-key'},expectedRevision:0});await app.json('/network/request','POST',{url,headers:{Authorization:'Bearer lubi-web-key:test-key'}});assert.equal(received,'Bearer '+value);
    await app.json('/secrets/test-key','DELETE');assert.deepEqual(await app.json('/secrets'),{names:[]});assert.equal((await app.request('/network/request','POST',{url,headers:{Authorization:'Bearer lubi-web-key:test-key'}})).status,400);
    const headers=(await fetch(app.base)).headers;assert.match(headers.get('content-security-policy'),/object-src 'none'/);assert.equal(headers.get('x-content-type-options'),'nosniff');
  }finally{await new Promise(resolve=>mock.close(resolve));await app.stop();}
});
