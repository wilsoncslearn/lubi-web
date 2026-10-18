import { randomBytes, createHash, scryptSync } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Persist hashes, never session cookies. Password changes invalidate all existing sessions. */
export class SessionStore {
  readonly salt:Buffer;
  readonly passwordHash:Buffer;
  private readonly passwordVersion:string;
  constructor(private db:DatabaseSync,password:string){
    db.exec('CREATE TABLE IF NOT EXISTS web_auth_config(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL);CREATE TABLE IF NOT EXISTS web_sessions(tokenHash TEXT PRIMARY KEY,expires INTEGER NOT NULL,passwordVersion TEXT NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO web_auth_config VALUES(1,?)').run(randomBytes(32).toString('hex'));
    this.salt=Buffer.from((db.prepare('SELECT salt FROM web_auth_config WHERE id=1').get() as {salt:string}).salt,'hex');
    this.passwordHash=scryptSync(password,this.salt,64);
    this.passwordVersion=createHash('sha256').update(this.passwordHash).digest('hex');this.cleanup();
  }
  private hash(token:string){return createHash('sha256').update(token).digest('hex');}
  get(token:string):number|undefined{if(!/^[a-f0-9]{64}$/.test(token))return;const row=this.db.prepare('SELECT expires,passwordVersion FROM web_sessions WHERE tokenHash=?').get(this.hash(token)) as {expires:number;passwordVersion:string}|undefined;return row?.passwordVersion===this.passwordVersion?row.expires:undefined;}
  set(token:string,expires:number){this.db.prepare('INSERT OR REPLACE INTO web_sessions VALUES(?,?,?)').run(this.hash(token),expires,this.passwordVersion);}
  delete(token:string){this.db.prepare('DELETE FROM web_sessions WHERE tokenHash=?').run(this.hash(token));}
  cleanup(){this.db.prepare('DELETE FROM web_sessions WHERE expires<? OR passwordVersion!=?').run(Date.now(),this.passwordVersion);}
}
