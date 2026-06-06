import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const queryTransactionsTool = createTool({
  id: 'query_transactions',
  description: `Query transactions. Use for spending questions, merchant lookups, category totals, date filters. Excludes transfers by default.`,
  inputSchema: z.object({
  category: z.string().nullable().optional()
    .describe("Category to filter by e.g. food, travel"),

  merchant_search: z.string().nullable().optional()
    .describe("Partial merchant name to search"),

  date_from: z.string().nullable().optional()
    .describe("Start date YYYY-MM-DD"),

  date_to: z.string().nullable().optional()
    .describe("End date YYYY-MM-DD"),

  include_refunds: z.boolean().optional(),

  include_transfers: z.boolean().optional(),

  aggregate: z.enum([
    'sum',
    'count',
    'top_merchants',
    'monthly_breakdown',
    'category_comparison',
    'list'
  ]).optional(),

  limit: z.number().optional()
}),
  execute: async (input: any) => {
  console.log("=== QUERY TRANSACTIONS TOOL EXECUTED ===");
  console.log(JSON.stringify(input, null, 2));

  const {
    category = null,
    merchant_search = null,
    date_from = null,
    date_to = null,
    include_refunds = false,
    include_transfers = false,
    aggregate = 'sum',
    limit = 10
  } = input ?? {};

    const conditions: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (category && category !== '') {
      conditions.push(`category ILIKE $${pi++}`);
      params.push(category);
    }
    if (merchant_search && merchant_search !== '') {
      conditions.push(`(canonical_merchant ILIKE $${pi} OR merchant ILIKE $${pi + 1})`);
      params.push(`%${merchant_search}%`);
      params.push(`%${merchant_search}%`);
      pi += 2;
    }
    if (date_from && date_from !== '') {
      conditions.push(`date >= $${pi++}`);
      params.push(date_from);
    }
    if (date_to && date_to !== '') {
      conditions.push(`date <= $${pi++}`);
      params.push(date_to);
    }
    if (!include_refunds) {
      conditions.push(`amount > 0`);
    }
    if (!include_transfers) {
      conditions.push(`category != 'transfer'`);
    }

    const WHERE = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      if (aggregate === 'sum') {
        const res = await pool.query(
          `SELECT ROUND(SUM(amount)::numeric, 2) as total, COUNT(*) as count FROM transactions ${WHERE}`,
          params
        );
        const row = res.rows[0];
        return { total: parseFloat(row.total) || 0, count: parseInt(row.count), currency: 'INR' };
      }

      if (aggregate === 'top_merchants') {
        const res = await pool.query(
          `SELECT canonical_merchant, ROUND(SUM(amount)::numeric,2) as total, COUNT(*) as txn_count
           FROM transactions ${WHERE}
           GROUP BY canonical_merchant
           ORDER BY SUM(amount) DESC
           LIMIT $${pi}`,
          [...params, limit]
        );
        return { merchants: res.rows };
      }

      if (aggregate === 'monthly_breakdown') {
        const res = await pool.query(
          `SELECT TO_CHAR(date,'YYYY-MM') as month, ROUND(SUM(amount)::numeric,2) as total, COUNT(*) as count
           FROM transactions ${WHERE}
           GROUP BY TO_CHAR(date,'YYYY-MM')
           ORDER BY month ASC`,
          params
        );
        return { months: res.rows };
      }

      if (aggregate === 'category_comparison') {
        const res = await pool.query(
          `SELECT category, ROUND(SUM(amount)::numeric,2) as total, COUNT(*) as count
           FROM transactions ${WHERE}
           GROUP BY category
           ORDER BY SUM(amount) DESC`,
          params
        );
        return { categories: res.rows };
      }

      if (aggregate === 'count') {
        const res = await pool.query(`SELECT COUNT(*) as count FROM transactions ${WHERE}`, params);
        return { count: parseInt(res.rows[0].count) };
      }

      // 'list'
      const res = await pool.query(
        `SELECT id, date, merchant, canonical_merchant, category, amount, currency, memo
         FROM transactions ${WHERE}
         ORDER BY date DESC LIMIT $${pi}`,
        [...params, limit]
      );
      if (res.rows.length === 0) return { found: false, message: 'No transactions found.' };
      return { found: true, rows: res.rows, count: res.rows.length };

    } catch (err: any) {
      return { error: err.message };
    }
  },
});


