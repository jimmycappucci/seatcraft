// SeatCraft UI: renders the shared board, wires drag/drop + locks for the human,
// and streams the agent's WebMCP tool calls into the activity feed.

(function () {
  const S = window.SeatState;
  const $ = (sel) => document.querySelector(sel);

  // ---------- rendering ----------
  function guestEl(g, { draggable = true } = {}) {
    const el = document.createElement("div");
    el.className = "guest";
    el.dataset.guestId = g.id;
    if (S.data.locks[g.id]) el.classList.add("locked");
    if (violatingIds.has(g.id)) el.classList.add("violating");
    el.draggable = draggable;
    el.innerHTML = `
      <span class="g-name"></span>
      <span class="g-group"></span>
      <span class="g-spacer"></span>
      <button class="lock-btn ${S.data.locks[g.id] ? "on" : ""}" title="Lock seat (agent may not move)">${S.data.locks[g.id] ? "🔒" : "🔓"}</button>`;
    el.querySelector(".g-name").textContent = g.name;
    el.querySelector(".g-group").textContent = g.group || "";
    el.querySelector(".lock-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      S.setLock(g.id, !S.data.locks[g.id], "human");
    });
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/guest-id", g.id);
      e.dataTransfer.effectAllowed = "move";
    });
    return el;
  }

  let violatingIds = new Set();

  function render() {
    violatingIds = new Set(S.violations().flatMap(v => v.guests));

    $("#event-name").textContent = S.data.eventName;

    // stats
    const seated = Object.keys(S.data.assignments).length;
    $("#topbar-stats").innerHTML =
      `<span><b>${S.data.guests.length}</b> guests</span>` +
      `<span><b>${seated}</b> seated</span>` +
      `<span><b>${S.data.tables.length}</b> tables</span>`;

    // board
    const board = $("#board");
    board.innerHTML = "";
    if (!S.data.tables.length) {
      board.innerHTML = `<div class="board-empty">No tables yet. Add one — or ask your agent to set the room up for you.</div>`;
    }
    for (const t of S.data.tables) {
      const guests = S.tableGuests(t.id);
      const card = document.createElement("div");
      card.className = "table-card" + (guests.length > t.capacity ? " overcap" : "");
      card.dataset.tableId = t.id;
      card.innerHTML = `
        <div class="table-head">
          <h3 title="Click to rename"></h3>
          <span class="table-cap ${guests.length >= t.capacity ? "full" : ""}">${guests.length}/${t.capacity}</span>
          <button class="table-x" title="Remove table">✕</button>
        </div>
        <div class="seat-list"></div>`;
      card.querySelector("h3").textContent = t.name;
      card.querySelector("h3").addEventListener("click", () => {
        const name = prompt("Table name", t.name);
        if (name) S.updateTable(t.id, { name }, "human");
      });
      card.querySelector(".table-x").addEventListener("click", () => {
        if (confirm(`Remove ${t.name}? Its guests become unseated.`)) S.removeTable(t.id, "human");
      });
      const list = card.querySelector(".seat-list");
      guests.forEach(g => list.appendChild(guestEl(g)));
      card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("dragover"); });
      card.addEventListener("dragleave", () => card.classList.remove("dragover"));
      card.addEventListener("drop", (e) => {
        e.preventDefault(); card.classList.remove("dragover");
        const gid = e.dataTransfer.getData("text/guest-id");
        if (gid) S.assign(gid, t.id, "human");
      });
      board.appendChild(card);
    }

    // bench
    const bench = $("#unseated");
    bench.innerHTML = "";
    const un = S.unseated();
    $("#unseated-count").textContent = un.length;
    un.forEach(g => bench.appendChild(guestEl(g)));

    // constraints
    const chips = $("#constraints");
    chips.innerHTML = "";
    $("#constraint-count").textContent = S.data.constraints.length;
    for (const c of S.data.constraints) {
      const a = S.guest(c.a), b = c.b ? S.guest(c.b) : null, t = c.tableId ? S.table(c.tableId) : null;
      const chip = document.createElement("div");
      chip.className = "chip";
      const label = c.type === "at_table"
        ? `${a ? a.name : "?"} → ${t ? t.name : "?"}`
        : `${a ? a.name : "?"} + ${b ? b.name : "?"}`;
      chip.innerHTML = `<span class="c-type ${c.type}">${c.type.replace("_", " ")}</span> <span class="c-label"></span> <span class="c-note"></span><button title="Remove rule">✕</button>`;
      chip.querySelector(".c-label").textContent = label;
      chip.querySelector(".c-note").textContent = c.note ? `(${c.note})` : "";
      chip.querySelector("button").addEventListener("click", () => S.removeConstraint(c.id, "human"));
      chips.appendChild(chip);
    }

    // violations
    const vs = S.violations();
    $("#violation-count").textContent = vs.length;
    const ul = $("#violations");
    ul.innerHTML = vs.length ? "" : `<li class="none">All constraints satisfied ✓</li>`;
    vs.forEach(v => {
      const li = document.createElement("li");
      li.textContent = v.message;
      ul.appendChild(li);
    });

    // agent hint
    const native = navigator.modelContext && !navigator.modelContext.__seatcraftShim;
    $("#agent-hint").textContent = native
      ? `${window.SeatTools.length} tools registered on the browser's native navigator.modelContext.`
      : `${window.SeatTools.length} tools registered (WebMCP shim — same API surface; native in Chrome behind the WebMCP flag).`;
  }

  // ---------- agent activity feed ----------
  window.addEventListener("seatcraft:toolcall", (e) => {
    const { name, args } = e.detail;
    const feed = $("#agent-feed");
    const empty = feed.querySelector(".feed-empty");
    if (empty) empty.remove();
    const item = document.createElement("div");
    item.className = "feed-item";
    item.innerHTML = `<span class="f-time"></span><span class="f-tool"></span> <div class="f-args"></div>`;
    item.querySelector(".f-time").textContent = new Date().toLocaleTimeString();
    item.querySelector(".f-tool").textContent = name;
    item.querySelector(".f-args").textContent = JSON.stringify(args || {});
    feed.prepend(item);
    while (feed.children.length > 40) feed.lastChild.remove();
    // flash guests the agent touched
    setTimeout(() => {
      document.querySelectorAll(".guest").forEach(el => {
        if (JSON.stringify(args || {}).includes(el.dataset.guestId)) el.classList.add("guest-flash");
      });
    }, 50);
  });

  // ---------- static drop zone (attach once) ----------
  const benchEl = $("#unseated");
  benchEl.addEventListener("dragover", (e) => e.preventDefault());
  benchEl.addEventListener("drop", (e) => {
    const gid = e.dataTransfer.getData("text/guest-id");
    if (gid) S.assign(gid, null, "human");
  });

  // ---------- topbar actions ----------
  $("#event-name").addEventListener("click", () => {
    const name = prompt("Event name", S.data.eventName);
    if (name) { S.data.eventName = name; S.emit("human", { op: "rename" }); }
  });
  $("#btn-add-table").addEventListener("click", () => {
    const name = prompt("Table name", `Table ${S.data.tables.length + 1}`);
    if (name === null) return;
    const cap = parseInt(prompt("Capacity", "8") || "8", 10);
    S.addTable({ name, capacity: isNaN(cap) ? 8 : cap }, "human");
  });
  $("#btn-add-guest").addEventListener("click", () => {
    const name = prompt("Guest name");
    if (!name) return;
    const group = prompt("Group (optional, e.g. 'bride family')") || "";
    S.addGuest({ name, group }, "human");
  });
  $("#btn-reset").addEventListener("click", () => {
    if (confirm("Clear the whole event?")) S.reset("human");
  });
  $("#btn-demo").addEventListener("click", () => {
    if (S.data.guests.length && !confirm("Replace current data with the sample wedding?")) return;
    S.reset("human");
    S.data.eventName = "Rivera–Chen Wedding";
    const mkT = (n, c) => S.addTable({ name: n, capacity: c }, "human");
    const head = mkT("Head Table", 6), fam = mkT("Family", 8), work = mkT("Work Friends", 8),
      college = mkT("College Crew", 8), misc = mkT("Mixed", 8);
    const G = {};
    [
      ["Maya Rivera", "couple"], ["Jordan Chen", "couple"],
      ["Elena Rivera", "bride family"], ["Marco Rivera", "bride family"], ["Abuela Rosa", "bride family"],
      ["Diane Chen", "groom family"], ["Victor Chen", "groom family"], ["Uncle Ray", "groom family"],
      ["Aunt Carol", "bride family"], ["Uncle Jim", "bride family"],
      ["Priya Shah", "work"], ["Tom Bradley", "work"], ["Sofia Ortiz", "work"], ["Dev Patel", "work"],
      ["Liam O'Brien", "college"], ["Nina Kowalski", "college"], ["Chris Yang", "college"], ["Zoe Adams", "college"],
      ["Sam Whitfield", "plus one"], ["Alexis Grant", "plus one"], ["Father Mike", "officiant"],
      ["Hannah Lee", "college"], ["Ben Foster", "work"], ["Grace Liu", "neighbor"],
    ].forEach(([name, group]) => { G[name] = S.addGuest({ name, group }, "human"); });
    S.assign(G["Maya Rivera"].id, head.id, "human"); S.setLock(G["Maya Rivera"].id, true, "human");
    S.assign(G["Jordan Chen"].id, head.id, "human"); S.setLock(G["Jordan Chen"].id, true, "human");
    S.addConstraint({ type: "apart", a: G["Aunt Carol"].id, b: G["Uncle Jim"].id, note: "divorced 2019" }, "human");
    S.addConstraint({ type: "together", a: G["Sam Whitfield"].id, b: G["Nina Kowalski"].id, note: "couple" }, "human");
    S.addConstraint({ type: "together", a: G["Alexis Grant"].id, b: G["Tom Bradley"].id, note: "couple" }, "human");
    S.addConstraint({ type: "at_table", a: G["Abuela Rosa"].id, tableId: fam.id, note: "near family" }, "human");
  });

  // ---------- agent console ----------
  const toolSel = $("#console-tool");
  window.SeatTools.forEach(t => {
    const o = document.createElement("option");
    o.value = t.name; o.textContent = t.name;
    toolSel.appendChild(o);
  });
  $("#console-run").addEventListener("click", async () => {
    let args;
    try { args = JSON.parse($("#console-args").value || "{}"); }
    catch { $("#console-out").textContent = "Invalid JSON args"; return; }
    const tool = window.SeatTools.find(t => t.name === toolSel.value);
    const res = await tool.execute(args);
    $("#console-out").textContent = res.content[0].text;
  });

  S.onChange(render);
  render();
})();
