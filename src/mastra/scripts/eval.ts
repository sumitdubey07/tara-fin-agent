import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.EVAL_URL || "http://localhost:3000";

const tests = [
  {
    question: "How much did I spend on food in March 2025?",
    check: (a: string) => a.includes("4075") || a.includes("4,075"),
    description: "Food spending March 2025",
  },
  {
    question: "What were my top 5 merchants by spending?",
    check: (a: string) => a.toLowerCase().includes("air india") || a.toLowerCase().includes("indigo"),
    description: "Top merchants",
  },
  {
    question: "What is my portfolio worth today?",
    check: (a: string) => a.includes("119") || a.includes("983"),
    description: "Portfolio value",
  },
  {
    question: "How much did I spend on travel in Q1 2025?",
    check: (a: string) => a.match(/[0-9,]+\.[0-9]{2}/) !== null,
    description: "Travel spending Q1 2025",
  },
  {
    question: "Which merchants look like recurring subscriptions?",
    check: (a: string) => a.length > 20 && !a.toLowerCase().includes("no data"),
    description: "Recurring subscriptions",
  },
  {
    question: "Compare my food and travel spending month by month",
    check: (a: string) => a.length > 50,
    description: "Month by month comparison",
  },
  {
    question: "What is my total spending in January 2025 excluding transfers?",
    check: (a: string) => a.match(/[0-9,]+\.[0-9]{2}/) !== null,
    description: "Total spending Jan 2025 no transfers",
  },
  {
    question: "Rank all funds by return between 2024-01-01 and 2025-01-01",
    check: (a: string) => a.length > 50,
    description: "Fund ranking by return",
  },
  {
    question: "What is my realised return on my holdings?",
    check: (a: string) => a.length > 20,
    description: "Realised return on holdings",
  },
  {
    question: "Do I have any rent transactions in April 2025?",
    check: (a: string) => a.toLowerCase().includes("no") || a.match(/[0-9]/) !== null,
    description: "No data case - rent April 2025",
  },
  {
    question: "How much did I spend on Swiggy?",
    check: (a: string) => a.match(/[0-9,]+\.[0-9]{2}/) !== null || a.toLowerCase().includes("no data"),
    description: "Merchant alias - Swiggy",
  },
  {
    question: "What category had the biggest spending in February 2025?",
    check: (a: string) => a.length > 20,
    description: "Top category Feb 2025",
  },
];

async function runEval() {
  console.log(`\n🧪 Running Tara Eval Suite against ${BASE_URL}\n`);
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;
  const failures: any[] = [];

  for (const test of tests) {
    try {
      const start = Date.now();
      const res = await fetch(`${BASE_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: test.question }),
      });
      const data = await res.json() as any;
      const latency = Date.now() - start;
      const answer = data.answer || "";
      const ok = test.check(answer);

      if (ok) {
        passed++;
        console.log(`✅ PASS [${latency}ms] ${test.description}`);
      } else {
        failed++;
        failures.push({ test: test.description, question: test.question, answer });
        console.log(`❌ FAIL [${latency}ms] ${test.description}`);
        console.log(`   Answer: ${answer.substring(0, 100)}`);
      }
    } catch (err: any) {
      failed++;
      failures.push({ test: test.description, error: err.message });
      console.log(`❌ ERROR ${test.description}: ${err.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${tests.length} tests`);

  if (failures.length > 0) {
    console.log("\n❌ Failed cases:");
    for (const f of failures) {
      console.log(`  - ${f.test}: ${f.answer || f.error}`);
    }
  }

  console.log("\n" + (failed === 0 ? "🎉 All tests passed!" : `⚠️ ${failed} tests need attention`));
}

runEval();