// Intended for the owner's interactive launcher only; never used in test/deployment logs.
import { ensureConfigured } from './environment.mjs';
ensureConfigured();
console.log('\nLocal access password / 本机访问密码:\n'+process.env.LUBI_PASSWORD+'\n');
