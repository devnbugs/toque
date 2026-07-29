import { Nusuk } from "./src/nusuk.js";

function ms(ms) {
  return `${ms}ms`;
}

function formatTime(date) {
  return date.toTimeString().slice(0, 8);
}

function parseTarget(str) {
  const parts = str.split(":");
  if (parts.length !== 3) return null;
  const [h, m, s] = parts.map(Number);
  if ([h, m, s].some(isNaN)) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, s, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target;
}

async function benchmark(nusuk, count = 5) {
  const samples = [];
  console.log(`\nSending ${count} test requests...\n`);
  for (let i = 0; i < count; i++) {
    const res = await nusuk.request("/manifest.json");
    const t = res.timing;
    samples.push(t);
    console.log(`  req ${i + 1}: total=${ms(t.total)}  ttfb=${ms(t.ttfb ?? "?")}  status=${res.status}`);
  }

  const totals = samples.map((s) => s.total);
  const ttfbVals = samples.map((s) => s.ttfb).filter(Boolean);
  const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const stats = {
    total: { min: Math.min(...totals), avg: avg(totals), max: Math.max(...totals) },
    ttfb: ttfbVals.length ? { min: Math.min(...ttfbVals), avg: avg(ttfbVals), max: Math.max(...ttfbVals) } : null,
  };

  console.log(`\n--- Latency Stats ---`);
  console.log(`  total RTT : min=${ms(stats.total.min)}  avg=${ms(stats.total.avg)}  max=${ms(stats.total.max)}`);
  if (stats.ttfb) {
    console.log(`  ttfb      : min=${ms(stats.ttfb.min)}  avg=${ms(stats.ttfb.avg)}  max=${ms(stats.ttfb.max)}`);
  }
  const oneway = stats.ttfb ? stats.ttfb.avg : Math.round(stats.total.avg / 2);
  console.log(`  one-way ~ : ${ms(oneway)}`);

  return { stats, oneway };
}

async function main() {
  const args = process.argv.slice(2);
  const targetIdx = args.indexOf("--target");
  const targetStr = targetIdx !== -1 ? args[targetIdx + 1] : null;
  const countIdx = args.indexOf("--count");
  const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) || 5 : 5;

  if (targetStr && !parseTarget(targetStr)) {
    console.error("Invalid target time. Use HH:MM:SS format, e.g. --target 22:00:00");
    process.exit(1);
  }

  const nusuk = new Nusuk().loadAuth("auth.json");
  await nusuk.init();

  try {
    const { stats, oneway } = await benchmark(nusuk, count);

    if (targetStr) {
      const target = parseTarget(targetStr);
      const safety = 200;
      const sendAhead = oneway + safety;
      const sendAt = new Date(target.getTime() - sendAhead);

      console.log(`\n--- Schedule ---`);
      console.log(`  target arrival : ${formatTime(target)}`);
      console.log(`  send request at: ${formatTime(sendAt)}  (${ms(sendAhead)} ahead)`);

      const wait = sendAt.getTime() - Date.now();
      if (wait > 0) {
        console.log(`  waiting ${ms(wait)}...`);
        await new Promise((r) => setTimeout(r, wait));
        const res = await nusuk.request("/umrah/groups_apis/api/Groups/SendToIssueVisa", {
          method: "POST",
          payload: null,
        });
        const arrived = new Date();
        const drift = arrived.getTime() - target.getTime();
        console.log(`\n  request sent`);
        console.log(`  arrived at     : ${formatTime(arrived)}.${String(arrived.getMilliseconds()).padStart(3, "0")}`);
        console.log(`  server time    : ${formatTime(target)}`);
        console.log(`  drift          : ${drift >= 0 ? "+" : ""}${drift}ms`);
        console.log(`  response status: ${res.status}`);
        if (res.json) console.log(`  response body  :`, JSON.stringify(res.json, null, 2).slice(0, 500));
      } else {
        console.log(`  target ${formatTime(target)} is in the past (or too close). Use a future time.`);
      }
    }
  } finally {
    await nusuk.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
