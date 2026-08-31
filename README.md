# SeatCraft ◍

**Seating charts that humans and AI agents solve together — on the same live board.**

Built for [The WebMCP Challenge](https://webmcp.devpost.com/). SeatCraft is an event
seating planner where the two kinds of users do what each is best at:

- **The host (human)** drags guests between tables, locks the seats that are
  non-negotiable (the couple sits at the head table, period), and states messy
  social truths ("Aunt Carol and Uncle Jim — divorced 2019 — cannot share a table").
- **The agent** carries the cognitive load: it ingests the guest list, records
  constraints, runs the seating solver, repairs violations after every human
  change, and explains what it did — through **15 WebMCP tools** registered on
  `navigator.modelContext`.

Neither can do the job alone. The host has the social knowledge; the agent has the
patience for a 24-guest constraint-satisfaction puzzle that changes every time
someone RSVPs. WebMCP is the contract that lets them share one board.

## Try it

**Live**: https://jimmycappucci.github.io/seatcraft/

1. Click **Demo data** to load a sample wedding (24 guests, 5 tables, 4 rules,
   2 host-locked seats).
2. Open the **Agent console** (bottom right) and call `auto_seat` — watch the board
   fill while honoring every rule and never touching the locked seats.
3. Drag someone to a "wrong" table and watch the **Violations** panel catch it;
   call `auto_seat` again and watch the agent repair around your choice.
4. In an agent-capable browser (Chrome Canary with the *WebMCP for testing* flag,
   or an MCP-B style extension bridge), just *talk*: "add my cousin Rita, she's
   vegetarian, keep her away from Uncle Ray, and re-seat everyone."

## The WebMCP surface

All state mutations flow through one shared model, so a human drag and an agent
tool call are the same operation with a different `source` tag. The agent gets:

| Tool | What it does |
|---|---|
| `get_event_overview` | Full snapshot: tables, occupancy, locks, rules, violations |
| `list_guests` / `add_guests` / `update_guest` / `remove_guest` | Guest CRUD (bulk add supported) |
| `add_table` / `update_table` / `remove_table` | Room layout |
| `seat_guest` / `swap_guests` | Individual moves — **refuse host-locked seats** |
| `add_constraint` / `remove_constraint` | `together` / `apart` / `at_table` rules with human-readable notes |
| `get_violations` | Every broken rule in plain language |
| `auto_seat` | Constraint solver: greedy clustered placement + swap repair; never moves locked guests |
| `set_event_name` | Housekeeping |

Design choices that matter for agents:

- **Guest/table references accept ids or names** (including unique partial names), so
  a conversational agent doesn't need to juggle ids.
- **Every mutating tool returns the resulting violation list**, so the agent always
  knows the consequence of its action without a second call.
- **Host locks are hard boundaries**: `seat_guest`, `swap_guests`, and `auto_seat`
  all refuse to move a locked guest and say so — the human always wins.
- **Every tool call is rendered in the Agent Activity feed**, so the human always
  sees what the agent did. Trust is bidirectional.

## Architecture

```
index.html
├── js/state.js    — single source of truth (event model, localStorage, pub/sub)
├── js/solver.js   — constraint solver (union-find clustering, affinity fill, swap repair)
├── js/webmcp.js   — 15 WebMCP tools on navigator.modelContext (+ spec-shaped shim)
└── js/board.js    — human UI: drag/drop, locks, rule chips, violations, agent feed
```

No build step, no dependencies, no backend — static hosting anywhere. State
persists in `localStorage`. When the browser ships native `navigator.modelContext`
(behind the *WebMCP for testing* flag in Chrome Canary today), the same
registration code runs on it; otherwise a small spec-shaped shim provides the API
so extension bridges and the in-page console can drive the identical tool surface.

## Run locally

```bash
git clone https://github.com/jimmycappucci/seatcraft.git
cd seatcraft
python -m http.server 8080   # any static server works
# open http://localhost:8080
```

## License

MIT — see [LICENSE](LICENSE).

---

*Built with AI assistance (Claude) — human-reviewed and submitted by Jimmy Cappucci.*
