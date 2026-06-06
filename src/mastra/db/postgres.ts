import { Pool } from "pg";

const isRender = process.env.DATABASE_URL?.includes("render.com");

export const pool = new Pool(
  isRender
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        host: "localhost",
        port: 5432,
        user: "postgres",
        password: "postgres",
        database: "provue_tara",
        ssl: false,
      }
);