const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e12;
let state = { btc: 5, eth: 5 };
let session = { loggedIn: true, paymentsLocked: false };
let currentUser = { username: 'guest', role: 'guest' };
const isOwner = () => currentUser.role === 'owner';
let initialSyncDone = false;
let panicAudio, panicMaster, panicTimer;
let panicActive = false, panicStarting = false;
const PANIC_VOLUME = .8;
const PANIC_ATTACK = 2.5;

// A single, endless horror ambience: detuned low drone, sub rumble, whispering
// noise, a distant wailing tone and a slow heartbeat. Built lazily so the page
// can start it the moment the emergency screen appears.
function ensurePanicAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    if (!panicAudio) {
      const ctx = panicAudio = new AudioContextClass();
      panicMaster = ctx.createGain();
      panicMaster.gain.value = 0;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -16; limiter.knee.value = 12;
      limiter.ratio.value = 8; limiter.attack.value = .01; limiter.release.value = .4;
      panicMaster.connect(limiter).connect(ctx.destination);

      // Diffuse room reflections make the sound feel distant and cavernous.
      const reverb = ctx.createConvolver();
      const impulse = ctx.createBuffer(2, ctx.sampleRate * 5, ctx.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const samples = impulse.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) {
          samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 3);
        }
      }
      reverb.buffer = impulse;
      const wet = ctx.createGain(); wet.gain.value = .28;
      reverb.connect(wet).connect(panicMaster);

      // Dissonant sawtooth cluster under a slowly breathing low-pass filter.
      const droneFilter = ctx.createBiquadFilter();
      droneFilter.type = 'lowpass'; droneFilter.frequency.value = 240; droneFilter.Q.value = 7;
      const droneGain = ctx.createGain(); droneGain.gain.value = .06;
      droneFilter.connect(droneGain).connect(panicMaster);
      for (const [frequency, detune] of [[41.2, -7], [43.65, 9], [61.74, 4]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = frequency; osc.detune.value = detune;
        osc.connect(droneFilter); osc.start();
      }
      const sweep = ctx.createOscillator(), sweepDepth = ctx.createGain();
      sweep.frequency.value = .045; sweepDepth.gain.value = 130;
      sweep.connect(sweepDepth).connect(droneFilter.frequency); sweep.start();

      // Sub-bass rumble felt more than heard.
      const sub = ctx.createOscillator(), subGain = ctx.createGain();
      sub.type = 'sine'; sub.frequency.value = 27.5; subGain.gain.value = .07;
      sub.connect(subGain).connect(panicMaster); sub.start();

      // Whispering noise bed with its own slow swell.
      const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const noise = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * .5;
      const hiss = ctx.createBufferSource(); hiss.buffer = noise; hiss.loop = true;
      const hissFilter = ctx.createBiquadFilter();
      hissFilter.type = 'bandpass'; hissFilter.frequency.value = 820; hissFilter.Q.value = .7;
      const hissGain = ctx.createGain(); hissGain.gain.value = .03;
      const hissLfo = ctx.createOscillator(), hissDepth = ctx.createGain();
      hissLfo.frequency.value = .08; hissDepth.gain.value = .018;
      hissLfo.connect(hissDepth).connect(hissGain.gain); hissLfo.start();
      const space = ctx.createStereoPanner();
      const wander = ctx.createOscillator(), width = ctx.createGain();
      wander.frequency.value = .037; width.gain.value = .65;
      wander.connect(width).connect(space.pan); wander.start();
      hiss.connect(hissFilter).connect(hissGain).connect(space).connect(panicMaster);
      hissGain.connect(reverb); hiss.start();

      // Distant, detuned wail drifting in and out of tune.
      const wail = ctx.createOscillator(), wailGain = ctx.createGain();
      wail.type = 'sine'; wail.frequency.value = 233.08; wailGain.gain.value = .03;
      const wailLfo = ctx.createOscillator(), wailDepth = ctx.createGain();
      wailLfo.frequency.value = .03; wailDepth.gain.value = 18;
      wailLfo.connect(wailDepth).connect(wail.frequency); wailLfo.start();
      wail.connect(wailGain).connect(panicMaster);
      wailGain.connect(reverb); wail.start();
      const breath = ctx.createOscillator(), breathDepth = ctx.createGain();
      breath.frequency.value = .047; breathDepth.gain.value = .025;
      breath.connect(breathDepth).connect(wailGain.gain); breath.start();
      for (const [frequency, rate] of [[311.13, .023], [329.63, .031]]) {
        const voice = ctx.createOscillator(), level = ctx.createGain();
        voice.type = 'triangle'; voice.frequency.value = frequency; level.gain.value = .012;
        const drift = ctx.createOscillator(), depth = ctx.createGain();
        drift.frequency.value = rate; depth.gain.value = 22;
        drift.connect(depth).connect(voice.detune); drift.start();
        voice.connect(level).connect(reverb); voice.start();
      }
    }
    if (panicAudio.state === 'suspended') panicAudio.resume().then(updateSoundHint).catch(() => updateSoundHint());
    return panicAudio;
  } catch { return null; }
}
function scheduleHeartbeat() {
  if (!panicActive || !panicAudio) return;
  const ctx = panicAudio, now = ctx.currentTime;
  if (ctx.state === 'running') for (const offset of [0, .42]) {
    const thump = ctx.createOscillator(), gain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(64, now + offset);
    thump.frequency.exponentialRampToValueAtTime(28, now + offset + .28);
    gain.gain.setValueAtTime(0, now + offset);
    gain.gain.linearRampToValueAtTime(.14, now + offset + .03);
    gain.gain.exponentialRampToValueAtTime(.001, now + offset + .4);
    thump.connect(gain).connect(panicMaster);
    thump.start(now + offset); thump.stop(now + offset + .45);
    thump.onended = () => { thump.disconnect(); gain.disconnect(); };
  }
  panicTimer = setTimeout(scheduleHeartbeat, 2100 + Math.random() * 700);
}
function updateSoundHint() {
  const hint = document.getElementById('sound-hint');
  if (!hint) return;
  hint.hidden = !(panicActive && (!panicAudio || panicAudio.state !== 'running'));
}
function startPanicSound() {
  panicActive = true;
  const ctx = ensurePanicAudio();
  if (!ctx) return;
  if (!panicStarting) {
    panicStarting = true;
    const now = ctx.currentTime;
    panicMaster.gain.cancelScheduledValues(now);
    panicMaster.gain.setValueAtTime(Math.max(panicMaster.gain.value, .0001), now);
    panicMaster.gain.linearRampToValueAtTime(PANIC_VOLUME, now + PANIC_ATTACK);
  }
  if (!panicTimer) scheduleHeartbeat();
  updateSoundHint();
}
function stopPanicSound() {
  if (!panicActive && !panicStarting) return;
  panicActive = false; panicStarting = false;
  clearTimeout(panicTimer); panicTimer = undefined;
  updateSoundHint();
  if (!panicAudio || !panicMaster) return;
  const now = panicAudio.currentTime;
  panicMaster.gain.cancelScheduledValues(now);
  panicMaster.gain.setValueAtTime(Math.max(panicMaster.gain.value, .0001), now);
  panicMaster.gain.linearRampToValueAtTime(0, now + 1.2);
}
// Browsers may block sound until the first interaction, so retry on any gesture
// while the emergency screen is up. Once unlocked the ambience never stops.
for (const gesture of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(gesture, () => {
    ensurePanicAudio();
    if (panicActive) { startPanicSound(); updateSoundHint(); }
  }, { passive: true });
}
window.addEventListener('focus', () => { if (panicActive) startPanicSound(); });
document.addEventListener('visibilitychange', () => { if (panicActive && !document.hidden) startPanicSound(); });
// Build and unlock the audio graph at page load so no click is needed when the
// browser allows autoplay (the launcher starts the browser with that policy on).
ensurePanicAudio();
function applySession(next) {
  const wasLoggedIn = session.loggedIn;
  session = next.session || next;
  if (next.user) currentUser = next.user;
  const owner = currentUser.role === 'owner';
  document.body.classList.toggle('logged-out', !session.loggedIn);
  $('overview').hidden = !session.loggedIn;
  $('overview').inert = !session.loggedIn;
  $('logout-screen').hidden = session.loggedIn;
  document.title = session.loggedIn ? 'Wallet · Overview' : 'QERNIX // LOGGED OUT';
  $('user-name').textContent = currentUser.username;
  $('user-role').textContent = owner ? '[Co-Founder]' : '[Guest]';
  $('user-role').className = owner ? 'red' : 'dim';
  $('profile-initial').textContent = currentUser.username.slice(0, 1);
  document.querySelectorAll('[data-owner]').forEach(button => { button.hidden = !owner; });
$('login-open').hidden = owner;
  $('logout-open').hidden = !owner;
  $('ticket-open').hidden = owner;
  if (!initialSyncDone) {
    initialSyncDone = true;
    if (session.loggedIn && !owner) setTimeout(() => { if (session.loggedIn && !isOwner()) openWelcome(); }, 350);
  }
  if (wasLoggedIn && !session.loggedIn) $('logout-title').focus();
  if (!session.loggedIn) startPanicSound(); else stopPanicSound();
  if (!wasLoggedIn && session.loggedIn) $('command-input').focus();
  const message = !session.loggedIn
    ? 'LOGGED OUT — all actions disabled. Restart the Node server to log back in.'
    : session.paymentsLocked ? 'LOCKDOWN — payments locked until the Node server restarts.' : '';
  $('session-message').textContent = message;
  $('session-message').hidden = !message;
  $('command-input').disabled = !session.loggedIn;
  $('command-input').placeholder = session.loggedIn ? 'Enter an action, or type help' : 'Logged out';
  if (!session.loggedIn) {
    for (const openDialog of document.querySelectorAll('dialog[open]')) openDialog.close();
    cancelAnimationFrame(frame);
    for (const coin of ['btc', 'eth']) $(`${coin}-balance`).textContent = '—';
  }
}
async function syncBalances() {
  try {
    const response = await fetch('/api/balances');
    if (!response.ok) throw new Error('Server unavailable');
    const next = await response.json();
    applySession(next);
    if (session.loggedIn && valid(next.btc) && valid(next.eth)) { state = { btc: next.btc, eth: next.eth }; render(); }
    $('live-indicator').textContent = '●';
    $('connection-label').textContent = 'connected';
  } catch {
    $('live-indicator').textContent = '○';
    $('connection-label').textContent = 'offline';
  }
}
const $ = id => document.getElementById(id);
const units = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let frame, toastTimeout;
let displayed = { btc: state.btc, eth: state.eth };

