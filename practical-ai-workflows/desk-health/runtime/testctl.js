// Desk Health Coach — test-mode control surface behind `/desk-health test fire|scenario|status`.
// Concatenated by testctl.sh as: osascript -l JavaScript -e lib.js -e tick.js -e testctl.js -- ...
// so runTick/evaluateSlot/showSlot/settleSlot/computeDueSlots (tick.js) and every lib.js helper
// are already in scope here. This file's own run(argv) is defined last, so it is the one
// osascript actually calls (JS: a later top-level `function run` redeclaration wins).
//
// Every scenario calls the SAME evaluateSlot/showSlot/settleSlot/resolveCollisions functions
// the live runner uses — only clock ("now"), heartbeat-gap, and (for fire) the resulting
// user click are ever injected. Nothing here hand-writes an expected slots.jsonl/summary
// outcome; the real code path produces it and the scenario only asserts on what came out.
// Always targets mode=test; live files are never touched or even opened.

function run(argv) {
  var baseDir = argv[0];
  var cmd = argv[1];
  var sub = argv[2] || '';

  if (cmd === 'status') return JSON.stringify(testStatus(baseDir));
  if (cmd === 'fire') return JSON.stringify(testFire(baseDir, sub));
  if (cmd === 'scenario') return JSON.stringify(runScenario(baseDir, sub));
  return JSON.stringify({ ok: false, error: 'unknown testctl command: ' + cmd });
}

function testStatus(baseDir) {
  var runtimeMode = readRuntimeMode(baseDir);
  var hasCurrent = fileExists(baseDir + '/data/test-runs/.current');
  if (runtimeMode !== 'test' || !hasCurrent) {
    return { ok: false, mode: runtimeMode, isolatedTestCurrent: hasCurrent, error: 'not in an active isolated test run' };
  }
  var dirs = resolveDirs(baseDir, 'test');
  var state = loadState(dirs);
  var summary = loadSummary(dirs);
  var lockActive = fileExists(dirs.lock);
  return {
    ok: true, mode: 'test', isolatedTestCurrent: true,
    lastTick: state.lastTick, lastHeartbeatTs: state.lastHeartbeatTs,
    dialogLockActive: lockActive,
    totals: summary.totals, score: summary.score, combo: summary.combo, streak: summary.streak
  };
}

function testFire(baseDir, type) {
  if (!type) return { ok: false, error: 'usage: test fire <type>' };
  var result = runTick(baseDir, 'test', { forceFireType: type });
  if (result.directive === 'SHOW_DIALOG') return { ok: true, directive: 'SHOW_DIALOG', path: result.path };
  return { ok: false, directive: result.directive, reason: result.reason || 'no dialog shown — is one already active?' };
}

function runScenario(baseDir, name) {
  var fn = SCENARIOS[name];
  if (!fn) return { ok: false, error: 'unknown scenario: ' + name, known: Object.keys(SCENARIOS) };
  if (!modeIsConsistent(baseDir, 'test')) return { ok: false, error: 'not in an isolated test run' };
  try {
    return fn(baseDir);
  } catch (e) {
    return { ok: false, error: 'scenario threw: ' + e.message };
  }
}

function pickRealEnabledRow(dirs) {
  return loadRoutine(dirs).filter(function (r) { return r.enabled; })[0];
}

function synthSlot(row, minute, day) {
  return { slotId: 'scn_' + uuid(), type: row.type, optionId: row.optionId, minute: minute, day: day };
}

