// Desk Health Coach — heartbeat / scheduler / dialog-lifecycle entry point.
// Invoked once per ~60s by runner.sh via: osascript -l JavaScript -e lib.js -e tick.js -- <baseDir> <mode> [optsJSON]
// Also concatenated (lib.js + tick.js + testctl.js, in that order) by testctl.sh so that
// `/desk-health test fire` and `/desk-health test scenario` exercise the exact same runTick()
// used live — only clock/heartbeat/response inputs may be injected via opts.
//
// stdout contract (one line) consumed by runner.sh:
//   OK                        nothing to do this tick
//   SHOW_DIALOG <path>        runner.sh must background-spawn: osascript runtime/dialog.js <path> &
//   FAIL_CLOSED <reason>      mode/runtime-mode mismatch; runner did nothing, no prompt shown

function runTick(baseDir, mode, opts) {
  opts = opts || {};
  setPrivateUmask();

  if (!modeIsConsistent(baseDir, mode)) {
    return { directive: 'FAIL_CLOSED', reason: 'runtime/mode says ' + mode + ' but data/test-runs/.current presence disagrees' };
  }

  var dirs = resolveDirs(baseDir, mode);
  ensureDir(dirs.state); ensureDir(dirs.inbox); ensureDir(dirs.commands); ensureDir(dirs.data);
  if (mode === 'test') ensureDir(dirs.quarantine);

  var now = opts.nowOverride ? new Date(opts.nowOverride) : new Date();
  var state = loadState(dirs);
  var settings = loadSettings(dirs);
  var routine = loadRoutine(dirs);
  var summary = loadSummary(dirs);
  var lib = libraryByOptionId(dirs);
  summary.milestoneJustHit = null;
  summary.comboJustCapped = false;

  // Shared tick.log heartbeat (kept at baseDir, not per-mode — intentional per spec).
  appendLine(baseDir + '/runtime/tick.log', toLocalISOString(now) + '\t' + mode);

  // Day rollover bookkeeping.
  var today = localDateStr(now);
  if (state.currentDay !== today) {
    pruneOldSlotState(state, today);
    state.currentDay = today;
  }

  // ---- 1. Consume pending command requests (pause/resume/routine-edit/undo/repair) ----
  var commandFiles = listDir(dirs.commands).filter(function (f) { return f.indexOf('.json') !== -1; }).sort();
  commandFiles.forEach(function (f) {
    var full = dirs.commands + '/' + f;
    var req;
    try { req = readJSON(full); } catch (e) { req = null; }
    if (!req) { removeIfExists(full); return; }
    if (req.mode !== mode) { quarantine(dirs, full, 'mode-mismatch'); return; }
    if (alreadyApplied(state, req.requestId)) { removeIfExists(full); return; }
    if (typeof req.expectedRevision === 'number' && req.expectedRevision !== settings.revision) {
      quarantine(dirs, full, 'stale-revision expected=' + req.expectedRevision + ' actual=' + settings.revision);
      return;
    }
    applyCommand(dirs, state, settings, req, now);
    settings.revision = (settings.revision || 1);
    recordApplied(state, req.requestId, settings.revision);
    removeIfExists(full);
  });
  saveSettings(dirs, settings);

  // ---- 2. Consume one pending dialog result (if any) ----
  var inboxFiles = listDir(dirs.inbox).filter(function (f) { return f.indexOf('.json') !== -1; }).sort();
  inboxFiles.forEach(function (f) {
    var full = dirs.inbox + '/' + f;
    var res;
    try { res = readJSON(full); } catch (e) { res = null; }
    if (!res) { removeIfExists(full); return; }
    if (res.mode !== mode) { quarantine(dirs, full, 'mode-mismatch'); return; }
    if (state.settledSlots[res.slotId]) { removeIfExists(full); return; } // already processed; avoid double count
    var shown = state.shownSlots[res.slotId];
    if (!shown) { quarantine(dirs, full, 'unknown-slot ' + res.slotId); return; }
    var outcome = res.action === 'done' ? 'done' : (res.action === 'skipped' ? 'skipped' : 'excluded-error');
    var rec = {
      slotId: res.slotId, scheduledTs: shown.scheduledTs, shownTs: shown.shownTs, settledTs: toLocalISOString(now),
      type: shown.type, optionId: shown.optionId, outcome: outcome,
      responseSec: (outcome === 'done' || outcome === 'skipped') ? res.responseSec : null, mode: mode
    };
    settleSlot(dirs, state, summary, settings, rec);
    removeIfExists(full);
    state.activeDialog = null;
    releaseDirLock(dirs.lock);
  });

  // ---- 3. Due-slot scan ----
  var directive = { directive: 'OK' };
  if (opts.forceFireType) {
    directive = tryShow(dirs, state, settings, routine, lib, now, forceSlotFor(opts.forceFireType, routine, now), true);
  } else {
    var dueSlots = computeDueSlots(routine, settings, state, now);
    for (var i = 0; i < dueSlots.length; i++) {
      var slot = dueSlots[i];
      var result = evaluateSlot(dirs, state, summary, settings, slot, now, opts);
      if (result.showed) { directive = { directive: 'SHOW_DIALOG', path: result.requestPath }; break; }
      // else it was settled as excluded-* inline by evaluateSlot; continue scanning remaining due slots
      // (a lock acquired by a just-shown slot would stop further shows on this tick, handled inside evaluateSlot).
    }
  }

  saveSummary(dirs, summary);
  state.lastHeartbeatTs = toLocalISOString(now);
  state.lastTick = toLocalISOString(now);
  saveState(dirs, state);

  // Milestone celebration — fire-and-forget banner, cosmetic only, never for a Skip.
  if (settings.milestoneCelebration && settings.gamification) {
    if (summary.comboJustCapped) {
      var comboLine = pickMilestoneLine(dirs, state, 'combo-cap');
      if (comboLine) notify(comboLine);
    }
    if (summary.milestoneJustHit) {
      var streakLine = pickMilestoneLine(dirs, state, 'streak-' + summary.milestoneJustHit) || pickMilestoneLine(dirs, state, 'streak');
      if (streakLine) notify(streakLine);
    }
    saveState(dirs, state); // persist lastMilestoneLine choice
  }

  return directive;
}

