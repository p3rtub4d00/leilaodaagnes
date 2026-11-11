require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1.4mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: false } });
const PORT = process.env.PORT || 10000;
const START_CREDITS = 1000;
const DB_URL = process.env.MONGODB_URI || process.env.MONGO_URI || '';
let databaseConnected = false;
const memory = { guests: new Map(), items: new Map(), game: newGame(), sequence: 0 };
const throttles = new Map();

const guestSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 32 },
  tokenHash: { type: String, required: true },
  credits: { type: Number, default: START_CREDITS },
  wins: [{ itemId: String, title: String, amount: Number, at: Date }]
}, { timestamps: true });
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  hint: { type: String, default: 'O que será que tem aqui?' },
  secret: { type: String, default: '' },
  image: { type: String, default: '' },
  color: { type: String, default: 'pink' },
  startingBid: { type: Number, default: 50 },
  increment: { type: Number, default: 50 },
  duration: { type: Number, default: 60 },
  order: { type: Number, default: 0 },
  status: { type: String, default: 'ready' },
  winner: { name: String, guestId: String, amount: Number }
}, { timestamps: true });
const gameSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'main' },
  status: { type: String, default: 'idle' },
  itemId: { type: String, default: '' },
  topAmount: { type: Number, default: 0 },
  topGuestId: { type: String, default: '' },
  topGuestName: { type: String, default: '' },
  endsAt: { type: Date, default: null },
  remainingMs: { type: Number, default: 0 },
  version: { type: Number, default: 0 },
  history: { type: Array, default: [] }
}, { minimize: false });
const Guest = mongoose.model('AuctionGuest', guestSchema);
const Item = mongoose.model('AuctionItem', itemSchema);
const Game = mongoose.model('AuctionGame', gameSchema);

