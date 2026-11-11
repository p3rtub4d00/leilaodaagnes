import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 14000 + Math.floor(Math.random() * 1000);
const base = 'http://127.0.0.1:' + PORT;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), MONGODB_URI: '', MONGO_URI: '',
    ADMIN_PASSWORD: 'teste-local-senha', SESSION_SECRET: 'teste-local-chave-secreta-mais-de-32-caracteres' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let errors = '';
child.stderr.on('data', chunk => { errors += chunk.toString(); });
async function request(url, body, more = {}) {
  const headers = { ...more.headers };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + url, {
    method: more.method || (body === undefined ? 'GET' : 'POST'),
    headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await response.json();
  return { response, json };
}
async function waitForServer() {
  for (let i = 0; i < 70; i++) {
    try { const {response} = await request('/health'); if (response.ok) return; }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  throw new Error('Server did not start. stderr:\n' + errors);
}
try {
  await waitForServer();
  const health = await request('/health');
  assert.equal(health.json.databaseConnected, false);
  const state0 = await request('/api/state');
  assert.equal(state0.json.game.status, 'idle');
  const alice = await request('/api/guests', { name: 'Alice' });
  assert.equal(alice.response.status, 201);
  assert.equal(alice.json.credits, 1000);
  await new Promise(resolve => setTimeout(resolve, 240));
  const bob = await request('/api/guests', { name: 'Bob' });
  assert.equal(bob.response.status, 201);
  const aliceHeaders = { 'x-guest-id': alice.json.id, 'x-guest-token': alice.json.token };
  const bobHeaders = { 'x-guest-id': bob.json.id, 'x-guest-token': bob.json.token };
  const login = await request('/api/admin/login', { password: 'teste-local-senha' });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const admin = { headers: { cookie } };
  const created = await request('/api/admin/items', {
    name: 'Pacote Surpresa #01', secret: 'Prêmio escondido',
    hint: 'O que será que tem aqui?', startingBid: 50, increment: 50, duration: 40, color: 'purple'
  }, admin);
  assert.equal(created.response.status, 201);
  const publicState = await request('/api/state');
  assert.equal(JSON.stringify(publicState.json).includes('Prêmio escondido'), false);
  const started = await request('/api/admin/start', { itemId: created.json.id }, admin);
  assert.equal(started.response.status, 200);
  const firstBid = await request('/api/bid', { amount: 50 }, { headers: aliceHeaders });
  assert.equal(firstBid.response.status, 200);
  const tooLow = await request('/api/bid', { amount: 50 }, { headers: bobHeaders });
  assert.equal(tooLow.response.status, 400);
  await new Promise(resolve => setTimeout(resolve, 550));
  const bobBid = await request('/api/bid', { amount: 100 }, { headers: bobHeaders });
  assert.equal(bobBid.response.status, 200);
  const aliceBefore = await request('/api/me', undefined, { headers: aliceHeaders });
  assert.equal(aliceBefore.json.credits, 1000);
  const paused = await request('/api/admin/pause', {}, admin);
  assert.equal(paused.response.status, 200);
  const resumed = await request('/api/admin/resume', {}, admin);
  assert.equal(resumed.response.status, 200);
  const finished = await request('/api/admin/finish', {}, admin);
  assert.equal(finished.response.status, 200);
  const bobAfter = await request('/api/me', undefined, { headers: bobHeaders });
  assert.equal(bobAfter.json.credits, 900);
  assert.equal(bobAfter.json.wins.length, 1);
  const aliceAfter = await request('/api/me', undefined, { headers: aliceHeaders });
  assert.equal(aliceAfter.json.credits, 1000);
  const result = await request('/api/state');
  assert.equal(result.json.game.status, 'sold');
  assert.equal(result.json.game.topGuestName, 'Bob');
  console.log('✅ Smoke tests passed: registration, admin, hidden secrets, bids, pause, resume, win, credits.');
} catch (error) {
  console.error('❌ Smoke test failed:', error);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
