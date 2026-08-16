// Desk Health Coach — shared JXA runtime library.
// Loaded by every entry point (tick.js, dialog.js, report.js, validate.js, testctl.js) by
// concatenation, not eval-of-a-path: every *.sh wrapper invokes
//   osascript -l JavaScript -e "$(cat lib.js)" -e "$(cat entry.js)" -- args...
// osascript compiles multiple -e fragments as ONE shared-scope program and calls the LAST
// fragment's run(argv) — confirmed empirically before this was chosen as the loading strategy.
// This file must always be the first -e fragment.
//
// NOTE on the two verified-primitive fixes found during the smoke-test step (2026-08-15):
// 1. NSFileManager's moveItemAtPath:toPath:error: FAILS if the destination already exists
//    (Cocoa's moveItem refuses to clobber). That breaks every overwrite — state.json,
//    summary.json, appendLine's 2nd+ call, etc. replaceItemAtURL:... "fixes" this but SEGFAULTS
//    when backupItemName: is JS null (same NSNull-bridging bug class as the createFile
//    attributes: param, just uncaught in the original reference block). The actual fix is the
//    POSIX rename(2) syscall via ObjC.import('stdio'); $.rename(tmp, dest) — atomic AND
//    overwrites the destination. Confirmed empirically before this file was written.
// 2. $.umask(0o077) (via ObjC.import('sys/stat')) + $.NSDictionary.dictionary as the
//    attributes: param on create calls is sufficient to get 0700 dirs / 0600 files — no need to
//    fight NSFilePosixPermissions dictionaries by hand.

ObjC.import('stdio');    // $.rename — atomic overwrite-capable rename(2), see note above
ObjC.import('sys/stat'); // $.umask
ObjC.import('stdlib');   // not currently called directly, but cheap and commonly needed

var FM = $.NSFileManager.defaultManager;

function setPrivateUmask() {
  $.umask(0o077);
}

function atomicWriteFile(path, contents) {
  var tmpPath = path + '.tmp.' + $.NSProcessInfo.processInfo.globallyUniqueString.js;
  var nsData = $.NSString.alloc.initWithUTF8String(contents).dataUsingEncoding($.NSUTF8StringEncoding);
  if (!FM.createFileAtPathContentsAttributes(tmpPath, nsData, $.NSDictionary.dictionary)) {
    throw new Error('atomicWriteFile: write failed: ' + tmpPath);
  }
  if ($.rename(tmpPath, path) !== 0) {
    FM.removeItemAtPathError(tmpPath, Ref());
    throw new Error('atomicWriteFile: rename failed: ' + tmpPath + ' -> ' + path);
  }
}

function appendLine(path, line) {
  var existing = FM.fileExistsAtPath(path)
    ? $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, Ref()).js
    : '';
  atomicWriteFile(path, existing + line + '\n');
}

function readTextOrNull(path) {
  if (!FM.fileExistsAtPath(path)) return null;
  var ref = Ref();
  var s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, ref);
  if (s.isNil && s.isNil()) return null;
  return s.js;
}

function readTSV(path) {
  var text = readTextOrNull(path);
  if (text === null) return [];
  return text.split('\n').filter(function (l) { return l.length > 0; }).map(function (l) { return l.split('\t'); });
}

function readJSON(path) {
  var text = readTextOrNull(path);
  if (text === null) return null;
  return JSON.parse(text);
}

function readJSONL(path) {
  var text = readTextOrNull(path);
  if (text === null) return [];
  return text.split('\n').filter(function (l) { return l.length > 0; }).map(function (l) { return JSON.parse(l); });
}

function createDirectory(path) {
  var err = Ref();
  if (!FM.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, $.NSDictionary.dictionary, err)) {
    throw new Error('createDirectory failed: ' + path + ': ' + (err[0] ? err[0].localizedDescription.js : 'unknown'));
  }
}

function ensureDir(path) {
  if (!FM.fileExistsAtPath(path)) createDirectory(path);
}

function fileExists(path) {
  return FM.fileExistsAtPath(path);
}

function removeIfExists(path) {
  if (FM.fileExistsAtPath(path)) FM.removeItemAtPathError(path, Ref());
}

function listDir(path) {
  if (!FM.fileExistsAtPath(path)) return [];
  var err = Ref();
  var arr = FM.contentsOfDirectoryAtPathError(path, err);
  if (!arr) return [];
  var out = [];
  for (var i = 0; i < arr.count; i++) out.push(ObjC.unwrap(arr.objectAtIndex(i)));
  return out;
}

