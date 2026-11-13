#!/usr/bin/env node
// GigaFinance login service (no dependencies). nginx asks GET /_auth on every
// request (auth_request); a valid signed session cookie answers 200 with the
// user's dsh port in X-GF-Port, anything else 401 -> nginx redirects to /login.
//
// Pages: /login, /logout, /register (invite code), /admin (admins only).
// New accounts are provisioned by the root-owned helper
// /usr/local/sbin/gigafinance-provision (a copy of deploy/add-user.sh),
// allowed for this service's user by a single sudoers rule.
//
//   node server.mjs serve                          (systemd: gigafinance-auth)
//   node server.mjs set-user <login> <port>        password from $GF_PASSWORD or stdin
//   node server.mjs set-admin <login> on|off
//   node server.mjs remove-user <login>
//
// Files: /var/lib/gigafinance/auth/users.json (login -> {salt, hash, port, admin}),
//        /var/lib/gigafinance/auth/secret (HMAC key), .../invite (invite code).

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

const DIR = process.env.GF_AUTH_DIR ?? '/var/lib/gigafinance/auth'
const USERS = process.env.GF_USERS_FILE ?? `${DIR}/users.json`
const SECRET_FILE = process.env.GF_SECRET_FILE ?? `${DIR}/secret`
const INVITE_FILE = process.env.GF_INVITE_FILE ?? `${DIR}/invite`
const PROVISION = process.env.GF_PROVISION ?? '/usr/local/sbin/gigafinance-provision'
const PORT = Number(process.env.GF_AUTH_PORT ?? 8790)
const COOKIE = 'gf_auth'
const MAX_AGE = 30 * 24 * 3600
const LOGIN_RE = /^[a-z][a-z0-9_-]{1,31}$/
const MIN_PASSWORD = 8

const readUsers = () => (existsSync(USERS) ? JSON.parse(readFileSync(USERS, 'utf8')) : {})
const writeUsers = (users) => {
  writeFileSync(`${USERS}.tmp`, JSON.stringify(users, null, 2), { mode: 0o640 })
  renameSync(`${USERS}.tmp`, USERS)
}
const secret = () => {
  if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 })
  return readFileSync(SECRET_FILE, 'utf8').trim()
}
const newInvite = () => {
  const code = randomBytes(6).toString('base64url')
  writeFileSync(INVITE_FILE, code, { mode: 0o600 })
  return code
}
const invite = () => (existsSync(INVITE_FILE) ? readFileSync(INVITE_FILE, 'utf8').trim() : newInvite())
const hashPassword = (password, salt) => scryptSync(password, salt, 32).toString('hex')
const sameText = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

// Cookie: login.expires.version.signature — version = first 8 hex of the
// password hash, so changing a password logs out every old session.
const sign = (key, body) => createHmac('sha256', key).update(body).digest('base64url')
function issue(key, login, user) {
  const body = `${login}.${Math.floor(Date.now() / 1000) + MAX_AGE}.${user.hash.slice(0, 8)}`
  return `${body}.${sign(key, body)}`
}
function verify(key, users, value) {
  const parts = (value ?? '').split('.')
  if (parts.length !== 4) return undefined
  const [login, expires, version, mac] = parts
  if (!sameText(sign(key, `${login}.${expires}.${version}`), mac)) return undefined
  if (Number(expires) < Date.now() / 1000) return undefined
  const user = users[login]
  if (user === undefined || user.hash.slice(0, 8) !== version) return undefined
  return { login, port: user.port, admin: user.admin === true }
}
const cookieOf = (req, name) => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}
const sessionCookie = (key, login, user) =>
  `${COOKIE}=${encodeURIComponent(issue(key, login, user))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}`

/** Run the root-owned provisioning helper; the password goes over stdin. */
function provision(args, password) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', PROVISION, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve(out) : reject(new Error(out.trim().split('\n').pop() || `exit ${code}`))))
    child.stdin.end(password === undefined ? '' : `${password}\n`)
  })
}

