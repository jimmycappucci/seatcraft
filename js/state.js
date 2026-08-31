// SeatCraft state: event model, persistence, pub/sub.
// Single source of truth shared by the human UI and the WebMCP tool surface.

const STORAGE_KEY = "seatcraft-event-v1";

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 8);
}

const State = {
  data: null,
  listeners: new Set(),

  blank() {
    return {
      eventName: "Untitled Event",
      guests: [],      // {id, name, group, tags[], notes}
      tables: [],      // {id, name, capacity}
      constraints: [], // {id, type: 'together'|'apart'|'at_table', a, b?, tableId?, note}
      assignments: {}, // guestId -> tableId
      locks: {},       // guestId -> true (human-locked; solver must not move)
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { this.data = JSON.parse(raw); return; }
    } catch (e) { /* fall through to blank */ }
    this.data = this.blank();
  },

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (e) { /* private mode */ }
  },

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },

  emit(source, detail) {
    this.save();
    this.listeners.forEach(fn => fn({ source, detail }));
  },

  // ---- queries ----
  guest(idOrName) {
    const g = this.data.guests.find(g => g.id === idOrName);
    if (g) return g;
    const needle = String(idOrName).trim().toLowerCase();
    const matches = this.data.guests.filter(g => g.name.toLowerCase() === needle);
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
      const partial = this.data.guests.filter(g => g.name.toLowerCase().includes(needle));
      if (partial.length === 1) return partial[0];
    }
    return null;
  },

  table(idOrName) {
    const t = this.data.tables.find(t => t.id === idOrName);
    if (t) return t;
    const needle = String(idOrName).trim().toLowerCase();
    return this.data.tables.find(t => t.name.toLowerCase() === needle) || null;
  },

  tableGuests(tableId) {
    return this.data.guests.filter(g => this.data.assignments[g.id] === tableId);
  },

  unseated() {
    return this.data.guests.filter(g => !this.data.assignments[g.id]);
  },

  seatsLeft(tableId) {
    const t = this.data.tables.find(t => t.id === tableId);
    if (!t) return 0;
    return t.capacity - this.tableGuests(tableId).length;
  },

  // ---- violations: the shared truth both human badges and agent reasoning use ----
  violations() {
    const v = [];
    const { constraints, assignments } = this.data;
    for (const c of constraints) {
      const ga = this.guest(c.a);
      if (!ga) continue;
      const ta = assignments[ga.id];
      if (c.type === "together") {
        const gb = this.guest(c.b);
        if (!gb) continue;
        const tb = assignments[gb.id];
        if (ta && tb && ta !== tb) v.push({ constraintId: c.id, message: `${ga.name} and ${gb.name} must sit together but are at different tables`, guests: [ga.id, gb.id] });
      } else if (c.type === "apart") {
        const gb = this.guest(c.b);
        if (!gb) continue;
        const tb = assignments[gb.id];
        if (ta && tb && ta === tb) v.push({ constraintId: c.id, message: `${ga.name} and ${gb.name} must NOT sit together but share a table`, guests: [ga.id, gb.id] });
      } else if (c.type === "at_table") {
        if (ta && ta !== c.tableId) {
          const t = this.data.tables.find(t => t.id === c.tableId);
          v.push({ constraintId: c.id, message: `${ga.name} should be at ${t ? t.name : c.tableId}`, guests: [ga.id] });
        }
      }
    }
    for (const t of this.data.tables) {
      const over = this.tableGuests(t.id).length - t.capacity;
      if (over > 0) v.push({ constraintId: null, message: `${t.name} is over capacity by ${over}`, guests: this.tableGuests(t.id).map(g => g.id) });
    }
    return v;
  },

  // ---- mutations (used by both UI and tools; source tags who did it) ----
  addGuest({ name, group, tags, notes }, source) {
    const g = { id: uid("g"), name: name.trim(), group: group || "", tags: tags || [], notes: notes || "" };
    this.data.guests.push(g);
    this.emit(source, { op: "addGuest", guest: g });
    return g;
  },

  updateGuest(id, patch, source) {
    const g = this.guest(id);
    if (!g) return null;
    Object.assign(g, patch);
    this.emit(source, { op: "updateGuest", guest: g });
    return g;
  },

  removeGuest(id, source) {
    const g = this.guest(id);
    if (!g) return false;
    this.data.guests = this.data.guests.filter(x => x.id !== g.id);
    delete this.data.assignments[g.id];
    delete this.data.locks[g.id];
    this.data.constraints = this.data.constraints.filter(c => c.a !== g.id && c.b !== g.id);
    this.emit(source, { op: "removeGuest", id: g.id });
    return true;
  },

  addTable({ name, capacity }, source) {
    const t = { id: uid("t"), name: name || `Table ${this.data.tables.length + 1}`, capacity: capacity || 8 };
    this.data.tables.push(t);
    this.emit(source, { op: "addTable", table: t });
    return t;
  },

  updateTable(id, patch, source) {
    const t = this.table(id);
    if (!t) return null;
    Object.assign(t, patch);
    this.emit(source, { op: "updateTable", table: t });
    return t;
  },

  removeTable(id, source) {
    const t = this.table(id);
    if (!t) return false;
    this.data.tables = this.data.tables.filter(x => x.id !== t.id);
    for (const gid of Object.keys(this.data.assignments)) {
      if (this.data.assignments[gid] === t.id) delete this.data.assignments[gid];
    }
    this.data.constraints = this.data.constraints.filter(c => c.tableId !== t.id);
    this.emit(source, { op: "removeTable", id: t.id });
    return true;
  },

  assign(guestId, tableId, source, { respectLock = false } = {}) {
    const g = this.guest(guestId);
    const t = tableId ? this.table(tableId) : null;
    if (!g) return { ok: false, error: "guest not found" };
    if (tableId && !t) return { ok: false, error: "table not found" };
    if (respectLock && this.data.locks[g.id]) return { ok: false, error: `${g.name} is locked by the host` };
    if (t) this.data.assignments[g.id] = t.id;
    else delete this.data.assignments[g.id];
    this.emit(source, { op: "assign", guestId: g.id, tableId: t ? t.id : null });
    return { ok: true, guest: g, table: t };
  },

  setLock(guestId, locked, source) {
    const g = this.guest(guestId);
    if (!g) return false;
    if (locked) this.data.locks[g.id] = true;
    else delete this.data.locks[g.id];
    this.emit(source, { op: "lock", guestId: g.id, locked });
    return true;
  },

  addConstraint(c, source) {
    const full = { id: uid("c"), note: "", ...c };
    this.data.constraints.push(full);
    this.emit(source, { op: "addConstraint", constraint: full });
    return full;
  },

  removeConstraint(id, source) {
    const before = this.data.constraints.length;
    this.data.constraints = this.data.constraints.filter(c => c.id !== id);
    const removed = this.data.constraints.length < before;
    if (removed) this.emit(source, { op: "removeConstraint", id });
    return removed;
  },

  reset(source) {
    this.data = this.blank();
    this.emit(source, { op: "reset" });
  },
};

State.load();
window.SeatState = State;
