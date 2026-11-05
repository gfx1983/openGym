/* Sign-up by e-mail and the letters behind it (EMAIL_AUTH). Real server.js in a child, with a fake
   Resend in this process: what it receives is what a person would get in their inbox, so the links
   are read from the letters, as they would be. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const PASSWORD = 'long enough to pass 17';
const NEXT = 'another long one to pass 42';
const INVITE = 'CODE1234';
const TRAINER = 'u_trainer';

const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

async function fakeResend(t) {
  const letters = [];
  const state = { status: 200 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      if (state.status === 200) letters.push({ path: req.url, auth: req.headers.authorization, ...JSON.parse(body) });
      res.writeHead(state.status, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { letters, state, url: `http://127.0.0.1:${server.address().port}` };
}

async function startServer(t, env = {}, users = [], invites = []) {
  const mail = await fakeResend(t);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-email-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: TRAINER, name: 'Trainer', created: new Date().toISOString(), trainer: true }, ...users],
    creds: [], subs: [], invites: [{ code: INVITE, created: new Date().toISOString(), trainerId: TRAINER }, ...invites]
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', INVITE_ONLY: '1', PASSWORD_LOGIN: '1',
      EMAIL_AUTH: '1', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'openGym <noreply@example.com>', RESEND_API_BASE: mail.url, ...env
    }
  });
  t.after(async () => {
    const gone = new Promise(r => child.once('exit', r));
    child.kill('SIGKILL');
    await gone;
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const call = (method, url, { uid, body } = {}) => fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { ...(uid ? { Cookie: `gymsid=${mint(uid)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return {
    mail, dataDir, log: () => log, call,
    post: (url, body = {}, uid) => call('POST', url, { uid, body }),
    get: (url, uid) => call('GET', url, { uid }),
    db: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'))
  };
}

const signUp = (h, over = {}) => h.post('/api/register/password', { name: 'Client', email: 'client@example.com', password: PASSWORD, code: INVITE, ...over });
const signIn = (h, who = 'client@example.com', password = PASSWORD) => h.post('/api/login/password', { identifier: who, password });
const tokenIn = letter => decodeURIComponent(/[?&]token=([^\s"<]+)/.exec(letter.text)[1]);
const untilLetters = async (h, n) => {
  for (let i = 0; i < 100 && h.mail.letters.length < n; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(h.mail.letters.length, n, 'letters received');
};

test('a new profile signs in only after its letter, and the letter carries a fragment link', async t => {
  const h = await startServer(t);
  const res = await signUp(h);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('set-cookie'), null, 'no session before the address is proven');
  assert.deepEqual(await res.json(), { needsVerification: true });

  await untilLetters(h, 1);
  const [letter] = h.mail.letters;
  assert.equal(letter.path, '/emails');
  assert.equal(letter.auth, 'Bearer test-key');
  assert.deepEqual(letter.to, ['client@example.com']);
  assert.match(letter.text, /http:\/\/localhost:8080\/#\/verify-email\?token=/);

  const before = await signIn(h);
  assert.equal(before.status, 403);
  assert.equal((await before.json()).code, 'email-unverified');
  assert.equal(before.headers.get('set-cookie'), null);

  const token = tokenIn(letter);
  assert.ok(!JSON.stringify(h.db()).includes(token), 'only the hash is stored');
  assert.equal((await h.post('/api/email/verify', { token })).status, 200);
  assert.equal((await h.post('/api/email/verify', { token })).status, 400, 'single use');

  const after = await signIn(h);
  assert.equal(after.status, 200);
  assert.ok(after.headers.get('set-cookie'));
  const stored = h.db().users.find(u => u.name === 'Client');
  assert.equal(stored.pendingSince, undefined);
  assert.equal(stored.emailProven, 'client@example.com');
  assert.equal(stored.trainerId, TRAINER, 'the invite still links the client to their trainer');
  assert.ok(!h.log().includes(token), 'the link is not in the log');
});

test('the wrong password never learns that an address is waiting for its letter', async t => {
  const h = await startServer(t);
  await signUp(h);
  const res = await signIn(h, 'client@example.com', 'not the right password at all');
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'bad-credentials');
});

test('an address is required, and passkey sign-up is refused on the server', async t => {
  const h = await startServer(t);
  const none = await signUp(h, { email: undefined });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).code, 'email-required');

  for (const route of ['/api/register/options', '/api/register/verify']) {
    const res = await h.post(route, { name: 'Sneaky', code: INVITE });
    assert.equal(res.status, 403, route);
    assert.equal((await res.json()).code, 'email-required', route);
  }
  assert.ok(!h.db().invites[0].usedBy, 'the code is still unused');
  assert.equal((await (await h.get('/api/config')).json()).email_auth, true);
});

test('a letter that cannot be sent leaves nothing behind', async t => {
  const h = await startServer(t);
  h.mail.state.status = 500;
  const failed = await signUp(h);
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).code, 'mail-failed');
  assert.ok(!h.db().users.some(u => u.name === 'Client'));
  assert.ok(!h.db().invites[0].usedBy, 'the code works again');

  h.mail.state.status = 200;
  assert.equal((await signUp(h)).status, 200, 'the same name, address and code on the next try');
});

test('profiles from before this feature sign in as they did, by name and without an address', async t => {
  const hashed = await hashOf(PASSWORD);
  const h = await startServer(t, {}, [{ id: 'u_old', name: 'Old', created: new Date().toISOString(), pw: { h: hashed, set: new Date().toISOString() } }]);
  const res = await signIn(h, 'Old');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('set-cookie'));
});

test('asking for a reset changes nothing until the link is used, and says nothing about who exists', async t => {
  const h = await startServer(t);
  await signUp(h);
  await untilLetters(h, 1);
  await h.post('/api/email/verify', { token: tokenIn(h.mail.letters[0]) });

  const unknown = await h.post('/api/login/forgot', { email: 'nobody@example.com' });
  const known = await h.post('/api/login/forgot', { email: 'client@example.com' });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.deepEqual(await unknown.json(), await known.json());
  await untilLetters(h, 2);
  assert.deepEqual(h.mail.letters[1].to, ['client@example.com'], 'nothing went to the unknown address');
  assert.match(h.mail.letters[1].text, /#\/reset-password\?token=/);

  assert.equal((await signIn(h)).status, 200, 'the old password still works after the request');

  const token = tokenIn(h.mail.letters[1]);
  const weak = await h.post('/api/login/forgot/confirm', { token, next: 'short' });
  assert.equal(weak.status, 400);
  assert.equal((await signIn(h)).status, 200, 'a refused password leaves the old one');
  const bad = await h.post('/api/login/forgot/confirm', { token: 'made-up', next: NEXT });
  assert.equal((await bad.json()).code, 'email-token-invalid');

  const done = await h.post('/api/login/forgot/confirm', { token, next: NEXT });
  assert.equal(done.status, 200);
  assert.equal(done.headers.get('set-cookie'), null, 'the person signs in where they want to');
  assert.equal((await signIn(h)).status, 401, 'the old password is gone');
  assert.equal((await signIn(h, 'client@example.com', NEXT)).status, 200);
  assert.equal((await h.post('/api/login/forgot/confirm', { token, next: 'and a third long one 99' })).status, 400, 'single use');
});

test('a reset ends the sessions the old password had', async t => {
  const h = await startServer(t);
  await signUp(h);
  await untilLetters(h, 1);
  await h.post('/api/email/verify', { token: tokenIn(h.mail.letters[0]) });
  const uid = h.db().users.find(u => u.name === 'Client').id;
  assert.equal((await h.get('/api/me', uid)).status, 200);
  await h.post('/api/login/forgot', { email: 'client@example.com' });
  await untilLetters(h, 2);
  await h.post('/api/login/forgot/confirm', { token: tokenIn(h.mail.letters[1]), next: NEXT });
  assert.equal((await h.get('/api/me', uid)).status, 401);
});

test('an unproven address gets no reset letter: typing someone else\'s address does not reach them', async t => {
  const hashed = await hashOf(PASSWORD);
  const h = await startServer(t, {}, [{ id: 'u_old', name: 'Old', email: 'unproven@example.com', created: new Date().toISOString(), pw: { h: hashed, set: new Date().toISOString() } }]);
  assert.equal((await h.post('/api/login/forgot', { email: 'unproven@example.com' })).status, 200);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(h.mail.letters.length, 0);
});

test('a new address in Settings stays pending until its letter is answered', async t => {
  const hashed = await hashOf(PASSWORD);
  const h = await startServer(t, {}, [{ id: 'u_old', name: 'Old', created: new Date().toISOString(), pw: { h: hashed, set: new Date().toISOString() } }]);
  const res = await h.call('POST', '/api/account/email', { uid: 'u_old', body: { email: 'old@example.com', current: PASSWORD } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, email: null, pending: 'old@example.com' });
  assert.equal(h.db().users.find(u => u.id === 'u_old').email, undefined, 'not until the letter is answered');
  assert.equal((await signIn(h, 'old@example.com')).status, 401);

  const status = await (await h.get('/api/account/password', 'u_old')).json();
  assert.equal(status.emailPending, 'old@example.com');
  assert.equal(status.emailProven, false);

  await untilLetters(h, 1);
  assert.equal((await h.post('/api/email/verify', { token: tokenIn(h.mail.letters[0]) })).status, 200);
  assert.equal((await signIn(h, 'old@example.com')).status, 200);
  assert.equal((await (await h.get('/api/account/password', 'u_old')).json()).emailProven, true);
});

test('letters asked for without a session are limited per account and per address', async t => {
  const h = await startServer(t);
  await signUp(h);
  await untilLetters(h, 1);
  const answers = [];
  for (let i = 0; i < 11; i++) answers.push((await h.post('/api/email/resend', { email: 'client@example.com' })).status);
  assert.deepEqual(answers.slice(0, 10), Array(10).fill(200));
  assert.equal(answers[10], 429, 'the address is out of budget');
  await untilLetters(h, 4);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(h.mail.letters.length, 4, 'one for the sign-up, then three per account');
});

test('a profile that never answered is removed after a week and its code works again', async t => {
  const hashed = await hashOf(PASSWORD);
  const old = new Date(Date.now() - 8 * 86400000).toISOString();
  const fresh = new Date(Date.now() - 86400000).toISOString();
  const h = await startServer(t, {}, [
    { id: 'u_stale', name: 'Stale', email: 'stale@example.com', created: old, pendingSince: old, invitedBy: 'USED', pw: { h: hashed, set: old } },
    { id: 'u_fresh', name: 'Fresh', email: 'fresh@example.com', created: fresh, pendingSince: fresh, pw: { h: hashed, set: fresh } }
  ], [{ code: 'USED', created: old, usedBy: 'u_stale', usedAt: old }, { code: 'KEPT', created: fresh, usedBy: 'u_fresh', usedAt: fresh }]);
  for (let i = 0; i < 100 && h.db().users.some(u => u.id === 'u_stale'); i++) await new Promise(r => setTimeout(r, 20));
  const names = h.db().users.map(u => u.name);
  assert.ok(!names.includes('Stale'));
  assert.ok(names.includes('Fresh'));
  const invites = h.db().invites;
  assert.equal(invites.find(i => i.code === 'USED').usedBy, undefined, 'the code works again');
  assert.equal(invites.find(i => i.code === 'KEPT').usedBy, 'u_fresh');
});

test('a trainer does not see a client who has not answered the letter yet', async t => {
  const h = await startServer(t);
  await signUp(h);
  await untilLetters(h, 1);
  assert.deepEqual((await (await h.get('/api/trainer/clients', TRAINER)).json()).clients, []);
  await h.post('/api/email/verify', { token: tokenIn(h.mail.letters[0]) });
  assert.equal((await (await h.get('/api/trainer/clients', TRAINER)).json()).clients.length, 1);
});

const codeIn = letter => /#\/invite\?code=([0-9A-F]+)/.exec(letter.text)[1];
const invite = (h, email = 'new@example.com', uid = TRAINER) => h.post('/api/trainer/invites/send', { email }, uid);

test('a trainer sends a code by letter, and whoever signs up with it becomes their client', async t => {
  const h = await startServer(t);
  const res = await invite(h);
  assert.equal(res.status, 200);
  const { invite: sent } = await res.json();
  await untilLetters(h, 1);
  const [letter] = h.mail.letters;
  assert.deepEqual(letter.to, ['new@example.com']);
  assert.equal(codeIn(letter), sent.code);
  assert.match(letter.text, /Trainer приглашает/);

  const listed = (await (await h.get('/api/trainer/invites', TRAINER)).json()).invites;
  assert.equal(listed.find(i => i.code === sent.code).sentTo, 'new@example.com');

  assert.equal((await signUp(h, { email: 'new@example.com', code: sent.code })).status, 200);
  await untilLetters(h, 2);
  await h.post('/api/email/verify', { token: tokenIn(h.mail.letters[1]) });
  const { clients } = await (await h.get('/api/trainer/clients', TRAINER)).json();
  assert.equal(clients.length, 1);
  const used = h.db().invites.find(i => i.code === sent.code);
  assert.ok(used.usedBy);
  assert.equal(used.sentTo, undefined, 'the address does not outlive the code');
  assert.ok(!h.log().includes('new@example.com'), 'the address stays out of the log');
});

test('only a trainer can send an invitation', async t => {
  const h = await startServer(t, {}, [{ id: 'u_other', name: 'Other', created: new Date().toISOString() }]);
  assert.equal((await h.post('/api/trainer/invites/send', { email: 'new@example.com' })).status, 401);
  assert.equal((await invite(h, 'new@example.com', 'u_other')).status, 403);
  assert.equal(h.mail.letters.length, 0);
});

test('an invitation answers plainly for a bad or a taken address and sends nothing', async t => {
  const h = await startServer(t, {}, [{ id: 'u_x', name: 'X', created: new Date().toISOString(), email: 'taken@example.com' }]);
  const before = h.db().invites.length;
  const bad = await invite(h, 'not an address');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'email-invalid');
  const taken = await invite(h, 'taken@example.com');
  assert.equal(taken.status, 409);
  assert.equal((await taken.json()).code, 'email-taken');
  assert.equal(h.mail.letters.length, 0);
  assert.equal(h.db().invites.length, before);
});

test('asking again for one address sends the same code, and only so many times', async t => {
  const h = await startServer(t);
  const first = (await (await invite(h)).json()).invite.code;
  assert.equal((await (await invite(h, 'NEW@example.com')).json()).invite.code, first);
  assert.equal((await invite(h)).status, 200);
  assert.equal((await invite(h)).status, 429);
  assert.equal(h.mail.letters.length, 3);
  assert.equal(h.db().invites.filter(i => i.sentTo).length, 1);
});

test('a trainer can send only so many invitations in an hour', async t => {
  const h = await startServer(t);
  for (let i = 0; i < 20; i++) assert.equal((await invite(h, `a${i}@example.com`)).status, 200);
  assert.equal((await invite(h, 'one-more@example.com')).status, 429);
  assert.equal(h.mail.letters.length, 20);
});

test('an invitation that cannot be sent leaves no new code, and an earlier one stays', async t => {
  const h = await startServer(t);
  const before = h.db().invites.length;
  h.mail.state.status = 500;
  const res = await invite(h, 'first@example.com');
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'mail-failed');
  assert.equal(h.db().invites.length, before);
  h.mail.state.status = 200;
  const { code } = (await (await invite(h, 'second@example.com')).json()).invite;
  h.mail.state.status = 500;
  assert.equal((await invite(h, 'second@example.com')).status, 502);
  assert.ok(h.db().invites.some(i => i.code === code), 'the code in the letter already sent still works');
});

test('a trainer\'s name cannot put markup into the letter', async t => {
  const h = await startServer(t, {}, [{ id: 'u_t2', name: '<a href="http://evil">Max</a>', created: new Date().toISOString(), trainer: true }]);
  assert.equal((await invite(h, 'new@example.com', 'u_t2')).status, 200);
  await untilLetters(h, 1);
  assert.ok(!h.mail.letters[0].html.includes('<a href="http://evil"'));
  assert.ok(h.mail.letters[0].html.includes('&lt;a href='));
});

test('a half-configured server stays as it was: no key, no e-mail routes and no gate', async t => {
  const h = await startServer(t, { RESEND_API_KEY: '' });
  assert.equal((await h.post('/api/login/forgot', { email: 'a@example.com' })).status, 404);
  assert.equal((await h.post('/api/trainer/invites/send', { email: 'a@example.com' }, TRAINER)).status, 404);
  assert.equal((await (await h.get('/api/config')).json()).email_auth, undefined);
  const res = await signUp(h, { email: undefined });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('set-cookie'));
});

async function hashOf(password) {
  const { hashPassword } = await import('../password.js');
  return hashPassword(password);
}