function renderNumbers(balances) {
  for (const coin of ['btc', 'eth']) {
    $(`${coin}-balance`).textContent = units.format(balances[coin]);
  }
}

function render(animate = false) {
  cancelAnimationFrame(frame);
  const start = { ...displayed }, target = { btc: state.btc, eth: state.eth }, started = performance.now();
  function tick(now) {
    const p = animate && !reduced.matches ? Math.min((now - started) / 650, 1) : 1;
    const ease = 1 - Math.pow(1 - p, 3);
    displayed = { btc: start.btc + (target.btc - start.btc) * ease, eth: start.eth + (target.eth - start.eth) * ease };
    renderNumbers(displayed);
    if (p < 1) frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}

const dialog = $('editor');
function openEditor() {
  if (!session.loggedIn) return false;
  if (!isOwner()) { openLogin(); return false; }
  if (dialog.open) return true;
  $('btc-input').value = state.btc; $('eth-input').value = state.eth;
  $('form-error').textContent = ''; dialog.showModal(); $('btc-input').focus(); $('btc-input').select();
  return true;
}
$('close-editor').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() === 'u' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target.closest('input,textarea,[contenteditable="true"]')) { event.preventDefault(); openEditor(); }
});
$('restore-defaults').addEventListener('click', () => { $('btc-input').value = 5; $('eth-input').value = 5; });
$('balance-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!session.loggedIn) return;
  if (!isOwner()) { $('form-error').textContent = 'Owner login required.'; return; }
  const btc = Number($('btc-input').value), eth = Number($('eth-input').value);
  if (!valid(btc) || !valid(eth)) { $('form-error').textContent = 'Enter positive balances or zero (up to 1 trillion).'; return; }
  const next = { btc, eth };
  try {
    const response = await fetch('/api/balances', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ btc: btc.toFixed(8), eth: eth.toFixed(8) }) });
    const result = await response.json();
    if (result.session) applySession(result);
    if (!response.ok) throw new Error(result.error);
  } catch (error) { $('form-error').textContent = error.message || 'Could not save. Check that the localhost server is running.'; return; }
  state = next; dialog.close(); render(true);
  showToast('balances updated');
});