// ---- pages -------------------------------------------------------------

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const STYLE = `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
background:radial-gradient(1200px 600px at 20% 0%,#ede7ff,transparent),radial-gradient(900px 500px at 100% 100%,#e3f0ff,transparent),#f7f6fb;color:#1c1b22;padding:24px 0}
.card{width:min(380px,calc(100vw - 32px));background:#fff;border:1px solid #e6e2f0;border-radius:20px;padding:32px 28px;box-shadow:0 20px 60px rgba(80,50,160,.12)}
.wide{width:min(760px,calc(100vw - 32px))}
.logo{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.04em;font-size:18px;margin-bottom:24px}
.mark{width:30px;height:30px;border-radius:50%;background:conic-gradient(from 200deg,#7c4dff,#3d8bff,#21c7b8,#7c4dff)}
h2{font-size:16px;margin:24px 0 8px}label{display:block;font-size:13px;color:#6b6780;margin:14px 0 6px}
input[type=text],input[type=password]{width:100%;height:44px;border:1px solid #dcd7ea;border-radius:12px;padding:0 14px;font-size:16px;outline:none;background:#fff;color:inherit}
input:focus{border-color:#7c4dff;box-shadow:0 0 0 3px rgba(124,77,255,.18)}
.btn{width:100%;height:46px;margin-top:22px;border:0;border-radius:12px;font-size:16px;font-weight:600;color:#fff;cursor:pointer;background:linear-gradient(135deg,#7c4dff,#3d8bff)}
.small{height:34px;width:auto;padding:0 14px;margin:0;font-size:14px}.danger{background:#e5484d}
.err{margin-top:14px;padding:10px 12px;border-radius:10px;background:#fdecee;color:#b3261e;font-size:14px}
.ok{margin-top:14px;padding:10px 12px;border-radius:10px;background:#e8f7ee;color:#1a7f37;font-size:14px}
.alt{margin-top:18px;text-align:center;font-size:14px;color:#6b6780}a{color:#7c4dff}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid #eee}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.row>div{flex:1 1 160px}.check{display:flex;gap:6px;align-items:center;margin-top:12px}
code{background:#f1eefa;padding:2px 8px;border-radius:6px;font-size:15px}
.top{display:flex;justify-content:space-between;align-items:center}
@media (prefers-color-scheme:dark){body{background:radial-gradient(1200px 600px at 20% 0%,#2a2140,transparent),#121118;color:#eee}.card{background:#1d1b25;border-color:#2e2b38}
input[type=text],input[type=password]{background:#15141b;border-color:#34303f}td,th{border-color:#2e2b38}code{background:#2a2537}}`
const shell = (title, body, wide = false) => `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — GigaFinance</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"><style>${STYLE}</style></head><body>
<div class="card${wide ? ' wide' : ''}"><div class="logo"><span class="mark"></span>GIGAFINANCE</div>${body}</div></body></html>`
const note = (error, ok) => `${error ? `<div class="err">${esc(error)}</div>` : ''}${ok ? `<div class="ok">${esc(ok)}</div>` : ''}`

const loginPage = error => shell('Вход', `<form method="post" action="/login">
<label for="u">Логин</label><input type="text" id="u" name="login" autocomplete="username" autocapitalize="none" required autofocus>
<label for="p">Пароль</label><input type="password" id="p" name="password" autocomplete="current-password" required>
<button class="btn" type="submit">Войти</button>${note(error)}</form>
<div class="alt">Нет аккаунта? <a href="/register">Регистрация</a></div>`)

const registerPage = (error, values = {}) => shell('Регистрация', `<form method="post" action="/register">
<label for="u">Логин</label><input type="text" id="u" name="login" value="${esc(values.login ?? '')}" autocomplete="username" autocapitalize="none" pattern="[a-z][a-z0-9_\\-]{1,31}" title="латиница в нижнем регистре, цифры, _ или -, начиная с буквы" required autofocus>
<label for="p">Пароль (от ${MIN_PASSWORD} символов)</label><input type="password" id="p" name="password" minlength="${MIN_PASSWORD}" autocomplete="new-password" required>
<label for="p2">Повторите пароль</label><input type="password" id="p2" name="password2" minlength="${MIN_PASSWORD}" autocomplete="new-password" required>
<label for="i">Код приглашения</label><input type="text" id="i" name="invite" value="${esc(values.invite ?? '')}" autocapitalize="none" required>
<button class="btn" type="submit">Создать аккаунт</button>${note(error)}</form>
<div class="alt">Уже есть аккаунт? <a href="/login">Войти</a></div>`)

