CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date DATE,
    merchant TEXT,
    category TEXT,
    amount NUMERIC,
    currency TEXT,
    memo TEXT
);

CREATE TABLE IF NOT EXISTS funds (
    id TEXT PRIMARY KEY,
    name TEXT,
    category TEXT
);

CREATE TABLE IF NOT EXISTS fund_nav (
    id SERIAL PRIMARY KEY,
    fund_id TEXT REFERENCES funds(id),
    nav_date DATE,
    nav NUMERIC
);

CREATE TABLE IF NOT EXISTS holdings (
    id SERIAL PRIMARY KEY,
    fund_id TEXT,
    fund_name TEXT,
    units NUMERIC,
    purchase_date DATE,
    purchase_nav NUMERIC
);