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
    if(path === '/api/plan') return send(200,await readFile(resolve(root,'docs/planning-dashboard/backlog.json'),'utf8'));
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
  } catch { send(500,JSON.stringify({error:'Unable to read repository data. Check that docs/planning-dashboard/backlog.json exists and is valid.'})); }
});
const requestedPort = process.env.PORT ?? '3000';
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
    ? 'No available port found. Choose another starting port with PORT=3100 node server.mjs.'
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
