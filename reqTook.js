import "dotenv/config";
import { Nusuk } from "./src/nusuk.js";
import { parsePositiveCount, parseTargetTime } from "./src/validation.js";

function ms(ms) {
  return `${ms}ms`;
}

function formatTime(date) {
  return date.toTimeString().slice(0, 8) + "." + String(date.getMilliseconds()).padStart(3, "0");
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
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const min = (arr) => Math.min(...arr);

  const realTtfb = ttfbVals.filter((v) => v > 2);
  const minTtfb = realTtfb.length ? min(realTtfb) : (ttfbVals.length ? min(ttfbVals) : null);
  const avgTtfb = ttfbVals.length ? avg(ttfbVals) : null;
  const netOneWay = minTtfb ? Math.round(minTtfb / 2) : null;

  console.log(`\n--- Latency Stats ---`);
  console.log(`  total RTT  : min=${ms(min(totals))}  avg=${ms(avg(totals))}  max=${ms(Math.max(...totals))}`);
  if (ttfbVals.length) {
    const filtered = realTtfb.length < ttfbVals.length ? ` (${realTtfb.length}/${ttfbVals.length} real)` : "";
    console.log(`  ttfb       : min=${ms(minTtfb)}  avg=${ms(avgTtfb)}  max=${ms(Math.max(...ttfbVals))}${filtered}`);
    if (realTtfb.length) {
      console.log(`  server proc: ${ms(avgTtfb - minTtfb)}  (avg ttfb - min ttfb)`);
    }
  }
  if (netOneWay) {
    console.log(`  net 1-way  : ${ms(netOneWay)}  (min ttfb ÷ 2)  <-- request delivery`);
  }
  const oneway = netOneWay || Math.round(avg(totals) / 2);
  console.log(`  one-way ~  : ${ms(oneway)}`);

  return { samples, oneway, netOneWay };
}

async function main() {
  const args = process.argv.slice(2);
  const targetIdx = args.indexOf("--target");
  const targetStr = targetIdx !== -1 ? args[targetIdx + 1] : null;
  const countIdx = args.indexOf("--count");
  const count = parsePositiveCount(countIdx !== -1 ? args[countIdx + 1] : undefined);

  if (count === null) {
    console.error("Count must be an integer from 1 to 100");
    process.exit(1);
  }
  if (targetStr && !parseTargetTime(targetStr)) {
    console.error("Invalid target time. Use HH:MM:SS format, e.g. --target 22:00:00");
    process.exit(1);
  }

  const nusuk = new Nusuk().loadAuth("auth.json");
  await nusuk.init();

  try {
    const { oneway, netOneWay } = await benchmark(nusuk, count);

    if (targetStr) {
      const target = parseTargetTime(targetStr);
      const safety = 50;
      const sendAhead = (netOneWay || oneway) + safety;
      const sendAt = new Date(target.getTime() - sendAhead);

      console.log(`\n--- Schedule ---`);
      console.log(`  deliver to server: ${formatTime(target)}`);
      console.log(`  send at          : ${formatTime(sendAt)}  (${ms(sendAhead)} ahead)`);

      const wait = sendAt.getTime() - Date.now();
      if (wait > 0) {
        console.log(`  waiting ${ms(wait)}...`);
        await new Promise((r) => setTimeout(r, wait));
        const sendActual = Date.now();
        const res = await nusuk.request("/umrah/groups_apis/api/Groups/SendToIssueVisa", {
          method: "POST",
          payload: null,
        });
        const responseReceived = Date.now();
        const serverArrival = sendActual + (netOneWay || oneway);
        const drift = serverArrival - target.getTime();
        console.log(`\n--- Result ---`);
        console.log(`  sent at          : ${formatTime(new Date(sendActual))}`);
        console.log(`  ~server arrival  : ${formatTime(new Date(serverArrival))}`);
        console.log(`  target           : ${formatTime(target)}`);
        console.log(`  drift            : ${drift >= 0 ? "+" : ""}${drift}ms`);
        console.log(`  response received: ${formatTime(new Date(responseReceived))}`);
        console.log(`  response status  : ${res.status}`);
        if (res.timing) {
          console.log(`  actual ttfb      : ${ms(res.timing.total)}`);
        }
        if (res.json) console.log(`  response:`, JSON.stringify(res.json, null, 2).slice(0, 600));
      } else {
        console.log(`  target ${formatTime(target)} is too close or in the past.`);
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
