import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const vendor=join(root,'packages/plugin-runtime');
const styles=join(vendor,'src/styles');
writeFileSync(join(vendor,'styles.css'),Buffer.concat(readdirSync(styles).filter(x=>x.endsWith('.css')).sort().map(x=>readFileSync(join(styles,x)))));
// Upstream's screenshot helper resolves icon files next to its own package.
const require=createRequire(import.meta.url);
const iconRoot=join(dirname(require.resolve('lucide-static/package.json')),'icons');
mkdirSync(join(vendor,'node_modules/lucide-static'),{recursive:true});
cpSync(iconRoot,join(vendor,'node_modules/lucide-static/icons'),{recursive:true});
// A legacy upstream test invokes its package-local esbuild CLI with `node`.
// Workspaces hoist dependencies; POSIX esbuild may also replace that CLI with ELF.
// Supply a disposable local dependency copy + JS launcher, never edit upstream tests.
const esbuildRoot=dirname(require.resolve('esbuild/package.json'));
const localEsbuild=join(vendor,'node_modules/esbuild');
if(localEsbuild!==esbuildRoot){
  cpSync(esbuildRoot,localEsbuild,{recursive:true});
  const cli=join(esbuildRoot,'bin/esbuild');
  writeFileSync(join(localEsbuild,'bin/esbuild'),`#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process');\nconst cli=${JSON.stringify(cli)};\nconst js=fs.readFileSync(cli).subarray(0,2).toString()==='#!';\nconst result=cp.spawnSync(js?process.execPath:cli,js?[cli,...process.argv.slice(2)]:process.argv.slice(2),{stdio:'inherit'});\nif(result.error)console.error(result.error);\nprocess.exit(result.status??1);\n`);
}

const stamp=createHash('sha256').update(readFileSync(join(root,'package-lock.json'))).update(`\n${process.platform}/${process.arch}/node${process.versions.node.split('.')[0]}`).digest('hex');
writeFileSync(join(root,'node_modules/.lubi-install-stamp'),stamp+'\n');
