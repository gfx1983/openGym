/* Letters, through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 *
 * The letters of this fork: confirm an address, reset a password, invite a client. There is no local
 * fallback that prints a letter: its link is as good as a password, and the console ends up in
 * logs. An answer's body is not logged either, since Resend may echo the address in it, so a
 * failure says only its status. The links carry the token after the "#": a fragment never reaches
 * a server, so no proxy log holds one.
 */
const BASE = (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/$/, '');
const TIMEOUT_MS = 10000;

export async function sendMail({ apiKey, from, to, subject, text, html }) {
  const res = await fetch(BASE + '/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`resend answered ${res.status}`);
}

const link = (origin, path, token) => `${origin.replace(/\/$/, '')}/#/${path}?token=${encodeURIComponent(token)}`;

// The token is URL-safe base64 and the origin the server's own setting, so nothing here needs
// escaping for HTML. No letter carries a name or anything else someone typed.
const LETTERS = {
  verify: (url, hours) => ({
    subject: 'Подтвердите адрес для openGym',
    text: `Чтобы завершить регистрацию в openGym, откройте ссылку: ${url}\n\nСсылка действует ${hours} ч. Если вы не регистрировались, проигнорируйте письмо.`,
    html: `<p>Чтобы завершить регистрацию в openGym, откройте ссылку:</p><p><a href="${url}">${url}</a></p><p>Ссылка действует ${hours} ч. Если вы не регистрировались, проигнорируйте письмо.</p>`
  }),
  change: (url, hours) => ({
    subject: 'Подтвердите новый адрес для openGym',
    text: `Чтобы использовать этот адрес в openGym, откройте ссылку: ${url}\n\nСсылка действует ${hours} ч. Если вы этого не запрашивали, проигнорируйте письмо.`,
    html: `<p>Чтобы использовать этот адрес в openGym, откройте ссылку:</p><p><a href="${url}">${url}</a></p><p>Ссылка действует ${hours} ч. Если вы этого не запрашивали, проигнорируйте письмо.</p>`
  }),
  reset: (url, minutes) => ({
    subject: 'Сброс пароля openGym',
    text: `Чтобы задать новый пароль openGym, откройте ссылку: ${url}\n\nСсылка действует ${minutes} мин. Если вы не запрашивали сброс, проигнорируйте письмо: пароль останется прежним.`,
    html: `<p>Чтобы задать новый пароль openGym, откройте ссылку:</p><p><a href="${url}">${url}</a></p><p>Ссылка действует ${minutes} мин. Если вы не запрашивали сброс, проигнорируйте письмо: пароль останется прежним.</p>`
  })
};

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The one letter with something a person typed in it: the trainer's name, so the reader knows who
// is asking. The code is the server's own hex, and it sits in the fragment like a token does.
export function inviteLetter(origin, code, trainerName) {
  const url = `${origin.replace(/\/$/, '')}/#/invite?code=${encodeURIComponent(code)}`;
  const line = `${trainerName} приглашает вас в openGym как своего клиента.`;
  const rest = 'Ссылка работает один раз. Если вы не ждали приглашения, проигнорируйте письмо.';
  return {
    subject: 'Приглашение в openGym',
    text: `${line} Чтобы создать профиль, откройте ссылку: ${url}\n\nКод приглашения: ${code}\n\n${rest}`,
    html: `<p>${escapeHtml(line)} Чтобы создать профиль, откройте ссылку:</p><p><a href="${url}">${url}</a></p><p>Код приглашения: ${code}</p><p>${rest}</p>`
  };
}

export const EMAIL_TOKEN_TTL_MS = { verify: 24 * 3600000, change: 24 * 3600000, reset: 30 * 60000 };

export function letterFor(kind, origin, token) {
  const path = kind === 'reset' ? 'reset-password' : 'verify-email';
  const amount = kind === 'reset' ? EMAIL_TOKEN_TTL_MS.reset / 60000 : EMAIL_TOKEN_TTL_MS[kind] / 3600000;
  return LETTERS[kind](link(origin, path, token), amount);
}
