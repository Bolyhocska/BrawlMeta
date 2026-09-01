"""Exercise the launch-burst control flow in masters.main() with every network
and DB call stubbed out, on a virtual clock. Proves the loop scaffolding runs,
paces itself, and terminates - without spending a scheduled slot to find out."""
import os, sys, types
os.environ.update(dict(SUPERCELL_API_KEY="x", SUPABASE_URL="http://x", SUPABASE_KEY="x",
                       PROXY_HOST="h", PROXY_PORT="1", PROXY_USER="u", PROXY_PASS="p"))
sys.path.insert(0, os.getcwd())

import scrapers.common as common
import scrapers.meta_weights as mw
import scrapers.masters as M

class Clock:
    """Virtual time: sleep() jumps the clock instead of blocking."""
    def __init__(self): self.t = 0.0; self.slept = []
    def monotonic(self): return self.t
    def sleep(self, s): self.slept.append(s); self.t += s

clock = Clock()
M.time = clock

PASS_MINUTES = [75, 48, 40, 35, 30, 30, 30]   # passes get cheaper as the graph is re-walked
state = {"pass": 0, "total": 0}

def fake_harvest(*a, **k):
    i = state["pass"]
    clock.t += PASS_MINUTES[min(i, len(PASS_MINUTES) - 1)] * 60
    state["pass"] += 1
    # simulate diminishing yield
    state["total"] += [31000, 9000, 6500, 5000, 4200, 4000, 3800][min(i, 6)]
    return []

M.require_credentials = lambda: None
M.LookupCache = lambda: types.SimpleNamespace()
M.refresh_dynamic_map_pool = lambda: None
M.get_stored_match_count = lambda *a, **k: 1_500_000
M.get_masters_seeds = lambda: (["#AAA", "#BBB"], {"#AAA"})
M.harvest_bracket = fake_harvest
M.push_players = lambda *a, **k: 0
M.push_matches = lambda *a, **k: (state["total"], {"69.230"})
M.persist_spider_players = lambda *a, **k: None
M.prune_bracket = lambda *a, **k: None
M.reaggregate = lambda *a, **k: None
mw.refresh_intelligence = lambda *a, **k: None

assert common.in_patch_launch_window(), "expected to be inside the launch window"
M.main()

mins = clock.t / 60
print(f"\n=== dry run ===")
print(f"passes run          : {state['pass']}")
print(f"sleeps              : {[int(s//60) for s in clock.slept]} min")
print(f"simulated wall clock: {mins:.0f} min   (workflow timeout is 350)")
print(f"simulated new rows  : {state['total']:,}  vs ~31,000 for a single pass today")
assert state["pass"] >= 2, "burst did not make multiple passes"
assert mins < 350, "burst would exceed the workflow timeout"
print("OK - multiple passes, terminates, inside the timeout")

# --- and the ordinary, out-of-window path: exactly one pass, no sleeping ---
import datetime as _dt
state["pass"] = 0; clock.slept.clear()
common.PATCH_START_TIMES = common.PATCH_START_TIMES[:-1] + [
    ("69.230", _dt.datetime(2026, 8, 1, 6, 0, tzinfo=_dt.timezone.utc))]  # 30 days old
assert not common.in_patch_launch_window()
M.main()
assert state["pass"] == 1, f"expected a single pass outside the window, got {state['pass']}"
assert not clock.slept, "should not sleep outside the launch window"
print("OK - outside the window it is one pass and no sleeps, exactly as before")
