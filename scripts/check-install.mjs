// Silent launcher check: rebuild dependency state only when lock/platform changes.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export function installationStamp(){return createHash('sha256').update(readFileSync(join(root,'package-lock.json'))).update(`\n${process.platform}/${process.arch}/node${process.versions.node.split('.')[0]}`).digest('hex');}
try{
  const file=join(root,'node_modules/.lubi-install-stamp');
  const packages=['tsx','vite','fastify','esbuild','lucide-static','playwright'];
  if(!existsSync(file)||readFileSync(file,'utf8').trim()!==installationStamp()||packages.some(x=>!existsSync(join(root,'node_modules',x,'package.json')))||!existsSync(join(root,'packages/plugin-runtime/styles.css')))process.exitCode=1;
}catch{process.exitCode=1;}