const adminPage = (users, me, code, error, ok) => shell('Пользователи', `<div class="top"><b>Пользователи</b>
<span><a href="/">В приложение</a> · <a href="/logout">Выйти</a></span></div>${note(error, ok)}
<table><tr><th>Логин</th><th>Порт</th><th>Роль</th><th></th></tr>${Object.entries(users).sort().map(([login, u]) => `<tr>
<td>${esc(login)}</td><td>${u.port}</td><td>${u.admin ? 'админ' : 'пользователь'}</td><td style="text-align:right">${login === me ? '<small>это вы</small>' : `
<form method="post" action="/admin" style="display:inline" onsubmit="return confirm('Удалить ${esc(login)}? Его чаты останутся на сервере.')">
<input type="hidden" name="action" value="delete"><input type="hidden" name="login" value="${esc(login)}">
<button class="btn small danger" type="submit">Удалить</button></form>`}</td></tr>`).join('')}</table>
<h2>Новый пользователь</h2><form method="post" action="/admin"><input type="hidden" name="action" value="create">
<div class="row"><div><label>Логин</label><input type="text" name="login" autocapitalize="none" pattern="[a-z][a-z0-9_\\-]{1,31}" required></div>
<div><label>Пароль (от ${MIN_PASSWORD} символов)</label><input type="password" name="password" minlength="${MIN_PASSWORD}" autocomplete="new-password" required></div></div>
<label class="check"><input type="checkbox" name="admin" value="1"> администратор</label>
<button class="btn" type="submit">Создать</button></form>
<h2>Код приглашения для регистрации</h2><div class="row" style="align-items:center"><div><code>${esc(code)}</code></div>
<form method="post" action="/admin"><input type="hidden" name="action" value="invite"><button class="btn small" type="submit">Сменить код</button></form></div>
<div class="alt" style="text-align:left">Ссылка для регистрации: /register — человек вводит этот код. После смены кода старый перестаёт работать.</div>`, true)

// ---- server ------------------------------------------------------------

function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 8192) { reject(new Error('too large')); req.destroy() }
    })
    req.on('end', () => resolve(new URLSearchParams(body)))
    req.on('error', reject)
  })
}

