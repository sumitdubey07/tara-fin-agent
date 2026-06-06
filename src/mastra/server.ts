import dotenv from "dotenv";
dotenv.config();
import express from "express";
import { pool } from "../mastra/db/postgres";

const app = express();
app.use(express.json());
const logs: any[] = [];

const SYSTEM_PROMPT = `You are Tara, a personal finance research assistant. Today is June 6, 2026. The financial data covers January 2024 to March 2025.

You MUST ALWAYS call a tool before responding. Never answer without calling a tool first.

CRITICAL DATE RULE: The data only covers up to March 2025. Always use dates within 2024-01-01 to 2025-03-31.
- "last month" or recent → use 2025-03-01 to 2025-03-31
- "this year" → use 2025-01-01 to 2025-03-31
- "Q1 2025" → 2025-01-01 to 2025-03-31
- "January 2025" → 2025-01-01 to 2025-01-31
- "February 2025" → 2025-02-01 to 2025-02-28
- "March 2025" → 2025-03-01 to 2025-03-31
- For recurring/all-time queries → use 2024-01-01 to 2025-03-31

Tool usage:
- spending/merchants/categories → query_transactions
- portfolio/funds/returns/NAV → query_funds
- "portfolio worth" → query_funds mode=portfolio_value
- "fund return" → query_funds mode=period_return with date_from=2024-01-01 date_to=2025-03-31
- "rank funds" → query_funds mode=all_funds_return
- "holding return" → query_funds mode=holding_return
- "recurring" → query_transactions aggregate=recurring date_from=2024-01-01 date_to=2025-03-31
- "top merchants" → query_transactions aggregate=top_merchants
- "by month" → query_transactions aggregate=by_month
- "by category" → query_transactions aggregate=by_category

Always exclude transfers. Show INR with 2 decimal places. Never invent numbers.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "query_transactions",
      description: "Query and aggregate user transactions. Use for spending, merchant, category, refund, recurring questions.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "category e.g. food, travel, entertainment" },
          merchant_search: { type: "string", description: "partial merchant name" },
          date_from: { type: "string", description: "start date YYYY-MM-DD" },
          date_to: { type: "string", description: "end date YYYY-MM-DD" },
          aggregate: { type: "string", enum: ["total", "by_month", "by_category", "by_merchant", "top_merchants", "recurring", "list"] },
          limit: { type: "number" },
          include_transfers: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_funds",
      description: "Query fund NAV, compute period returns, holding returns, portfolio value.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["period_return", "all_funds_return", "holding_return", "portfolio_value", "list_funds"] },
          fund_id: { type: "string" },
          fund_name_search: { type: "string" },
          date_from: { type: "string", description: "YYYY-MM-DD" },
          date_to: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["mode"],
      },
    },
  },
];

async function runTransactionQuery(args: any) {
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (!args.include_transfers) {
    conditions.push(`LOWER(category) NOT IN ('transfer', 'transfers')`);
  }
  if (args.category) {
    conditions.push(`LOWER(category) LIKE LOWER($${i++})`);
    params.push(`%${args.category}%`);
  }
  if (args.merchant_search) {
    conditions.push(`LOWER(merchant) LIKE LOWER($${i++})`);
    params.push(`%${args.merchant_search}%`);
  }
  if (args.date_from) {
    conditions.push(`date >= $${i++}`);
    params.push(args.date_from);
  }
  if (args.date_to) {
    conditions.push(`date <= $${i++}`);
    params.push(args.date_to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const aggregate = args.aggregate || "total";
  const limit = args.limit || 10;

  if (aggregate === "total") {
    const r = await pool.query(
      `SELECT COUNT(*) as count,
        ROUND(SUM(amount)::numeric,2) as net_spend,
        ROUND(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END)::numeric,2) as gross_spend,
        ROUND(SUM(CASE WHEN amount<0 THEN amount ELSE 0 END)::numeric,2) as refunds
       FROM transactions ${where}`, params);
    return r.rows[0];
  }
  if (aggregate === "by_month") {
    const r = await pool.query(
      `SELECT TO_CHAR(date,'YYYY-MM') as month,
        ROUND(SUM(amount)::numeric,2) as net_spend,
        COUNT(*) as count
       FROM transactions ${where}
       GROUP BY month ORDER BY month`, params);
    return { rows: r.rows };
  }
  if (aggregate === "by_category") {
    const r = await pool.query(
      `SELECT category,
        ROUND(SUM(amount)::numeric,2) as net_spend,
        COUNT(*) as count
       FROM transactions ${where}
       GROUP BY category ORDER BY net_spend DESC`, params);
    return { rows: r.rows };
  }
  if (aggregate === "top_merchants" || aggregate === "by_merchant") {
    const r = await pool.query(
      `SELECT merchant,
        ROUND(SUM(amount)::numeric,2) as net_spend,
        COUNT(*) as count
       FROM transactions ${where}
       GROUP BY merchant ORDER BY net_spend DESC
       LIMIT $${i++}`, [...params, limit]);
    return { rows: r.rows };
  }
  if (aggregate === "recurring") {
    const r = await pool.query(
      `SELECT merchant,
        COUNT(DISTINCT TO_CHAR(date,'YYYY-MM')) as months_active,
        ROUND(AVG(amount)::numeric,2) as avg_amount,
        ROUND(SUM(amount)::numeric,2) as total
       FROM transactions ${where}
       GROUP BY merchant
       HAVING COUNT(DISTINCT TO_CHAR(date,'YYYY-MM')) >= 3
       ORDER BY months_active DESC
       LIMIT $${i++}`, [...params, limit || 20]);
    return { rows: r.rows };
  }
  if (aggregate === "list") {
    const r = await pool.query(
      `SELECT id,date,merchant,category,amount,currency,memo
       FROM transactions ${where}
       ORDER BY date DESC LIMIT $${i++}`, [...params, limit]);
    return { rows: r.rows };
  }
  return { error: "unknown aggregate" };
}

async function runFundQuery(args: any) {
  if (args.mode === "list_funds") {
    const r = await pool.query(
      `SELECT f.id, f.name, f.category,
        MIN(fn.date) as nav_from, MAX(fn.date) as nav_to
       FROM funds f LEFT JOIN fund_nav fn ON f.id=fn.fund_id
       GROUP BY f.id,f.name,f.category ORDER BY f.name`);
    return { rows: r.rows };
  }
  if (args.mode === "period_return" || args.mode === "all_funds_return") {
    const startDate = args.date_from || "2024-01-01";
    const endDate = args.date_to || "2025-03-31";
    let filter = "";
    const params: any[] = [startDate, endDate];
    if (args.fund_id) { filter = `AND f.id = $3`; params.push(args.fund_id); }
    else if (args.fund_name_search) { filter = `AND LOWER(f.name) LIKE LOWER($3)`; params.push(`%${args.fund_name_search}%`); }
    const r = await pool.query(
      `SELECT f.id, f.name, f.category,
        s.nav as start_nav, s.date as start_date,
        e.nav as end_nav, e.date as end_date,
        ROUND(((e.nav-s.nav)/s.nav*100)::numeric,2) as return_pct
       FROM funds f
       JOIN LATERAL (SELECT nav,date FROM fund_nav WHERE fund_id=f.id AND date>=$1 ORDER BY date ASC LIMIT 1) s ON true
       JOIN LATERAL (SELECT nav,date FROM fund_nav WHERE fund_id=f.id AND date<=$2 ORDER BY date DESC LIMIT 1) e ON true
       WHERE 1=1 ${filter}
       ORDER BY return_pct DESC`, params);
    const rows = r.rows;
    if (rows.length > 1) {
      return { rows, best: rows[0], worst: rows[rows.length-1], spread: Math.round((Number(rows[0].return_pct) - Number(rows[rows.length-1].return_pct))*100)/100 };
    }
    return { rows };
  }
  if (args.mode === "holding_return") {
    let filter = "";
    const params: any[] = [];
    if (args.fund_id) { filter = `AND h.fund_id=$1`; params.push(args.fund_id); }
    else if (args.fund_name_search) { filter = `AND LOWER(h.fund_name) LIKE LOWER($1)`; params.push(`%${args.fund_name_search}%`); }
    const r = await pool.query(
      `SELECT h.fund_name, h.units, h.purchase_date, h.purchase_nav,
        n.nav as current_nav, n.date as current_date,
        ROUND((h.units*h.purchase_nav)::numeric,2) as cost,
        ROUND((h.units*n.nav)::numeric,2) as current_value,
        ROUND((h.units*n.nav-h.units*h.purchase_nav)::numeric,2) as absolute_return,
        ROUND(((n.nav-h.purchase_nav)/h.purchase_nav*100)::numeric,2) as return_pct
       FROM holdings h
       JOIN LATERAL (SELECT nav,date FROM fund_nav WHERE fund_id=h.fund_id ORDER BY date DESC LIMIT 1) n ON true
       WHERE 1=1 ${filter}
       ORDER BY return_pct DESC`, params);
    return { rows: r.rows };
  }
  if (args.mode === "portfolio_value") {
    const r = await pool.query(
      `SELECT h.fund_name, h.units, h.purchase_nav,
        n.nav as current_nav, n.date as current_date,
        ROUND((h.units*h.purchase_nav)::numeric,2) as cost,
        ROUND((h.units*n.nav)::numeric,2) as current_value,
        ROUND((h.units*n.nav-h.units*h.purchase_nav)::numeric,2) as gain,
        ROUND(((n.nav-h.purchase_nav)/h.purchase_nav*100)::numeric,2) as return_pct
       FROM holdings h
       JOIN LATERAL (SELECT nav,date FROM fund_nav WHERE fund_id=h.fund_id ORDER BY date DESC LIMIT 1) n ON true
       ORDER BY current_value DESC`);
    const rows = r.rows;
    const totalValue = rows.reduce((s:number,r:any)=>s+parseFloat(r.current_value),0);
    const totalCost = rows.reduce((s:number,r:any)=>s+parseFloat(r.cost),0);
    return { holdings: rows, total_value: Math.round(totalValue*100)/100, total_cost: Math.round(totalCost*100)/100, total_gain: Math.round((totalValue-totalCost)*100)/100 };
  }
  return { error: "unknown mode" };
}

// NO RETRIES — one call only, return error message if rate limited
async function callGroq(messages: any[]): Promise<any> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 2048,
    }),
  });

  if (response.status === 429) {
    console.log("Rate limited by Groq");
    return { choices: [{ message: { content: "I am currently rate limited. Please try again in 30 seconds." } }] };
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }

  return response.json();
}

app.post("/ask", async (req, res) => {
  const requestId = `req_${Date.now()}`;
  const start = Date.now();
  const { question } = req.body;

  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  console.log(`\n[${requestId}] Question: ${question}`);
  const toolsCalled: any[] = [];

  try {
    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question },
    ];

    let answer = "";

    for (let step = 0; step < 5; step++) {
      const data = await callGroq(messages);
      const msg = data.choices?.[0]?.message;

      if (!msg) break;
      messages.push(msg);

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          const fnName = tc.function.name;
          const fnArgs = JSON.parse(tc.function.arguments);
          console.log(`[${requestId}] Tool: ${fnName}`, JSON.stringify(fnArgs).substring(0, 200));
          toolsCalled.push({ tool: fnName, input: fnArgs });

          let toolResult;
          try {
            if (fnName === "query_transactions") {
              toolResult = await runTransactionQuery(fnArgs);
            } else if (fnName === "query_funds") {
              toolResult = await runFundQuery(fnArgs);
            } else {
              toolResult = { error: "unknown tool" };
            }
          } catch (toolErr: any) {
            console.error(`[${requestId}] Tool error:`, toolErr.message);
            toolResult = { error: toolErr.message };
          }

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult),
          });
        }
      } else {
        answer = msg.content || "";
        break;
      }
    }

    const latency = Date.now() - start;
    logs.push({ request_id: requestId, question, tools_called: toolsCalled, status: "success", latency_ms: latency, answer });
    console.log(`[${requestId}] ✅ Done in ${latency}ms`);
    console.log(`[${requestId}] Answer: ${answer.substring(0, 300)}`);
    res.json({ answer });

  } catch (err: any) {
    const latency = Date.now() - start;
    logs.push({ request_id: requestId, question, tools_called: toolsCalled, status: "error", error: err.message, latency_ms: latency });
    console.error(`[${requestId}] ❌ Error:`, err.message);
    res.status(500).json({ error: "Something went wrong", details: err.message });
  }
});

app.get("/logs", (req, res) => { res.json(logs); });
app.get("/health", (req, res) => { res.json({ status: "ok" }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Tara running on http://localhost:${PORT}`); });