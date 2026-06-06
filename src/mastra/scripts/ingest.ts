import fs from "fs";
import path from "path";
import { Pool } from "pg";

// Hardcode to bypass dotenvx override issue
// const DB_URL = process.env.DATABASE_URL?.includes("render.com")
//   ? process.env.DATABASE_URL
//   : "postgresql://postgres:postgres@localhost:5432/provue_tara";

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "postgres",
  database: "provue_tara",
  ssl: false,
});

const DATA_DIR = process.env.DATA_DIR || "./data/sample_a";

// Normalize merchant name — strips noise so aliases match
function normalizeMerchant(merchant: string): string {
  let m = merchant.toUpperCase().trim();
  const strip = [
    /\*ORDER\b/g, /\*BOOKING\b/g, /\*RIDE\b/g,
    /\bMUMBAI\b/g, /\bBANGALORE\b/g, /\bDELHI\b/g, /\bCHENNAI\b/g,
    /\bPVT\.?\s*LTD\.?\b/g, /\bLIMITED\b/g, /\bINDIA\b/g,
    /\bONLINE\b/g, /\.COM\b/g, /\.IN\b/g,
  ];
  for (const p of strip) m = m.replace(p, "");
  // Handle UPI/NEFT style: "UPI/571548/SWIGGY/swiggy@ybl" → "SWIGGY"
  if (m.startsWith("NEFT/") || m.startsWith("UPI/")) {
    const parts = m.split("/");
    m = parts.find(p => p.length > 3 && !/^\d+$/.test(p) && p !== "SELF") || parts[1] || m;
  }
  m = m.replace(/[*_\-.]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = m.split(" ").filter(t => t.length > 2);
  return tokens.slice(0, 2).join(" ") || m;
}

async function ingestTransactions() {
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "transactions.json"), "utf-8"));
  await pool.query("TRUNCATE transactions CASCADE");
  let count = 0;
  for (const t of data) {
    const canonical = normalizeMerchant(t.merchant);
    await pool.query(
      `INSERT INTO transactions (id, date, merchant, canonical_merchant, category, amount, currency, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [
        t.id,
        t.date,
        t.merchant,
        canonical,
        t.category || "uncategorized",
        t.amount,
        t.currency || "INR",
        t.memo || "",
      ]
    );
    count++;
  }
  console.log(`✅ Inserted ${count} transactions`);
}

async function ingestFunds() {
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "funds.json"), "utf-8"));
  await pool.query("TRUNCATE fund_nav CASCADE");
  await pool.query("TRUNCATE funds CASCADE");
  for (const f of data) {
    await pool.query(
      `INSERT INTO funds (id, name, category) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
      [f.id, f.name, f.category]
    );
    const navHistory = f.nav_history || f.nav || [];
    for (const n of navHistory) {
      const navDate = n.date || n.nav_date;
      const navValue = n.nav || n.nav_value || n.value;
      if (navDate && navValue) {
        await pool.query(
          `INSERT INTO fund_nav (fund_id, date, nav) VALUES ($1,$2,$3) ON CONFLICT (fund_id, date) DO NOTHING`,
          [f.id, navDate, navValue]
        );
      }
    }
  }
  console.log(`✅ Inserted ${data.length} funds`);
}

async function ingestHoldings() {
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "holdings.json"), "utf-8"));
  await pool.query("TRUNCATE holdings CASCADE");
  for (const h of data) {
    await pool.query(
      `INSERT INTO holdings (fund_id, fund_name, units, purchase_date, purchase_nav)
       VALUES ($1,$2,$3,$4,$5)`,
      [h.fund_id, h.fund_name, h.units, h.purchase_date, h.purchase_nav]
    );
  }
  console.log(`✅ Inserted ${data.length} holdings`);
}

async function main() {
  console.log(`📂 Loading from: ${DATA_DIR}`);
  try {
    await ingestTransactions();
    await ingestFunds();
    await ingestHoldings();
    console.log("🎉 Ingest complete!");
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await pool.end();
  }
}

main();