import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../packages/plugin-runtime/',import.meta.url));
const manifest=JSON.parse(readFileSync(join(root,'UPSTREAM.json'),'utf8'));
for(const [file,hash] of Object.entries(manifest.sha256))assert.equal(createHash('sha256').update(readFileSync(join(root,file))).digest('hex'),hash,`Upstream source changed: ${file}`);
console.log(`PASS: ${Object.keys(manifest.sha256).length} original plugin source/style files are byte-for-byte identical to the recorded baseline.`);
