'use strict';
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const FILE = '/home/hot.json';
let hotSet = new Set();

try {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (Array.isArray(data)) hotSet = new Set(data);
  console.log('Hot server: loaded', hotSet.size, 'entries from', FILE);
} catch(e) {
  console.log('Hot server: starting fresh');
}

function saveFile() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify([...hotSet]));
  } catch(e) {
    console.error('Hot server: save failed:', e.message);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch(e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---- BAQ polling ----
let jobsCache = null;   // parsed JSON from Epicor ({ value: [...], ... })
let cachedAt  = null;   // Date of last successful poll

function pollBaq() {
  const epicorUrl  = process.env.EPICOR_URL;
  const epicorAuth = process.env.EPICOR_BASIC_AUTH;

  if (!epicorUrl || !epicorAuth) {
    console.warn('BAQ poll: EPICOR_URL or EPICOR_BASIC_AUTH not set, skipping');
    return;
  }

  console.log('BAQ poll: fetching...');
  let parsed;
  try { parsed = new URL(epicorUrl); } catch(e) {
    console.error('BAQ poll: invalid EPICOR_URL:', e.message);
    return;
  }

  const lib = parsed.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname + (parsed.search || ''),
    method:   'GET',
    headers: {
      'Authorization': 'Basic ' + epicorAuth,
      'Accept': 'application/json',
    },
    timeout: 90000,
  };

  const req = lib.request(options, (res) => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.error('BAQ poll: HTTP', res.statusCode);
        return;
      }
      try {
        const json = JSON.parse(Buffer.concat(chunks).toString());
        jobsCache = json;
        cachedAt  = new Date();
        console.log('BAQ poll: cached', (json.value || []).length, 'records at', cachedAt.toISOString());
      } catch(e) {
        console.error('BAQ poll: parse error:', e.message);
      }
    });
  });

  req.on('error',   e => console.error('BAQ poll: error:', e.message));
  req.on('timeout', () => { console.error('BAQ poll: timeout'); req.destroy(); });
  req.end();
}

// Warm the cache immediately, then refresh every 5 minutes.
pollBaq();
setInterval(pollBaq, 5 * 60 * 1000);

// ---- HTTP server ----
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const url = req.url.split('?')[0];

  try {
    // GET /api/jobs — return cached BAQ data
    if (req.method === 'GET' && url === '/api/jobs') {
      if (!jobsCache) {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'cache warming', retryAfter: 10 }));
        return;
      }
      res.end(JSON.stringify(Object.assign({}, jobsCache, { _cachedAt: cachedAt.toISOString() })));
      return;
    }

    // GET /api/hot — return current hot set
    if (req.method === 'GET' && url === '/api/hot') {
      res.end(JSON.stringify([...hotSet]));
      return;
    }

    // POST /api/hot/add — mark a job hot
    if (req.method === 'POST' && url === '/api/hot/add') {
      const { key } = await readBody(req);
      if (key && typeof key === 'string') { hotSet.add(key); saveFile(); }
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // POST /api/hot/remove — unmark a job
    if (req.method === 'POST' && url === '/api/hot/remove') {
      const { key } = await readBody(req);
      if (key && typeof key === 'string') { hotSet.delete(key); saveFile(); }
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // POST /api/hot/sync — prune hot keys no longer in the BAQ, return survivors
    if (req.method === 'POST' && url === '/api/hot/sync') {
      const validKeys = await readBody(req);
      if (Array.isArray(validKeys)) {
        const valid = new Set(validKeys);
        for (const k of [...hotSet]) {
          if (!valid.has(k)) hotSet.delete(k);
        }
        saveFile();
      }
      res.end(JSON.stringify([...hotSet]));
      return;
    }

    res.writeHead(404);
    res.end('{}');
  } catch(e) {
    console.error('Hot server error:', e.message);
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'bad request' }));
  }
});

server.listen(3001, '127.0.0.1', () => {
  console.log('Hot server listening on 127.0.0.1:3001');
});
