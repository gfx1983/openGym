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
  return { dataDir, call, get: (url, uid) => call('GET', url, uid), post: (url, uid, body = {}) => call('POST', url, uid, body) };
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

const CLIENT_STATE = {
  unit: 'kg',
  workouts: [{ id: 'w1', d: '2026-11-01', name: 'Legs', entries: [], media: ['secret-photo'] }, { id: 'w2', d: '2026-11-02', name: 'Back', entries: [] }],
  bodyweight: [{ d: '2026-11-01', w: 60 }],
  measurements: [{ d: '2026-11-01', waist: 70 }],
  routines: [{ id: 'r1', name: 'Legs', ex: [{ id: 'squat', sets: 3, reps: 10 }] }],
  week: { 1: ['r1'] },
  coach: { chat: [{ text: 'private chat with the Assistant' }] },
  exNotes: { squat: 'private note' }
};

test('a trainer reads their own client and nobody else, and gets only what the page shows', async t => {
  const h = await startServer(t);
  const url = id => `/api/trainer/client?id=${encodeURIComponent(id)}`;
  // The client saves their own data the way a device does.
  assert.equal((await h.call('PUT', '/api/data', CLIENT, { state: CLIENT_STATE })).status, 200);

  const r = await h.get(url(CLIENT), TRAINER);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(d.workouts.map(w => w.id), ['w2', 'w1'], 'newest first');
  assert.equal(d.workouts[1].media, undefined, 'photos and videos stay the owner\'s');
  assert.equal(d.bodyweight.length, 1);
  assert.equal(d.measurements[0].waist, 70);
  assert.equal(d.routines[0].ex[0].id, 'squat');
  assert.deepEqual(d.week, { 1: ['r1'] });
  const raw = JSON.stringify(d);
  assert.equal(raw.includes('private chat'), false, 'the Assistant chat is not the trainer\'s');
  assert.equal(raw.includes('private note'), false);
  assert.equal(raw.includes('passkey') || raw.includes('"pw"') || raw.includes('email'), false);

  assert.equal((await h.get(url(CLIENT), OTHER)).status, 404, 'another trainer');
  assert.equal((await h.get(url(PLAIN), TRAINER)).status, 404, 'someone who is not a client');
  assert.equal((await h.get(url(ADMIN), TRAINER)).status, 404, 'the admin');
  assert.equal((await h.get(url('nobody'), TRAINER)).status, 404);
  assert.equal((await h.get(url(CLIENT), ADMIN)).status, 403, 'an admin uses the admin page');
  assert.equal((await h.get(url(CLIENT), CLIENT)).status, 403, 'a client');
  assert.equal((await h.get(url(CLIENT), null)).status, 401);
});

test('a client sees who their trainer is and can leave, which ends the access at once', async t => {
  const h = await startServer(t);
  assert.deepEqual(await (await h.get('/api/account/trainer', CLIENT)).json(), { trainer: { id: TRAINER, name: 'Trainer' }, plan: null });
  assert.deepEqual(await (await h.get('/api/account/trainer', PLAIN)).json(), { trainer: null, plan: null });
  assert.equal((await h.get('/api/account/trainer', null)).status, 401);
  assert.equal((await h.post('/api/account/trainer/unlink', null)).status, 401);

  assert.equal((await h.get(`/api/trainer/client?id=${CLIENT}`, TRAINER)).status, 200);
  assert.equal((await h.post('/api/account/trainer/unlink', CLIENT)).status, 200);
  assert.deepEqual(await (await h.get('/api/account/trainer', CLIENT)).json(), { trainer: null, plan: null });
  assert.equal((await h.get(`/api/trainer/client?id=${CLIENT}`, TRAINER)).status, 404);
  assert.deepEqual((await (await h.get('/api/trainer/clients', TRAINER)).json()).clients, []);
  assert.equal((await h.post('/api/account/trainer/unlink', CLIENT)).status, 200, 'leaving twice is not an error');
});

const PLAN = { opengym_plan: 1, unit: 'kg', week: {}, routines: [{ id: 'tr', name: 'Push', ex: [{ id: 'squat', sets: 3, reps: 8 }] }], customEx: [] };
const sendPlan = (h, uid = TRAINER, extra = {}) => h.post('/api/trainer/client/plan', uid, { id: CLIENT, bundle: PLAN, note: 'hi', ...extra });
const waiting = async h => (await (await h.get('/api/account/trainer', CLIENT)).json()).plan;

test('a trainer can send only their own client a plan, and only a plan', async t => {
  const h = await startServer(t);
  assert.equal((await sendPlan(h, OTHER)).status, 404, 'another trainer');
  assert.equal((await h.post('/api/trainer/client/plan', TRAINER, { id: PLAIN, bundle: PLAN })).status, 404, 'not a client');
  assert.equal((await sendPlan(h, ADMIN)).status, 403);
  assert.equal((await sendPlan(h, CLIENT)).status, 403);
  assert.equal((await sendPlan(h, null)).status, 401);
  assert.equal(await waiting(h), null, 'nothing got through');
  for (const bundle of [undefined, [], { routines: [] }, { opengym_plan: 1, routines: 'x' }]) {
    assert.equal((await h.post('/api/trainer/client/plan', TRAINER, { id: CLIENT, bundle })).status, 400);
  }
  assert.equal((await h.post('/api/trainer/client/plan', TRAINER, { id: CLIENT, bundle: { opengym_plan: 1, routines: [] } })).status, 400, 'nothing to send');
  assert.equal((await sendPlan(h, TRAINER, { removed: 'x' })).status, 400);
  assert.equal((await sendPlan(h, TRAINER, { note: 'x'.repeat(300 * 1024) })).status, 400, 'too large');
  assert.equal(await waiting(h), null);
});

