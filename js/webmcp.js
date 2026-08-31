// WebMCP tool surface — the agent's half of SeatCraft.
// Registers tools on navigator.modelContext (W3C WebMCP draft). When the browser
// doesn't provide one (the API ships behind a flag in Chrome Canary today), a
// spec-shaped shim is installed so the same registration code runs everywhere and
// the built-in Agent Console + MCP-B style bridges can drive the tools.

(function () {
  const S = window.SeatState;

  // ---- spec-shaped shim (no-op when the real API exists) ----
  if (!navigator.modelContext) {
    const registry = new Map();
    navigator.modelContext = {
      __seatcraftShim: true,
      registerTool(tool) { registry.set(tool.name, tool); return { unregister: () => registry.delete(tool.name) }; },
      unregisterTool(name) { registry.delete(name); },
      provideContext({ tools = [] } = {}) { registry.clear(); tools.forEach(t => registry.set(t.name, t)); },
      clearContext() { registry.clear(); },
      // non-spec helpers used by the in-page Agent Console
      listTools() { return [...registry.values()].map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })); },
      async callTool(name, args) {
        const t = registry.get(name);
        if (!t) throw new Error(`No such tool: ${name}`);
        return t.execute(args || {});
      },
    };
  }

  const feed = (name, args, result) => {
    window.dispatchEvent(new CustomEvent("seatcraft:toolcall", { detail: { name, args, result, at: Date.now() } }));
  };

  const text = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

  function tool(name, description, inputSchema, fn) {
    return {
      name, description, inputSchema,
      async execute(args) {
        let result;
        try { result = fn(args || {}); }
        catch (e) { result = { error: String(e.message || e) }; }
        feed(name, args, result);
        return text(result);
      },
    };
  }

  const guestRef = { type: "string", description: "Guest id (g_xxx) or exact/partial unique name" };
  const tableRef = { type: "string", description: "Table id (t_xxx) or table name" };

  const TOOLS = [
    tool("get_event_overview",
      "Snapshot of the whole event: name, tables with occupancy, unseated guests, active constraints, and current violations. Call this first to orient yourself.",
      { type: "object", properties: {} },
      () => ({
        eventName: S.data.eventName,
        tables: S.data.tables.map(t => ({
          id: t.id, name: t.name, capacity: t.capacity,
          seated: S.tableGuests(t.id).map(g => ({ id: g.id, name: g.name, lockedByHost: !!S.data.locks[g.id] })),
        })),
        unseated: S.unseated().map(g => ({ id: g.id, name: g.name, group: g.group })),
        constraints: S.data.constraints,
        violations: S.violations().map(v => v.message),
      })),

    tool("list_guests",
      "List all guests with their group, tags, table assignment and host-lock status. Optionally filter by text.",
      { type: "object", properties: { filter: { type: "string", description: "Optional substring to match against name/group/tags" } } },
      ({ filter }) => {
        let gs = S.data.guests;
        if (filter) {
          const f = filter.toLowerCase();
          gs = gs.filter(g => (g.name + " " + g.group + " " + g.tags.join(" ")).toLowerCase().includes(f));
        }
        return gs.map(g => ({
          id: g.id, name: g.name, group: g.group, tags: g.tags, notes: g.notes,
          table: S.data.assignments[g.id] ? (S.table(S.data.assignments[g.id]) || {}).name : null,
          lockedByHost: !!S.data.locks[g.id],
        }));
      }),

    tool("add_guests",
      "Add one or more guests to the event. Each needs a name; group/tags/notes are optional.",
      {
        type: "object",
        required: ["guests"],
        properties: {
          guests: {
            type: "array",
            items: {
              type: "object", required: ["name"],
              properties: {
                name: { type: "string" }, group: { type: "string", description: "e.g. 'bride family', 'work friends'" },
                tags: { type: "array", items: { type: "string" }, description: "e.g. ['vegetarian','kid']" },
                notes: { type: "string" },
              },
            },
          },
        },
      },
      ({ guests }) => ({ added: guests.map(g => S.addGuest(g, "agent")).map(g => ({ id: g.id, name: g.name })) })),

    tool("update_guest",
      "Update a guest's name, group, tags, or notes.",
      {
        type: "object", required: ["guest"],
        properties: { guest: guestRef, name: { type: "string" }, group: { type: "string" }, tags: { type: "array", items: { type: "string" } }, notes: { type: "string" } },
      },
      ({ guest, ...patch }) => {
        const g = S.guest(guest);
        if (!g) return { error: `Guest not found: ${guest}` };
        S.updateGuest(g.id, patch, "agent");
        return { updated: { id: g.id, name: g.name } };
      }),

    tool("remove_guest",
      "Remove a guest from the event entirely (unseats them and drops their constraints).",
      { type: "object", required: ["guest"], properties: { guest: guestRef } },
      ({ guest }) => {
        const g = S.guest(guest);
        if (!g) return { error: `Guest not found: ${guest}` };
        S.removeGuest(g.id, "agent");
        return { removed: g.name };
      }),

    tool("add_table",
      "Add a table with a name and seat capacity.",
      { type: "object", properties: { name: { type: "string" }, capacity: { type: "number", description: "Default 8" } } },
      ({ name, capacity }) => {
        const t = S.addTable({ name, capacity: capacity || 8 }, "agent");
        return { added: { id: t.id, name: t.name, capacity: t.capacity } };
      }),

    tool("update_table",
      "Rename a table or change its capacity.",
      { type: "object", required: ["table"], properties: { table: tableRef, name: { type: "string" }, capacity: { type: "number" } } },
      ({ table, ...patch }) => {
        const t = S.table(table);
        if (!t) return { error: `Table not found: ${table}` };
        S.updateTable(t.id, patch, "agent");
        return { updated: { id: t.id, name: t.name, capacity: t.capacity } };
      }),

    tool("remove_table",
      "Remove a table; its guests become unseated.",
      { type: "object", required: ["table"], properties: { table: tableRef } },
      ({ table }) => {
        const t = S.table(table);
        if (!t) return { error: `Table not found: ${table}` };
        S.removeTable(t.id, "agent");
        return { removed: t.name };
      }),

    tool("seat_guest",
      "Seat a guest at a table (or unseat them by passing no table). Refuses to move guests the host has locked — ask the host instead.",
      { type: "object", required: ["guest"], properties: { guest: guestRef, table: { ...tableRef, description: tableRef.description + ". Omit to unseat." } } },
      ({ guest, table }) => {
        const g = S.guest(guest);
        if (!g) return { error: `Guest not found: ${guest}` };
        const res = S.assign(g.id, table ? (S.table(table) || {}).id : null, "agent", { respectLock: true });
        if (!res.ok) return { error: res.error };
        return { seated: g.name, at: res.table ? res.table.name : "(unseated)", violations: S.violations().map(v => v.message) };
      }),

    tool("swap_guests",
      "Swap the table assignments of two guests. Refuses if either guest is host-locked.",
      { type: "object", required: ["guestA", "guestB"], properties: { guestA: guestRef, guestB: guestRef } },
      ({ guestA, guestB }) => {
        const a = S.guest(guestA), b = S.guest(guestB);
        if (!a || !b) return { error: "One or both guests not found" };
        if (S.data.locks[a.id] || S.data.locks[b.id]) return { error: "A host-locked guest cannot be swapped" };
        const ta = S.data.assignments[a.id] || null, tb = S.data.assignments[b.id] || null;
        S.assign(a.id, tb, "agent"); S.assign(b.id, ta, "agent");
        return { swapped: [a.name, b.name], violations: S.violations().map(v => v.message) };
      }),

    tool("add_constraint",
      "Record a seating rule: 'together' (a and b must share a table), 'apart' (a and b must not), or 'at_table' (a belongs at a specific table).",
      {
        type: "object", required: ["type", "a"],
        properties: {
          type: { type: "string", enum: ["together", "apart", "at_table"] },
          a: guestRef, b: { ...guestRef, description: guestRef.description + " (for together/apart)" },
          table: { ...tableRef, description: tableRef.description + " (for at_table)" },
          note: { type: "string", description: "Why this rule exists, e.g. 'divorced 2019'" },
        },
      },
      ({ type, a, b, table, note }) => {
        const ga = S.guest(a);
        if (!ga) return { error: `Guest not found: ${a}` };
        const c = { type, a: ga.id, note: note || "" };
        if (type === "at_table") {
          const t = S.table(table);
          if (!t) return { error: `Table not found: ${table}` };
          c.tableId = t.id;
        } else {
          const gb = S.guest(b);
          if (!gb) return { error: `Guest not found: ${b}` };
          c.b = gb.id;
        }
        const added = S.addConstraint(c, "agent");
        return { added, currentViolations: S.violations().map(v => v.message) };
      }),

    tool("remove_constraint",
      "Remove a seating rule by its id (see get_event_overview).",
      { type: "object", required: ["constraintId"], properties: { constraintId: { type: "string" } } },
      ({ constraintId }) => ({ removed: S.removeConstraint(constraintId, "agent") })),

    tool("get_violations",
      "List every current constraint violation and over-capacity table in plain language.",
      { type: "object", properties: {} },
      () => ({ violations: S.violations().map(v => v.message), count: S.violations().length })),

    tool("auto_seat",
      "Run the constraint solver: seats everyone it can while honoring together/apart/at_table rules and never moving host-locked guests. Returns what moved and what still violates.",
      { type: "object", properties: {} },
      () => {
        const { assignments, moved, report } = window.SeatSolver.solve(S.data);
        S.data.assignments = assignments;
        S.emit("agent", { op: "autoSeat", moved });
        return {
          report,
          moved: moved.map(m => ({
            guest: (S.guest(m.guestId) || {}).name,
            from: m.from ? (S.table(m.from) || {}).name : null,
            to: m.to ? (S.table(m.to) || {}).name : null,
          })),
          remainingViolations: S.violations().map(v => v.message),
        };
      }),

    tool("set_event_name",
      "Set the event's display name.",
      { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      ({ name }) => { S.data.eventName = name; S.emit("agent", { op: "rename" }); return { eventName: name }; }),
  ];

  TOOLS.forEach(t => navigator.modelContext.registerTool(t));
  window.SeatTools = TOOLS;
})();
