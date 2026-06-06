import { Pool } from "pg";

const url = "postgresql://postgres:postgres@localhost:5432/provue_tara";
console.log("Using URL:", url);

const pool = new Pool({ connectionString: url, ssl: false });

try {
  await pool.query("DELETE FROM transactions WHERE id = 'test1'");
  const r = await pool.query("SELECT COUNT(*) FROM transactions");
  console.log("Count before ingest:", r.rows[0].count);
  
  await pool.query(`
    INSERT INTO transactions (id, date, merchant, canonical_merchant, category, amount, currency, memo)
    VALUES ('test2', '2024-01-01', 'Swiggy', 'SWIGGY', 'food', 250.00, 'INR', 'test')
    ON CONFLICT (id) DO NOTHING
  `);
  
  const r2 = await pool.query("SELECT COUNT(*) FROM transactions");
  console.log("Count after insert:", r2.rows[0].count);
} catch(e) {
  console.error("ERROR:", e.message);
} finally {
  await pool.end();
}