function uuid() {
  return $.NSProcessInfo.processInfo.globallyUniqueString.js;
}

// Atomic directory-creation lock. Returns true if acquired.
function tryAcquireDirLock(lockPath) {
  var err = Ref();
  return FM.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(lockPath, false, $.NSDictionary.dictionary, err);
}

function releaseDirLock(lockPath) {
  if (FM.fileExistsAtPath(lockPath)) FM.removeItemAtPathError(lockPath, Ref());
}

function shellSafe(cmd) {
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  try {
    return app.doShellScript(cmd);
  } catch (e) {
    return '';
  }
}

// Only ever called with internally-validated integer PIDs — never user text.
function processStillAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  var out = shellSafe('ps -p ' + pid + ' -o pid= 2>/dev/null');
  return out.trim().length > 0;
}

function processStartTime(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  return shellSafe('ps -p ' + pid + ' -o lstart= 2>/dev/null').trim();
}

// ---------- HTML escaping ----------
function htmlEscape(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Time helpers ----------
var DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function toLocalISOString(d) {
  var offMin = -d.getTimezoneOffset();
  var sign = offMin >= 0 ? '+' : '-';
  var abs = Math.abs(offMin);
  var offStr = sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + offStr;
}

function localDateStr(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function localDOW(d) {
  return DOW_LABELS[d.getDay()];
}

function minutesSinceMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHHMM(s) {
  var m = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(String(s).trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function fmtHHMM(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  return pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
}

function dateAtMinutes(baseDate, mins) {
  var d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
  d.setMinutes(mins);
  return d;
}

// ---------- Validation ----------
function hasControlChars(s) {
  return /[\t\n\r\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s);
}

function isValidURL(s) {
  return /^https:\/\/[^\s]+$/.test(s);
}

var VALID_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var VALID_TYPES = ['eyes', 'neck-shoulders', 'wrists-hands', 'lower-back', 'standing', 'posture'];

// Shared with validate.js AND the testctl rank scenario, which loads lib.js but not
// validate.js — keep it here so both bundles can reach it.
function validateRanks(routine, errors) {
  var seenRank = {};
  routine.forEach(function (r) {
    if (r.priorityRank === null || r.priorityRank === undefined) return; // unranked is allowed
    if (!Number.isInteger(r.priorityRank) || r.priorityRank < 1) {
      errors.push('routine: ' + r.type + ' has priorityRank "' + r.priorityRank + '" — must be blank or a positive integer');
      return;
    }
    if (seenRank[r.priorityRank]) {
      errors.push('routine: priorityRank ' + r.priorityRank + ' is used by both ' + seenRank[r.priorityRank] + ' and ' + r.type + ' — each rank may be used only once');
      return;
    }
    seenRank[r.priorityRank] = r.type;
  });
}

// ---------- Config IO ----------
function loadSettings(dirs) {
  var rows = readTSV(dirs.config + '/settings.tsv');
  var s = {};
  rows.forEach(function (r) {
    if (r.length < 2) return;
    s[r[0]] = r[1];
  });
  s.workdays = (s.workdays || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  s.withinReach = (s.withinReach || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  s.limitations = (s.limitations || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  try { s.quietWindows = JSON.parse(s.quietWindowsJSON || '[]'); } catch (e) { s.quietWindows = []; }
  s.gamification = s.gamification === 'on';
  s.milestoneCelebration = s.milestoneCelebration === 'on';
  s.revision = parseInt(s.revision || '1', 10);
  return s;
}

function saveSettings(dirs, s) {
  var out = [];
  function row(k, v) { out.push(k + '\t' + (v === undefined || v === null ? '' : v)); }
  row('workdays', s.workdays.join(','));
  row('workStart', s.workStart);
  row('workEnd', s.workEnd);
  row('workSetting', s.workSetting || '');
  row('busyContext', s.busyContext || '');
  row('limitations', s.limitations.join(','));
  row('withinReach', s.withinReach.join(','));
  row('movementCapacity', s.movementCapacity || '');
  row('quietWindowsJSON', JSON.stringify(s.quietWindows || []));
  row('gamification', s.gamification ? 'on' : 'off');
  row('coachingTone', s.coachingTone || '');
  row('milestoneCelebration', s.milestoneCelebration ? 'on' : 'off');
  // No priorityArea row: priority now lives only in routine.tsv's priorityRank column, and
  // priorityArea is derived (the rank-1 row's type) wherever it is still reported.
  row('statedGoal', s.statedGoal || '');
  row('revision', String(s.revision || 1));
  atomicWriteFile(dirs.config + '/settings.tsv', out.join('\n') + '\n');
}

// The exact expected routine.tsv header. validate.js rejects any file whose header differs —
// fields are read positionally, so an old 7-column file would otherwise parse silently with
// priorityRank === null and no diagnostic at all.
var ROUTINE_HEADER = ['type', 'mode', 'cadenceMinutes', 'phase', 'times', 'enabled', 'optionId', 'priorityRank'];

function routineHeaderOf(dirs) {
  var rows = readTSV(dirs.config + '/routine.tsv');
  return rows.length > 0 && rows[0][0] === 'type' ? rows[0] : null;
}

function loadRoutine(dirs) {
  var rows = readTSV(dirs.config + '/routine.tsv');
  return rows.filter(function (r) { return r[0] !== 'type'; }).map(function (r) {
    return {
      type: r[0],
      mode: r[1] || '',
      cadenceMinutes: r[2] ? parseInt(r[2], 10) : null,
      phase: r[3] !== undefined && r[3] !== '' ? parseInt(r[3], 10) : 0,
      times: r[4] ? r[4].split(',').map(function (x) { return x.trim(); }).filter(Boolean) : [],
      enabled: r[5] === 'true',
      optionId: r[6] || '',
      // Blank means unranked, which is a legitimate answer, not a missing one.
      priorityRank: (r[7] !== undefined && String(r[7]).trim() !== '') ? parseInt(r[7], 10) : null
    };
  });
}

function saveRoutine(dirs, rows) {
  var out = [ROUTINE_HEADER.join('\t')];
  rows.forEach(function (r) {
    var phaseField = r.mode === 'interval' ? (r.phase || 0) : '';
    var rankField = (r.priorityRank === null || r.priorityRank === undefined || r.priorityRank === '') ? '' : r.priorityRank;
    out.push([r.type, r.mode || '', r.cadenceMinutes || '', phaseField, (r.times || []).join(','), r.enabled ? 'true' : 'false', r.optionId || '', rankField].join('\t'));
  });
  atomicWriteFile(dirs.config + '/routine.tsv', out.join('\n') + '\n');
}

function loadLibrary(dirs) {
  var rows = readTSV(dirs.config + '/library.tsv');
  return rows.filter(function (r) { return r[0] !== 'optionId'; }).map(function (r) {
    return {
      optionId: r[0], type: r[1], name: r[2], instruction: r[3], dose: r[4],
      why: r[5], minSeconds: parseInt(r[6], 10) || 0, sourceURL: r[7] || '', restrictions: r[8] || ''
    };
  });
}

function libraryByOptionId(dirs) {
  var lib = {};
  loadLibrary(dirs).forEach(function (m) { lib[m.optionId] = m; });
  return lib;
}

// ---------- Directory / mode resolution ----------
function resolveDirs(baseDir, mode) {
  if (mode === 'test') {
    var t = baseDir + '/data/test-runs/.current';
    return {
      mode: 'test', base: baseDir, root: t,
      config: t + '/config', state: t + '/state', data: t + '/data',
      inbox: t + '/state/inbox', commands: t + '/state/commands',
      lock: t + '/state/dialog.lock', quarantine: t + '/quarantine',
      dashboard: t + '/dashboard.html', coachSummary: t + '/coach-summary.json',
      slots: t + '/data/slots.jsonl', log: t + '/data/log.jsonl',
      summary: t + '/data/summary.json', changes: t + '/data/changes.jsonl',
      stateFile: t + '/state/state.json'
    };
  }
  return {
    mode: 'live', base: baseDir, root: baseDir,
    config: baseDir + '/config', state: baseDir + '/state', data: baseDir + '/data',
    inbox: baseDir + '/state/inbox', commands: baseDir + '/state/commands',
    lock: baseDir + '/state/dialog.lock', quarantine: baseDir + '/data/quarantine',
    dashboard: baseDir + '/dashboard.html', coachSummary: baseDir + '/coach-summary.json',
    slots: baseDir + '/data/slots.jsonl', log: baseDir + '/data/log.jsonl',
    summary: baseDir + '/data/summary.json', changes: baseDir + '/data/changes.jsonl',
    stateFile: baseDir + '/state/state.json'
  };
}

function readRuntimeMode(baseDir) {
  var t = readTextOrNull(baseDir + '/runtime/mode');
  return t ? t.trim() : null;
}

function modeIsConsistent(baseDir, mode) {
  var hasCurrent = fileExists(baseDir + '/data/test-runs/.current');
  if (mode === 'test') return hasCurrent;
  if (mode === 'live') return !hasCurrent;
  return false;
}

// ---------- state.json ----------
function loadState(dirs) {
  return readJSON(dirs.stateFile) || {
    configRevision: 1, currentDay: null, pauseUntil: null, lastTick: null,
    shownSlots: {}, settledSlots: {}, activeDialog: null, rotationState: {},
    appliedCommands: {}, lastHeartbeatTs: null, lastMilestoneLine: {}
  };
}

function saveState(dirs, st) {
  atomicWriteFile(dirs.stateFile, JSON.stringify(st));
}

// ---------- summary.json ----------
function loadSummary(dirs) {
  return readJSON(dirs.summary) || {
    byDay: {}, byType: {}, byTimeBucket: {}, excludedByReason: {},
    score: 0, combo: 0, comboDay: null, streak: 0, lastStreakDay: null,
    totals: { done: 0, skipped: 0, excluded: 0 }
  };
}

function saveSummary(dirs, sum) {
  atomicWriteFile(dirs.summary, JSON.stringify(sum));
}

function bump(obj, key, field) {
  if (!obj[key]) obj[key] = { done: 0, skipped: 0, excluded: 0 };
  obj[key][field] = (obj[key][field] || 0) + 1;
}

var COMBO_LADDER = [1.0, 1.2, 1.5, 2.0];
var STREAK_MILESTONES = [3, 5, 10, 20, 30];

function applyOutcomeToSummary(sum, rec, settings) {
  var day = rec.scheduledTs.slice(0, 10);
  var hour = new Date(rec.scheduledTs).getHours();
  bump(sum.byDay, day, rec.outcome === 'done' ? 'done' : (rec.outcome === 'skipped' ? 'skipped' : 'excluded'));
  bump(sum.byType, rec.type, rec.outcome === 'done' ? 'done' : (rec.outcome === 'skipped' ? 'skipped' : 'excluded'));
  bump(sum.byTimeBucket, String(hour), rec.outcome === 'done' ? 'done' : (rec.outcome === 'skipped' ? 'skipped' : 'excluded'));
  if (rec.outcome === 'done') {
    sum.totals.done++;
    if (settings.gamification) {
      if (sum.comboDay !== day) { sum.combo = 0; sum.comboDay = day; }
      sum.combo++;
      var ladderIdx = Math.min(sum.combo, COMBO_LADDER.length) - 1;
      var mult = COMBO_LADDER[ladderIdx];
      sum.score += Math.round(10 * mult);
    }
    var streakInfo = updateStreak(sum, day);
    sum.milestoneJustHit = streakInfo.milestoneHit;
    sum.comboJustCapped = settings.gamification && sum.combo === COMBO_LADDER.length;
  } else if (rec.outcome === 'skipped') {
    sum.totals.skipped++;
  } else {
    sum.totals.excluded++;
    sum.excludedByReason[rec.outcome] = (sum.excludedByReason[rec.outcome] || 0) + 1;
  }
}

function updateStreak(sum, day) {
  var hit = null;
  if (sum.lastStreakDay === day) return { milestoneHit: null };
  // A Done today: streak continues from the previous eligible workday's streak count.
  sum.streak = (sum.streak || 0) + 1;
  sum.lastStreakDay = day;
  if (STREAK_MILESTONES.indexOf(sum.streak) !== -1 || (sum.streak > 30 && sum.streak % 10 === 0)) {
    hit = sum.streak;
  }
  return { milestoneHit: hit };
}

function completionRate(agg) {
  var denom = agg.done + agg.skipped;
  return denom === 0 ? null : agg.done / denom;
}

// ---------- Scheduling engine ----------
// Expand an enabled routine row into minute-of-day slot times within [workStart, workEnd).
function expandRow(row, workStart, workEnd) {
  var out = [];
  if (row.mode === 'times') {
    row.times.forEach(function (t) {
      var m = parseHHMM(t);
      if (m !== null && m >= workStart && m < workEnd) out.push(m);
    });
  } else if (row.mode === 'interval') {
    var phase = ((row.phase % row.cadenceMinutes) + row.cadenceMinutes) % row.cadenceMinutes;
    for (var m2 = workStart + phase; m2 < workEnd; m2 += row.cadenceMinutes) {
      if (m2 >= workStart) out.push(m2);
    }
  }
  return out;
}

var MIN_SCHEDULED_GAP = 8;
var MIN_ACTUAL_SHOW_GAP = 5;

// Build the full flat timeline (all enabled rows) for one workday, sorted by time.
function buildTimeline(routine, workStart, workEnd) {
  var slots = [];
  routine.filter(function (r) { return r.enabled; }).forEach(function (r) {
    expandRow(r, workStart, workEnd).forEach(function (m) {
      slots.push({ type: r.type, minute: m, optionId: r.optionId });
    });
  });
  slots.sort(function (a, b) { return a.minute - b.minute; });
  return slots;
}

function findSpacingViolations(slots) {
  var violations = [];
  for (var i = 1; i < slots.length; i++) {
    var gap = slots[i].minute - slots[i - 1].minute;
    if (gap < MIN_SCHEDULED_GAP) {
      violations.push({ a: slots[i - 1], b: slots[i], gapMinutes: gap });
    }
  }
  return violations;
}

// Order enabled interval rows for greedy placement.
//   'rank'    — priorityRank ascending (rank 1 first), unranked last by cadence. Honors the
//               contract's "rank 1 gets first choice among valid phase placements".
//   'cadence' — tightest cadence first. This is what actually makes the greedy search succeed:
//               the most constrained row (e.g. eyes/20min = 24 slots a day) must be placed
//               before loose ones, or it can be left with zero valid phases.
function orderIntervalRows(intervalRows, strategy) {
  var byCadence = function (a, b) { return a.cadenceMinutes - b.cadenceMinutes || a.type.localeCompare(b.type); };
  if (strategy === 'cadence') return intervalRows.slice().sort(byCadence);
  return intervalRows.slice().sort(function (a, b) {
    var ar = a.priorityRank, br = b.priorityRank;
    if (ar !== null && br !== null) return ar - br || byCadence(a, b);
    if (ar !== null) return -1;
    if (br !== null) return 1;
    return byCadence(a, b);
  });
}

// Greedily assign phases to enabled interval rows (exact-times rows are fixed and placed
// first) so that the combined timeline has no pair closer than MIN_SCHEDULED_GAP. Exhaustively
// searches every candidate phase in [0, cadence) per row against everything already placed —
// small loop, bounded by the work-hours window (typically <= a few hundred iterations per row).
//
// Placement is attempted in priorityRank order first so a ranked row really does get first
// choice. Rank order can be infeasible where cadence order is not (placing a loose 60-min row
// before a tight 20-min one can leave the tight row zero valid phases), and the contract is
// explicit that rank "chooses among valid phase placements only" and never wins a slot by
// pushing another row below the 8-minute floor. So a rank-order failure falls back to cadence
// order rather than being reported as a collision; the caller surfaces
// rankHonored:false as a warning. Only when BOTH orders fail is it a real collision.
// Returns {ok:true, routine:[...withPhase], rankHonored:bool} or {ok:false, collisions:[...]}.
function resolveCollisions(routine, workStart, workEnd) {
  var attempts = ['rank', 'cadence'];
  var lastFailure = null;
  for (var a = 0; a < attempts.length; a++) {
    var result = resolveCollisionsWithOrder(routine, workStart, workEnd, attempts[a]);
    if (result.ok) {
      result.rankHonored = (attempts[a] === 'rank');
      return result;
    }
    if (attempts[a] === 'cadence' || result.stage === 'fixed-times') lastFailure = result;
  }
  return lastFailure;
}

function resolveCollisionsWithOrder(routine, workStart, workEnd, strategy) {
  var enabled = routine.filter(function (r) { return r.enabled; });
  var fixed = enabled.filter(function (r) { return r.mode === 'times'; });
  var intervalRows = orderIntervalRows(enabled.filter(function (r) { return r.mode === 'interval'; }), strategy);

  var placed = [];
  fixed.forEach(function (r) {
    expandRow(r, workStart, workEnd).forEach(function (m) { placed.push({ type: r.type, minute: m }); });
  });
  placed.sort(function (a, b) { return a.minute - b.minute; });
  if (findSpacingViolations(placed).length > 0) {
    return { ok: false, collisions: findSpacingViolations(placed).map(function (v) { return describeCollision(v); }), stage: 'fixed-times' };
  }

  var resolvedPhases = {};
  for (var i = 0; i < intervalRows.length; i++) {
    var row = intervalRows[i];
    var found = null;
    for (var phase = 0; phase < row.cadenceMinutes; phase++) {
      var candidateSlots = expandRow({ type: row.type, mode: 'interval', cadenceMinutes: row.cadenceMinutes, phase: phase, times: [] }, workStart, workEnd)
        .map(function (m) { return { type: row.type, minute: m }; });
      var combined = placed.concat(candidateSlots).sort(function (a, b) { return a.minute - b.minute; });
      if (findSpacingViolations(combined).length === 0) { found = phase; break; }
    }
    if (found === null) {
      var collisions = [];
      for (var phase2 = 0; phase2 < row.cadenceMinutes; phase2++) {
        var candSlots = expandRow({ type: row.type, mode: 'interval', cadenceMinutes: row.cadenceMinutes, phase: phase2, times: [] }, workStart, workEnd)
          .map(function (m) { return { type: row.type, minute: m }; });
        var comb = placed.concat(candSlots).sort(function (a, b) { return a.minute - b.minute; });
        findSpacingViolations(comb).forEach(function (v) {
          if (v.a.type === row.type || v.b.type === row.type) collisions.push(describeCollision(v));
        });
      }
      return { ok: false, collisions: uniqueCollisions(collisions), stage: 'row:' + row.type, blockedRow: row.type };
    }
    resolvedPhases[row.type] = found;
    expandRow({ type: row.type, mode: 'interval', cadenceMinutes: row.cadenceMinutes, phase: found, times: [] }, workStart, workEnd)
      .forEach(function (m) { placed.push({ type: row.type, minute: m }); });
    placed.sort(function (a, b) { return a.minute - b.minute; });
  }

  var newRoutine = routine.map(function (r) {
    if (r.enabled && r.mode === 'interval' && resolvedPhases.hasOwnProperty(r.type)) {
      var copy = Object.assign({}, r);
      copy.phase = resolvedPhases[r.type];
      return copy;
    }
    return r;
  });
  return { ok: true, routine: newRoutine };
}

function describeCollision(v) {
  return v.a.type + '@' + fmtHHMM(v.a.minute) + ' <-> ' + v.b.type + '@' + fmtHHMM(v.b.minute) + ' (' + v.gapMinutes + ' min apart, need ' + MIN_SCHEDULED_GAP + ')';
}
function uniqueCollisions(arr) {
  var seen = {};
  return arr.filter(function (c) { if (seen[c]) return false; seen[c] = true; return true; });
}

// ---------- Rotation ----------
function pickOptionId(row, lastPicked) {
  var ids = row.optionId.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  if (ids.length <= 1) return ids[0] || '';
  var choices = ids.filter(function (id) { return id !== lastPicked; });
  if (choices.length === 0) choices = ids;
  return choices[Math.floor(Math.random() * choices.length)];
}

// ---------- Quiet windows ----------
function inQuietWindow(quietWindows, day3, minuteOfDay) {
  for (var i = 0; i < quietWindows.length; i++) {
    var w = quietWindows[i];
    if (w.days.indexOf(day3) === -1) continue;
    var s = parseHHMM(w.start), e = parseHHMM(w.end);
    if (s === null || e === null) continue;
    if (minuteOfDay >= s && minuteOfDay < e) return w;
  }
  return null;
}

// ---------- Milestone messages ----------
function loadMessages(dirs) {
  var rows = readTSV(dirs.config + '/messages.tsv');
  var byKey = {};
  rows.filter(function (r) { return r[0] !== 'milestoneType'; }).forEach(function (r) {
    var key = r[0];
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(r[1]);
  });
  return byKey;
}

function pickMilestoneLine(dirs, state, milestoneKey) {
  var msgs = loadMessages(dirs)[milestoneKey] || [];
  if (msgs.length === 0) return null;
  var last = state.lastMilestoneLine[milestoneKey];
  var choices = msgs.filter(function (m) { return m !== last; });
  if (choices.length === 0) choices = msgs;
  var pick = choices[Math.floor(Math.random() * choices.length)];
  state.lastMilestoneLine[milestoneKey] = pick;
  return pick;
}

// ---------- coach-summary.json whitelist builder ----------
var COACH_SUMMARY_KEYS = ['schemaVersion', 'mode', 'generatedAt', 'sampleWindow', 'aggregateResults',
  'schedule', 'enabledRoutine', 'movementLimits', 'priorityArea', 'workSetting', 'busyContext',
  'statedGoal', 'coachingTone', 'gamification', 'recentChanges'];

function buildCoachSummary(dirs, mode) {
  var settings = loadSettings(dirs);
  var routine = loadRoutine(dirs);
  var summary = loadSummary(dirs);
  var slots = readJSONL(dirs.slots);
  var changes = readJSONL(dirs.changes);

  var days = {};
  slots.forEach(function (s) { days[s.scheduledTs.slice(0, 10)] = true; });
  var dayKeys = Object.keys(days).sort();

  var byDay = {}, byType = {}, byTimeBucket = {};
  Object.keys(summary.byDay).forEach(function (k) { byDay[k] = rateShape(summary.byDay[k]); });
  Object.keys(summary.byType).forEach(function (k) { byType[k] = rateShape(summary.byType[k]); });
  Object.keys(summary.byTimeBucket).forEach(function (k) { byTimeBucket[k] = rateShape(summary.byTimeBucket[k]); });

  var out = {
    schemaVersion: '1.0.0',
    mode: mode,
    generatedAt: toLocalISOString(new Date()),
    sampleWindow: { start: dayKeys[0] || null, end: dayKeys[dayKeys.length - 1] || null, workdayCount: dayKeys.length },
    aggregateResults: {
      done: summary.totals.done, skipped: summary.totals.skipped, excluded: summary.totals.excluded,
      completionRate: completionRate(summary.totals),
      byDay: byDay, byType: byType, byTimeBucket: byTimeBucket,
      excludedByReason: summary.excludedByReason
    },
    schedule: {
      workdays: settings.workdays, workStart: settings.workStart, workEnd: settings.workEnd,
      quietWindows: settings.quietWindows.map(function (w) { return { days: w.days, start: w.start, end: w.end, label: w.label || null }; })
    },
    enabledRoutine: routine.filter(function (r) { return r.enabled; }).map(function (r) {
      return { type: r.type, mode: r.mode, cadenceMinutes: r.cadenceMinutes, times: r.times, enabled: r.enabled, optionId: r.optionId, priorityRank: r.priorityRank };
    }),
    movementLimits: settings.limitations,
    // Derived, never stored: the type of the rank-1 row, or null when nothing is ranked.
    priorityArea: derivePriorityArea(routine),
    workSetting: settings.workSetting || null,
    busyContext: settings.busyContext || null,
    statedGoal: settings.statedGoal || null,
    coachingTone: settings.coachingTone || null,
    gamification: settings.gamification
      ? { enabled: true, score: summary.score, combo: summary.combo, streak: summary.streak }
      : { enabled: false },
    recentChanges: changes.slice(-10).map(function (c) {
      return { timestamp: c.ts, area: c.area, changeType: c.changeType, before: c.before, after: c.after };
    })
  };
  return out;
}

// priorityArea is a reporting convenience derived from routine.tsv, not a stored setting.
function derivePriorityArea(routine) {
  var top = routine.filter(function (r) { return r.enabled && r.priorityRank === 1; })[0];
  return top ? top.type : null;
}

function rateShape(agg) {
  return { done: agg.done || 0, skipped: agg.skipped || 0, excluded: agg.excluded || 0, completionRate: completionRate({ done: agg.done || 0, skipped: agg.skipped || 0 }) };
}

// ---------- Dashboard ----------
function buildDashboardHTML(dirs, mode) {
  var settings = loadSettings(dirs);
  var routine = loadRoutine(dirs);
  var lib = libraryByOptionId(dirs);
  var summary = loadSummary(dirs);
  var slots = readJSONL(dirs.slots);
  var now = new Date();

  var today = localDateStr(now);
  var todayAgg = summary.byDay[today] || { done: 0, skipped: 0, excluded: 0 };
  var rate = completionRate(summary.totals);

  var last14 = [];
  var d = new Date(now);
  for (var i = 0; i < 14; i++) {
    var day = localDateStr(d);
    var isWorkday = settings.workdays.indexOf(localDOW(d)) !== -1;
    if (isWorkday) {
      var agg = summary.byDay[day] || { done: 0, skipped: 0, excluded: 0 };
      last14.unshift({ day: day, done: agg.done, skipped: agg.skipped, excluded: agg.excluded });
    }
    d.setDate(d.getDate() - 1);
  }

  var typeRows = routine.filter(function (r) { return r.enabled; }).map(function (r) {
    var mv = lib[r.optionId.split(',')[0]];
    var t = summary.byType[r.type] || { done: 0, skipped: 0, excluded: 0 };
    return '<tr><td>' + htmlEscape(r.type) + '</td><td>' + htmlEscape(mv ? mv.name : r.optionId) +
      '</td><td>' + htmlEscape(r.mode === 'interval' ? ('every ' + r.cadenceMinutes + ' min') : r.times.join(', ')) +
      '</td><td>' + t.done + '</td><td>' + t.skipped + '</td><td>' + t.excluded + '</td></tr>';
  }).join('\n');

  var heatCells = last14.map(function (h) {
    var total = h.done + h.skipped + h.excluded;
    var cls = total === 0 ? 'hm-empty' : (h.done >= h.skipped ? 'hm-good' : 'hm-mixed');
    return '<div class="hm-cell ' + cls + '" title="' + htmlEscape(h.day) + ': ' + h.done + ' done / ' + h.skipped + ' skipped / ' + h.excluded + ' excluded">' +
      '<div class="hm-day">' + htmlEscape(h.day.slice(5)) + '</div><div class="hm-count">' + h.done + '</div></div>';
  }).join('\n');

  var gameBlock = settings.gamification ? (
    '<div class="stat"><div class="stat-label">Score</div><div class="stat-value">' + summary.score + '</div></div>' +
    '<div class="stat"><div class="stat-label">Combo (today)</div><div class="stat-value">' + summary.combo + '</div></div>' +
    '<div class="stat"><div class="stat-label">Day streak</div><div class="stat-value">' + summary.streak + '</div></div>'
  ) : '';

  var modeNote = mode === 'test'
    ? '<div class="mode-banner">TEST MODE — installation-check data only. Not evidence of a changed habit.</div>'
    : '';

  return '<title>Desk Health Coach Dashboard</title>' +
    '<style>' +
    'body{font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#1a1a1a;background:#fff}' +
    'h1{font-size:20px}.asof{color:#666;font-size:12px;margin-bottom:16px}' +
    '.mode-banner{background:#fff3cd;border:1px solid #e6c200;padding:8px 12px;border-radius:6px;margin-bottom:16px;font-weight:600}' +
    '.stats{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px}' +
    '.stat{border:1px solid #ddd;border-radius:8px;padding:10px 14px;min-width:110px}' +
    '.stat-label{font-size:11px;color:#666;text-transform:uppercase}.stat-value{font-size:22px;font-weight:700}' +
    'table{border-collapse:collapse;width:100%;margin-bottom:20px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:13px}' +
    'th{background:#f5f5f5}' +
    '.hm{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px}' +
    '.hm-cell{width:44px;height:44px;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px}' +
    '.hm-empty{background:#f0f0f0;color:#999}.hm-good{background:#d4f4dd;color:#0a5c2b}.hm-mixed{background:#fde2c8;color:#7a3e00}' +
    '.note{color:#666;font-size:12px}' +
    '</style>' +
    '<h1>Desk Health Coach</h1>' +
    '<div class="asof">as of ' + htmlEscape(toLocalISOString(now)) + '</div>' +
    modeNote +
    '<div class="stats">' +
    '<div class="stat"><div class="stat-label">Today Done</div><div class="stat-value">' + todayAgg.done + '</div></div>' +
    '<div class="stat"><div class="stat-label">Today Skipped</div><div class="stat-value">' + todayAgg.skipped + '</div></div>' +
    '<div class="stat"><div class="stat-label">Completion rate</div><div class="stat-value">' + (rate === null ? '—' : Math.round(rate * 100) + '%') + '</div></div>' +
    '<div class="stat"><div class="stat-label">Excluded (all-time)</div><div class="stat-value">' + summary.totals.excluded + '</div></div>' +
    gameBlock +
    '</div>' +
    '<h2>Current routine</h2>' +
    '<table><tr><th>Type</th><th>Movement</th><th>Cadence</th><th>Done</th><th>Skipped</th><th>Excluded</th></tr>' + typeRows + '</table>' +
    '<h2>Last 14 workdays</h2>' +
    '<div class="hm">' + heatCells + '</div>' +
    '<p class="note">Done and Skip are self-reported by clicking the reminder dialog. "Response time" below (when shown) means prompt-to-click elapsed seconds, not minutes exercised — it does not prove a movement happened. This dashboard is read-only; routine changes happen through Claude Code.</p>';
}

// ---------- Command / requestId reconciliation ----------
function alreadyApplied(state, requestId) {
  return state.appliedCommands && state.appliedCommands.hasOwnProperty(requestId);
}
function recordApplied(state, requestId, resultingRevision) {
  if (!state.appliedCommands) state.appliedCommands = {};
  state.appliedCommands[requestId] = { ts: toLocalISOString(new Date()), resultingRevision: resultingRevision };
}
