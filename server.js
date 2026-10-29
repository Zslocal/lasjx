const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const express = require('express')
const multer = require('multer')

const config = require('./lib/config')
const store = require('./lib/db')
const { hashPassword, verifyPassword, createToken } = require('./lib/security')

const app = express()
app.set('trust proxy', true)
app.disable('x-powered-by')

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false }))

const SESSION_COOKIE = 'timeline_session'
const SESSION_MS = config.sessionDays * 24 * 60 * 60 * 1000

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

function setSessionCookie(res, token, maxAgeMs) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ]
  if (process.env.COOKIE_SECURE === '1') attrs.push('Secure')
  res.append('Set-Cookie', attrs.join('; '))
}

app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie)
  const token = req.cookies[SESSION_COOKIE]
  req.sessionToken = token || null
  req.user = store.sessionUser(token) || null
  next()
})

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' })
  next()
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' })
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' })
  next()
}

const loginAttempts = new Map()
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 10

function loginKey(req) {
  return `${req.ip || 'unknown'}|${String(req.body?.username || '').toLowerCase()}`
}

function tooManyAttempts(key) {
  const entry = loginAttempts.get(key)
  if (!entry) return false
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key)
    return false
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS
}

function recordFailure(key) {
  const now = Date.now()
  const entry = loginAttempts.get(key)
  if (!entry || now - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { first: now, count: 1 })
    return
  }
  entry.count += 1
}

function clearAttempts(key) {
  loginAttempts.delete(key)
}

function toSqliteDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' })

  const key = loginKey(req)
  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: '尝试次数过多，请稍后再试' })
  }

  const user = store.userByUsername(username)
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailure(key)
    return res.status(401).json({ error: '用户名或密码错误' })
  }

  clearAttempts(key)
  const token = createToken()
  const expiresAt = new Date(Date.now() + SESSION_MS)
  store.createSession(user.id, token, toSqliteDatetime(expiresAt))
  setSessionCookie(res, token, SESSION_MS)

  res.json({
    user: { id: user.id, username: user.username, role: user.role },
  })
})

app.post('/api/logout', (req, res) => {
  store.deleteSession(req.sessionToken)
  setSessionCookie(res, '', 0)
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null })
  res.json({ user: req.user })
})

app.post('/api/me/password', requireAuth, (req, res) => {
  const current = String(req.body?.currentPassword || '')
  const next = String(req.body?.newPassword || '')
  if (next.length < 6) return res.status(400).json({ error: '新密码至少 6 位' })
  const record = store.userByUsername(req.user.username)
  if (!verifyPassword(current, record.password_hash)) {
    return res.status(400).json({ error: '当前密码不正确' })
  }
  store.updatePassword(req.user.id, hashPassword(next))
  store.deleteUserSessions(req.user.id, req.sessionToken)
  res.json({ ok: true })
})

function toIsoDate(value) {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const date = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  if (date.toISOString().slice(0, 10) !== raw) return null
  return raw
}

function cleanText(value, max) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (text.length > max) return text.slice(0, max)
  return text
}

