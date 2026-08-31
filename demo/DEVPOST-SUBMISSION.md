# Devpost submission — copy-paste kit

**Project name:** SeatCraft

**Tagline (one-liner):**
Seating charts humans and AI agents solve together — the host drags and locks seats, the agent solves the constraint puzzle, on one live WebMCP board.

---

## About the project (main description)

### Inspiration

Seating charts are a two-player game that we've been forcing one player to play alone. The host holds the social knowledge — who divorced whom, which cousins feud, who must flank the grandmother. But turning that knowledge into a valid arrangement of 24 people across 5 tables is a constraint-satisfaction puzzle that shifts every time an RSVP lands. That second half is exactly what agents are good at and humans hate. WebMCP is the missing contract that lets each player play their half **on the same board**.

### What it does

SeatCraft is an event seating planner with two first-class users:

- **The host** drags guests between tables, locks non-negotiable seats (the couple sits at the head table, period), and states messy truths as rules: *Aunt Carol and Uncle Jim — apart (divorced 2019)*.
- **The agent** works through **15 WebMCP tools** registered on `navigator.modelContext`: full guest/table CRUD, individual seating moves, a three-type constraint system (`together` / `apart` / `at_table`, each with a human-readable note), a violations reporter, and `auto_seat` — a solver that seats everyone it can while honoring every rule and **never moving a host-locked guest**.

The collaboration is bidirectional and honest: every agent tool call streams into an on-page Agent Activity feed so the host always sees what the agent did, and every mutating tool returns the resulting violation list so the agent always knows the consequence of its action. When the agent tries to move a locked seat, it's refused with a message telling it to ask the host. The human always wins.

### How we built it

Deliberately zero-dependency: vanilla JS, no build step, no backend — a static page you can host anywhere. Four modules share one state store (localStorage-persisted, pub/sub): the human UI (drag/drop, locks, rule chips, violation badges), the WebMCP tool surface, a constraint solver (union-find clustering of must-sit-together pairs, group-affinity greedy fill, pairwise-swap repair), and the shared model. A human drag and an agent `seat_guest` call are literally the same mutation with a different source tag — that's the whole thesis in one line of code.

The tools register on the browser's native `navigator.modelContext` when present (Chrome's *WebMCP for testing* flag today); otherwise a small spec-shaped shim provides the identical API, so extension bridges and the built-in Agent Console drive the same surface that native browsers will.

### Challenges we ran into

Making the solver's output *socially* plausible, not just constraint-valid — early versions satisfied every rule while exiling one work friend to the family table. Fixes: seat bonded clusters first, fill remaining guests in group-sorted order with a same-group affinity score, then swap-repair. Also: designing tool ergonomics for conversational agents — every guest/table parameter accepts ids **or** names (including unique partial names), because an agent relaying "keep Priya away from Dev" shouldn't juggle opaque ids.

### What we learned

The interesting design surface of WebMCP isn't exposing actions — it's exposing **boundaries**. The lock system (agent-proof seats) and the violations-in-every-response pattern did more for the human-agent collaboration than any additional tool would have. Agent-readable refusals are a feature, not an error.

### What's next

Per-seat (not per-table) placement with adjacency rules, multi-event templates, exportable place cards, and native testing as Chrome's flag rolls toward stable in Q4 2026.

---

**Built with:** javascript, webmcp, navigator.modelContext, html5 drag-and-drop, css, localstorage

**Links:**
- Live: https://jimmycappucci.github.io/seatcraft/
- Repo: https://github.com/jimmycappucci/seatcraft
- Video: https://youtu.be/jX23asScYNk

**AI disclosure (if a form field asks):** Built with AI assistance (Claude); human-reviewed and submitted by Jimmy Cappucci.
