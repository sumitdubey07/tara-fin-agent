# Tara — Personal Finance Research Agent

AI agent that answers natural-language questions about personal finances using a Postgres database.

## Deployed URL
https://tara-agent-n1x0.onrender.com

## Test it
```bash
curl -X POST https://tara-agent-n1x0.onrender.com/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "How much did I spend on food in January 2024?"}'
```

## Local Setup

1. Install Node 18+
2. Clone repo: `git clone https://github.com/sumitdubey07/tara-fin-agent.git`
3. Install: `npm install`
4. Create `.env`:

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/provue_tara
GROQ_API_KEY=your-key-here

5. Start Postgres (Docker): `docker run -d --name provue-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`
6. Create DB: `psql -U postgres -c "CREATE DATABASE provue_tara;"`
7. Create tables: `psql -U postgres -d provue_tara -f src/mastra/db/schema.sql`
8. Ingest data: `DATA_DIR=./data/sample_a npx tsx src/mastra/scripts/ingest.ts`
9. Start server: `npm start`
10. Test: `curl -X POST http://localhost:3000/ask -H "Content-Type: application/json" -d '{"question":"How much did I spend on food?"}'`

## Run Evals
```bash
npx tsx scripts/eval.ts
```

## Model
Groq — llama-3.3-70b-versatile

## Deployment
- App: Render.com Web Service (Singapore, free tier)
- Database: Render Postgres (Singapore, free tier)

## Known Limitations
- Free tier cold start: first request may take 30-60 seconds
- Groq free tier rate limits: retry after 60 seconds if you get rate limit error
- Data covers January 2024 to March 2025 only