function notify(text) {
  try {
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.displayNotification(text, { withTitle: 'Desk Health Coach' });
  } catch (e) { /* notifications are cosmetic only; never fail the tick over one */ }
}

function quarantine(dirs, path, reason) {
  ensureDir(dirs.quarantine || (dirs.root + '/quarantine'));
  var qdir = dirs.quarantine || (dirs.root + '/quarantine');
  var name = path.split('/').pop();
  try {
    var content = readTextOrNull(path) || '';
    atomicWriteFile(qdir + '/' + toLocalISOString(new Date()).replace(/[:]/g, '-') + '_' + name, content + '\n// reason: ' + reason + '\n');
  } catch (e) { /* best effort */ }
  removeIfExists(path);
}

function pruneOldSlotState(state, today) {
  var cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 30);
  var cutoffStr = localDateStr(cutoff);
  Object.keys(state.settledSlots).forEach(function (id) {
    // slotId shapes vary (mode_YYYY-MM-DDTHHMM_type from makeSlotId, scn_<uuid>-style from test
    // scenarios) — find the date rather than assume a fixed prefix length.
    var m = /\d{4}-\d{2}-\d{2}/.exec(id);
    if (!m) return; // no embedded date (e.g. a bare scn_<uuid> slot) — nothing to age out
    if (m[0] < cutoffStr) delete state.settledSlots[id];
  });
}

function applyCommand(dirs, state, settings, req, now) {
  var beforeSettings = JSON.parse(JSON.stringify(settings));
  if (req.type === 'pause') {
    state.pauseUntil = req.payload.untilTs;
    appendChange(dirs, { area: 'pause', changeType: 'pause', before: { pauseUntil: beforeSettings.pauseUntil || null }, after: { pauseUntil: state.pauseUntil } }, now);
  } else if (req.type === 'resume') {
    state.pauseUntil = null;
    appendChange(dirs, { area: 'pause', changeType: 'resume', before: {}, after: { pauseUntil: null } }, now);
  } else if (req.type === 'routine-edit') {
    state.lastChangeSnapshot = { kind: 'routine', data: loadRoutine(dirs) };
    saveRoutine(dirs, req.payload.newRoutine);
    settings.revision = (settings.revision || 1) + 1;
    appendChange(dirs, { area: 'routine', changeType: req.payload.changeType || 'edit', before: req.payload.beforeRow || null, after: req.payload.afterRow || null }, now);
  } else if (req.type === 'settings-edit') {
    state.lastChangeSnapshot = { kind: 'settings', data: beforeSettings };
    Object.assign(settings, req.payload.newSettings);
    settings.revision = (settings.revision || 1) + 1;
    appendChange(dirs, { area: 'settings', changeType: req.payload.changeType || 'edit', before: req.payload.beforeFields || null, after: req.payload.afterFields || null }, now);
  } else if (req.type === 'undo') {
    // One-step undo, whichever kind the last approved change was — mirrors the build
    // contract's "keep one validated previous routine for undo," generalized to settings too
    // since a viewer reasonably expects undo to work the same way regardless of what changed.
    var snap = state.lastChangeSnapshot;
    if (snap && snap.kind === 'routine') {
      saveRoutine(dirs, snap.data);
      settings.revision = (settings.revision || 1) + 1;
      appendChange(dirs, { area: 'routine', changeType: 'undo', before: null, after: null }, now);
      state.lastChangeSnapshot = null;
    } else if (snap && snap.kind === 'settings') {
      Object.assign(settings, snap.data);
      settings.revision = (settings.revision || 1) + 1;
      appendChange(dirs, { area: 'settings', changeType: 'undo', before: null, after: null }, now);
      state.lastChangeSnapshot = null;
    }
  } else if (req.type === 'repair') {
    rebuildLogMirror(dirs);
    appendChange(dirs, { area: 'data', changeType: 'repair', before: null, after: null }, now);
  }
}

