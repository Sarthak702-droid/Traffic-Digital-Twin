import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const assets = {'/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/styles.css':['styles.css','text/css']};
const server = http.createServer(async (req,res) => {
  const send = (status,body,type='application/json') => {res.writeHead(status,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);};
  try {
    if(req.method !== 'GET') return send(405,JSON.stringify({error:'Method not allowed'}));
    const path = new URL(req.url,'http://localhost').pathname;
    if(path === '/api/plan') {
      const plan = JSON.parse(await readFile(resolve(root,'docs/backlog.json'),'utf8'));
      const progress = JSON.parse(await readFile(resolve(root,'docs/delivery-status.json'),'utf8'));
      for (const epic of plan.epics) for (const task of epic.stories) {
        const record = progress.tasks[task.id];
        if (record && ['backlog','ready','in-progress','blocked','completed'].includes(record.status)) {
          task.status = record.status;
          if (record.status === 'completed' && record.evidence) task.evidence = record.evidence;
        }
      }
      return send(200,JSON.stringify(plan));
    }
    if(path.startsWith('/evidence/')) {
      const target = decodeURIComponent(path.slice(10));
      const epicMap = {
        'epic1': 'docs/epic1-acceptance.md', 'e01': 'docs/epic1-acceptance.md',
        'epic2': 'docs/epic2-status.md', 'e02': 'docs/epic2-status.md',
        'epic3': 'docs/epic3-status.md', 'e03': 'docs/epic3-status.md',
        'epic4': 'docs/epic4-status.md', 'e04': 'docs/epic4-status.md',
        'epic5': 'docs/epic5-status.md', 'e05': 'docs/epic5-status.md',
        'epic6': 'docs/epic6-status.md', 'e06': 'docs/epic6-status.md',
        'epic7': 'docs/epic7-status.md', 'e07': 'docs/epic7-status.md',
        'epic8': 'docs/epic8-status.md', 'e08': 'docs/epic8-status.md',
        'epic9': 'docs/epic9-status.md', 'e09': 'docs/epic9-status.md',
        'epic10': 'docs/epic10-status.md', 'e10': 'docs/epic10-status.md',
        'epic11': 'docs/epic11-status.md', 'e11': 'docs/epic11-status.md',
        'epic12': 'docs/epic12-status.md', 'e12': 'docs/epic12-status.md',
        'epic13': 'docs/epic13-status.md', 'e13': 'docs/epic13-status.md',
        'epic14': 'docs/epic14-status.md', 'e14': 'docs/epic14-status.md',
        'epic15': 'docs/epic15-status.md', 'e15': 'docs/epic15-status.md',
        'epic16': 'docs/epic16-status.md', 'e16': 'docs/epic16-status.md',
        'epic17': 'docs/epic17-status.md', 'e17': 'docs/epic17-status.md',
        'epic18': 'docs/epic18-status.md', 'e18': 'docs/epic18-status.md',
        'epic19': 'docs/epic19-status.md', 'e19': 'docs/epic19-status.md'
      };
      const candidatePaths = [
        epicMap[target.toLowerCase()],
        target,
        `docs/${target}`,
        `.runtime/evidence/${target}`
      ].filter(Boolean);

      for (const rel of candidatePaths) {
        try {
          const content = await readFile(resolve(root, rel), 'utf8');
          const mime = rel.endsWith('.json') ? 'application/json' : 'text/plain';
          return send(200, content, mime);
        } catch {}
      }
    }
    if(path === '/api/git') {
      try {
        const [{stdout:branch},{stdout:status}] = await Promise.all([run('git',['branch','--show-current'],{cwd:root}),run('git',['status','--short'],{cwd:root})]);
        return send(200,JSON.stringify({available:true,branch:branch.trim(),files:status.split('\n').filter(Boolean)}));
      } catch {return send(200,JSON.stringify({available:false,message:'Git metadata is unavailable in this workspace.'}));}
    }
    if(path === '/favicon.ico') return send(204,'','image/x-icon');
    const asset=assets[path];
    if(!asset) return send(404,JSON.stringify({error:'Not found'}));
    send(200,await readFile(resolve(here,asset[0])),asset[1]);
  } catch { send(500,JSON.stringify({error:'Unable to read repository data. Check that docs/backlog.json exists and is valid.'})); }
});
const requestedPort = process.env.PORT ?? '3001';
let port = Number(requestedPort);
let retries = 0;
const maxRetries = 20;

server.on('error', error => {
  if (error.code === 'EADDRINUSE' && retries < maxRetries && port < 65535) {
    console.warn(`Port ${port} is already in use; trying ${port + 1}…`);
    port += 1;
    retries += 1;
    server.listen(port, '127.0.0.1');
    return;
  }
  console.error(error.code === 'EADDRINUSE'
    ? 'No available port found. Choose another starting port with PORT=3002 node server.mjs.'
    : `Unable to start dashboard (${error.code || 'unknown error'}): ${error.message}`);
  process.exitCode = 1;
});
server.once('listening', () => {
  console.log(`Delivery dashboard: http://127.0.0.1:${server.address().port}`);
  console.log('Press Ctrl+C to stop.');
});

if (!/^\d+$/.test(requestedPort) || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('Invalid PORT. Use an integer from 0 to 65535 (0 selects an available port).');
  process.exitCode = 1;
} else {
  server.listen(port, '127.0.0.1');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => { process.exitCode = 0; });
    server.closeIdleConnections();
  });
}
