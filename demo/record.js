// Records the SeatCraft demo with Playwright, choreographed to narration segment
// durations passed in demo/timings.json ({segId: seconds}).
// Usage: node demo/record.js   (expects http://localhost:8932/bounty-venture/seatcraft/ up)

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const TIMINGS = JSON.parse(fs.readFileSync(path.join(__dirname, "timings.json"), "utf8"));
const URL = "http://localhost:8932/bounty-venture/seatcraft/?demo=1";
const PAD = 0.6; // seconds of visual breathing room after each segment's action

const wait = (page, s) => page.waitForTimeout(Math.max(0, s * 1000));

// Run a tool through the same surface an agent uses; feed animates via the event.
async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const r = await navigator.modelContext.callTool(name, args);
    return r.content[0].text;
  }, { name, args });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: path.join(__dirname, "raw"), size: { width: 1280, height: 720 } },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  const videoStart = Date.now(); // recording begins with the page
  const marks = [];
  const mark = (id) => marks.push({ id, at: Date.now() });

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#board");

  // s1: intro over the empty board
  mark("s1_intro");
  await wait(page, TIMINGS.s1_intro + PAD);

  // Composition rule: side-panel visits are brief; the table grid is the star.
  const toTop = async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await wait(page, 0.6);
  };

  // s2: load demo data, glance at the rules, back to the board
  mark("s2_demo_data");
  await page.click("#btn-demo");
  await wait(page, 1.2);
  await page.hover(".chip");
  await wait(page, 2.0);
  await toTop();
  await wait(page, TIMINGS.s2_demo_data - 3.8 + PAD);

  // s3: open the agent console, show the tool list, pre-select auto_seat, back to board
  mark("s3_tools");
  await wait(page, 1.2);
  await page.click(".console summary");
  await wait(page, 0.5);
  await page.click("#console-tool");
  await wait(page, 2.2);
  await page.keyboard.press("Escape");
  await wait(page, 0.3);
  await page.selectOption("#console-tool", "auto_seat");
  await wait(page, 0.3);
  await toTop();
  await wait(page, TIMINGS.s3_tools - 5.1 + PAD);

  // s4: auto_seat — click run, then immediately return so tables fill on camera
  mark("s4_autoseat");
  await wait(page, 0.8);
  await page.click("#console-run");
  await wait(page, 0.8);
  await toTop();
  await wait(page, TIMINGS.s4_autoseat - 2.2 + PAD);

  // s5: human drags Uncle Jim onto Aunt Carol's table -> violation appears
  mark("s5_human_breaks");
  const jim = page.locator(".guest", { hasText: "Uncle Jim" }).first();
  await jim.hover();
  await wait(page, 0.5);
  // Playwright's dragTo breaks on this page's native HTML5 dnd (mid-drag scroll
  // kills the drop), so dispatch the same DragEvents the browser would.
  await page.evaluate(() => {
    const guest = [...document.querySelectorAll(".guest")].find(el => el.textContent.includes("Uncle Jim"));
    const card = [...document.querySelectorAll(".table-card")].find(el => el.textContent.includes("Aunt Carol"));
    const dt = new DataTransfer();
    guest.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    card.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
    card.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  });
  await wait(page, 0.7);
  await page.hover("#violations");
  await wait(page, 2.0);
  await toTop();
  await wait(page, TIMINGS.s5_human_breaks - 3.8 + PAD);

  // s6: agent repairs on camera; then refusal on locked guest; glance at feed
  mark("s6_agent_repairs");
  await agentCall(page, "auto_seat", {});
  await wait(page, 2.0);
  await agentCall(page, "seat_guest", { guest: "Maya Rivera", table: "Mixed" });
  await wait(page, 1.0);
  await page.hover("#agent-feed");
  await wait(page, 2.2);
  await toTop();
  await wait(page, TIMINGS.s6_agent_repairs - 5.8 + PAD);

  // s7: new constraint + re-solve
  mark("s7_new_rule");
  await agentCall(page, "add_constraint", { type: "apart", a: "Priya", b: "Dev", note: "ex-coworkers, awkward" });
  await wait(page, 1.5);
  await agentCall(page, "auto_seat", {});
  await wait(page, TIMINGS.s7_new_rule - 1.5 + PAD);

  // s8: outro — calm full-board shot
  mark("s8_outro");
  await page.mouse.move(640, 400);
  await wait(page, TIMINGS.s8_outro + PAD);

  const video = page.video();
  await ctx.close();
  const file = await video.path();
  const t0 = videoStart;
  fs.writeFileSync(path.join(__dirname, "marks.json"),
    JSON.stringify({ video: file, marks: marks.map(m => ({ id: m.id, at: (m.at - t0) / 1000 })) }, null, 2));
  await browser.close();
  console.log("recorded:", file);
  console.log("marks:", JSON.stringify(marks.map(m => ({ id: m.id, at: (m.at - t0) / 1000 }))));
})();