function appendChange(dirs, fields, now) {
  var rec = { ts: toLocalISOString(now), area: fields.area, changeType: fields.changeType, before: fields.before, after: fields.after };
  appendLine(dirs.changes, JSON.stringify(rec));
}

function rebuildLogMirror(dirs) {
  var slots = readJSONL(dirs.slots);
  var lines = slots.filter(function (s) { return s.outcome === 'done' || s.outcome === 'skipped'; })
    .map(function (s) {
      return JSON.stringify({ ts: s.settledTs, scheduledTs: s.scheduledTs, shownTs: s.shownTs, type: s.type, optionId: s.optionId, action: s.outcome, responseSec: s.responseSec, mode: s.mode });
    });
  atomicWriteFile(dirs.log, lines.join('\n') + (lines.length ? '\n' : ''));
}

// Build slotId for a given type+scheduled minute on the given local day.
function makeSlotId(mode, dateStr, minute, type) {
  return mode + '_' + dateStr + 'T' + fmtHHMM(minute).replace(':', '') + '_' + type;
}

// Compute today's due-but-not-yet-settled slots, in scheduled order.
function computeDueSlots(routine, settings, state, now) {
  var dow = localDOW(now);
  if (settings.workdays.indexOf(dow) === -1) return [];
  var workStart = parseHHMM(settings.workStart);
  var workEnd = parseHHMM(settings.workEnd);
  if (workStart === null || workEnd === null) return [];
  var timeline = buildTimeline(routine, workStart, workEnd);
  var today = localDateStr(now);
  var nowMin = minutesSinceMidnight(now);
  var out = [];
  timeline.forEach(function (slot) {
    if (slot.minute > nowMin) return; // not due yet
    var slotId = makeSlotId(state.__modeForId || 'live', today, slot.minute, slot.type);
    if (state.settledSlots[slotId] || state.shownSlots[slotId]) return;
    out.push({ slotId: slotId, type: slot.type, optionId: slot.optionId, minute: slot.minute, day: today });
  });
  return out;
}

function forceSlotFor(type, routine, now) {
  var row = routine.filter(function (r) { return r.type === type; })[0];
  return { slotId: null, type: type, optionId: row ? row.optionId : type, minute: minutesSinceMidnight(now), day: localDateStr(now), forced: true };
}

function scheduledTsFor(day, minute) {
  var d = new Date(day + 'T00:00:00');
  d.setMinutes(minute);
  return toLocalISOString(d);
}

// Evaluate one due slot: settle it inline as excluded-*, or show it (returns {showed:true, requestPath}).
function evaluateSlot(dirs, state, summary, settings, slot, now, opts) {
  var slotId = slot.slotId;
  var scheduledTs = scheduledTsFor(slot.day, slot.minute);
  var scheduledDate = new Date(scheduledTs);
  var lateMs = now - scheduledDate;

  function settleExcluded(reason) {
    var rec = { slotId: slotId, scheduledTs: scheduledTs, shownTs: null, settledTs: toLocalISOString(now), type: slot.type, optionId: slot.optionId, outcome: reason, responseSec: null, mode: dirs.mode };
    settleSlot(dirs, state, summary, settings, rec);
    return { showed: false };
  }

  if (state.pauseUntil && now < new Date(state.pauseUntil)) return settleExcluded('excluded-pause');

  var dow = localDOW(scheduledDate);
  if (inQuietWindow(settings.quietWindows, dow, slot.minute)) return settleExcluded('excluded-quiet');

  var lockHeld = lockIsActive(dirs, state, opts);
  if (lockHeld) return settleExcluded('excluded-dialog-busy');

  var lateMin = lateMs / 60000;
  if (lateMin > 3) {
    var gapSec = opts.heartbeatGapOverrideSec;
    var priorHb = state.lastHeartbeatTs ? new Date(state.lastHeartbeatTs) : null;
    var asleep = (gapSec && gapSec > 90) || (priorHb && priorHb < scheduledDate && (now - priorHb) > 90000);
    return settleExcluded(asleep ? 'excluded-asleep' : 'excluded-unshown');
  }

  if (lateMin > 0) {
    // Catch-up window (<=3 min late): require continuous heartbeat availability.
    var gapSec2 = opts.heartbeatGapOverrideSec;
    var priorHb2 = state.lastHeartbeatTs ? new Date(state.lastHeartbeatTs) : null;
    var continuous = !gapSec2 || gapSec2 <= 90;
    if (priorHb2 && (now - priorHb2) > 90000) continuous = false;
    if (!continuous) return settleExcluded('excluded-asleep');
  }

  var lastShownAny = state.lastAnyShownTs ? new Date(state.lastAnyShownTs) : null;
  if (lastShownAny && (now - lastShownAny) < MIN_ACTUAL_SHOW_GAP * 60000) {
    return settleExcluded('excluded-unshown');
  }

  return showSlot(dirs, state, settings, slot, scheduledTs, now);
}