function showToast(text) {
  const toast = $('toast');
  toast.textContent = text;
  clearTimeout(toastTimeout); toast.classList.add('show');
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2600);
}

const loginDialog = $('login-dialog');
function openLogin() {
  if (!session.loggedIn) return;
  if (isOwner()) { showToast('already signed in as flku'); return; }
  $('login-error').textContent = '';
  $('login-user').value = ''; $('login-pass').value = '';
  loginDialog.showModal(); $('login-user').focus();
}
$('login-open').addEventListener('click', openLogin);
$('login-cancel').addEventListener('click', () => loginDialog.close());
$('login-as-guest').addEventListener('click', () => loginDialog.close());
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('login-error').textContent = '';
  try {
    const response = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('login-user').value.trim(), password: $('login-pass').value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Login failed.');
    applySession(result);
    if (valid(result.btc) && valid(result.eth)) { state = { btc: result.btc, eth: result.eth }; render(true); }
    $('login-pass').value = '';
    loginDialog.close();
    showToast(`signed in as ${result.user.username}`);
    $('command-input').focus();
  } catch (error) { $('login-error').textContent = error.message || 'Login failed.'; }
});

const ticketDialog = $('ticket-dialog');
function openTicket(message = '') {
  if (!session.loggedIn) return;
  if (isOwner()) { showToast('you are the owner — read tickets with the tickets command'); return; }
  $('ticket-message').value = message;
  $('ticket-status').textContent = '';
  $('ticket-status').className = '';
  ticketDialog.showModal(); $('ticket-message').focus();
}
$('ticket-open').addEventListener('click', () => openTicket());
document.querySelectorAll('.close-ticket').forEach(button => button.addEventListener('click', () => ticketDialog.close()));
$('ticket-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('ticket-message').value.trim();
  if (!message) { $('ticket-status').textContent = 'Write a message first.'; return; }
  try {
    const response = await fetch('/api/tickets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not send ticket.');
    $('ticket-message').value = '';
    ticketDialog.close();
    showToast('help ticket sent to the owners');
  } catch (error) { $('ticket-status').textContent = error.message || 'Could not send ticket.'; }
});

