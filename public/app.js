(() => {
'use strict';
const $ = id => document.getElementById(id);
const view = location.pathname.startsWith('/admin') ? 'admin' : location.pathname.startsWith('/telao') ? 'tv' : 'guest';
const currency = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = ms => { const sec = Math.max(0, Math.ceil(Number(ms || 0) / 1000)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); };
const state = { auction: null, me: null, guest: null, admin: null, selected: null, photo: '', editItem: null, previousBid: null, previousStatus: null, sound: false, soundContext: null, narratedRound: '', saidOne: false, saidTwo: false, lastAdminRefresh: 0, lastMeRefresh: 0 };
try { state.guest = JSON.parse(localStorage.getItem('agnes_auction_guest') || 'null'); } catch { localStorage.removeItem('agnes_auction_guest'); }
const imageOf = item => item?.image || '/assets/mystery-gift.svg';
const statusName = status => ({ idle: 'Aguardando', live: 'Ao vivo', paused: 'Pausado', settling: 'Finalizando', sold: 'Encerrado' })[status] || 'Aguardando';
const bidMinimum = (game, item) => item ? ((game?.topAmount || 0) > 0 ? game.topAmount + item.increment : item.startingBid) : 0;
function toast(message, isError = false) {
  const el = $('toast'); if (!el) return;
  el.textContent = message; el.classList.toggle('error', isError); el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.hidden = true, 4100);
}
async function api(url, body, options = {}) {
  const headers = { ...options.headers };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.guest) { headers['X-Guest-Id'] = state.guest.id; headers['X-Guest-Token'] = state.guest.token; }
  let response;
  try { response = await fetch('/api' + url, { method: body === undefined ? 'GET' : (options.method || 'POST'), headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error('Sem conexão com o servidor. Confira sua internet.'); }
  let value; try { value = await response.json(); } catch { value = {}; }
  if (!response.ok) { const error = new Error(value.error || 'Não foi possível continuar.'); error.code = response.status; throw error; }
  return value;
}
async function refreshAuction() {
  try { const value = await api('/state'); applyAuction(value); }
  catch (e) { if (!state.auction) toast(e.message, true); }
}
function applyAuction(value) {
  if (!value?.game) return;
  const old = state.auction?.game;
  const bidChanged = old && (value.game.topAmount !== old.topAmount || value.game.itemId !== old.itemId);
  const newWinner = old && old.status !== 'sold' && value.game.status === 'sold' && value.game.topGuestId;
  state.auction = value;
  if (bidChanged && value.game.topAmount) {
    if (view === 'tv') {
      state.narratedRound = value.game.itemId + ':' + value.game.topGuestId + ':' + value.game.topAmount;
      state.saidOne = false; state.saidTwo = false;
      if (state.sound) {
        ding(2);
        announce(value.game.topGuestName + ' deu um lance de ' + spokenMoney(value.game.topAmount) + '! Quem vai dar mais?');
      }
    }
    if (view === 'guest' && state.selected !== null) state.selected = null;
  }
  if (newWinner && view === 'tv' && state.sound) {
    ding(4);
    announce('Arrematado! ' + value.game.topGuestName + ' levou ' + (value.active?.name || 'o pacote surpresa') + ' por ' + spokenMoney(value.game.topAmount) + '! Parabéns!');
  }
  if (view === 'guest') {
    renderGuest();
    if (bidChanged || newWinner) refreshMe(false);
  } else if (view === 'tv') renderTV(bidChanged || newWinner);
  else { renderAdminLive(); if (!state.lastAdminRefresh || Date.now() - state.lastAdminRefresh > 1200) refreshAdmin(false); }
}
function remaining() {
  const game = state.auction?.game;
  return game?.status === 'live' && game?.endsAt ? Math.max(0, new Date(game.endsAt).getTime() - Date.now()) : game?.remainingMs || 0;
}
function onTick(ms) {
  if (state.auction?.game?.status !== 'live') return;
  state.auction.game.remainingMs = ms;
  const time = clock(ms);
  if (view === 'tv' && $('tvTimer')) $('tvTimer').textContent = time;
  if (view === 'guest' && $('guestTimer')) $('guestTimer').textContent = time;
  if (view === 'admin' && $('controlTimer')) $('controlTimer').textContent = time;
  if (view === 'tv' && state.sound && state.auction?.game?.topAmount > 0) {
    const g = state.auction.game;
    const round = g.itemId + ':' + g.topGuestId + ':' + g.topAmount;
    if (round !== state.narratedRound) { state.narratedRound = round; state.saidOne = false; state.saidTwo = false; }
    if (ms > 0 && ms <= 6700 && !state.saidOne) {
      state.saidOne = true;
      announce('Dou-lhe uma! ' + spokenMoney(g.topAmount) + ' para ' + g.topGuestName + '!');
    }
    if (ms > 0 && ms <= 2600 && !state.saidTwo) {
      state.saidTwo = true;
      announce('Dou-lhe duas! Última chance! ' + spokenMoney(g.topAmount) + '!');
    }
  }
}
function renderGuest() {
  const joined = !!state.me;
  $('guestJoin').hidden = joined;
  $('guestDashboard').hidden = !joined;
  if (!joined) return;
  const a = state.auction || {};
  const game = a.game || {};
  const item = a.active;
  $('helloGuest').textContent = 'Olá, ' + state.me.name + '! 👋';
  $('guestCredits').textContent = currency(state.me.credits);
  $('guestItemName').textContent = item?.name || 'Aguardando a próxima surpresa';
  $('guestItemHint').textContent = item?.hint || 'O leiloeiro vai começar em breve!';
  $('guestGift').innerHTML = '<img src="' + safe(imageOf(item)) + '" alt="Presente surpresa">';
  $('guestGift').className = 'gift-thumb color-' + (item?.color || 'pink');
  $('guestCurrentBid').textContent = currency(game.topAmount || 0);
  $('guestLeader').textContent = game.topGuestName ? '👑 Líder: ' + game.topGuestName : '👑 Aguardando o primeiro lance';
  $('guestTimer').textContent = clock(remaining());
  const statusChip = $('guestStatus');
  statusChip.textContent = statusName(game.status);
  statusChip.className = 'status-chip ' + (game.status || '');
  const live = game.status === 'live' && !!item;
  $('guestBidPanel').hidden = !live;
  const winnerPanel = $('guestWinnerPanel');
  winnerPanel.hidden = game.status !== 'sold' || !item;
  if (!winnerPanel.hidden) {
    winnerPanel.innerHTML = game.topGuestName
      ? '<h3>🎉 ARREMATADO!</h3><p><b>' + safe(item.name) + '</b> foi arrematado por <b>' + safe(game.topGuestName) + '</b> por ' + currency(game.topAmount) + '!</p>'
      : '<h3>🔔 Rodada encerrada!</h3><p>Ninguém deu lances. Este pacote pode voltar ao leilão.</p>';
  }
  if (live) {
    const min = bidMinimum(game, item);
    const amounts = [min, min + item.increment, min + item.increment * 2];
    if (!amounts.includes(state.selected) || state.selected > state.me.credits) state.selected = amounts.find(v => v <= state.me.credits) || null;
    $('bidOptions').innerHTML = amounts.map(amount => '<button type="button" class="bid-choice' + (state.selected === amount ? ' selected' : '') + '" data-amount="' + amount + '"' + (amount > state.me.credits ? ' disabled title="Créditos insuficientes"' : '') + '>' + currency(amount).replace(',00', '').replace('R$ ', 'R$ ') + '</button>').join('');
    $('placeBidBtn').disabled = state.selected === null || game.topGuestId === state.me.id;
    $('placeBidBtn').textContent = game.topGuestId === state.me.id ? '👑 VOCÊ ESTÁ GANHANDO!' : '🔨 DAR LANCE';
    $('bidNote').textContent = game.topGuestId === state.me.id ? 'Seu lance está liderando. Aguarde o final!' : 'Seu saldo só diminui se você arrematar o pacote.';
  }
  $('myWinCount').textContent = (state.me.wins || []).length + ' pacote(s)';
  $('myWins').innerHTML = (state.me.wins || []).length
    ? state.me.wins.slice().reverse().map(w => '<div class="win-row"><span>🎁 ' + safe(w.title) + '</span><b>' + currency(w.amount) + '</b></div>').join('')
    : '<span class="muted-text">Seus presentes arrematados aparecerão aqui.</span>';
  $('guestRanking').innerHTML = (a.ranking || []).length
    ? a.ranking.slice(0,5).map((g,i) => '<div class="mini-rank-row"><span>' + ['🥇','🥈','🥉','🌟','⭐'][i] + ' ' + safe(g.name) + '</span><b>' + g.wins + ' 🎁</b></div>').join('')
    : '<span class="muted-text">O placar aparece quando os convidados participarem.</span>';
}
async function refreshMe(showError = true) {
  if (!state.guest) { state.me = null; if (view === 'guest') renderGuest(); return; }
  try { state.me = await api('/me'); state.lastMeRefresh = Date.now(); if (view === 'guest') renderGuest(); }
  catch (e) {
    if (e.code === 401) { state.guest = null; state.me = null; localStorage.removeItem('agnes_auction_guest'); if (view === 'guest') renderGuest(); }
    else if (showError) toast(e.message, true);
  }
}
function initGuest() {
  $('guestView').hidden = false;
  $('joinForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('guestName').value.trim();
    const btn = event.submitter || $('joinForm').querySelector('button');
    btn.disabled = true;
    try {
      const g = await api('/guests', { name });
      state.guest = { id:g.id, token:g.token };
      localStorage.setItem('agnes_auction_guest', JSON.stringify(state.guest));
      await refreshMe();
      toast('Bem-vindo(a), ' + g.name + '! Você ganhou 1.000 créditos fictícios! 🎉');
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  });
  $('switchGuestBtn').addEventListener('click', () => {
    if (!confirm('Trocar de participante neste aparelho? Sua conta anterior continua com os créditos que tinha.')) return;
    localStorage.removeItem('agnes_auction_guest'); state.guest = null; state.me = null; state.selected = null; renderGuest();
  });
  $('bidOptions').addEventListener('click', event => {
    const btn = event.target.closest('[data-amount]');
    if (!btn) return;
    state.selected = Number(btn.dataset.amount);
    renderGuest();
  });
  $('placeBidBtn').addEventListener('click', async () => {
    if (state.selected === null) return;
    const amount = state.selected;
    const btn = $('placeBidBtn'); btn.disabled = true;
    try {
      await api('/bid', { amount });
      toast('Seu lance de ' + currency(amount) + ' foi registrado! 🔨');
      state.selected = null;
      await refreshAuction();
    } catch (e) {
      toast(e.message, true);
      await refreshAuction();
    } finally { btn.disabled = false; renderGuest(); }
  });
  refreshMe(false); refreshAuction();
}
function ding(count) {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    state.soundContext ||= new C();
    state.soundContext.resume();
    const now = state.soundContext.currentTime;
    for (let i=0;i<count;i++) {
      const osc=state.soundContext.createOscillator(); const gain=state.soundContext.createGain();
      osc.type='sine'; osc.frequency.setValueAtTime(680+i*170,now+i*.09);
      gain.gain.setValueAtTime(.0001,now+i*.09); gain.gain.exponentialRampToValueAtTime(.09,now+i*.09+.012);
      gain.gain.exponentialRampToValueAtTime(.0001,now+i*.09+.21);
      osc.connect(gain).connect(state.soundContext.destination); osc.start(now+i*.09); osc.stop(now+i*.09+.23);
    }
  } catch {}
}
// Narração por síntese de voz do navegador: não depende de API paga.
function spokenMoney(value) {
  const amount = Number(value) || 0;
  if (!Number.isFinite(amount)) return 'zero créditos';
  // A interface usa R$ apenas como aparência: todos os valores são fictícios.
  return amount.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' créditos';
}
function announce(message) {
  if (!state.sound || view !== 'tv' || !('speechSynthesis' in window)) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const line = new SpeechSynthesisUtterance(message);
    line.lang = 'pt-BR';
    line.rate = 1.03;
    line.pitch = 1.04;
    line.volume = 1;
    const voices = synth.getVoices();
    line.voice = voices.find(v => /^pt[-_]br$/i.test(v.lang) && v.localService)
      || voices.find(v => /^pt[-_]br$/i.test(v.lang))
      || voices.find(v => /^pt/i.test(v.lang))
      || null;
    synth.speak(line);
  } catch (error) { console.warn('Voz não disponível:', error); }
}
function changeNarrator(enabled) {
  if (enabled && !('speechSynthesis' in window)) {
    toast('Este navegador não tem narração por voz. Use Chrome ou Edge na TV.', true);
    enabled = false;
  }
  state.sound = enabled;
  $('tvNarratorStart').hidden = true;
  $('tvSound').textContent = enabled ? '🔊 Narrador ligado' : '🔇 Ligar narrador';
  if (enabled) {
    ding(2);
    announce('Atenção, atenção! O Leilão Surpresa da Agnes está no ar! Preparem seus lances!');
  } else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
function renderTV(animate) {
  const a=state.auction || {}; const game=a.game || {}; const item=a.active;
  $('tvGift').src = imageOf(item);
  $('tvItemName').textContent = item?.name || 'Aguardando o leiloeiro...';
  $('tvItemHint').textContent = item?.hint || 'Prepare seus créditos, a surpresa vai começar!';
  $('tvCurrentBid').textContent = currency(game.topAmount);
  $('tvLeader').textContent = game.topGuestName ? 'LÍDER: ' + game.topGuestName : 'AGUARDANDO LANCES';
  $('tvTimer').textContent = clock(remaining());
  $('tvParticipantCount').textContent = (a.guestCount || 0) + ' convidados participando';
  $('tvStatusText').textContent = game.status === 'live' ? '🔥 Quem vai arrematar esse mistério?' : game.status === 'paused' ? '⏸ Leilão pausado pelo leiloeiro' : game.status === 'sold' ? '🏆 Rodada encerrada' : '🎈 A festa está só começando!';
  const last = game.history?.[0];
  $('tvBanner').querySelector('strong').textContent = last && game.status === 'live' ? 'NOVO LANCE!' : game.status === 'sold' ? 'ARREMATADO!' : 'LEILÃO SURPRESA!';
  $('tvBannerText').textContent = last && game.status === 'live' ? last.name + ' → ' + currency(last.amount) : game.status === 'sold' && game.topGuestName ? game.topGuestName + ' venceu com ' + currency(game.topAmount) : 'O que será que tem dentro do pacote?';
  $('tvWinnerOverlay').hidden = game.status !== 'sold' || !game.topGuestName;
  if (!$('tvWinnerOverlay').hidden) {
    $('tvWinnerGift').src = imageOf(item);
    $('tvWinnerItem').textContent = item?.name || 'Pacote Surpresa';
    $('tvWinnerAmount').textContent = currency(game.topAmount);
    $('tvWinnerName').textContent = game.topGuestName;
  }
  if (animate) {
    for (const el of [$('tvCurrentBid'), $('tvBanner')].filter(Boolean)) {
      el.classList.remove('new-bid-pop'); void el.offsetWidth; el.classList.add('new-bid-pop');
    }
  }
}
function initTV() {
  $('tvView').hidden = false;
  $('tvFullscreen').addEventListener('click', async () => {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); }
    catch { toast('Tela cheia não disponível neste navegador.', true); }
  });
  $('tvSound').addEventListener('click', () => changeNarrator(!state.sound));
  $('tvNarratorEnable').addEventListener('click', () => changeNarrator(true));
  $('tvNarratorSkip').addEventListener('click', () => changeNarrator(false));
  refreshAuction();
}
function itemById(itemId) { return state.admin?.items?.find(i => (i.id || i._id) === itemId); }
async function refreshAdmin(showError = false) {
  try {
    const value = await api('/admin/data');
    state.admin = value; state.lastAdminRefresh = Date.now();
    $('adminLogin').hidden = true; $('adminDashboard').hidden = false; $('adminLogout').hidden = false;
    renderAdmin();
  } catch (e) {
    if (e.code === 401) { $('adminLogin').hidden = false; $('adminDashboard').hidden = true; $('adminLogout').hidden = true; }
    else if (showError) toast(e.message, true);
  }
}
function renderAdminLive() {
  const a=state.auction; if (!a || !state.admin) return;
  const game=a.game, item=a.active, active=['live','paused','settling'].includes(game.status);
  $('metricGuests').textContent=a.guestCount; $('metricPackages').textContent=a.items.length; $('metricSold').textContent=a.totalSold;
  $('metricStatus').textContent=statusName(game.status);
  const badge=$('adminLiveBadge'); badge.textContent=statusName(game.status); badge.className='status-chip '+game.status;
  $('controlItemName').textContent=item?.name || 'Nenhum pacote iniciado';
  $('controlGift').src=imageOf(item);
  $('controlCurrentBid').textContent=currency(game.topAmount);
  $('controlLeader').textContent=game.topGuestName ? '👑 Líder: '+game.topGuestName : 'Aguardando lances';
  $('controlTimer').textContent=clock(remaining());
  $('controlStart').disabled=active || !(state.admin.items||[]).some(x=>x.status!=='sold');
  $('controlPause').disabled=game.status!=='live';
  $('controlResume').disabled=game.status!=='paused';
  $('controlFinish').disabled=!['live','paused'].includes(game.status);
  const history=game.history || [];
  $('adminBidHistory').innerHTML=history.length ? history.map(x=>'<div class="history-row"><div><b>🔨 '+safe(x.name)+'</b><small>'+new Date(x.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+'</small></div><strong>'+currency(x.amount)+'</strong></div>').join('') : '<p class="muted-text">Os lances aparecerão aqui.</p>';
}
function renderAdmin() {
  if (!state.admin) return;
  $('storageWarning').hidden=!state.admin.temporaryStorage;
  renderAdminLive();
  const game=state.auction?.game || {};
  const active=['live','paused','settling'].includes(game.status);
  $('adminPackages').innerHTML=state.admin.items.length ? state.admin.items.map(item=>{
    const itemId=item.id || item._id, isActive=game.itemId===itemId && active, sold=item.status==='sold';
    return '<div class="package-tile"><div class="package-art"><img src="'+safe(imageOf(item))+'" alt=""></div><div class="package-desc"><h3>'+safe(item.name)+'</h3><p>'+safe(item.hint)+'</p><small>Início: '+currency(item.startingBid)+' · +' +currency(item.increment)+' · '+item.duration+'s</small>'+(item.secret?'<div class="package-secret">🤫 Segredo: '+safe(item.secret)+'</div>':'')+(sold?'<div class="package-secret">🏆 '+safe(item.winner?.name||'Arrematado')+' · '+currency(item.winner?.amount||0)+'</div>':'')+'<div class="package-actions"><button type="button" data-action="start" data-id="'+safe(itemId)+'" class="start-tile" '+(sold||active?'disabled':'')+'>▶ Leiloar</button><button type="button" data-action="edit" data-id="'+safe(itemId)+'" '+(isActive?'disabled':'')+'>✏️ Editar</button><button type="button" data-action="delete" data-id="'+safe(itemId)+'" '+(isActive?'disabled':'')+'>🗑️ Excluir</button></div></div></div>';
  }).join('') : '<div class="empty-state"><span class="emoji">🎁</span>Cadastre o primeiro pacote surpresa para começar!</div>';
  $('adminGuests').innerHTML=state.admin.guests.length ? state.admin.guests.map(g=>'<tr><td>👤 '+safe(g.name)+'</td><td>'+currency(g.credits)+'</td><td>'+(g.wins||[]).length+'</td></tr>').join('') : '<tr><td colspan="3" class="muted-text">Nenhum convidado entrou ainda.</td></tr>';
  $('adminGuestCount').textContent=state.admin.guests.length+' convidados';
}
async function adminAction(endpoint, body={}, options={}) {
  try { await api('/admin/'+endpoint,body,options); toast('Atualização realizada! 🎉'); await Promise.all([refreshAuction(),refreshAdmin(true)]); return true; }
  catch(e){ toast(e.message,true); return false; }
}
function openModal(item=null) {
  $('packageForm').reset();
  $('editItemId').value=item?.id||item?._id||'';
  $('packageModalTitle').textContent=item?'✏️ Editar pacote surpresa':'🎁 Novo pacote surpresa';
  $('itemName').value=item?.name||'Pacote Surpresa #'+String((state.admin?.items?.length||0)+1).padStart(2,'0');
  $('itemHint').value=item?.hint||'O que será que tem aqui?';
  $('itemSecret').value=item?.secret||'';
  $('itemStarting').value=item?.startingBid||50; $('itemIncrement').value=item?.increment||50;
  $('itemDuration').value=item?.duration||60; $('itemColor').value=item?.color||'pink';
  state.photo=item?.image||'';
  $('itemPhotoPreview').querySelector('img').src=state.photo||'/assets/mystery-gift.svg';
  $('packageModal').hidden=false; document.body.style.overflow='hidden'; $('itemName').focus();
}
function closeModal(){ $('packageModal').hidden=true;document.body.style.overflow=''; }
async function optimizePhoto(file){
  if(!file) return '';
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Envie uma foto JPG, PNG ou WEBP.');
  if(file.size>12*1024*1024) throw new Error('Foto muito grande. O limite de entrada é 12 MB.');
  const source=URL.createObjectURL(file);
  try {
    const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Não foi possível abrir a imagem.'));i.src=source;});
    const ratio=Math.min(1,950/Math.max(image.naturalWidth,image.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.round(image.naturalWidth*ratio);c.height=Math.round(image.naturalHeight*ratio);
    c.getContext('2d').drawImage(image,0,0,c.width,c.height);
    const result=c.toDataURL('image/webp',.72);
    if(result.length>1100000)throw new Error('Foto maior que o permitido. Escolha uma foto menor.');
    return result;
  } finally { URL.revokeObjectURL(source); }
}
function initAdmin() {
  $('adminView').hidden=false;
  $('adminLoginForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const btn=event.submitter||$('adminLoginForm').querySelector('button');btn.disabled=true;
    try {
      await api('/admin/login',{password:$('adminPassword').value});
      $('adminPassword').value='';await Promise.all([refreshAuction(),refreshAdmin(true)]);toast('Painel desbloqueado! 🔓');
    }catch(e){toast(e.message,true);}finally{btn.disabled=false;}
  });
  $('adminLogout').addEventListener('click',async()=>{await api('/admin/logout',{});state.admin=null;await refreshAdmin();toast('Você saiu do painel.');});
  $('controlStart').addEventListener('click',async()=>{
    const next=state.admin?.items.find(i=>i.status!=='sold');
    if(!next)return toast('Cadastre um pacote primeiro.',true);
    await adminAction('start',{itemId:next.id||next._id});
  });
  $('controlPause').addEventListener('click',()=>adminAction('pause'));
  $('controlResume').addEventListener('click',()=>adminAction('resume'));
  $('controlFinish').addEventListener('click',()=>{if(confirm('Encerrar agora e entregar o pacote ao maior lance?'))adminAction('finish');});
  $('addPackageBtn').addEventListener('click',()=>openModal());
  $('addPackageBtn2').addEventListener('click',()=>openModal());
  $('adminPackages').addEventListener('click',async event=>{
    const b=event.target.closest('button[data-action]');if(!b)return;
    const item=itemById(b.dataset.id);if(!item)return;
    if(b.dataset.action==='start')await adminAction('start',{itemId:b.dataset.id});
    if(b.dataset.action==='edit')openModal(item);
    if(b.dataset.action==='delete'&&confirm('Excluir o pacote "'+item.name+'"?'))await adminAction('items/'+b.dataset.id,{}, {method:'DELETE'});
  });
  $('packageModalClose').addEventListener('click',closeModal);
  $('packageModal').addEventListener('click',e=>{if(e.target===$('packageModal'))closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('packageModal').hidden)closeModal();});
  $('itemPhoto').addEventListener('change',async e=>{
    if(!e.target.files[0])return;
    try{state.photo=await optimizePhoto(e.target.files[0]);$('itemPhotoPreview').querySelector('img').src=state.photo;toast('Foto preparada para o pacote.');}
    catch(error){toast(error.message,true);e.target.value='';}
  });
  $('packageForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const itemId=$('editItemId').value;
    const body={name:$('itemName').value,hint:$('itemHint').value,secret:$('itemSecret').value,image:state.photo,color:$('itemColor').value,startingBid:Number($('itemStarting').value),increment:Number($('itemIncrement').value),duration:Number($('itemDuration').value),order:itemId?(itemById(itemId)?.order||0):(state.admin?.items?.length||0)+1};
    const btn=event.submitter||$('packageForm').querySelector('[type=submit]');btn.disabled=true;
    try{
      await api(itemId?'/admin/items/'+itemId:'/admin/items',body,itemId?{method:'PUT'}:{});
      closeModal();toast('Pacote salvo com sucesso! 🎁');await Promise.all([refreshAdmin(),refreshAuction()]);
    }catch(e){toast(e.message,true);}finally{btn.disabled=false;}
  });
  $('resetAllBtn').addEventListener('click',async()=>{
    const answer=prompt('Isso apagará TODOS os convidados, pacotes e lances. Digite ZERAR TUDO para confirmar.');
    if(answer==='ZERAR TUDO')await adminAction('reset',{confirmation:'ZERAR TUDO'});
  });
  refreshAuction();refreshAdmin();
}
if(view==='guest')initGuest();
if(view==='tv')initTV();
if(view==='admin')initAdmin();
if(window.io){
  const socket=window.io({transports:['websocket','polling'],reconnection:true});
  socket.on('auction:state',applyAuction);
  socket.on('auction:tick',t=>onTick(t.remainingMs));
  socket.on('connect',()=>{refreshAuction();if(view==='guest'&&state.guest)refreshMe(false);});
}
setInterval(()=>{
  if(state.auction?.game?.status==='live')onTick(remaining());
  if(state.guest&&view==='guest'&&Date.now()-state.lastMeRefresh>12000)refreshMe(false);
  if(view==='admin'&&state.admin&&Date.now()-state.lastAdminRefresh>12000)refreshAdmin(false);
},1000);
setInterval(refreshAuction,15000);
})();