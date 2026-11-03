/* The trainer role and who may use the Assistant. Real server.js in a child, with the fixture
   Coach provider, which counts as connected: without one every profile would be refused the
   Assistant and the refusals below would prove nothing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN = 'u_admin', TRAINER = 'u_trainer', OTHER = 'u_other_trainer', CLIENT = 'u_client', PLAIN = 'u_plain';

const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-trainer-'));
  const created = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Admin', created, admin: true },
      { id: TRAINER, name: 'Trainer', created, trainer: true },
      { id: OTHER, name: 'Other', created, trainer: true },
      { id: CLIENT, name: 'Client', created, trainerId: TRAINER },
      { id: PLAIN, name: 'Plain', created }
    ], creds: [], subs: [], invites: []
  }));
  fs.writeFileSync(path.join(dataDir, 'coach.json'), JSON.stringify({ enabled: true, provider: 'fixture' }));
  const { ASSISTANT_FOR_ALL, ...inherited } = process.env;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...inherited, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', INVITE_ONLY: '1', PASSWORD_LOGIN: '1', ...env }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const call = (method, url, uid, body) => fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { ...(uid ? { Cookie: `gymsid=${mint(uid)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { call, get: (url, uid) => call('GET', url, uid), post: (url, uid, body = {}) => call('POST', url, uid, body) };
}

const signUp = (h, name, code) => h.post('/api/register/password', null, { name, code, password: 'long enough to pass 17' });

test('the Assistant answers the admin and a trainer, and looks absent to everyone else', async t => {
  const h = await startServer(t);
  for (const uid of [ADMIN, TRAINER]) {
    assert.equal((await (await h.get('/api/config', uid)).json()).coach?.enabled, true, `config for ${uid}`);
    for (const url of ['/api/coach/status', '/api/coach/disclosure', '/api/coach/account']) {
      assert.equal((await h.get(url, uid)).status, 200, `${url} for ${uid}`);
    }
  }
  for (const uid of [CLIENT, PLAIN]) {
    const config = await (await h.get('/api/config', uid)).json();
    assert.ok('coach' in config, 'the key still marks an answer made for a session');
    assert.equal(config.coach, null, `config for ${uid}`);
    const refused = [
      ['GET', '/api/coach/status'], ['GET', '/api/coach/disclosure'], ['GET', '/api/coach/account'], ['GET', '/api/coach/cohort'],
      ['POST', '/api/coach/plan'], ['POST', '/api/coach/review'], ['POST', '/api/coach/debrief'], ['POST', '/api/coach/ask'],
      ['POST', '/api/coach/cohort/share'], ['POST', '/api/coach/pending/resolve']
    ];
    for (const [method, url] of refused) {
      const r = await h.call(method, url, uid, method === 'POST' ? {} : undefined);
      assert.equal(r.status, 503, `${method} ${url} for ${uid}`);
      assert.equal((await r.json()).code, 'off', `${method} ${url} for ${uid}`);
    }
    assert.equal((await h.post('/api/coach/forget', uid)).status, 200, 'dropping what is held is never refused');
  }
});

test('ASSISTANT_FOR_ALL=1 restores the upstream behaviour', async t => {
  const h = await startServer(t, { ASSISTANT_FOR_ALL: '1' });
  assert.equal((await (await h.get('/api/config', PLAIN)).json()).coach?.enabled, true);
  assert.equal((await h.get('/api/coach/status', PLAIN)).status, 200);
});

test('a trainer code links the new profile to that trainer; an admin code does not', async t => {
  const h = await startServer(t);
  const { invite } = await (await h.post('/api/trainer/invites/new', TRAINER, { note: 'gym friend' })).json();
  assert.equal(invite.trainerId, TRAINER);
  assert.deepEqual((await (await h.get('/api/trainer/invites', TRAINER)).json()).invites.map(i => i.code), [invite.code]);
  assert.deepEqual((await (await h.get('/api/trainer/invites', OTHER)).json()).invites, [], 'another trainer sees none of it');

  const client = await (await signUp(h, 'New client', invite.code)).json();
  assert.ok(client.user?.id, 'signed up');
  const names = (await (await h.get('/api/trainer/clients', TRAINER)).json()).clients.map(c => c.name).sort();
  assert.deepEqual(names, ['Client', 'New client']);
  assert.deepEqual((await (await h.get('/api/trainer/clients', OTHER)).json()).clients, []);
  assert.equal((await (await h.get('/api/config', client.user.id)).json()).coach, null, 'a new client has no Assistant');

  const adminCode = (await (await h.post('/api/admin/invites/new', ADMIN)).json()).invite.code;
  await signUp(h, 'Admin invited', adminCode);
  const after = (await (await h.get('/api/trainer/clients', TRAINER)).json()).clients.map(c => c.name);
  assert.equal(after.includes('Admin invited'), false);
  assert.equal(after.length, 2);
});

test('the trainer routes refuse everyone who is not a trainer, the admin included', async t => {
  const h = await startServer(t);
  for (const [method, url] of [['GET', '/api/trainer/clients'], ['GET', '/api/trainer/invites'], ['POST', '/api/trainer/invites/new'], ['POST', '/api/trainer/invites/revoke']]) {
    const body = method === 'POST' ? {} : undefined;
    assert.equal((await h.call(method, url, null, body)).status, 401, `${url} anonymous`);
    for (const uid of [CLIENT, PLAIN, ADMIN]) assert.equal((await h.call(method, url, uid, body)).status, 403, `${url} for ${uid}`);
  }
});

test('a trainer gets none of the admin routes', async t => {
  const h = await startServer(t);
  for (const url of ['/api/admin/users', '/api/admin/invites', '/api/admin/audit', '/api/admin/coach']) {
    assert.equal((await h.get(url, TRAINER)).status, 403, url);
  }
  assert.equal((await h.get(`/api/admin/user?id=${CLIENT}`, TRAINER)).status, 403);
  for (const url of ['/api/admin/invites/new', '/api/admin/user/trainer', '/api/admin/user/delete', '/api/admin/user/recovery']) {
    assert.equal((await h.post(url, TRAINER, { id: CLIENT, trainer: true })).status, 403, url);
  }
});

test('a trainer revokes only their own unused codes', async t => {
  const h = await startServer(t);
  const { invite } = await (await h.post('/api/trainer/invites/new', TRAINER)).json();
  assert.equal((await h.post('/api/trainer/invites/revoke', OTHER, { code: invite.code })).status, 404);
  assert.equal((await h.post('/api/trainer/invites/revoke', TRAINER, { code: invite.code })).status, 200);
  assert.equal((await signUp(h, 'Too late', invite.code)).status, 403, 'a revoked code signs nobody up');

  const used = (await (await h.post('/api/trainer/invites/new', TRAINER)).json()).invite;
  await signUp(h, 'In time', used.code);
  assert.equal((await h.post('/api/trainer/invites/revoke', TRAINER, { code: used.code })).status, 400);
});

test('only an admin appoints a trainer, and removing the role closes everything it opened', async t => {
  const h = await startServer(t);
  assert.equal((await h.post('/api/admin/user/trainer', PLAIN, { id: PLAIN, trainer: true })).status, 403, 'nobody appoints themselves');
  assert.equal((await h.post('/api/admin/user/trainer', ADMIN, { id: PLAIN, trainer: 'yes' })).status, 400);

  assert.equal((await h.post('/api/admin/user/trainer', ADMIN, { id: PLAIN, trainer: true })).status, 200);
  assert.equal((await (await h.get('/api/me', PLAIN)).json()).user.trainer, true);
  assert.equal((await h.get('/api/coach/status', PLAIN)).status, 200, 'a new trainer gets the Assistant');

  const pending = (await (await h.post('/api/trainer/invites/new', TRAINER)).json()).invite;
  assert.equal((await h.post('/api/admin/user/trainer', ADMIN, { id: TRAINER, trainer: false })).status, 200);
  assert.equal((await h.get('/api/trainer/clients', TRAINER)).status, 403);
  assert.equal((await h.get('/api/coach/status', TRAINER)).status, 503, 'the Assistant goes with the role');
  assert.equal((await signUp(h, 'Late', pending.code)).status, 403, 'their unused code stopped working');

  // Granting it again must not hand back the old clients.
  await h.post('/api/admin/user/trainer', ADMIN, { id: TRAINER, trainer: true });
  assert.deepEqual((await (await h.get('/api/trainer/clients', TRAINER)).json()).clients, []);
});

test('deleting a trainer unlinks their clients and voids their unused codes', async t => {
  const h = await startServer(t);
  const { invite } = await (await h.post('/api/trainer/invites/new', TRAINER)).json();
  assert.equal((await h.post('/api/admin/user/delete', ADMIN, { id: TRAINER })).status, 200);
  assert.equal((await signUp(h, 'Late', invite.code)).status, 403);
  const users = (await (await h.get('/api/admin/users', ADMIN)).json()).users;
  assert.equal(users.find(u => u.id === CLIENT).trainerId, null);
});
