// Devpost gallery stills — deterministic framing, saved to demo/gallery/.
const { chromium } = require("playwright");
const path = require("path");

const URL = "http://localhost:8932/bounty-venture/seatcraft/?shots=1";
const OUT = path.join(__dirname, "gallery");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
  const call = (name, args) => page.evaluate(async ({ name, args }) => {
    const r = await navigator.modelContext.callTool(name, args || {});
    return r.content[0].text;
  }, { name, args });

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#board");
  await page.click("#btn-demo");
  await page.waitForTimeout(600);

  // 1. hero: fully solved board
  await call("auto_seat");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "1-hero-solved.png") });

  // 2. violation caught: Uncle Jim seated next to Aunt Carol
  const overview = JSON.parse(await call("get_event_overview"));
  const carolTable = overview.tables.find(t => t.seated.some(g => g.name === "Aunt Carol"));
  await call("seat_guest", { guest: "Uncle Jim", table: carolTable.id });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "2-violation-caught.png") });

  // 3. agent repairs + console open with auto_seat result
  await page.click(".console summary");
  await page.selectOption("#console-tool", "auto_seat");
  await page.click("#console-run");
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelector(".console").scrollIntoView({ block: "end" }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "3-agent-console.png") });

  await browser.close();
  console.log("gallery shots written");
})();