/** Cross-site form posts are refused (the cookie is SameSite=Lax, this is a second fence). */
const sameOrigin = (req) => {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

function validateNew(users, login, password) {
  if (!LOGIN_RE.test(login)) return 'Логин: латиница в нижнем регистре, цифры, _ или -, от 2 до 32 символов, начиная с буквы.'
  if (users[login] !== undefined) return 'Такой логин уже занят.'
  if (password.length < MIN_PASSWORD) return `Пароль должен быть не короче ${MIN_PASSWORD} символов.`
  return undefined
}

function serve() {
  const key = secret()
  invite()
  const failures = new Map() // ip -> {count, until}
  let busy = Promise.resolve() // provisioning runs one at a time

  const limited = (ip) => {
    const f = failures.get(ip)
    return f !== undefined && f.count >= 5 && f.until > Date.now()
  }
  const fail = (ip) => {
    const f = failures.get(ip)
    failures.set(ip, { count: f !== undefined && f.until > Date.now() ? f.count + 1 : 1, until: Date.now() + 60_000 })
  }
  const queue = (task) => {
    const run = busy.then(task, task)
    busy = run.catch(() => {})
    return run
  }

  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const users = readUsers()
    const ip = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress)
    const session = verify(key, users, cookieOf(req, COOKIE))
    const html = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers })
      res.end(body)
    }
    const redirect = (to, cookie) => {
      res.writeHead(302, { Location: to, ...(cookie ? { 'Set-Cookie': cookie } : {}) })
      res.end()
    }

    try {
      if (url.pathname === '/_auth') {
        if (session === undefined) { res.writeHead(401); return res.end() }
        res.writeHead(200, { 'X-GF-Port': String(session.port), 'X-GF-User': session.login })
        return res.end()
      }
      if (url.pathname === '/logout') return redirect('/login', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
      if (req.method === 'POST' && !sameOrigin(req)) return html(403, loginPage('Запрос отклонён.'))

      if (url.pathname === '/login') {
        if (req.method !== 'POST') return html(200, loginPage())
        if (limited(ip)) return html(429, loginPage('Слишком много попыток. Подождите минуту.'))
        const form = await readForm(req)
        const login = (form.get('login') ?? '').trim().toLowerCase()
        const user = users[login]
        if (user === undefined || !sameText(hashPassword(form.get('password') ?? '', user.salt), user.hash)) {
          fail(ip)
          return html(401, loginPage('Неверный логин или пароль.'))
        }
        failures.delete(ip)
        return redirect('/', sessionCookie(key, login, user))
      }

      if (url.pathname === '/register') {
        if (req.method !== 'POST') return html(200, registerPage())
        if (limited(ip)) return html(429, registerPage('Слишком много попыток. Подождите минуту.'))
        const form = await readForm(req)
        const login = (form.get('login') ?? '').trim().toLowerCase()
        const password = form.get('password') ?? ''
        const code = (form.get('invite') ?? '').trim()
        const values = { login, invite: code }
        if (!sameText(code, invite())) {
          fail(ip)
          return html(403, registerPage('Неверный код приглашения.', values))
        }
        if (password !== (form.get('password2') ?? '')) return html(400, registerPage('Пароли не совпадают.', values))
        const problem = validateNew(users, login, password)
        if (problem) return html(400, registerPage(problem, values))
        await queue(() => provision([login], password))
        return redirect('/', sessionCookie(key, login, readUsers()[login]))
      }

      if (url.pathname === '/admin') {
        if (session === undefined) return redirect('/login')
        if (!session.admin) return html(403, shell('Нет доступа', '<p>Эта страница только для администраторов.</p><div class="alt"><a href="/">В приложение</a></div>'))
        if (req.method !== 'POST') return html(200, adminPage(users, session.login, invite()))
        const form = await readForm(req)
        const action = form.get('action')
        const login = (form.get('login') ?? '').trim().toLowerCase()
        const page = (status, error, ok) => html(status, adminPage(readUsers(), session.login, invite(), error, ok))
        if (action === 'invite') { newInvite(); return page(200, undefined, 'Код приглашения обновлён.') }
        if (action === 'create') {
          const password = form.get('password') ?? ''
          const problem = validateNew(users, login, password)
          if (problem) return page(400, problem)
          await queue(() => provision([login], password))
          if (form.get('admin') === '1') {
            const all = readUsers()
            all[login].admin = true
            writeUsers(all)
          }
          return page(200, undefined, `Пользователь ${login} создан.`)
        }
        if (action === 'delete') {
          if (login === session.login) return page(400, 'Нельзя удалить самого себя.')
          if (users[login] === undefined) return page(404, 'Нет такого пользователя.')
          await queue(() => provision(['--remove', login]))
          return page(200, undefined, `Пользователь ${login} удалён. Его данные остались на сервере.`)
        }
        return page(400, 'Неизвестное действие.')
      }

      res.writeHead(404)
      res.end()
    } catch (error) {
      console.error(error)
      if (!res.headersSent) html(500, shell('Ошибка', `<div class="err">Не получилось: ${esc(error instanceof Error ? error.message : error)}</div><div class="alt"><a href="javascript:history.back()">Назад</a></div>`))
    }
  }).listen(PORT, '127.0.0.1', () => console.log(`gigafinance-auth on 127.0.0.1:${PORT}`))
}

// ---- CLI ---------------------------------------------------------------

async function readPassword() {
  if (process.env.GF_PASSWORD) return process.env.GF_PASSWORD
  if (process.stdin.isTTY) process.stdout.write('Пароль: ')
  let data = ''
  for await (const chunk of process.stdin) { data += chunk; if (data.includes('\n')) break }
  return data.split('\n')[0]
}

const [cmd, login, arg] = process.argv.slice(2)
if (cmd === 'serve') serve()
else if (cmd === 'set-user') {
  if (!LOGIN_RE.test(login ?? '') || !Number(arg)) throw new Error('usage: set-user <login> <port>')
  const password = await readPassword()
  if (password.length < MIN_PASSWORD && process.env.GF_ALLOW_SHORT !== '1') throw new Error(`password must be at least ${MIN_PASSWORD} characters`)
  const users = readUsers()
  const salt = randomBytes(16).toString('hex')
  users[login] = { ...users[login], salt, hash: hashPassword(password, salt), port: Number(arg) }
  writeUsers(users)
  console.log(`user ${login} -> port ${arg}`)
} else if (cmd === 'set-admin') {
  const users = readUsers()
  if (users[login] === undefined) throw new Error(`no user ${login}`)
  users[login].admin = arg === 'on'
  writeUsers(users)
  console.log(`${login} admin=${users[login].admin}`)
} else if (cmd === 'remove-user') {
  const users = readUsers()
  delete users[login]
  writeUsers(users)
} else {
  console.log('usage: server.mjs serve | set-user <login> <port> | set-admin <login> on|off | remove-user <login>')
  process.exit(1)
}
