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
  const aliceDevice = state0.response.headers.get('set-cookie').split(';')[0];
  const aliceHeaders = { cookie: aliceDevice };
  const alice = await request('/api/guests', { name: 'Alice' }, { headers: aliceHeaders });
  assert.equal(alice.response.status, 201);
  assert.equal(alice.json.credits, 1000);
  const repeat = await request('/api/guests', { name: 'Alice fake' }, { headers: aliceHeaders });
  assert.equal(repeat.response.status, 409, 'Segundo cadastro no mesmo aparelho deve ser rejeitado');
  const restored = await request('/api/me', undefined, { headers: aliceHeaders });
  assert.equal(restored.response.status, 200, 'A conta deve ser recuperada pelo cookie do aparelho');
  assert.equal(restored.json.id, alice.json.id);
  const bobState = await request('/api/state');
  const bobHeaders = { cookie: bobState.response.headers.get('set-cookie').split(';')[0] };
  const bob = await request('/api/guests', { name: 'Bob' }, { headers: bobHeaders });
  assert.equal(bob.response.status, 201);
  const login = await request('/api/admin/login', { password: 'teste-local-senha' });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const admin = { headers: { cookie } };
  const passes = await request('/api/admin/passes', {count: 3}, admin);
  assert.equal(passes.response.status, 200);
  assert.equal(passes.json.codes.length, 3);
  const secure = await request('/api/admin/registration', {open: true, inviteOnly: true}, admin);
  assert.equal(secure.response.status, 200);
  const charlieState = await request('/api/state');
  const charlieHeaders = { cookie: charlieState.response.headers.get('set-cookie').split(';')[0] };
  const noCode = await request('/api/guests', { name: 'Charlie' }, { headers: charlieHeaders });
  assert.equal(noCode.response.status, 403);
  await new Promise(resolve => setTimeout(resolve, 950));
  const charlie = await request('/api/guests', {name: 'Charlie', accessCode: passes.json.codes[0]}, {headers: charlieHeaders});
  assert.equal(charlie.response.status, 201);
  const daveState = await request('/api/state');
  const daveHeaders = {cookie: daveState.response.headers.get('set-cookie').split(';')[0]};
  const reused = await request('/api/guests', {name:'Dave', accessCode: passes.json.codes[0]}, {headers:daveHeaders});
  assert.equal(reused.response.status, 403, 'Código de uso único não pode ser reutilizado');
  const closed = await request('/api/admin/registration', {open:false,inviteOnly:true}, admin);
  assert.equal(closed.response.status, 200);
  const deniedClosed = await request('/api/guests', {name:'Dave',accessCode:passes.json.codes[1]}, {headers:daveHeaders});
  assert.equal(deniedClosed.response.status, 403);
  const reopened = await request('/api/admin/registration', {open:true,inviteOnly:true}, admin);
  assert.equal(reopened.response.status, 200);
  const blockedGuest = await request('/api/admin/guests/'+charlie.json.id+'/block', {blocked:true}, admin);
  assert.equal(blockedGuest.response.status, 200);
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
  const blockedBid = await request('/api/bid', { amount: 100 }, { headers: charlieHeaders });
  assert.equal(blockedBid.response.status, 403, 'Convidado bloqueado não pode dar lance');
  const tooLow = await request('/api/bid', { amount: 50 }, { headers: bobHeaders });
  assert.equal(tooLow.response.status, 400);
  await new Promise(resolve => setTimeout(resolve, 550));
  const bobBid = await request('/api/bid', { amount: 125 }, { headers: bobHeaders });
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
  assert.equal(bobAfter.json.credits, 875);
  assert.equal(bobAfter.json.wins.length, 1);
  const aliceAfter = await request('/api/me', undefined, { headers: aliceHeaders });
  assert.equal(aliceAfter.json.credits, 1000);
  const result = await request('/api/state');
  assert.equal(result.json.game.status, 'sold');
  assert.equal(result.json.game.topGuestName, 'Bob');
  console.log('✅ Smoke tests passed: livre bid, unique device, restore cookie, one-use codes, close registration, guest blocking, full auction and credits.');
} catch (error) {
  console.error('❌ Smoke test failed:', error);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