const welcomeDialog = $('welcome-dialog');
function openWelcome() {
  if (!session.loggedIn) return false;
  for (const openDialog of document.querySelectorAll('dialog[open]')) openDialog.close();
  welcomeDialog.showModal();
  $('welcome-balances').focus();
  return true;
}
$('welcome-close').addEventListener('click', () => welcomeDialog.close());
$('welcome-balances').addEventListener('click', () => { welcomeDialog.close(); $('command-input').focus(); });
$('welcome-ticket').addEventListener('click', () => { welcomeDialog.close(); openTicket(); });
$('welcome-login').addEventListener('click', () => { welcomeDialog.close(); openLogin(); });
welcomeDialog.addEventListener('click', event => { if (event.target === welcomeDialog) welcomeDialog.close(); });

async function logout() {
  const response = await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not sign out.');
  applySession(result);
  return result;
}
document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', () => { document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a === link)); }));
render();
syncBalances();
setInterval(syncBalances, 500);

// Built-in UI commands only; input never executes an operating-system shell.
const commandHistory = [];
let historyIndex = 0;
const guestCommands = ['help', 'balance', 'whoami', 'status', 'ping', 'date', 'history', 'clear', 'ticket', 'welcome', 'login'];
const ownerCommands = ['tickets', 'close', 'reopen', 'stats', 'export', 'logout', 'panic'];
let commandBusy = false;
$('command-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('command-input');
  const command = input.value.trim();
  if (!command || !session.loggedIn || commandBusy) return;
  input.value = '';
  commandHistory.push(command); historyIndex = commandHistory.length;
  const verb = command.split(/\s+/)[0].toLowerCase();
  if (verb === 'clear') { $('command-output').replaceChildren(); return; }
  commandBusy = true;
  $('command-form').setAttribute('aria-busy', 'true');
  const row = document.createElement('div');
  const prompt = document.createElement('span'); prompt.className = 'green'; prompt.textContent = `❯ ${command}\n`;
  row.append(prompt);
  const output = document.createElement('span');
  try { switch (verb) {
    case 'help': output.textContent = isOwner()
      ? 'OVERVIEW\nbalance · whoami · status · ping · date · history · clear\n\nADMIN\ntickets       read the inbox\nclose <id>    close a ticket\nreopen <id>   reopen a ticket\nstats         ticket summary\nexport        download a balance snapshot\nlogout        return to guest\npanic         clear balances and end all sessions\n\nTab completes commands. ↑ ↓ browse history.'
      : 'OVERVIEW\nbalance · whoami · status · ping · date · history · clear\n\nGUEST\nticket <text>  compose a support ticket\nwelcome        show introduction\nlogin          owner sign-in\n\nTab completes commands. ↑ ↓ browse history.'; break;
    case 'status': {
      const response = await fetch('/api/balances');
      if (!response.ok) throw new Error('Server unavailable.');
      const result = await response.json(); applySession(result);
      output.textContent = `Server      online\nAccess      ${result.user.role}\nPayments    ${result.session.paymentsLocked ? 'locked' : 'available'}\nSession     ${result.session.loggedIn ? 'active' : 'terminated'}`;
      break;
    }
    case 'ping': {
      const started = performance.now();
      const response = await fetch('/api/balances');
      if (!response.ok) throw new Error('Server unavailable.');
      await response.json();
      output.textContent = `Local server responded in ${Math.round(performance.now() - started)} ms.`; break;
    }
    case 'date': output.textContent = new Date().toLocaleString(); break;
    case 'history': output.textContent = commandHistory.slice(-20).map((item, index) => `${Math.max(0, commandHistory.length - 20) + index + 1}  ${item}`).join('\n'); break;
    case 'export': {
      if (!isOwner()) throw new Error('Owner login required. Type login.');
      const response = await fetch('/api/balances');
      if (!response.ok) throw new Error('Could not read balances.');
      const result = await response.json();
      if (result.user.role !== 'owner' || !result.session.loggedIn) throw new Error('Active owner session required.');
      const file = new Blob([JSON.stringify({ at: new Date().toISOString(), balances: { HBTC: result.btc, ETH: result.eth } }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file), link = document.createElement('a');
      link.href = url; link.download = 'qernix-balances.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      output.textContent = 'Balance snapshot downloaded.'; break;
    }
    case 'balance': case 'balances':
      await syncBalances();
      output.textContent = session.loggedIn ? `${units.format(state.btc)} HBTC\n${units.format(state.eth)} ETH` : 'Logged out. Restart the Node server to log back in.'; break;
    case 'panic':
      if (!isOwner()) { output.textContent = 'Owner login required. Type login.'; output.className = 'red'; break; }
      try {
        const response = await fetch('/api/command', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: command.toLowerCase() }),
        });
        const result = await response.json();
        if (result.session) applySession(result);
        if (!response.ok) throw new Error(result.error || 'Command failed.');
        if (session.loggedIn && valid(result.btc) && valid(result.eth)) {
          state = { btc: result.btc, eth: result.eth }; render(true);
        }
        output.textContent = result.message;
        output.className = session.loggedIn && !session.paymentsLocked ? 'green' : 'red';
      } catch (error) { output.textContent = error.message; output.className = 'red'; }
      break;
    case 'welcome': openWelcome(); output.textContent = 'Opening welcome…'; break;
    case 'whoami': output.textContent = `${currentUser.username} [${isOwner() ? 'Co-Founder' : 'Guest'}]`; break;
    case 'login':
      if (isOwner()) { output.textContent = `Already signed in as ${currentUser.username}.`; break; }
      openLogin(); output.textContent = 'Opening owner login…'; break;
    case 'logout':
      if (!isOwner()) { output.textContent = 'Already signed in as guest.'; break; }
      try { await logout(); output.textContent = 'Signed out. You are now a guest.'; }
      catch (error) { output.textContent = error.message; output.className = 'red'; }
      break;
    case 'ticket': case 'support': {
      if (isOwner()) { output.textContent = 'You are the owner. Use tickets to read the inbox.'; break; }
      openTicket(command.replace(/^\S+\s*/, '')); output.textContent = 'Opening help ticket…'; break;
    }
    case 'stats': case 'tickets': {
      if (!isOwner()) { output.textContent = 'Owner login required. Type login.'; output.className = 'red'; break; }
      try {
        const response = await fetch('/api/tickets');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        output.textContent = verb === 'stats'
          ? `Tickets     ${result.tickets.length}\nOpen        ${result.tickets.filter(t => t.status === 'open').length}\nClosed      ${result.tickets.filter(t => t.status === 'closed').length}`
          : result.tickets.length
          ? result.tickets.map(ticket => `#${ticket.id.slice(0, 8)} [${ticket.status}] from ${ticket.from} — ${new Date(ticket.at).toLocaleString()}\n${ticket.message}`).join('\n\n')
          : 'No help tickets yet.';
        if (result.tickets.some(ticket => ticket.status === 'open')) output.className = 'amber';
      } catch (error) { output.textContent = error.message; output.className = 'red'; }
      break;
    }
    case 'reopen': case 'close': {
      if (!isOwner()) { output.textContent = 'Owner login required. Type login.'; output.className = 'red'; break; }
      const id = command.split(/\s+/)[1];
      if (!id) { output.textContent = `Usage: ${verb} <ticket id>`; output.className = 'red'; break; }
      try {
        const response = await fetch('/api/tickets', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: verb === 'reopen' ? 'open' : 'closed' }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        output.textContent = `Ticket #${id} ${verb === 'reopen' ? 'reopened' : 'closed'}.`; output.className = 'green';
      } catch (error) { output.textContent = error.message; output.className = 'red'; }
      break;
    }
    case 'edit': case 'u': {
      const opened = openEditor();
      output.textContent = opened ? 'Opening balance editor…' : 'Owner login required. Type login.';
      if (!opened) output.className = 'red';
      break;
    }
    default: output.textContent = `command not found: ${command}. Type help.`; output.className = 'red';
  }
  } catch (error) { output.textContent = error.message || 'Command failed.'; output.className = 'red'; }
  finally { commandBusy = false; $('command-form').removeAttribute('aria-busy'); }
  row.append(output); $('command-output').append(row);
  row.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'instant' : 'smooth' });
  while ($('command-output').children.length > 12) $('command-output').firstChild.remove();
});
$('command-input').addEventListener('keydown', event => {
  if (event.key === 'Tab' && event.target.value.trim()) {
    const matches = [...guestCommands, ...(isOwner() ? ownerCommands : [])].filter(cmd => cmd.startsWith(event.target.value.trim().toLowerCase()));
    if (matches.length) { event.preventDefault(); if (matches.length === 1) event.target.value = matches[0]; else showToast(matches.join(' · ')); }
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    historyIndex = Math.max(0, Math.min(commandHistory.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
    event.target.value = commandHistory[historyIndex] || '';
  }
  if (event.key === 'l' && event.ctrlKey) { event.preventDefault(); $('command-output').replaceChildren(); }
});

document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => {
  if (!session.loggedIn || commandBusy) return;
  $('actions-panel').open = true;
  $('command-input').value = button.dataset.command;
  $('command-form').requestSubmit();
}));
$('logout-open').addEventListener('click', async () => {
  try { await logout(); showToast('Signed out'); }
  catch (error) { showToast(error.message); }
});

