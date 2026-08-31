// Constraint-aware seating solver.
// Greedy placement by constraint-degree, then local-search swaps to repair violations.
// Human-locked guests are never moved; the agent calls this via the auto_seat tool.

const Solver = {
  // Returns {assignments, moved[], report} without mutating State.
  solve(data) {
    const assignments = { ...data.assignments };
    const locks = data.locks || {};
    const tables = data.tables;
    const guests = data.guests;
    if (!tables.length) return { assignments, moved: [], report: "No tables exist yet." };

    const together = data.constraints.filter(c => c.type === "together");
    const apart = data.constraints.filter(c => c.type === "apart");
    const atTable = data.constraints.filter(c => c.type === "at_table");

    const capLeft = id => {
      const t = tables.find(t => t.id === id);
      const used = guests.filter(g => assignments[g.id] === id).length;
      return t.capacity - used;
    };

    // union-find over "together" pairs so bonded groups place as units
    const parent = {};
    const find = x => (parent[x] === x || parent[x] === undefined) ? (parent[x] = x) : (parent[x] = find(parent[x]));
    const union = (a, b) => { parent[find(a)] = find(b); };
    guests.forEach(g => find(g.id));
    together.forEach(c => { if (guests.find(g => g.id === c.a) && guests.find(g => g.id === c.b)) union(c.a, c.b); });

    const clusters = {};
    guests.forEach(g => {
      const root = find(g.id);
      (clusters[root] = clusters[root] || []).push(g);
    });

    const apartSet = new Set(apart.map(c => [c.a, c.b].sort().join("|")));
    const conflicts = (gid, tableId) => {
      const seated = guests.filter(g => assignments[g.id] === tableId).map(g => g.id);
      return seated.filter(sid => apartSet.has([gid, sid].sort().join("|"))).length;
    };

    const moved = [];
    const place = (guest, tableId) => {
      if (assignments[guest.id] !== tableId) moved.push({ guestId: guest.id, from: assignments[guest.id] || null, to: tableId });
      assignments[guest.id] = tableId;
    };

    // 1. honor at_table pins (unless locked elsewhere by the host)
    for (const c of atTable) {
      const g = guests.find(g => g.id === c.a);
      if (g && !locks[g.id] && capLeft(c.tableId) > 0) place(g, c.tableId);
    }

    // 2. place bonded clusters (size >= 2) first; singletons wait for the affinity fill
    const clusterList = Object.values(clusters).filter(c => c.length >= 2).sort((a, b) => b.length - a.length);
    for (const cluster of clusterList) {
      const anchored = cluster.find(g => locks[g.id] && assignments[g.id]);
      const unplaced = cluster.filter(g => !assignments[g.id] && !locks[g.id]);
      let target = anchored ? assignments[anchored.id] : null;
      if (!target) {
        // prefer table already holding most of the cluster, then group company, space, few conflicts
        const scored = tables.map(t => {
          const holding = cluster.filter(g => assignments[g.id] === t.id).length;
          const conf = cluster.reduce((s, g) => s + conflicts(g.id, t.id), 0);
          const aff = cluster.reduce((s, g) => s + guests.filter(o => o.group && o.group === g.group && assignments[o.id] === t.id).length, 0);
          return { t, score: holding * 100 + aff * 10 + capLeft(t.id) - conf * 50 };
        }).sort((a, b) => b.score - a.score);
        target = scored[0] && capLeft(scored[0].t.id) >= unplaced.length ? scored[0].t.id : null;
      }
      if (target) {
        for (const g of cluster) {
          if (locks[g.id]) continue;
          if (assignments[g.id] === target) continue;
          if (capLeft(target) > 0 && conflicts(g.id, target) === 0) place(g, target);
        }
      }
    }

    // 3. fill remaining unseated: avoid conflicts, prefer tables with same-group company
    const groupAffinity = (g, tableId) => {
      if (!g.group) return 0;
      return guests.filter(o => o.id !== g.id && assignments[o.id] === tableId && o.group === g.group).length;
    };
    const groupSize = {};
    guests.forEach(g => { if (g.group) groupSize[g.group] = (groupSize[g.group] || 0) + 1; });
    const fillOrder = [...guests].sort((a, b) =>
      (groupSize[b.group] || 0) - (groupSize[a.group] || 0) || (a.group || "~").localeCompare(b.group || "~"));
    for (const g of fillOrder) {
      if (assignments[g.id] || locks[g.id]) continue;
      const options = tables
        .filter(t => capLeft(t.id) > 0)
        .map(t => ({ t, conf: conflicts(g.id, t.id), aff: groupAffinity(g, t.id), left: capLeft(t.id) }))
        .sort((a, b) => a.conf - b.conf || b.aff - a.aff || b.left - a.left);
      if (options.length) place(g, options[0].t.id);
    }

    // 4. local search: try pairwise swaps to reduce violations (bounded)
    const countViolations = () => {
      let n = 0;
      for (const c of together) {
        const ta = assignments[c.a], tb = assignments[c.b];
        if (ta && tb && ta !== tb) n++;
      }
      for (const c of apart) {
        const ta = assignments[c.a], tb = assignments[c.b];
        if (ta && tb && ta === tb) n++;
      }
      return n;
    };
    let best = countViolations();
    if (best > 0) {
      const movable = guests.filter(g => !locks[g.id] && assignments[g.id]);
      outer:
      for (let pass = 0; pass < 3 && best > 0; pass++) {
        for (let i = 0; i < movable.length; i++) {
          for (let j = i + 1; j < movable.length; j++) {
            const a = movable[i], b = movable[j];
            if (assignments[a.id] === assignments[b.id]) continue;
            const ta = assignments[a.id], tb = assignments[b.id];
            assignments[a.id] = tb; assignments[b.id] = ta;
            const n = countViolations();
            if (n < best) {
              best = n;
              moved.push({ guestId: a.id, from: ta, to: tb }, { guestId: b.id, from: tb, to: ta });
              if (best === 0) break outer;
            } else {
              assignments[a.id] = ta; assignments[b.id] = tb;
            }
          }
        }
      }
    }

    const unseatedCount = guests.filter(g => !assignments[g.id]).length;
    const report =
      `Seated ${guests.length - unseatedCount}/${guests.length} guests; ` +
      `${best} constraint violation(s) remain` +
      (unseatedCount ? `; ${unseatedCount} could not be seated (capacity)` : "") +
      `; ${Object.keys(locks).length} host-locked guest(s) were not moved.`;
    return { assignments, moved, report };
  },
};

window.SeatSolver = Solver;
