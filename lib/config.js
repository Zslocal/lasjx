const path = require('node:path')

const root = path.join(__dirname, '..')

module.exports = {
  root,
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'data', 'uploads'),
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'timeline.db'),
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  sessionDays: Number(process.env.SESSION_DAYS) || 30,
  maxFileSize: (Number(process.env.MAX_FILE_MB) || 200) * 1024 * 1024,
  maxFilesPerPost: Number(process.env.MAX_FILES_PER_POST) || 10,
  seedAdmin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
  seedUser: {
    username: process.env.USER_USERNAME || 'couple',
    password: process.env.USER_PASSWORD || 'couple123',
  },
}
