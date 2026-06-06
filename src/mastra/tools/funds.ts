import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db/postgres";

export const queryFunds = createTool({
  id: "query_funds",
  description: `Query fund NAV history, compute period returns, and calculate the user's 
  realised returns on holdings. Use for fund performance questions, portfolio value, 
  and investment return calculations.`,
  inputSchema: z.object({
    mode: z.enum([
      "period_return",
      "all_funds_return", 
      "holding_return",
      "portfolio_value",
      "list_funds",
    ]).describe("What to compute"),
    fund_id: z.string().optional().describe("Specific fund id"),
    fund_name_search: z.string().optional().describe("Partial fund name to search"),
    date_from: z.string().optional().describe("Start date YYYY-MM-DD for period return"),
    date_to: z.string().optional().describe("End date YYYY-MM-DD for period return"),
  }),
  execute: async ({ context }) => {
    const { mode, fund_id, fund_name_search, date_from, date_to } = context;

    if (mode === "list_funds") {
      const res = await pool.query(
        `SELECT f.id, f.name, f.category,
          MIN(fn.date) as nav_from,
          MAX(fn.date) as nav_to
         FROM funds f
         LEFT JOIN fund_nav fn ON f.id = fn.fund_id
         GROUP BY f.id, f.name, f.category
         ORDER BY f.name`
      );
      return { rows: res.rows };
    }

    if (mode === "period_return") {
      let fundFilter = "";
      const params: any[] = [];
      let i = 1;

      if (fund_id) {
        fundFilter = `AND f.id = $${i++}`;
        params.push(fund_id);
      } else if (fund_name_search) {
        fundFilter = `AND LOWER(f.name) LIKE LOWER($${i++})`;
        params.push(`%${fund_name_search}%`);
      }

      const startDate = date_from || "2024-01-01";
      const endDate = date_to || new Date().toISOString().split("T")[0];

      params.push(startDate, endDate);

      const res = await pool.query(
        `SELECT
          f.id,
          f.name,
          f.category,
          start_nav.nav as start_nav,
          end_nav.nav as end_nav,
          start_nav.date as start_date,
          end_nav.date as end_date,
          ROUND(((end_nav.nav - start_nav.nav) / start_nav.nav * 100)::numeric, 2) as period_return_pct,
          ROUND((end_nav.nav - start_nav.nav)::numeric, 4) as nav_change
         FROM funds f
         JOIN LATERAL (
           SELECT nav, date FROM fund_nav
           WHERE fund_id = f.id AND date >= $${i - 1}
           ORDER BY date ASC LIMIT 1
         ) start_nav ON true
         JOIN LATERAL (
           SELECT nav, date FROM fund_nav
           WHERE fund_id = f.id AND date <= $${i}
           ORDER BY date DESC LIMIT 1
         ) end_nav ON true
         WHERE 1=1 ${fundFilter}
         ORDER BY period_return_pct DESC`,
        params
      );
      return { rows: res.rows };
    }

    if (mode === "all_funds_return") {
      const startDate = date_from || "2024-01-01";
      const endDate = date_to || new Date().toISOString().split("T")[0];

      const res = await pool.query(
        `SELECT
          f.id,
          f.name,
          f.category,
          start_nav.nav as start_nav,
          end_nav.nav as end_nav,
          ROUND(((end_nav.nav - start_nav.nav) / start_nav.nav * 100)::numeric, 2) as period_return_pct
         FROM funds f
         JOIN LATERAL (
           SELECT nav FROM fund_nav
           WHERE fund_id = f.id AND date >= $1
           ORDER BY date ASC LIMIT 1
         ) start_nav ON true
         JOIN LATERAL (
           SELECT nav FROM fund_nav
           WHERE fund_id = f.id AND date <= $2
           ORDER BY date DESC LIMIT 1
         ) end_nav ON true
         ORDER BY period_return_pct DESC`,
        [startDate, endDate]
      );

      const rows = res.rows;
      const best = rows[0];
      const worst = rows[rows.length - 1];
      const spread = best && worst
        ? Math.round((best.period_return_pct - worst.period_return_pct) * 100) / 100
        : null;

      return { rows, best, worst, spread };
    }

    if (mode === "holding_return") {
      let filter = "";
      const params: any[] = [];
      let i = 1;

      if (fund_id) {
        filter = `AND h.fund_id = $${i++}`;
        params.push(fund_id);
      } else if (fund_name_search) {
        filter = `AND LOWER(h.fund_name) LIKE LOWER($${i++})`;
        params.push(`%${fund_name_search}%`);
      }

      const res = await pool.query(
        `SELECT
          h.id,
          h.fund_name,
          h.fund_id,
          h.units,
          h.purchase_date,
          h.purchase_nav,
          latest_nav.nav as current_nav,
          latest_nav.date as current_nav_date,
          ROUND((h.units * h.purchase_nav)::numeric, 2) as purchase_cost,
          ROUND((h.units * latest_nav.nav)::numeric, 2) as current_value,
          ROUND((h.units * latest_nav.nav - h.units * h.purchase_nav)::numeric, 2) as absolute_return,
          ROUND(((latest_nav.nav - h.purchase_nav) / h.purchase_nav * 100)::numeric, 2) as return_pct
         FROM holdings h
         JOIN LATERAL (
           SELECT nav, date FROM fund_nav
           WHERE fund_id = h.fund_id
           ORDER BY date DESC LIMIT 1
         ) latest_nav ON true
         WHERE 1=1 ${filter}
         ORDER BY return_pct DESC`,
        params
      );
      return { rows: res.rows };
    }

    if (mode === "portfolio_value") {
      const res = await pool.query(
        `SELECT
          h.fund_name,
          h.units,
          h.purchase_nav,
          latest_nav.nav as current_nav,
          latest_nav.date as current_nav_date,
          ROUND((h.units * h.purchase_nav)::numeric, 2) as purchase_cost,
          ROUND((h.units * latest_nav.nav)::numeric, 2) as current_value,
          ROUND((h.units * latest_nav.nav - h.units * h.purchase_nav)::numeric, 2) as absolute_return,
          ROUND(((latest_nav.nav - h.purchase_nav) / h.purchase_nav * 100)::numeric, 2) as return_pct
         FROM holdings h
         JOIN LATERAL (
           SELECT nav, date FROM fund_nav
           WHERE fund_id = h.fund_id
           ORDER BY date DESC LIMIT 1
         ) latest_nav ON true
         ORDER BY current_value DESC`
      );

      const rows = res.rows;
      const totalValue = rows.reduce((sum: number, r: any) => sum + parseFloat(r.current_value), 0);
      const totalCost = rows.reduce((sum: number, r: any) => sum + parseFloat(r.purchase_cost), 0);
      const totalReturn = totalValue - totalCost;
      const totalReturnPct = totalCost > 0 ? Math.round((totalReturn / totalCost) * 10000) / 100 : 0;

      return {
        holdings: rows,
        summary: {
          total_current_value: Math.round(totalValue * 100) / 100,
          total_purchase_cost: Math.round(totalCost * 100) / 100,
          total_absolute_return: Math.round(totalReturn * 100) / 100,
          total_return_pct: totalReturnPct,
        },
      };
    }

    return { error: "Unknown mode" };
  },
});