test('a plan waits for the client, says what became of it, and never touches the state file', async t => {
  const h = await startServer(t);
  const sent = await (await sendPlan(h)).json();
  assert.equal(sent.plan.status, 'pending');
  const plan = await waiting(h);
  assert.equal(plan.id, sent.plan.id);
  assert.equal(plan.note, 'hi');
  assert.deepEqual(plan.bundle, PLAN);
  assert.equal((await (await h.get('/api/account/trainer', PLAIN)).json()).plan, null);
  const seen = await (await h.get(`/api/trainer/client?id=${CLIENT}`, TRAINER)).json();
  assert.equal(seen.plan.status, 'pending');
  assert.deepEqual(seen.plan.routines, ['Push']);
  assert.equal(seen.plan.bundle, undefined);
  assert.deepEqual((await (await h.get('/api/data', CLIENT)).json()).routines ?? [], [], 'the server wrote nothing into the profile');

  const resolve = (decision, id = plan.id, uid = CLIENT) => h.post('/api/account/trainer/plan/resolve', uid, { id, decision });
  assert.equal((await resolve('maybe')).status, 400);
  assert.equal((await resolve('undone')).status, 409, 'nothing was applied yet');
  assert.equal((await resolve('applied', 'old id')).status, 409);
  assert.equal((await resolve('applied', plan.id, PLAIN)).status, 409, 'someone else cannot settle it');
  assert.equal((await resolve('applied', plan.id, null)).status, 401);
  assert.equal((await resolve('applied')).status, 200);
  assert.equal(await waiting(h), null);
  assert.equal((await resolve('declined')).status, 409, 'settled once');
  const after = await (await h.get(`/api/trainer/client?id=${CLIENT}`, TRAINER)).json();
  assert.equal(after.plan.status, 'applied');
  assert.ok(after.plan.resolvedAt);
  assert.equal((await resolve('undone', 'old id')).status, 409);
  assert.equal((await resolve('undone')).status, 200);
  assert.equal((await (await h.get(`/api/trainer/client?id=${CLIENT}`, TRAINER)).json()).plan.status, 'undone');
  assert.equal((await resolve('undone')).status, 409, 'undone once');
});

test('sending again replaces what waits, and a trainer can take it back', async t => {
  const h = await startServer(t);
  const first = await (await sendPlan(h)).json();
  const second = await (await sendPlan(h, TRAINER, { note: 'better' })).json();
  assert.notEqual(first.plan.id, second.plan.id);
  assert.equal((await waiting(h)).note, 'better');
  assert.equal((await h.post('/api/account/trainer/plan/resolve', CLIENT, { id: first.plan.id, decision: 'applied' })).status, 409);
  assert.equal((await h.post('/api/trainer/client/plan/withdraw', OTHER, { id: CLIENT })).status, 404);
  assert.notEqual(await waiting(h), null, 'another trainer took nothing');
  assert.equal((await h.post('/api/trainer/client/plan/withdraw', TRAINER, { id: CLIENT })).status, 200);
  assert.equal(await waiting(h), null);
  assert.equal((await h.post('/api/trainer/client/plan/withdraw', TRAINER, { id: CLIENT })).status, 200, 'twice is fine');
});

test('a plan goes when the client leaves, when the trainer stops being one, and with the account', async t => {
  const stored = h => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).trainerPlans || {};
  await t.test('the client leaves', async t => {
    const h = await startServer(t);
    await sendPlan(h);
    await h.post('/api/account/trainer/unlink', CLIENT);
    assert.equal(await waiting(h), null);
    assert.deepEqual(stored(h), {});
    assert.equal((await h.post('/api/account/trainer/plan/resolve', CLIENT, { id: 'x', decision: 'applied' })).status, 409);
  });
  await t.test('the role is taken away', async t => {
    const h = await startServer(t);
    const { plan } = await (await sendPlan(h)).json();
    assert.equal((await h.post('/api/admin/user/trainer', ADMIN, { id: TRAINER, trainer: false })).status, 200);
    assert.equal(await waiting(h), null);
    assert.deepEqual(stored(h), {});
    assert.equal((await h.post('/api/account/trainer/plan/resolve', CLIENT, { id: plan.id, decision: 'applied' })).status, 409, 'the plan is gone, not just hidden');
  });
  await t.test('the client\'s account is deleted', async t => {
    const h = await startServer(t);
    await sendPlan(h);
    assert.notDeepEqual(stored(h), {});
    assert.equal((await h.post('/api/admin/user/delete', ADMIN, { id: CLIENT })).status, 200);
    assert.deepEqual(stored(h), {});
  });
  await t.test('the trainer\'s account is deleted', async t => {
    const h = await startServer(t);
    await sendPlan(h);
    assert.equal((await h.post('/api/admin/user/delete', ADMIN, { id: TRAINER })).status, 200);
    assert.deepEqual(stored(h), {});
  });
});