function lockIsActive(dirs, state, opts) {
  if (opts && opts.forceLockActive) return true;
  if (!fileExists(dirs.lock)) return false;
  var info = readJSON(dirs.lock + '/info.json');
  if (!info || !info.pid) return true; // lock exists but not yet claimed by dialog.js -> treat as active
  if (!processStillAlive(info.pid)) { releaseDirLock(dirs.lock); return false; }
  if (info.startTime && processStartTime(info.pid) !== info.startTime) { releaseDirLock(dirs.lock); return false; }
  return true;
}

function showSlot(dirs, state, settings, slot, scheduledTs, now) {
  ensureDir(dirs.state);
  if (!tryAcquireDirLock(dirs.lock)) return { showed: false }; // race lost; treat as busy, will resurface next tick
  atomicWriteFile(dirs.lock + '/info.json', JSON.stringify({ slotId: slot.slotId, pid: null, startTime: null, startedTs: toLocalISOString(now) }));

  var row = loadRoutine(dirs).filter(function (r) { return r.type === slot.type; })[0];
  var lastPicked = state.rotationState[slot.type];
  var optionId = row ? pickOptionId(row, lastPicked) : slot.optionId;
  state.rotationState[slot.type] = optionId;

  var lib = libraryByOptionId(dirs);
  var movement = lib[optionId] || { name: slot.type, instruction: '', dose: '', why: '', minSeconds: 0 };

  var shownTs = toLocalISOString(now);
  var slotId = slot.slotId || makeSlotId(dirs.mode, slot.day, slot.minute, slot.type);
  state.shownSlots[slotId] = { scheduledTs: scheduledTs, shownTs: shownTs, type: slot.type, optionId: optionId };
  state.lastAnyShownTs = shownTs;
  state.activeDialog = { slotId: slotId, lockPath: dirs.lock, startedTs: shownTs };

  var reqPath = dirs.state + '/active-dialog-request.json';
  var req = {
    slotId: slotId, mode: dirs.mode, scheduledTs: scheduledTs, shownTs: shownTs,
    type: slot.type, optionId: optionId, name: movement.name, instruction: movement.instruction,
    dose: movement.dose, why: movement.why, minSeconds: movement.minSeconds || 0,
    inboxDir: dirs.inbox, lockDir: dirs.lock
  };
  atomicWriteFile(reqPath, JSON.stringify(req));
  return { showed: true, requestPath: reqPath };
}

// Used by the forced-fire test path: skip the due-check machinery entirely and show immediately.
function tryShow(dirs, state, settings, routine, lib, now, slot, force) {
  if (lockIsActive(dirs, state, {})) return { directive: 'OK', reason: 'dialog already active' };
  var scheduledTs = toLocalISOString(now);
  var res = showSlot(dirs, state, settings, slot, scheduledTs, now);
  saveState(dirs, state);
  return res.showed ? { directive: 'SHOW_DIALOG', path: res.requestPath } : { directive: 'OK' };
}

function settleSlot(dirs, state, summary, settings, rec) {
  appendLine(dirs.slots, JSON.stringify(rec));
  if (rec.outcome === 'done' || rec.outcome === 'skipped') {
    appendLine(dirs.log, JSON.stringify({ ts: rec.settledTs, scheduledTs: rec.scheduledTs, shownTs: rec.shownTs, type: rec.type, optionId: rec.optionId, action: rec.outcome, responseSec: rec.responseSec, mode: rec.mode }));
  }
  applyOutcomeToSummary(summary, rec, settings);
  state.settledSlots[rec.slotId] = true;
  delete state.shownSlots[rec.slotId];
}

// osascript entry point (only reached when this file itself is the top-level script).
function run(argv) {
  var baseDir = argv[0];
  var mode = argv[1];
  var opts = argv[2] ? JSON.parse(argv[2]) : {};
  var result = runTick(baseDir, mode, opts);
  if (result.directive === 'SHOW_DIALOG') return 'SHOW_DIALOG ' + result.path;
  if (result.directive === 'FAIL_CLOSED') return 'FAIL_CLOSED ' + result.reason;
  return 'OK';
}
