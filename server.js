const express = require('express')
const multer = require('multer')
const sqlite3 = require('sqlite3').verbose()
const cron = require('node-cron')
const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const cors = require('cors')

const app = express()
const PORT = 3000

// --- Middleware ---
app.use(cors())
app.use(express.json())

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir)
}

// --- Multer Storage Config ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/')
  },
  filename: (req, file, cb) => {
    // Use a unique ID for the filename on disk to prevent collisions
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`
    cb(null, uniqueName)
  },
})
const upload = multer({ storage: storage })

// --- Database Setup (SQLite) ---
const db = new sqlite3.Database('./flashshare.db', (err) => {
  if (err) console.error('DB Connection Error:', err.message)
  else console.log('Connected to SQLite database.')
})

// Create Table
db.run(`CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    filename TEXT,
    filepath TEXT,
    originalName TEXT,
    createdAt INTEGER,
    expiresAt INTEGER,
    downloadsLeft INTEGER
)`)

// --- Helper: Delete File Wrapper ---
const deleteFile = (filePath, fileId) => {
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error(`Error deleting file ${filePath}:`, err)
    } else {
      console.log(`File deleted from disk: ${filePath}`)
    }
  })

  db.run(`DELETE FROM files WHERE id = ?`, [fileId], (err) => {
    if (err) console.error(`Error removing DB entry ${fileId}:`, err)
    else console.log(`DB entry removed: ${fileId}`)
  })
}

// --- Routes ---

// 1. Upload Route
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const fileId = uuidv4()
  const now = Date.now()
  const oneDay = 24 * 60 * 60 * 1000
  const expiresAt = now + oneDay

  const stmt = db.prepare(
    `INSERT INTO files (id, filename, filepath, originalName, createdAt, expiresAt, downloadsLeft) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )

  stmt.run(
    fileId,
    req.file.filename,
    req.file.path,
    req.file.originalname,
    now,
    expiresAt,
    1,
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' })
      }
      res.json({
        message: 'File uploaded successfully',
        fileId: fileId,
        expiresAt: new Date(expiresAt).toISOString(),
      })
    },
  )
  stmt.finalize()
})

// 2. Download/View Route (The "Burn" Logic)
app.get('/api/file/:id', (req, res) => {
  const fileId = req.params.id

  db.get(`SELECT * FROM files WHERE id = ?`, [fileId], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: 'File not found or has expired.' })
    }

    // Check expiration time
    if (Date.now() > row.expiresAt) {
      deleteFile(row.filepath, row.id)
      return res.status(410).json({ error: 'File expired.' })
    }

    // Check download limits
    if (row.downloadsLeft <= 0) {
      deleteFile(row.filepath, row.id)
      return res.status(410).json({ error: 'File already accessed.' })
    }

    // Send file
    res.download(row.filepath, row.originalName, (err) => {
      if (err) {
        console.error('Error sending file:', err)
      }

      // SELF DESTRUCT LOGIC: Decrement counter
      // We set downloadsLeft to 0 immediately to prevent race conditions
      // if multiple requests hit at once, though SQLite isn't great at concurrency.
      // For this project, we assume "1 download" means "1 successful request".

      const newCount = row.downloadsLeft - 1

      if (newCount <= 0) {
        console.log(`Limit reached for ${fileId}. Self-destructing...`)
        deleteFile(row.filepath, row.id)
      } else {
        db.run(`UPDATE files SET downloadsLeft = ? WHERE id = ?`, [
          newCount,
          fileId,
        ])
      }
    })
  })
})

// 3. File Info Route (Metadata only)
app.get('/api/info/:id', (req, res) => {
  db.get(
    `SELECT originalName, expiresAt, downloadsLeft FROM files WHERE id = ?`,
    [req.params.id],
    (err, row) => {
      if (err || !row) return res.status(404).json({ error: 'File not found' })
      res.json(row)
    },
  )
})

// --- Cron Job: The "Garbage Collector" ---
// Runs every hour to clean up files that expired by time (even if not downloaded)
cron.schedule('0 * * * *', () => {
  console.log('Running scheduled cleanup...')
  const now = Date.now()

  db.all(`SELECT * FROM files WHERE expiresAt < ?`, [now], (err, rows) => {
    if (err) return console.error('Cron DB Error:', err)

    rows.forEach((row) => {
      console.log(`Cron deleting expired file: ${row.id}`)
      deleteFile(row.filepath, row.id)
    })
  })
})

app.listen(PORT, () => {
  console.log(`FlashShare server running on http://localhost:${PORT}`)
})
