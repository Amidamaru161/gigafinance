#!/usr/bin/env node
// GigaFinance login service (no dependencies). nginx asks GET /_auth on every
// request (auth_request); a valid signed session cookie answers 200 with the
// user's dsh port in X-GF-Port, anything else 401 -> nginx redirects to /login.
//
//   node server.mjs serve                     (systemd: gigafinance-auth)
//   node server.mjs set-user <login> <port>   password from $GF_PASSWORD or stdin
//   node server.mjs remove-user <login>
//
// Files: /var/lib/gigafinance/auth/users.json (login -> {salt, hash, port}),
//        /var/lib/gigafinance/auth/secret (HMAC key, created on first run).

import { createServer } from 'node:http'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

const USERS = process.env.GF_USERS_FILE ?? '/var/lib/gigafinance/auth/users.json'
const SECRET_FILE = process.env.GF_SECRET_FILE ?? '/var/lib/gigafinance/auth/secret'
const PORT = Number(process.env.GF_AUTH_PORT ?? 8790)
const COOKIE = 'gf_auth'
const MAX_AGE = 30 * 24 * 3600

const readUsers = () => (existsSync(USERS) ? JSON.parse(readFileSync(USERS, 'utf8')) : {})
const writeUsers = (users) => {
  writeFileSync(`${USERS}.tmp`, JSON.stringify(users, null, 2), { mode: 0o640 })
  renameSync(`${USERS}.tmp`, USERS)
}
const secret = () => {
  if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 })
  return readFileSync(SECRET_FILE, 'utf8').trim()
}
const hashPassword = (password, salt) => scryptSync(password, salt, 32).toString('hex')

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
  const body = `${login}.${expires}.${version}`
  const expected = Buffer.from(sign(key, body))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined
  if (Number(expires) < Date.now() / 1000) return undefined
  const user = users[login]
  if (user === undefined || user.hash.slice(0, 8) !== version) return undefined
  return { login, port: user.port }
}
const cookieOf = (req, name) => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const page = error => `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Вход — GigaFinance</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
background:radial-gradient(1200px 600px at 20% 0%,#ede7ff,transparent),radial-gradient(900px 500px at 100% 100%,#e3f0ff,transparent),#f7f6fb;color:#1c1b22}
@media (prefers-color-scheme:dark){body{background:radial-gradient(1200px 600px at 20% 0%,#2a2140,transparent),#121118;color:#eee}.card{background:#1d1b25!important;border-color:#2e2b38!important}input{background:#15141b!important;color:#eee!important;border-color:#34303f!important}}
.card{width:min(380px,calc(100vw - 32px));background:#fff;border:1px solid #e6e2f0;border-radius:20px;padding:32px 28px;box-shadow:0 20px 60px rgba(80,50,160,.12)}
.logo{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.04em;font-size:18px;margin-bottom:24px}
.mark{width:30px;height:30px;border-radius:50%;background:conic-gradient(from 200deg,#7c4dff,#3d8bff,#21c7b8,#7c4dff)}
label{display:block;font-size:13px;color:#6b6780;margin:14px 0 6px}
input{width:100%;height:44px;border:1px solid #dcd7ea;border-radius:12px;padding:0 14px;font-size:16px;outline:none}
input:focus{border-color:#7c4dff;box-shadow:0 0 0 3px rgba(124,77,255,.18)}
button{width:100%;height:46px;margin-top:22px;border:0;border-radius:12px;font-size:16px;font-weight:600;color:#fff;cursor:pointer;background:linear-gradient(135deg,#7c4dff,#3d8bff)}
.err{margin-top:14px;padding:10px 12px;border-radius:10px;background:#fdecee;color:#b3261e;font-size:14px}
</style></head><body><form class="card" method="post" action="/login">
<div class="logo"><span class="mark"></span>GIGAFINANCE</div>
<label for="u">Логин</label><input id="u" name="login" autocomplete="username" autocapitalize="none" required autofocus>
<label for="p">Пароль</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Войти</button>${error ? `<div class="err">${esc(error)}</div>` : ''}
</form></body></html>`

function serve() {
  const key = secret()
  const failures = new Map() // ip -> {count, until}
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const users = readUsers()
    if (url.pathname === '/_auth') {
      const session = verify(key, users, cookieOf(req, COOKIE))
      if (session === undefined) { res.writeHead(401); return res.end() }
      res.writeHead(200, { 'X-GF-Port': String(session.port), 'X-GF-User': session.login })
      return res.end()
    }
    if (url.pathname === '/logout') {
      res.writeHead(302, { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` })
      return res.end()
    }
    if (url.pathname !== '/login') { res.writeHead(404); return res.end() }
    const html = (status, error) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(page(error))
    }
    if (req.method !== 'POST') return html(200)
    const ip = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress)
    const f = failures.get(ip)
    if (f !== undefined && f.count >= 5 && f.until > Date.now()) return html(429, 'Слишком много попыток. Подождите минуту.')
    let body = ''
    req.on('data', (chunk) => { body += chunk; if (body.length > 4096) req.destroy() })
    req.on('end', () => {
      const form = new URLSearchParams(body)
      const login = (form.get('login') ?? '').trim().toLowerCase()
      const user = users[login]
      const ok = user !== undefined && timingSafeEqual(
        Buffer.from(hashPassword(form.get('password') ?? '', user.salt), 'hex'), Buffer.from(user.hash, 'hex'))
      if (!ok) {
        const next = f !== undefined && f.until > Date.now() ? f.count + 1 : 1
        failures.set(ip, { count: next, until: Date.now() + 60_000 })
        return html(401, 'Неверный логин или пароль.')
      }
      failures.delete(ip)
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(issue(key, login, user))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}`,
      })
      res.end()
    })
  }).listen(PORT, '127.0.0.1', () => console.log(`gigafinance-auth on 127.0.0.1:${PORT}`))
}

async function readPassword() {
  if (process.env.GF_PASSWORD) return process.env.GF_PASSWORD
  if (process.stdin.isTTY) process.stdout.write('Пароль: ')
  let data = ''
  for await (const chunk of process.stdin) { data += chunk; if (data.includes('\n')) break }
  return data.split('\n')[0]
}

const [cmd, login, port] = process.argv.slice(2)
if (cmd === 'serve') serve()
else if (cmd === 'set-user') {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(login ?? '') || !Number(port)) throw new Error('usage: set-user <login> <port>')
  const password = await readPassword()
  if (password.length < 8 && process.env.GF_ALLOW_SHORT !== '1') throw new Error('password must be at least 8 characters')
  const salt = randomBytes(16).toString('hex')
  writeUsers({ ...readUsers(), [login]: { salt, hash: hashPassword(password, salt), port: Number(port) } })
  console.log(`user ${login} -> port ${port}`)
} else if (cmd === 'remove-user') {
  const users = readUsers()
  delete users[login]
  writeUsers(users)
} else {
  console.log('usage: server.mjs serve | set-user <login> <port> | remove-user <login>')
  process.exit(1)
}
