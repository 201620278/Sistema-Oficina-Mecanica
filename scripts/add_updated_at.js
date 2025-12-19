const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'database.db');

console.log('Opening DB:', dbPath);
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error('Failed to open DB:', err.message);
    process.exit(1);
  }

  const sql = `ALTER TABLE transacoes ADD COLUMN updated_at TEXT`;
  db.run(sql, [], function(runErr) {
    if (runErr) {
      const msg = String(runErr.message || '');
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('duplicate column')) {
        console.log('Column already exists (or similar), nothing to do:', msg);
        db.close();
        process.exit(0);
      }
      console.error('Error adding column:', runErr.message);
      db.close();
      process.exit(1);
    }
    console.log('Column `updated_at` added successfully.');
    db.close();
    process.exit(0);
  });
});