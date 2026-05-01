'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');

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

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const url = req.url.split('?')[0];

  try {
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

    // POST /api/hot/sync — client sends all current valid job keys;
    // server prunes any hot entries no longer in the BAQ, returns surviving set.
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
