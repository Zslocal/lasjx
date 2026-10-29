const crypto = require('node:crypto')

const SCRYPT_KEYLEN = 64
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  let candidate
  try {
    candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS)
  } catch {
    return false
  }
  const expected = Buffer.from(hash, 'hex')
  if (expected.length !== candidate.length) return false
  return crypto.timingSafeEqual(expected, candidate)
}

function createToken() {
  return crypto.randomBytes(32).toString('hex')
}

function tokenId(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

module.exports = { hashPassword, verifyPassword, createToken, tokenId }
