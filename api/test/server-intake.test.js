/* The questionnaire a client fills in for their trainer: health data, so who can read it and when
   it goes matter more than how it is stored. Real server.js in a child. */
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

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-intake-'));
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
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', INVITE_ONLY: '1', PASSWORD_LOGIN: '1' }
  });
  const gone = new Promise(r => child.once('exit', r));
  t.after(async () => { child.kill('SIGKILL'); await gone; fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const call = (method, url, uid, body) => fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { ...(uid ? { Cookie: `gymsid=${mint(uid)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return {
    file: path.join(dataDir, `intake-${CLIENT}.json`), dataDir, log: () => log,
    get: (url, uid) => call('GET', url, uid), post: (url, uid, body = {}) => call('POST', url, uid, body)
  };
}
const SAVE = '/api/account/intake';
const seen = async (h, uid = TRAINER) => (await (await h.get(`/api/trainer/client?id=${CLIENT}`, uid)).json()).intake;

test('nothing is stored before consent; afterwards a step at a time, private on disk', async t => {
  const h = await startServer(t);
  assert.equal((await h.post(SAVE, CLIENT, { answers: { age: '30' } })).status, 400);
  assert.equal(fs.existsSync(h.file), false);
  assert.equal((await h.post(SAVE, CLIENT, { consent: true, answers: { age: '30', goal: 'muscle' } })).status, 200);
  const d = await (await h.post(SAVE, CLIENT, { answers: { goal: '', sleep: '7' }, done: 'short' })).json();
  assert.deepEqual(d.intake.answers, { age: '30', sleep: '7' });
  assert.ok(d.intake.shortDoneAt);
  assert.equal(fs.statSync(h.file).mode & 0o777, 0o600);
  assert.equal(h.log().includes('sleep'), false);
});

test('only their own trainer reads the answers', async t => {
  const h = await startServer(t);
  await h.post(SAVE, CLIENT, { consent: true, answers: { conditions_details: 'астма' } });
  assert.equal((await seen(h)).answers.conditions_details, 'астма');
  assert.equal((await h.get(`/api/trainer/client?id=${CLIENT}`, OTHER)).status, 404);
  assert.equal((await h.get(`/api/trainer/client?id=${CLIENT}`, PLAIN)).status, 403);
  const admin = await (await h.get(`/api/admin/user?id=${CLIENT}`, ADMIN)).text();
  assert.equal(admin.includes('астма'), false);
  const row = (await (await h.get('/api/trainer/clients', TRAINER)).json()).clients[0];
  assert.equal(row.intake, 'draft');
  assert.equal(row.conditions_details, undefined);
});

test('answers given to another trainer read as nothing', async t => {
  const h = await startServer(t);
  await h.post(SAVE, CLIENT, { consent: true, answers: { age: '30' } });
  fs.writeFileSync(h.file, JSON.stringify({ ...JSON.parse(fs.readFileSync(h.file, 'utf8')), trainerId: OTHER }));
  assert.equal(await seen(h), null);
  assert.equal((await (await h.get(SAVE, CLIENT)).json()).intake, null);
});

test('a profile without a trainer has no questionnaire', async t => {
  const h = await startServer(t);
  assert.deepEqual(await (await h.get(SAVE, PLAIN)).json(), { trainer: null, intake: null, shown: false });
  assert.equal((await h.post(SAVE, PLAIN, { consent: true, answers: { age: '30' } })).status, 403);
  assert.equal((await h.get(SAVE, null)).status, 401);
});

test('shapeless or oversized answers are refused and change nothing', async t => {
  const h = await startServer(t);
  for (const answers of [null, [], { __proto_x: 'a' }, { 'bad key': 'a' }, { age: 30 }, { age: 'x'.repeat(2001) }, Object.fromEntries(Array.from({ length: 81 }, (_, i) => ['k' + i, 'a']))]) {
    assert.equal((await h.post(SAVE, CLIENT, { consent: true, answers })).status, 400, JSON.stringify(answers)?.slice(0, 40));
  }
  assert.equal((await h.post(SAVE, CLIENT, { consent: true, answers: {}, done: 'all' })).status, 400);
  assert.equal(fs.existsSync(h.file), false);
});

test('the client can delete the answers, and they are gone for the trainer', async t => {
  const h = await startServer(t);
  await h.post(SAVE, CLIENT, { consent: true, answers: { age: '30' } });
  assert.equal((await h.post('/api/account/intake/delete', CLIENT)).status, 200);
  assert.equal(fs.existsSync(h.file), false);
  assert.equal(await seen(h), null);
  assert.equal((await h.post(SAVE, CLIENT, { answers: { age: '31' } })).status, 400, 'consent is asked again');
});

for (const [name, end] of [
  ['the client leaves', h => h.post('/api/account/trainer/unlink', CLIENT)],
  ['the trainer loses the role', h => h.post('/api/admin/user/trainer', ADMIN, { id: TRAINER, trainer: false })],
  ['the client becomes a trainer', h => h.post('/api/admin/user/trainer', ADMIN, { id: CLIENT, trainer: true })],
]) {
  test(`answers do not outlive the link when ${name}`, async t => {
    const h = await startServer(t);
    await h.post(SAVE, CLIENT, { consent: true, answers: { age: '30' } });
    assert.ok(fs.existsSync(h.file));
    assert.equal((await end(h)).status, 200);
    assert.equal(fs.existsSync(h.file), false);
  });
}

test('the longer part opens per client, after the short one, and once', async t => {
  const h = await startServer(t);
  const ask = uid => h.post('/api/trainer/client/intake/request', uid, { id: CLIENT });
  await h.post(SAVE, CLIENT, { consent: true, answers: { age: '30' } });
  assert.equal((await ask(TRAINER)).status, 409);
  await h.post(SAVE, CLIENT, { answers: {}, done: 'short' });
  assert.equal((await ask(OTHER)).status, 404);
  const first = (await (await ask(TRAINER)).json()).intake.extendedRequestedAt;
  assert.ok(first);
  assert.equal((await (await ask(TRAINER)).json()).intake.extendedRequestedAt, first);
  assert.equal((await (await h.get(SAVE, CLIENT)).json()).intake.extendedRequestedAt, first);
});

test('the app opens it by itself only once', async t => {
  const h = await startServer(t);
  assert.equal((await (await h.get(SAVE, CLIENT)).json()).shown, false);
  await h.post('/api/account/intake/shown', CLIENT);
  assert.equal((await (await h.get(SAVE, CLIENT)).json()).shown, true);
});
