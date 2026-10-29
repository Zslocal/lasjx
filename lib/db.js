const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const config = require('./config')
const { hashPassword, tokenId } = require('./security')

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true })
fs.mkdirSync(config.uploadDir, { recursive: true })

const db = new DatabaseSync(config.dbFile)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'file')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_posts_event_date ON posts(event_date DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_media_post ON media(post_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`)

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  if (count > 0) return

  const insert = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
  insert.run(config.seedAdmin.username, hashPassword(config.seedAdmin.password), 'admin')
  insert.run(config.seedUser.username, hashPassword(config.seedUser.password), 'user')

  console.log('[init] created default accounts:')
  console.log(`[init]   admin -> ${config.seedAdmin.username} / ${config.seedAdmin.password}`)
  console.log(`[init]   user  -> ${config.seedUser.username} / ${config.seedUser.password}`)
  console.log('[init] please change these passwords after first login')
}

seed()

function userByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username)
}

function userById(id) {
  return db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id)
}

function createSession(userId, token, expiresAt) {
  db.prepare('INSERT INTO sessions (token_id, user_id, expires_at) VALUES (?, ?, ?)').run(
    tokenId(token),
    userId,
    expiresAt,
  )
}

function parseSqliteUtc(value) {
  if (!value) return new Date(0)
  return new Date(`${String(value).replace(' ', 'T')}Z`)
}

function sessionUser(token, now = new Date()) {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT s.token_id, s.expires_at, u.id, u.username, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_id = ?`,
    )
    .get(tokenId(token))
  if (!row) return null
  if (parseSqliteUtc(row.expires_at) <= now) {
    db.prepare('DELETE FROM sessions WHERE token_id = ?').run(row.token_id)
    return null
  }
  return { id: row.id, username: row.username, role: row.role }
}

function deleteSession(token) {
  if (!token) return
  db.prepare('DELETE FROM sessions WHERE token_id = ?').run(tokenId(token))
}

function deleteUserSessions(userId, keepToken) {
  if (keepToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_id != ?').run(
      userId,
      tokenId(keepToken),
    )
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }
}

function updatePassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId)
}

function listPosts({ limit, offset }) {
  const rows = db
    .prepare(
      `SELECT p.*, u.username AS author_name
       FROM posts p LEFT JOIN users u ON u.id = p.author_id
       ORDER BY p.event_date DESC, p.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset)
  const total = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n
  if (rows.length === 0) return { posts: [], total }

  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')
  const mediaRows = db
    .prepare(`SELECT * FROM media WHERE post_id IN (${placeholders}) ORDER BY id ASC`)
    .all(...ids)

  const grouped = new Map()
  for (const m of mediaRows) {
    if (!grouped.has(m.post_id)) grouped.set(m.post_id, [])
    grouped.get(m.post_id).push(m)
  }

  return {
    total,
    posts: rows.map((r) => ({ ...r, media: grouped.get(r.id) || [] })),
  }
}

function postById(id) {
  const post = db
    .prepare(
      `SELECT p.*, u.username AS author_name
       FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
    )
    .get(id)
  if (!post) return null
  post.media = db.prepare('SELECT * FROM media WHERE post_id = ? ORDER BY id ASC').all(id)
  return post
}

function createPost({ title, content, eventDate, authorId }) {
  const info = db
    .prepare('INSERT INTO posts (title, content, event_date, author_id) VALUES (?, ?, ?, ?)')
    .run(title, content, eventDate, authorId)
  return postById(Number(info.lastInsertRowid))
}

function updatePost(id, { title, content, eventDate }) {
  db.prepare(
    "UPDATE posts SET title = ?, content = ?, event_date = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(title, content, eventDate, id)
  return postById(id)
}

function deletePost(id) {
  const mediaRows = db.prepare('SELECT filename FROM media WHERE post_id = ?').all(id)
  db.prepare('DELETE FROM posts WHERE id = ?').run(id)
  return mediaRows.map((m) => m.filename)
}

function addMedia(postId, items) {
  const insert = db.prepare(
    'INSERT INTO media (post_id, filename, original_name, mime, size, kind) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const item of items) {
    insert.run(postId, item.filename, item.originalName, item.mime, item.size, item.kind)
  }
}

function mediaById(id) {
  return db.prepare('SELECT * FROM media WHERE id = ?').get(id)
}

function removeMedia(id) {
  const row = mediaById(id)
  if (!row) return null
  db.prepare('DELETE FROM media WHERE id = ?').run(id)
  return row
}

function mediaFilenamesForPost(postId) {
  return db.prepare('SELECT filename FROM media WHERE post_id = ?').all(postId).map((r) => r.filename)
}

function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run()
}

function stats() {
  const row = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM posts) AS posts,
              (SELECT COUNT(*) FROM media) AS media,
              (SELECT MIN(event_date) FROM posts) AS firstDate,
              (SELECT MAX(event_date) FROM posts) AS lastDate`,
    )
    .get()
  let days = 0
  if (row.firstDate && row.lastDate) {
    const first = new Date(`${row.firstDate}T00:00:00Z`).getTime()
    const last = new Date(`${row.lastDate}T00:00:00Z`).getTime()
    days = Math.max(1, Math.round((last - first) / 86400000) + 1)
  }
  return { posts: row.posts, media: row.media, days }
}

module.exports = {
  db,
  userByUsername,
  userById,
  createSession,
  sessionUser,
  deleteSession,
  deleteUserSessions,
  updatePassword,
  listPosts,
  stats,
  postById,
  createPost,
  updatePost,
  deletePost,
  addMedia,
  mediaById,
  removeMedia,
  mediaFilenamesForPost,
  purgeExpiredSessions,
}
