import { realpath, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';

export async function readEvidence(root, encodedTarget, artifacts) {
  let target;
  try { target = decodeURIComponent(encodedTarget); } catch { throw Object.assign(new Error('Invalid evidence identifier'), {status:403}); }
  if (target.includes('%') || target.includes('\\') || isAbsolute(target) || target.split('/').includes('..')) throw Object.assign(new Error('Forbidden evidence identifier'),{status:403});
  const known = artifacts[target] ?? artifacts[target.toLowerCase()];
  if (!known) throw Object.assign(new Error('Unknown evidence artifact'),{status:403});
  const base=await realpath(root);
  const file=await realpath(resolve(base,known));
  const rel=relative(base,file);
  if (!rel || isAbsolute(rel) || rel==='..' || rel.startsWith(`..${sep}`) || file!==resolve(base,known)) throw Object.assign(new Error('Forbidden evidence path'),{status:403});
  return {content:await readFile(file,'utf8'),mime:file.endsWith('.json')?'application/json':'text/plain'};
}