const KIND_BY_MIME = [
  [/^image\//, 'image'],
  [/^video\//, 'video'],
]

function mediaKind(mime) {
  for (const [pattern, kind] of KIND_BY_MIME) {
    if (pattern.test(mime)) return kind
  }
  return 'file'
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 16)
      const safeExt = /^\.[A-Za-z0-9]+$/.test(ext) ? ext.toLowerCase() : ''
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`)
    },
  }),
  limits: {
    fileSize: config.maxFileSize,
    files: config.maxFilesPerPost,
  },
  defParamCharset: 'utf8',
  fileFilter: (req, file, cb) => {
    if (/\.(exe|bat|cmd|sh|msi|com|scr)$/i.test(file.originalname || '')) {
      return cb(new Error('不允许上传可执行文件'))
    }
    cb(null, true)
  },
})

function removeFiles(files) {
  for (const file of files || []) {
    fs.promises.unlink(file.path).catch(() => {})
  }
}

app.get('/api/posts', requireAuth, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 60)
  const page = Math.max(Number(req.query.page) || 1, 1)
  const result = store.listPosts({ limit, offset: (page - 1) * limit })
  res.json({ ...result, page, limit })
})

app.get('/api/stats', requireAuth, (req, res) => {
  res.json(store.stats())
})

function handleUpload(req, res, next) {
  upload.array('files', config.maxFilesPerPost)(req, res, async (err) => {
    if (err) {
      removeFiles(req.files)
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `单个文件不能超过 ${config.maxFileSize / 1024 / 1024}MB` })
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: `一次最多上传 ${config.maxFilesPerPost} 个文件` })
      }
      return res.status(400).json({ error: err.message || '上传失败' })
    }
    next()
  })
}

app.post('/api/posts', requireAuth, handleUpload, (req, res) => {
  const files = req.files || []
  const title = cleanText(req.body?.title, 120)
  const content = cleanText(req.body?.content, 5000)
  const eventDate = toIsoDate(req.body?.eventDate)

  if (!title) {
    removeFiles(files)
    return res.status(400).json({ error: '请填写标题' })
  }
  if (!eventDate) {
    removeFiles(files)
    return res.status(400).json({ error: '请选择有效的事件日期' })
  }
  if (files.length === 0) {
    return res.status(400).json({ error: '请至少上传一个文件' })
  }

  let post
  try {
    post = store.createPost({ title, content, eventDate, authorId: req.user.id })
    store.addMedia(
      post.id,
      files.map((file) => ({
        filename: file.filename,
        originalName: file.originalname || file.filename,
        mime: file.mimetype || 'application/octet-stream',
        size: file.size,
        kind: mediaKind(file.mimetype || ''),
      })),
    )
  } catch (error) {
    removeFiles(files)
    return res.status(500).json({ error: '保存失败，请重试' })
  }

  res.status(201).json({ post: store.postById(post.id) })
})

app.get('/api/posts/:id', requireAuth, (req, res) => {
  const post = store.postById(Number(req.params.id))
  if (!post) return res.status(404).json({ error: '记录不存在' })
  res.json({ post })
})

app.put('/api/posts/:id', requireAdmin, handleUpload, (req, res) => {
  const id = Number(req.params.id)
  const existing = store.postById(id)
  const files = req.files || []
  if (!existing) {
    removeFiles(files)
    return res.status(404).json({ error: '记录不存在' })
  }

  const title = req.body?.title === undefined ? existing.title : cleanText(req.body.title, 120)
  const content =
    req.body?.content === undefined ? existing.content : cleanText(req.body.content, 5000)
  const eventDateRaw = req.body?.eventDate === undefined ? existing.event_date : req.body.eventDate
  const eventDate = toIsoDate(eventDateRaw)

  if (!title) {
    removeFiles(files)
    return res.status(400).json({ error: '标题不能为空' })
  }
  if (!eventDate) {
    removeFiles(files)
    return res.status(400).json({ error: '事件日期无效' })
  }

  try {
    store.updatePost(id, { title, content, eventDate })
    if (files.length > 0) {
      store.addMedia(
        id,
        files.map((file) => ({
          filename: file.filename,
          originalName: file.originalname || file.filename,
          mime: file.mimetype || 'application/octet-stream',
          size: file.size,
          kind: mediaKind(file.mimetype || ''),
        })),
      )
    }
  } catch (error) {
    removeFiles(files)
    return res.status(500).json({ error: '保存失败，请重试' })
  }

  res.json({ post: store.postById(id) })
})

app.delete('/api/posts/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  if (!store.postById(id)) return res.status(404).json({ error: '记录不存在' })
  const filenames = store.deletePost(id)
  await Promise.all(
    filenames.map((name) =>
      fs.promises.unlink(path.join(config.uploadDir, name)).catch(() => {}),
    ),
  )
  res.json({ ok: true })
})

app.delete('/api/media/:id', requireAdmin, async (req, res) => {
  const row = store.removeMedia(Number(req.params.id))
  if (!row) return res.status(404).json({ error: '文件不存在' })
  await fs.promises.unlink(path.join(config.uploadDir, row.filename)).catch(() => {})
  res.json({ ok: true })
})

app.get('/uploads/:name', requireAuth, (req, res, next) => {
  const name = path.basename(req.params.name)
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).end()
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.sendFile(path.join(config.uploadDir, name), { maxAge: '30d', immutable: true }, (err) => {
    if (err) next(err.code === 'ENOENT' ? { status: 404 } : err)
  })
})

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  if (req.path !== '/' && req.path !== '/index.html') return next()
  if (req.user) return next()
  return res.redirect(302, '/login.html')
})

app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'] }))

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' })
  res.status(404).sendFile(path.join(config.root, 'public', '404.html'))
})

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  const status = err.status || 500
  if (status >= 500) console.error(err)
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: status === 500 ? '服务器错误' : err.message || '请求失败' })
  }
  res.status(status).send('请求失败')
})

store.purgeExpiredSessions()
setInterval(() => store.purgeExpiredSessions(), 6 * 60 * 60 * 1000).unref()

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] listening on http://${config.host}:${config.port}`)
})

function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