function newGame() {
  return { key: 'main', status: 'idle', itemId: '', topAmount: 0, topGuestId: '',
    topGuestName: '', endsAt: null, remainingMs: 0, version: 0, history: [] };
}
function id(v) { return String(v?._id ?? v?.id ?? v ?? ''); }
function data(v) { return v?.toObject ? v.toObject() : v; }
function err(res, message, code = 400) { return res.status(code).json({ error: message }); }
function cleanName(v, max = 36) { return String(v ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
function intIn(v, min, max, fallback) { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; }
function sha(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function signAdmin(payload) {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + mac;
}
function verifyAdmin(req) {
  const cookie = req.headers.cookie || '';
  const value = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('agnes_admin='));
  if (!value) return false;
  const token = value.split('=')[1] || '';
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
  if (!secret) return false;
  const signature = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64url');
  if (!safeEqual(signature, parts[1])) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return claims.role === 'admin' && claims.exp > Date.now();
  } catch { return false; }
}
function requireAdmin(req, res, next) { if (!verifyAdmin(req)) return err(res, 'Acesso administrativo necessário.', 401); next(); }
function slowDown(key, ms) {
  const now = Date.now();
  const last = throttles.get(key) || 0;
  if (now - last < ms) return true;
  throttles.set(key, now);
  if (throttles.size > 2000) for (const [k, t] of throttles) if (now - t > 120000) throttles.delete(k);
  return false;
}
async function getGame() {
  if (!databaseConnected) return { ...memory.game, history: [...memory.game.history] };
  return data(await Game.findOneAndUpdate({ key: 'main' }, { $setOnInsert: newGame() },
    { upsert: true, new: true, lean: true }));
}
async function saveGame(changes, expected = {}) {
  if (!databaseConnected) {
    if (Object.entries(expected).some(([k, v]) => memory.game[k] !== v)) return null;
    memory.game = { ...memory.game, ...changes, version: memory.game.version + 1 };
    return { ...memory.game };
  }
  return data(await Game.findOneAndUpdate({ key: 'main', ...expected },
    { $set: changes, $inc: { version: 1 } }, { new: true, lean: true }));
}
async function getItems() {
  if (!databaseConnected) return [...memory.items.values()].sort((a, b) => a.order - b.order);
  return Item.find({}).sort({ order: 1, createdAt: 1 }).lean();
}
async function getItem(itemId) {
  if (!databaseConnected) return memory.items.get(itemId) || null;
  if (!mongoose.isValidObjectId(itemId)) return null;
  return Item.findById(itemId).lean();
}
async function addItem(info) {
  if (!databaseConnected) {
    const item = { ...info, _id: crypto.randomUUID(), status: 'ready', createdAt: new Date() };
    memory.items.set(id(item), item); return item;
  }
  return data(await Item.create(info));
}
async function editItem(itemId, info) {
  if (!databaseConnected) {
    const item = memory.items.get(itemId);
    if (!item) return null;
    Object.assign(item, info); return item;
  }
  if (!mongoose.isValidObjectId(itemId)) return null;
  return Item.findByIdAndUpdate(itemId, { $set: info }, { new: true, runValidators: true }).lean();
}
async function removeItem(itemId) {
  if (!databaseConnected) return memory.items.delete(itemId);
  if (!mongoose.isValidObjectId(itemId)) return false;
  return !!(await Item.findByIdAndDelete(itemId));
}
async function allGuests() {
  if (!databaseConnected) return [...memory.guests.values()];
  return Guest.find({}).sort({ createdAt: 1 }).lean();
}
async function getGuest(guestId) {
  if (!databaseConnected) return memory.guests.get(guestId) || null;
  if (!mongoose.isValidObjectId(guestId)) return null;
  return Guest.findById(guestId).lean();
}
async function addGuest(name, tokenHash) {
  if (!databaseConnected) {
    const guest = { _id: crypto.randomUUID(), name, tokenHash, credits: START_CREDITS, wins: [], createdAt: new Date() };
    memory.guests.set(id(guest), guest); return guest;
  }
  return data(await Guest.create({ name, tokenHash, credits: START_CREDITS }));
}
async function chargeWinner(guestId, amount, win) {
  if (!databaseConnected) {
    const guest = memory.guests.get(guestId);
    if (!guest || guest.credits < amount) return false;
    guest.credits -= amount; guest.wins.push(win); return true;
  }
  if (!mongoose.isValidObjectId(guestId)) return false;
  return !!(await Guest.findOneAndUpdate({ _id: guestId, credits: { $gte: amount } },
    { $inc: { credits: -amount }, $push: { wins: win } }));
}
async function changeBid(game, bid) {
  if (!databaseConnected) {
    if (memory.game.version !== game.version || memory.game.status !== 'live') return null;
    memory.game = { ...memory.game, ...bid, version: memory.game.version + 1 };
    return { ...memory.game };
  }
  return Game.findOneAndUpdate({ key: 'main', version: game.version, status: 'live', endsAt: { $gt: new Date() } },
    { $set: bid, $inc: { version: 1 } }, { new: true, lean: true });
}
async function clearAll() {
  if (!databaseConnected) { memory.items.clear(); memory.guests.clear(); memory.game = newGame(); return; }
  await Promise.all([Guest.deleteMany({}), Item.deleteMany({}), Game.deleteMany({})]);
  await getGame();
}
async function publicState() {
  const [game, items, guests] = await Promise.all([getGame(), getItems(), allGuests()]);
  const active = items.find(x => id(x) === game.itemId) || null;
  const publicItem = item => item && ({
    id: id(item), name: item.name, hint: item.hint, image: item.image,
    color: item.color, startingBid: item.startingBid, increment: item.increment,
    duration: item.duration, status: item.status, winner: item.winner || null
  });
  const ranking = guests.map(g => ({
    id: id(g), name: g.name, credits: g.credits,
    wins: g.wins?.length || 0, spent: START_CREDITS - g.credits
  })).sort((a, b) => b.wins - a.wins || b.spent - a.spent || a.name.localeCompare(b.name)).slice(0, 8);
  const remainingMs = game.status === 'live' ? Math.max(0, new Date(game.endsAt).getTime() - Date.now()) : (game.remainingMs || 0);
  return {
    game: { status: game.status, itemId: game.itemId, topAmount: game.topAmount || 0,
      topGuestName: game.topGuestName || '', topGuestId: game.topGuestId || '',
      remainingMs, endsAt: game.status === 'live' ? game.endsAt : null,
      history: (game.history || []).slice(-6).reverse() },
    active: publicItem(active),
    items: items.map(publicItem),
    ranking, guestCount: guests.length,
    totalSold: items.filter(x => x.status === 'sold').length,
    temporaryStorage: !databaseConnected, startingCredits: START_CREDITS
  };
}
let broadcastPending = false;
async function broadcast() {
  if (broadcastPending) return;
  broadcastPending = true;
  try { io.emit('auction:state', await publicState()); }
  catch (e) { console.error('broadcast:', e.message); }
  finally { broadcastPending = false; }
}
async function finishAuction() {
  const game = await getGame();
  if (game.status !== 'live' && game.status !== 'paused') return false;
  const settled = await saveGame({ status: 'settling', endsAt: null, remainingMs: 0 }, { status: game.status, version: game.version });
  if (!settled) return false;
  const item = await getItem(game.itemId);
  if (item) {
    if (game.topGuestId && game.topAmount) {
      const win = { itemId: id(item), title: item.name, amount: game.topAmount, at: new Date() };
      const paid = await chargeWinner(game.topGuestId, game.topAmount, win);
      if (paid) await editItem(id(item), { status: 'sold', winner: { name: game.topGuestName, guestId: game.topGuestId, amount: game.topAmount } });
      else await editItem(id(item), { status: 'ready' });
    } else await editItem(id(item), { status: 'ready' });
  }
  await saveGame({ status: 'sold' }, { status: 'settling' });
  await broadcast();
  return true;
}
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
app.get('/health', (req, res) => res.json({ ok: true, databaseConnected, realtime: true }));
app.get('/api/state', asyncRoute(async (req, res) => res.json(await publicState())));
app.post('/api/guests', asyncRoute(async (req, res) => {
  const name = cleanName(req.body?.name, 32);
  if (name.length < 2) return err(res, 'Informe seu nome (mínimo 2 letras).');
  if (slowDown('join:' + req.ip, 5000)) return err(res, 'Aguarde alguns segundos antes de entrar novamente.', 429);
  const token = crypto.randomBytes(32).toString('hex');
  const guest = await addGuest(name, sha(token));
  res.status(201).json({ id: id(guest), token, name: guest.name, credits: guest.credits });
  await broadcast();
}));
async function guestFrom(req) {
  const guestId = String(req.headers['x-guest-id'] || '');
  const token = String(req.headers['x-guest-token'] || '');
  if (!guestId || !token || token.length > 128) return null;
  const guest = await getGuest(guestId);
  return guest && safeEqual(guest.tokenHash, sha(token)) ? guest : null;
}
app.get('/api/me', asyncRoute(async (req, res) => {
  const g = await guestFrom(req);
  if (!g) return err(res, 'Cadastro não encontrado neste aparelho.', 401);
  res.json({ id: id(g), name: g.name, credits: g.credits, wins: g.wins || [] });
}));
app.post('/api/bid', asyncRoute(async (req, res) => {
  const guest = await guestFrom(req);
  if (!guest) return err(res, 'Entre com seu nome para dar lances.', 401);
  if (slowDown('bid:' + id(guest), 450)) return err(res, 'Aguarde um instante entre os lances.', 429);
  const game = await getGame();
  if (game.status !== 'live' || Date.now() >= new Date(game.endsAt).getTime()) return err(res, 'Este leilão não está recebendo lances.');
  const item = await getItem(game.itemId);
  if (!item) return err(res, 'Pacote não encontrado.', 404);
  if (game.topGuestId === id(guest)) return err(res, 'Você já está liderando este leilão!');
  const amount = Number(req.body?.amount);
  const minimum = game.topAmount > 0 ? game.topAmount + item.increment : item.startingBid;
  if (!Number.isInteger(amount) || amount < minimum || (amount - minimum) % item.increment !== 0)
    return err(res, 'O lance deve respeitar o valor mínimo e os incrementos.');
  if (amount > guest.credits) return err(res, 'Você não tem créditos suficientes para esse lance.');
  if (amount > 1000000) return err(res, 'Lance acima do limite.');
  const currentTime = Date.now();
  const endsAt = new Date(Math.max(new Date(game.endsAt).getTime(), currentTime + 10000));
  const history = [...(game.history || []), { guestId: id(guest), name: guest.name, amount, time: new Date() }].slice(-12);
  const changed = await changeBid(game, { topAmount: amount, topGuestId: id(guest),
    topGuestName: guest.name, endsAt, history });
  if (!changed) return err(res, 'Outro lance chegou primeiro. Confira o valor atualizado.', 409);
  res.json({ ok: true, amount });
  await broadcast();
}));

app.post('/api/admin/login', (req, res) => {
  const password = process.env.ADMIN_PASSWORD || '';
  if (!password || !process.env.SESSION_SECRET) return err(res, 'Configure ADMIN_PASSWORD e SESSION_SECRET no Render.', 503);
  if (slowDown('login:' + req.ip, 1250)) return err(res, 'Aguarde antes de tentar novamente.', 429);
  if (!safeEqual(password, String(req.body?.password || ''))) return err(res, 'Senha incorreta.', 401);
  const token = signAdmin({ role: 'admin', exp: Date.now() + 12 * 60 * 60 * 1000, nonce: crypto.randomBytes(12).toString('hex') });
  res.cookie('agnes_admin', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 60 * 60 * 1000, path: '/' });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('agnes_admin', { path: '/' });
  res.json({ ok: true });
});
app.get('/api/admin/data', requireAdmin, asyncRoute(async (req, res) => {
  const [items, guests, game] = await Promise.all([getItems(), allGuests(), getGame()]);
  res.json({ items: items.map(x => ({ ...data(x), id: id(x) })),
    guests: guests.map(g => ({ id: id(g), name: g.name, credits: g.credits, wins: g.wins || [], createdAt: g.createdAt })),
    game, temporaryStorage: !databaseConnected });
}));
function parseItem(body) {
  const name = cleanName(body?.name, 60);
  if (!name) throw new Error('Informe o nome do pacote.');
  const image = String(body?.image || '');
  if (image && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 1200000))
    throw new Error('Imagem inválida ou grande demais. Use uma foto de até 850 KB.');
  return { name, hint: cleanName(body?.hint, 90) || 'O que será que tem aqui?',
    secret: cleanName(body?.secret, 200), image,
    color: ['pink', 'purple', 'blue', 'gold'].includes(body?.color) ? body.color : 'pink',
    startingBid: intIn(body?.startingBid, 1, 1000, 50),
    increment: intIn(body?.increment, 1, 500, 50),
    duration: intIn(body?.duration, 15, 900, 60),
    order: intIn(body?.order, 0, 10000, 0) };
}
app.post('/api/admin/items', requireAdmin, asyncRoute(async (req, res) => {
  let info;
  try { info = parseItem(req.body); } catch (e) { return err(res, e.message); }
  const item = await addItem(info);
  res.status(201).json({ id: id(item) });
  await broadcast();
}));
app.put('/api/admin/items/:itemId', requireAdmin, asyncRoute(async (req, res) => {
  const g = await getGame();
  if (g.itemId === req.params.itemId && ['live', 'paused', 'settling'].includes(g.status))
    return err(res, 'Pause ou encerre este leilão antes de alterar o pacote.');
  let info;
  try { info = parseItem(req.body); } catch (e) { return err(res, e.message); }
  const existing = await getItem(req.params.itemId);
  if (!existing) return err(res, 'Pacote não encontrado.', 404);
  if (!info.image) info.image = existing.image || '';
  const item = await editItem(req.params.itemId, info);
  res.json({ ok: !!item });
  await broadcast();
}));
app.delete('/api/admin/items/:itemId', requireAdmin, asyncRoute(async (req, res) => {
  const g = await getGame();
  if (g.itemId === req.params.itemId && ['live', 'paused', 'settling'].includes(g.status))
    return err(res, 'Não é possível excluir o pacote em andamento.');
  res.json({ ok: await removeItem(req.params.itemId) });
  await broadcast();
}));
app.post('/api/admin/start', requireAdmin, asyncRoute(async (req, res) => {
  const game = await getGame();
  if (['live', 'paused', 'settling'].includes(game.status)) return err(res, 'Encerre o leilão atual primeiro.');
  const item = await getItem(String(req.body?.itemId || ''));
  if (!item) return err(res, 'Selecione um pacote cadastrado.');
  if (item.status === 'sold') return err(res, 'Este pacote já foi arrematado.');
  const changes = { status: 'live', itemId: id(item), topAmount: 0, topGuestId: '', topGuestName: '',
    endsAt: new Date(Date.now() + item.duration * 1000), remainingMs: item.duration * 1000, history: [] };
  const next = await saveGame(changes, { version: game.version });
  if (!next) return err(res, 'Leilão atualizado por outro administrador. Tente novamente.', 409);
  res.json({ ok: true });
  await broadcast();
}));
app.post('/api/admin/pause', requireAdmin, asyncRoute(async (req, res) => {
  const game = await getGame();
  if (game.status !== 'live') return err(res, 'Não há um leilão em andamento.');
  const remainingMs = Math.max(1000, new Date(game.endsAt).getTime() - Date.now());
  if (!await saveGame({ status: 'paused', remainingMs, endsAt: null }, { status: 'live', version: game.version }))
    return err(res, 'O estado do leilão mudou.', 409);
  res.json({ ok: true }); await broadcast();
}));
app.post('/api/admin/resume', requireAdmin, asyncRoute(async (req, res) => {
  const game = await getGame();
  if (game.status !== 'paused') return err(res, 'O leilão não está pausado.');
  if (!await saveGame({ status: 'live', endsAt: new Date(Date.now() + game.remainingMs) },
    { status: 'paused', version: game.version })) return err(res, 'O estado do leilão mudou.', 409);
  res.json({ ok: true }); await broadcast();
}));
app.post('/api/admin/finish', requireAdmin, asyncRoute(async (req, res) => {
  if (!await finishAuction()) return err(res, 'Não há leilão ativo para encerrar.');
  res.json({ ok: true });
}));
app.post('/api/admin/reset', requireAdmin, asyncRoute(async (req, res) => {
  if (req.body?.confirmation !== 'ZERAR TUDO') return err(res, 'Confirmação inválida.');
  await clearAll(); res.json({ ok: true }); await broadcast();
}));
app.get(['/telao', '/telao/', '/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use('/api', (req, res) => err(res, 'Rota não encontrada.', 404));
app.use((errValue, req, res, next) => {
  console.error('API:', errValue);
  if (res.headersSent) return next(errValue);
  res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente.' });
});
io.on('connection', socket => { publicState().then(state => socket.emit('auction:state', state)).catch(() => {}); });

let timerBusy = false;
setInterval(async () => {
  if (timerBusy) return;
  timerBusy = true;
  try {
    const game = await getGame();
    if (game.status === 'live' && Date.now() >= new Date(game.endsAt).getTime()) await finishAuction();
    else if (game.status === 'live') io.emit('auction:tick', { remainingMs: Math.max(0, new Date(game.endsAt).getTime() - Date.now()) });
  } catch (e) { console.error('timer:', e.message); }
  finally { timerBusy = false; }
}, 800).unref();

async function start() {
  if (DB_URL) {
    try {
      await mongoose.connect(DB_URL, { serverSelectionTimeoutMS: 12000 });
      databaseConnected = true;
      console.log('MongoDB conectado. Persistência habilitada.');
      await getGame();
    } catch (e) { console.error('MongoDB indisponível: iniciado no modo demonstração volátil.', e.message); }
  } else console.warn('MONGODB_URI ausente: modo demonstração em memória (dados temporários).');
  httpServer.listen(PORT, '0.0.0.0', () => console.log('Leilão Surpresa da Agnes na porta', PORT));
}
start();
process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)); });
