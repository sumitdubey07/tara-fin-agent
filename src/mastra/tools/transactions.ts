import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db/postgres";

export const queryTransactions = createTool({
  id: "query_transactions",
  description: `Query the user's transactions. Use for spending questions, merchant lookups, 
  category totals, month-over-month comparisons, refunds, recurring subscriptions.
  Automatically excludes transfers unless include_transfers is true.`,
  inputSchema: z.object({
    category: z.string().optional().describe("Filter by category e.g. food, travel"),
    merchant_search: z.string().optional().describe("Partial merchant name to search"),
    date_from: z.string().optional().describe("Start date YYYY-MM-DD"),
    date_to: z.string().optional().describe("End date YYYY-MM-DD"),
    aggregate: z.enum(["total", "by_month", "by_category", "by_merchant", "top_merchants", "recurring", "list"]).default("total").optional(),
    limit: z.number().optional(),
include_transfers: z.boolean().optional(),
  }),
  execute: async ({ context }) => {
    const { category, merchant_search, date_from, date_to, aggregate, limit, include_transfers } = context;

    const conditions: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (!include_transfers) {
      conditions.push(`LOWER(category) NOT IN ('transfer', 'transfers')`);
    }
    if (category) {
      conditions.push(`LOWER(category) LIKE LOWER($${i++})`);
      params.push(`%${category}%`);
    }
    if (merchant_search) {
      conditions.push(`LOWER(merchant) LIKE LOWER($${i++})`);
      params.push(`%${merchant_search}%`);
    }
    if (date_from) {
      conditions.push(`date >= $${i++}`);
      params.push(date_from);
    }
    if (date_to) {
      conditions.push(`date <= $${i++}`);
      params.push(date_to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    if (aggregate === "total") {
      const res = await pool.query(
        `SELECT
          COUNT(*) as transaction_count,
          ROUND(SUM(amount)::numeric, 2) as net_spend,
          ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)::numeric, 2) as gross_spend,
          ROUND(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)::numeric, 2) as total_refunds
         FROM transactions ${where}`,
        params
      );
      return res.rows[0];
    }

    if (aggregate === "by_month") {
      const res = await pool.query(
        `SELECT
          TO_CHAR(date, 'YYYY-MM') as month,
          ROUND(SUM(amount)::numeric, 2) as net_spend,
          COUNT(*) as transaction_count
         FROM transactions ${where}
         GROUP BY month ORDER BY month`,
        params
      );
      return { rows: res.rows };
    }

    if (aggregate === "by_category") {
      const res = await pool.query(
        `SELECT
          category,
          ROUND(SUM(amount)::numeric, 2) as net_spend,
          COUNT(*) as transaction_count
         FROM transactions ${where}
         GROUP BY category ORDER BY net_spend DESC`,
        params
      );
      return { rows: res.rows };
    }

    if (aggregate === "top_merchants" || aggregate === "by_merchant") {
      const res = await pool.query(
        `SELECT
          merchant,
          ROUND(SUM(amount)::numeric, 2) as net_spend,
          COUNT(*) as transaction_count
         FROM transactions ${where}
         GROUP BY merchant ORDER BY net_spend DESC
         LIMIT $${i++}`,
        [...params, limit]
      );
      return { rows: res.rows };
    }

    if (aggregate === "recurring") {
      const res = await pool.query(
        `SELECT
          merchant,
          COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) as months_active,
          ROUND(AVG(amount)::numeric, 2) as avg_amount,
          ROUND(SUM(amount)::numeric, 2) as total_spent
         FROM transactions ${where}
         GROUP BY merchant
         HAVING COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) >= 3
         ORDER BY months_active DESC
         LIMIT $${i++}`,
        [...params, limit]
      );
      return { rows: res.rows };
    }

    if (aggregate === "list") {
      const res = await pool.query(
        `SELECT id, date, merchant, category, amount, currency, memo
         FROM transactions ${where}
         ORDER BY date DESC LIMIT $${i++}`,
        [...params, limit]
      );
      return { rows: res.rows };
    }

    return { error: "Unknown aggregate type" };
  },
});