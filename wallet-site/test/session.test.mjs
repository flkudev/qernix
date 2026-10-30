import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import net from 'node:net';

test('guest access, owner login, help tickets and panic lockdown', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qernix-session-test-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let child;
  let cookie = '';
  async function start() {
    child = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')], {
      env: { ...process.env, PORT: String(port), WALLET_DATA_FILE: path.join(directory, 'wallet.json'), WALLET_TICKETS_FILE: path.join(directory, 'tickets.json') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Server exited: ${code}`)));
      child.stdout.once('data', resolve);
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  async function request(endpoint, body, method = 'POST') {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
      method: body === undefined ? 'GET' : method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { code: response.status, body: await response.json() };
  }
  try {
    await start();
    const guest = (await request('/api/balances')).body;
    assert.equal(guest.session.loggedIn, true);
    assert.equal(guest.user.role, 'guest');
    assert.equal(guest.btc, 5);

    assert.equal((await request('/api/balances', { btc: '5', eth: '5' }, 'PUT')).code, 403);
    const guestPanic = await request('/api/command', { command: 'panic' });
    assert.equal(guestPanic.code, 403);
    assert.match(guestPanic.body.error, /Owner login required/);

    const ticket = await request('/api/tickets', { message: 'Please send help, the terminal is haunted.' });
    assert.equal(ticket.code, 201);
    assert.equal(ticket.body.ticket.from, 'guest');
    assert.equal(ticket.body.ticket.status, 'open');
    assert.equal((await request('/api/tickets')).code, 403);

    const login = await request('/api/login', { username: 'flku', password: '12345' });
    assert.equal(login.code, 200);
    assert.deepEqual(login.body.user, { username: 'flku', role: 'owner' });
    assert.equal(login.body.session.loggedIn, true);
    assert.equal((await request('/api/login', { username: 'flku', password: 'wrong' })).code, 401);

    const inbox = await request('/api/tickets');
    assert.equal(inbox.code, 200);
    assert.equal(inbox.body.tickets.length, 1);
    assert.match(inbox.body.tickets[0].id, /^[a-f0-9-]{36}$/);
    const closed = await request('/api/tickets', { id: inbox.body.tickets[0].id.slice(0, 8), status: 'closed' }, 'PATCH');
    assert.equal(closed.code, 200);
    assert.equal(closed.body.tickets[0].status, 'closed');

    assert.equal((await request('/api/balances', { btc: '100', eth: '100' }, 'PUT')).body.btc, 100);
    assert.equal((await request('/api/balances', { btc: '5', eth: '5' }, 'PUT')).body.btc, 5);
    const id = 'a'.repeat(64);
    assert.equal((await request('/api/reserve', { id, coin: 'btc', amount: '2' })).body.btc, 3);
    for (const command of ['lockdown', 'flush', 'logall']) {
      assert.equal((await request('/api/command', { command })).code, 400);
    }
    const panic = await request('/api/command', { command: 'panic' });
    assert.equal(panic.body.session.paymentsLocked, true);
    assert.equal(panic.body.session.loggedIn, false);
    assert.match(panic.body.panicEvent.id, /^[a-f0-9-]{36}$/);
    const locked = await request('/api/reserve', { id: 'b'.repeat(64), coin: 'eth', amount: '1' });
    assert.equal(locked.code, 403);
    assert.match(locked.body.error, /Logged out/);
    for (const [endpoint, payload, method] of [
      ['/api/balances', { btc: '5', eth: '5' }, 'PUT'],
      ['/api/reserve', { id: 'c'.repeat(64), coin: 'btc', amount: '1' }],
      ['/api/command', { command: 'flush' }],
      ['/api/command', { command: 'lockdown' }],
      ['/api/refund', { id }],
      ['/api/tickets', { message: 'hello' }],
    ]) {
      const denied = await request(endpoint, payload, method);
      assert.equal(denied.code, 403);
      assert.match(denied.body.error, /Logged out/);
    }
    assert.equal((await request('/api/login', { username: 'flku', password: '12345' })).code, 403);
    const loggedOut = (await request('/api/balances')).body;
    assert.equal(loggedOut.session.loggedIn, false);
    assert.equal(loggedOut.btc, undefined);
    await stop();
    await start();
    const restarted = (await request('/api/balances')).body;
    assert.deepEqual(restarted.session, { loggedIn: true, paymentsLocked: false });
    assert.equal(restarted.user.role, 'guest');
    assert.equal(restarted.btc, 0);
    assert.equal(restarted.eth, 0);
    assert.equal(restarted.panicEvent.id, panic.body.panicEvent.id);
    assert.equal((await request('/api/refund', { id })).body.btc, 0);
    assert.equal((await request('/api/login', { username: 'flku', password: '12345' })).code, 200);
    assert.equal((await request('/api/tickets')).body.tickets[0].status, 'closed');
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