var SCENARIOS = {
  pause: function (baseDir) {
    var dirs = resolveDirs(baseDir, 'test');
    var row = pickRealEnabledRow(dirs);
    var now = new Date();
    var day = localDateStr(now);
    var state = loadState(dirs), summary = loadSummary(dirs), settings = loadSettings(dirs);
    state.pauseUntil = toLocalISOString(new Date(now.getTime() + 30 * 60000));
    var slot = synthSlot(row, minutesSinceMidnight(now), day);
    var res = evaluateSlot(dirs, state, summary, settings, slot, now, {});
    saveState(dirs, state); saveSummary(dirs, summary);
    var rec = tailSlot(dirs, slot.slotId);
    state.pauseUntil = null; saveState(dirs, state); // scenario teardown
    return { ok: !res.showed && rec && rec.outcome === 'excluded-pause', detail: rec };
  },

  quiet: function (baseDir) {
    var dirs = resolveDirs(baseDir, 'test');
    var settings = loadSettings(dirs);
    if (!settings.quietWindows || settings.quietWindows.length === 0) {
      return { ok: false, error: 'test profile has no quiet window configured to test against' };
    }
    var w = settings.quietWindows[0];
    var row = pickRealEnabledRow(dirs);
    var now = new Date();
    var dow = w.days[0];
    var targetDow = DOW_LABELS.indexOf(dow);
    var d = new Date(now);
    while (localDOW(d) !== dow) d.setDate(d.getDate() + 1);
    var minute = parseHHMM(w.start) + 2;
    var state = loadState(dirs), summary = loadSummary(dirs);
    var slot = synthSlot(row, minute, localDateStr(d));
    var scheduledTs = scheduledTsFor(slot.day, slot.minute);
    var res = evaluateSlot(dirs, state, summary, settings, slot, new Date(scheduledTs), {});
    saveState(dirs, state); saveSummary(dirs, summary);
    var rec = tailSlot(dirs, slot.slotId);
    return { ok: !res.showed && rec && rec.outcome === 'excluded-quiet', detail: rec };
  },

  'dialog-busy': function (baseDir) {
    var dirs = resolveDirs(baseDir, 'test');
    var row = pickRealEnabledRow(dirs);
    var now = new Date();
    var state = loadState(dirs), summary = loadSummary(dirs), settings = loadSettings(dirs);
    var slot = synthSlot(row, minutesSinceMidnight(now), localDateStr(now));
    var res = evaluateSlot(dirs, state, summary, settings, slot, now, { forceLockActive: true });
    saveState(dirs, state); saveSummary(dirs, summary);
    var rec = tailSlot(dirs, slot.slotId);
    return { ok: !res.showed && rec && rec.outcome === 'excluded-dialog-busy', detail: rec };
  },

  unshown: function (baseDir) {
    var dirs = resolveDirs(baseDir, 'test');
    var row = pickRealEnabledRow(dirs);
    var now = new Date();
    var scheduledMinute = minutesSinceMidnight(now) - 10; // 10 min ago: past the 3-min catch-up window
    var state = loadState(dirs), summary = loadSummary(dirs), settings = loadSettings(dirs);
    state.lastHeartbeatTs = toLocalISOString(new Date(now.getTime() - 60000)); // continuous, recent heartbeat
    var slot = synthSlot(row, scheduledMinute, localDateStr(now));
    var res = evaluateSlot(dirs, state, summary, settings, slot, now, { heartbeatGapOverrideSec: 45 });
    saveState(dirs, state); saveSummary(dirs, summary);
    var rec = tailSlot(dirs, slot.slotId);
    return { ok: !res.showed && rec && rec.outcome === 'excluded-unshown', detail: rec };
  },

  'wake-gap': function (baseDir) {
    var dirs = resolveDirs(baseDir, 'test');
    var row = pickRealEnabledRow(dirs);
    var now = new Date();
    var scheduledMinute = minutesSinceMidnight(now) - 2; // 2 min ago: inside the 3-min catch-up window
    var state = loadState(dirs), summary = loadSummary(dirs), settings = loadSettings(dirs);
    state.lastHeartbeatTs = toLocalISOString(new Date(now.getTime() - 400000)); // >90s gap crossing scheduledTs
    var slot = synthSlot(row, scheduledMinute, localDateStr(now));
    var res = evaluateSlot(dirs, state, summary, settings, slot, now, { heartbeatGapOverrideSec: 400 });
    saveState(dirs, state); saveSummary(dirs, summary);
    var rec = tailSlot(dirs, slot.slotId);
    var asleepOk = !res.showed && rec && rec.outcome === 'excluded-asleep';

    // Companion check: same lateness, but a genuinely continuous heartbeat DOES permit catch-up.
    var row2 = row;
    var scheduledMinute2 = minutesSinceMidnight(now) - 2;
    var state2 = loadState(dirs), summary2 = loadSummary(dirs);
    state2.lastHeartbeatTs = toLocalISOString(new Date(now.getTime() - 50000));
    var slot2 = synthSlot(row2, scheduledMinute2, localDateStr(now));
    var res2 = evaluateSlot(dirs, state2, summary2, settings, slot2, now, { heartbeatGapOverrideSec: 50 });
    var caughtUpOk = res2.showed === true;
    if (res2.showed) {
      // Clean teardown: settle the synthetic catch-up slot as done so it doesn't sit open.
      var rec2 = { slotId: slot2.slotId, scheduledTs: scheduledTsFor(slot2.day, slot2.minute), shownTs: toLocalISOString(now), settledTs: toLocalISOString(now), type: row2.type, optionId: row2.optionId, outcome: 'done', responseSec: row2 ? undefined : null, mode: 'test' };
      settleSlot(dirs, state2, summary2, settings, rec2);
      releaseDirLock(dirs.lock);
    }
    saveState(dirs, state2); saveSummary(dirs, summary2);

    return { ok: asleepOk && caughtUpOk, detail: { asleepCase: rec, catchUpCase: { showed: res2.showed } } };
  },

  collision: function (baseDir) {
    var dirs = resolveDirs(baseDir, 'test');
    var routine = loadRoutine(dirs);
    var settings = loadSettings(dirs);
    var workStart = parseHHMM(settings.workStart), workEnd = parseHHMM(settings.workEnd);
    // Force an intentional collision on an in-memory clone only — never written to disk.
    var clone = routine.map(function (r) { return Object.assign({}, r); });
    var target = clone.filter(function (r) { return r.enabled && r.mode === 'interval'; })[0];
    if (!target) return { ok: false, error: 'no enabled interval row available to collide' };
    var other = clone.filter(function (r) { return r.enabled && r.mode === 'interval' && r !== target; })[0];
    if (other) other.cadenceMinutes = target.cadenceMinutes; // same cadence, will be tried at overlapping phases first
    target.cadenceMinutes = 5; // 5-minute cadence cannot satisfy an 8-minute floor against anything else
    var result = resolveCollisions(clone, workStart, workEnd);
    return { ok: result.ok === false && result.collisions && result.collisions.length > 0, detail: result };
  },

  // Proves the three priorityRank behaviors that the rank model rests on, all on in-memory
  // clones — nothing here is written to disk.
  rank: function (baseDir) {
    var dirs = resolveDirs(baseDir, 'test');
    var settings = loadSettings(dirs);
    var ws = parseHHMM(settings.workStart), we = parseHHMM(settings.workEnd);
    function mk(type, cad, rank) {
      return { type: type, mode: 'interval', cadenceMinutes: cad, phase: 0, times: [], enabled: true, optionId: 'x', priorityRank: rank };
    }
    function phasesOf(res) { var o = {}; res.routine.forEach(function (r) { if (r.enabled) o[r.type] = r.phase; }); return o; }

    // (a) rank actually decides placement on a genuine tie (same cadence, alphabetical otherwise)
    var tieUnranked = resolveCollisions([mk('neck-shoulders', 60, null), mk('standing', 60, null)], ws, we);
    var tieRanked = resolveCollisions([mk('neck-shoulders', 60, 2), mk('standing', 60, 1)], ws, we);
    var rankDecides = tieUnranked.ok && tieRanked.ok &&
      phasesOf(tieUnranked)['neck-shoulders'] === 0 && phasesOf(tieRanked)['standing'] === 0;

    // (b) an infeasible rank order falls back to cadence order instead of a spurious collision
    var starve = [mk('standing', 60, 1), mk('posture', 60, 2), mk('neck-shoulders', 60, 3), mk('eyes', 20, 4)];
    var rankOnly = resolveCollisionsWithOrder(starve, ws, we, 'rank');
    var combined = resolveCollisions(starve, ws, we);
    var fallbackWorks = rankOnly.ok === false && combined.ok === true && combined.rankHonored === false;

    // (c) duplicate ranks are rejected outright
    var dupErrors = [];
    validateRanks([mk('eyes', 20, 1), mk('standing', 60, 1)], dupErrors);
    var badErrors = [];
    validateRanks([mk('eyes', 20, 0)], badErrors);
    var rejectsBadRanks = dupErrors.length === 1 && badErrors.length === 1;

    return {
      ok: rankDecides && fallbackWorks && rejectsBadRanks,
      detail: {
        rankDecidesPlacement: { unranked: phasesOf(tieUnranked), standingRankedFirst: phasesOf(tieRanked), pass: rankDecides },
        infeasibleRankFallsBack: { rankOrderAlone: rankOnly.ok, combined: combined.ok, rankHonored: combined.rankHonored, pass: fallbackWorks },
        rejectsBadRanks: { duplicate: dupErrors, nonPositive: badErrors, pass: rejectsBadRanks }
      }
    };
  },

  streak: function (baseDir) {
    var dirs = resolveDirs(baseDir, 'test');
    var row = pickRealEnabledRow(dirs);
    var settings = loadSettings(dirs);
    var state = loadState(dirs), summary = loadSummary(dirs);

    // Fixture setup, not outcome fabrication: real updateStreak()/settleSlot() only ever run
    // forward in time (a live tick never processes "yesterday" after "today"), so a clean
    // baseline is required before replaying synthetic consecutive-workday Dones in ascending
    // chronological order. The counters restored here are exactly the ones the real code path
    // is about to recompute — nothing about the *outcome* is hand-written.
    var savedStreak = summary.streak, savedLastStreakDay = summary.lastStreakDay;
    summary.streak = 0; summary.lastStreakDay = null;

    var base = new Date();
    var pastDays = [];
    var offset = 0;
    while (pastDays.length < 3) {
      offset++;
      var d = new Date(base.getTime() - offset * 86400000);
      if (settings.workdays.indexOf(localDOW(d)) === -1) continue;
      pastDays.unshift(d); // build oldest-first
    }

    var runTag = uuid(); // keeps slotIds unique across repeated scenario runs on the same dates
    var streaks = [];
    var milestoneAt3 = null;
    pastDays.forEach(function (d) {
      var day = localDateStr(d);
      var rec = { slotId: 'scn_streak_' + day + '_' + runTag, scheduledTs: scheduledTsFor(day, parseHHMM(settings.workStart) + 10), shownTs: null, settledTs: scheduledTsFor(day, parseHHMM(settings.workStart) + 10), type: row.type, optionId: row.optionId, outcome: 'done', responseSec: row ? 12 : null, mode: 'test' };
      settleSlot(dirs, state, summary, settings, rec);
      streaks.push(summary.streak);
      if (summary.streak === 3) milestoneAt3 = summary.milestoneJustHit;
    });

    var ok = summary.streak === 3 && milestoneAt3 === 3;
    // Teardown: restore whatever streak counter existed before this scenario ran (e.g. from an
    // earlier same-day Done via another scenario/fire) so this diagnostic doesn't leave the
    // dashboard's real streak counter pointing at synthetic backdated days.
    summary.streak = savedStreak; summary.lastStreakDay = savedLastStreakDay;
    saveState(dirs, state); saveSummary(dirs, summary);
    return { ok: ok, detail: { streakProgression: streaks, milestoneJustHitAt3: milestoneAt3, restoredStreak: summary.streak } };
  }
};

function tailSlot(dirs, slotId) {
  var slots = readJSONL(dirs.slots);
  for (var i = slots.length - 1; i >= 0; i--) if (slots[i].slotId === slotId) return slots[i];
  return null;
}