export const queryPortfolioTool = createTool({
  id: 'query_portfolio',
  description: `Query mutual fund NAV and holdings. Modes: period_return, holding_return, portfolio_value, rank_funds, list_holdings.`,
  inputSchema: z.object({
    mode: z.enum(['period_return', 'holding_return', 'portfolio_value', 'rank_funds', 'list_holdings']),
    fund_id: z.string().optional().default('').describe("Specific fund ID e.g. 'fund_bluechip'"),
    fund_name_search: z.string().optional().default('').describe("Partial fund name to search"),
    date_from: z.string().optional().default('').describe("Start date YYYY-MM-DD"),
    date_to: z.string().optional().default('').describe("End date YYYY-MM-DD"),
  }),
  execute: async ({ context }) => {
    const { mode, fund_id, fund_name_search, date_from, date_to } = context;

    try {
      let resolvedFundId = (fund_id && fund_id !== '') ? fund_id : undefined;

      if (!resolvedFundId && fund_name_search && fund_name_search !== '') {
        const res = await pool.query(
          `SELECT id, name FROM funds WHERE name ILIKE $1 LIMIT 1`,
          [`%${fund_name_search}%`]
        );
        if (res.rows.length === 0) return { found: false, message: `No fund found matching "${fund_name_search}"` };
        resolvedFundId = res.rows[0].id;
      }

      if (mode === 'period_return') {
        if (!resolvedFundId) return { error: 'fund_id or fund_name_search required for period_return' };
        const fundRes = await pool.query(`SELECT name FROM funds WHERE id=$1`, [resolvedFundId]);
        if (fundRes.rows.length === 0) return { found: false, message: `Fund not found: ${resolvedFundId}` };
        const fundName = fundRes.rows[0].name;

        let startNav: number, endNav: number, startDate: string, endDate: string;

        if (date_from && date_from !== '') {
          const s = await pool.query(
            `SELECT nav, date FROM fund_nav WHERE fund_id=$1 AND date >= $2 ORDER BY date ASC LIMIT 1`,
            [resolvedFundId, date_from]
          );
          if (s.rows.length === 0) return { found: false, message: `No NAV data from ${date_from}` };
          startNav = parseFloat(s.rows[0].nav);
          startDate = s.rows[0].date;
        } else {
          const s = await pool.query(`SELECT nav, date FROM fund_nav WHERE fund_id=$1 ORDER BY date ASC LIMIT 1`, [resolvedFundId]);
          startNav = parseFloat(s.rows[0].nav);
          startDate = s.rows[0].date;
        }

        if (date_to && date_to !== '') {
          const e = await pool.query(
            `SELECT nav, date FROM fund_nav WHERE fund_id=$1 AND date <= $2 ORDER BY date DESC LIMIT 1`,
            [resolvedFundId, date_to]
          );
          if (e.rows.length === 0) return { found: false, message: `No NAV data up to ${date_to}` };
          endNav = parseFloat(e.rows[0].nav);
          endDate = e.rows[0].date;
        } else {
          const e = await pool.query(`SELECT nav, date FROM fund_nav WHERE fund_id=$1 ORDER BY date DESC LIMIT 1`, [resolvedFundId]);
          endNav = parseFloat(e.rows[0].nav);
          endDate = e.rows[0].date;
        }

        const returnPct = ((endNav! - startNav!) / startNav! * 100).toFixed(2);
        return { fund_name: fundName, start_date: startDate!, end_date: endDate!, start_nav: startNav!, end_nav: endNav!, period_return_pct: parseFloat(returnPct) };
      }

      if (mode === 'holding_return') {
        let query = `
          SELECT h.fund_id, h.fund_name, h.units, h.purchase_date, h.purchase_nav,
                 n.nav as current_nav, n.date as current_nav_date
          FROM holdings h
          JOIN fund_nav n ON n.fund_id = h.fund_id
          WHERE n.date = (SELECT MAX(date) FROM fund_nav WHERE fund_id = h.fund_id)`;
        const params: any[] = [];
        if (resolvedFundId) {
          query += ` AND h.fund_id = $1`;
          params.push(resolvedFundId);
        }
        const res = await pool.query(query, params);
        if (res.rows.length === 0) return { found: false, message: 'No holdings found.' };
        const holdings = res.rows.map(h => {
          const currentValue = parseFloat(h.units) * parseFloat(h.current_nav);
          const purchaseCost = parseFloat(h.units) * parseFloat(h.purchase_nav);
          const gainLoss = currentValue - purchaseCost;
          return {
            fund_name: h.fund_name,
            units: parseFloat(h.units),
            purchase_date: h.purchase_date,
            purchase_nav: parseFloat(h.purchase_nav),
            current_nav: parseFloat(h.current_nav),
            current_nav_date: h.current_nav_date,
            current_value_inr: Math.round(currentValue * 100) / 100,
            purchase_cost_inr: Math.round(purchaseCost * 100) / 100,
            gain_loss_inr: Math.round(gainLoss * 100) / 100,
            return_pct: parseFloat(((gainLoss / purchaseCost) * 100).toFixed(2)),
          };
        });
        return resolvedFundId ? holdings[0] : { holdings };
      }

      if (mode === 'portfolio_value') {
        const res = await pool.query(`
          SELECT h.fund_name, h.units, h.purchase_nav,
                 n.nav as current_nav,
                 ROUND((h.units * n.nav)::numeric, 2) as current_value,
                 ROUND((h.units * h.purchase_nav)::numeric, 2) as cost_value
          FROM holdings h
          JOIN fund_nav n ON n.fund_id = h.fund_id
          WHERE n.date = (SELECT MAX(date) FROM fund_nav WHERE fund_id = h.fund_id)
        `);
        const totalValue = res.rows.reduce((s, r) => s + parseFloat(r.current_value), 0);
        const totalCost  = res.rows.reduce((s, r) => s + parseFloat(r.cost_value), 0);
        return {
          portfolio_value_inr: Math.round(totalValue * 100) / 100,
          total_invested_inr: Math.round(totalCost * 100) / 100,
          total_gain_loss_inr: Math.round((totalValue - totalCost) * 100) / 100,
          return_pct: parseFloat(((totalValue - totalCost) / totalCost * 100).toFixed(2)),
          holdings: res.rows,
        };
      }

      if (mode === 'rank_funds') {
        const startDateStr = (date_from && date_from !== '') ? date_from : '2024-01-01';
        const endDateStr   = (date_to   && date_to   !== '') ? date_to   : '2025-01-01';
        const res = await pool.query(`
          SELECT f.id, f.name,
            s.nav as start_nav, s.date as start_date,
            e.nav as end_nav,   e.date as end_date,
            ROUND(((e.nav - s.nav) / s.nav * 100)::numeric, 2) as return_pct
          FROM funds f
          JOIN fund_nav s ON s.fund_id = f.id AND s.date = (
            SELECT date FROM fund_nav WHERE fund_id=f.id AND date >= $1 ORDER BY date LIMIT 1)
          JOIN fund_nav e ON e.fund_id = f.id AND e.date = (
            SELECT date FROM fund_nav WHERE fund_id=f.id AND date <= $2 ORDER BY date DESC LIMIT 1)
          ORDER BY return_pct DESC
        `, [startDateStr, endDateStr]);
        if (res.rows.length === 0) return { found: false, message: 'No fund data for that period.' };
        const ranked = res.rows.map((r, i) => ({ rank: i + 1, ...r, return_pct: parseFloat(r.return_pct) }));
        return { funds: ranked, spread_pct: parseFloat((ranked[0].return_pct - ranked[ranked.length-1].return_pct).toFixed(2)), period: { from: startDateStr, to: endDateStr } };
      }

      if (mode === 'list_holdings') {
        const res = await pool.query(`SELECT fund_id, fund_name, units, purchase_date, purchase_nav FROM holdings`);
        if (res.rows.length === 0) return { found: false, message: 'No holdings in database.' };
        return { holdings: res.rows };
      }

      return { error: 'Unknown mode' };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});


export const detectRecurringTool = createTool({
  id: 'detect_recurring',
  description: `Find recurring subscription merchants (appear 3+ months with consistent amounts).`,
  inputSchema: z.object({
    min_months: z.number().optional().default(3),
  }),
  execute: async ({ context }) => {
    const { min_months } = context;
    try {
      const res = await pool.query(`
        SELECT
          canonical_merchant,
          COUNT(DISTINCT TO_CHAR(date,'YYYY-MM')) as month_count,
          ROUND(AVG(amount)::numeric, 2) as avg_amount,
          ROUND(STDDEV(amount)::numeric, 2) as stddev_amount,
          MIN(date) as first_seen,
          MAX(date) as last_seen
        FROM transactions
        WHERE amount > 0 AND category != 'transfer'
        GROUP BY canonical_merchant
        HAVING COUNT(DISTINCT TO_CHAR(date,'YYYY-MM')) >= $1
        ORDER BY month_count DESC, avg_amount DESC
      `, [min_months]);

      const recurring = res.rows
        .filter(r => {
          const stddev = parseFloat(r.stddev_amount) || 0;
          const avg    = parseFloat(r.avg_amount)    || 1;
          return (stddev / avg) < 0.3;
        })
        .map(r => ({
          merchant: r.canonical_merchant,
          months_active: parseInt(r.month_count),
          avg_monthly_amount: parseFloat(r.avg_amount),
          first_seen: r.first_seen,
          last_seen: r.last_seen,
        }));

      if (recurring.length === 0) return { found: false, message: 'No recurring subscriptions detected.' };
      return { recurring_merchants: recurring, count: recurring.length };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});