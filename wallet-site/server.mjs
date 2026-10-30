import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const port = Number(process.env.PORT || 3000);
const dataFile = process.env.WALLET_DATA_FILE || path.join(process.env.APPDATA || '.', 'ExodusCopy', 'site-wallet.json');
const ticketsFile = process.env.WALLET_TICKETS_FILE || path.join(path.dirname(dataFile), 'site-tickets.json');
const users = new Map([
  ['flku', { password: '12345', role: 'owner' }],
]);
const sessions = new Map();
const panic = { active: false };
let wallet = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : { btc: '500000000', eth: '500000000', transfers: {} };
let tickets = existsSync(ticketsFile) ? JSON.parse(readFileSync(ticketsFile, 'utf8')) : [];

function save(next) {
  mkdirSync(path.dirname(dataFile), { recursive: true });
  writeFileSync(dataFile + '.tmp', JSON.stringify(next));
  renameSync(dataFile + '.tmp', dataFile);
  wallet = next;
}
function saveTickets(next) {
  mkdirSync(path.dirname(ticketsFile), { recursive: true });
  writeFileSync(ticketsFile + '.tmp', JSON.stringify(next));
  renameSync(ticketsFile + '.tmp', ticketsFile);
  tickets = next;
}
function units(value) {
  const text = String(value);
  if (!/^\d{1,13}(\.\d{1,8})?$/.test(text)) throw new Error('Enter a positive amount with up to 8 decimal places.');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
}
function balances() { return { btc: Number(wallet.btc) / 1e8, eth: Number(wallet.eth) / 1e8 }; }
function snapshot(user) {
  return {
    session: { loggedIn: !panic.active, paymentsLocked: panic.active },
    user: { username: user.username, role: user.role },
    panicEvent: wallet.panicEvent || null,
    ...(panic.active ? {} : balances()),
  };
}
function blocked() {
  if (!panic.active) return null;
  return 'Logged out. All actions are disabled until the Node server restarts.';
}
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}
function attachSession(res, user) {
  const token = randomUUID();
  sessions.set(token, user);
  res.setHeader('Set-Cookie', `qernix_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  return user;
}
function currentUser(req, res) {
  const token = readCookie(req, 'qernix_session');
  if (token && sessions.has(token)) return sessions.get(token);
  return attachSession(res, { username: 'guest', role: 'guest' });
}
const isOwner = user => user.role === 'owner';
function ticketView(ticket) {
  return { id: ticket.id, from: ticket.from, at: ticket.at, status: ticket.status, message: ticket.message };
}
async function api(req, res, endpoint) {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host) || (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin))) return json(res, 403, { error: 'Local requests only.' });
  const user = currentUser(req, res);
  if (endpoint === '/api/balances' && req.method === 'GET') return json(res, 200, snapshot(user));
  if (endpoint === '/api/tickets' && req.method === 'GET') {
    const reason = blocked(endpoint);
    if (reason) return json(res, 403, { error: reason, session: { ...snapshot(user).session }, user: snapshot(user).user });
    if (!isOwner(user)) return json(res, 403, { error: 'Owner login required.', user: snapshot(user).user });
    return json(res, 200, { tickets: tickets.map(ticketView).sort((a, b) => b.at.localeCompare(a.at)) });
  }
  if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !req.headers['content-type']?.startsWith('application/json')) return json(res, 400, { error: 'Expected JSON.' });
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('Request too large.'); }
    const input = JSON.parse(body);
    if (endpoint === '/api/login' && req.method === 'POST') {
      if (panic.active) return json(res, 403, { error: 'Lockdown active. Restart the Node server to log back in.', session: { ...snapshot(user).session } });
      const account = users.get(String(input.username || ''));
      if (!account || account.password !== String(input.password || '')) return json(res, 401, { error: 'Invalid username or password.', user: snapshot(user).user });
      const token = readCookie(req, 'qernix_session');
      if (token) sessions.delete(token);
      return json(res, 200, snapshot(attachSession(res, { username: String(input.username), role: account.role })));
    }
    if (endpoint === '/api/logout' && req.method === 'POST') {
      const reason = blocked(endpoint);
      if (reason) return json(res, 403, { error: reason, session: { ...snapshot(user).session } });
      const token = readCookie(req, 'qernix_session');
      if (token) sessions.delete(token);
      return json(res, 200, snapshot(attachSession(res, { username: 'guest', role: 'guest' })));
    }
    const reason = blocked(endpoint);
    if (reason) return json(res, 403, { error: reason, session: { ...snapshot(user).session } });
    if (endpoint === '/api/command' && req.method === 'POST') {
      if (!isOwner(user)) return json(res, 403, { error: 'Owner login required.', user: snapshot(user).user });
      if (input.command === 'panic') {
        const cleared = structuredClone(wallet);
        cleared.panicEvent = { id: randomUUID(), at: new Date().toISOString() };
        cleared.btc = '0'; cleared.eth = '0';
        // Do not allow a late refund to restore balances after an emergency flush.
        for (const transfer of Object.values(cleared.transfers)) transfer.refunded = true;
        save(cleared);
        panic.active = true;
        return json(res, 200, { ...snapshot(user), message: 'PANIC — balances cleared, payments disabled, session terminated.' });
      }
      return json(res, 400, { error: 'Unknown command.' });
    }
    if (endpoint === '/api/tickets' && req.method === 'POST') {
      const message = String(input.message || '').trim();
      if (!message || message.length > 1000) throw new Error('Ticket message must be 1-1000 characters.');
      const ticket = { id: randomUUID(), from: user.username, at: new Date().toISOString(), status: 'open', message };
      saveTickets([...tickets, ticket]);
      return json(res, 201, { ticket: ticketView(ticket), message: 'Help ticket sent to the owners.' });
    }
    if (endpoint === '/api/tickets' && req.method === 'PATCH') {
      if (!isOwner(user)) return json(res, 403, { error: 'Owner login required.', user: snapshot(user).user });
      const match = tickets.find(ticket => ticket.id === input.id || ticket.id.startsWith(String(input.id || '')));
      if (!match) throw new Error('Unknown ticket.');
      if (!['open', 'closed'].includes(input.status)) throw new Error('Ticket status must be open or closed.');
      saveTickets(tickets.map(ticket => ticket.id === match.id ? { ...ticket, status: input.status } : ticket));
      return json(res, 200, { tickets: tickets.map(ticketView).sort((a, b) => b.at.localeCompare(a.at)) });
    }
    if (endpoint === '/api/balances' && req.method === 'PUT') {
      if (!isOwner(user)) return json(res, 403, { error: 'Owner login required.', user: snapshot(user).user });
      const next = structuredClone(wallet);
      next.btc = units(input.btc).toString(); next.eth = units(input.eth).toString();
      save(next); return json(res, 200, snapshot(user));
    }
    const next = structuredClone(wallet);
    if (endpoint === '/api/reserve' && req.method === 'POST') {
      if (!['btc', 'eth'].includes(input.coin) || !/^[a-f0-9]{64}$/.test(input.id)) throw new Error('Invalid transfer.');
      const amount = units(input.amount);
      if (amount <= 0n) throw new Error('Amount must be greater than zero.');
      if (next.transfers[input.id]) throw new Error('Transfer already recorded.');
      if (BigInt(next[input.coin]) < amount) return json(res, 409, { error: 'qernix aint that rich lil bro' });
      next[input.coin] = (BigInt(next[input.coin]) - amount).toString();
      next.transfers[input.id] = { coin: input.coin, amount: amount.toString(), refunded: false };
    } else if (endpoint === '/api/refund' && req.method === 'POST') {
      const transfer = next.transfers[input.id];
      if (!transfer) throw new Error('Unknown transfer.');
      if (!transfer.refunded) { next[transfer.coin] = (BigInt(next[transfer.coin]) + BigInt(transfer.amount)).toString(); transfer.refunded = true; }
    } else return json(res, 404, { error: 'Unknown endpoint.' });
    save(next); json(res, 200, snapshot(user));
  } catch (error) { json(res, 400, { error: error.message }); }
}
const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/logout.css', ['logout.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
]);
const server = http.createServer(async (req, res) => {
  const endpoint = new URL(req.url, 'http://localhost').pathname;
  if (endpoint.startsWith('/api/')) return api(req, res, endpoint);
  const route = routes.get(endpoint);
  if (!route || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    const body = await readFile(new URL(`public/${route[0]}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500); res.end('Could not load dashboard');
  }
});
server.on('error', error => { console.error(`Cannot start dashboard: ${error.message}`); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(`Qernix dashboard: http://127.0.0.1:${port}`));
