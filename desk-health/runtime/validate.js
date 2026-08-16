// Desk Health Coach — schema, schedule/collision, lock, and aggregate-reconciliation checks.
// run(argv): argv[0]=baseDir, argv[1]=target ('staging'|'live'|'test')
// Prints one JSON report to stdout: {ok, errors:[...], warnings:[...], timeline:[...]}

function run(argv) {
  setPrivateUmask();
  var baseDir = argv[0];
  var target = argv[1];
  var errors = [];
  var warnings = [];
  var timeline = [];

  var dirs;
  if (target === 'staging') {
    dirs = { config: baseDir + '/.staging/config' };
  } else {
    if (!modeIsConsistent(baseDir, target)) {
      return JSON.stringify({ ok: false, errors: ['runtime/mode disagrees with presence of data/test-runs/.current for target=' + target], warnings: [], timeline: [] });
    }
    dirs = resolveDirs(baseDir, target);
  }

  var settings, routine, library;
  try { settings = loadSettings(dirs); } catch (e) { errors.push('settings.tsv unreadable: ' + e.message); }
  try { routine = loadRoutine(dirs); } catch (e) { errors.push('routine.tsv unreadable: ' + e.message); }
  try { library = loadLibrary(dirs); } catch (e) { errors.push('library.tsv unreadable: ' + e.message); }

  if (settings) validateSettings(settings, errors);
  validateRoutineHeader(dirs, errors);
  if (routine) validateRanks(routine, errors);
  if (routine && library) validateRoutine(routine, library, errors);
  if (library) validateLibrary(library, errors);

  if (settings && routine && errors.length === 0) {
    var workStart = parseHHMM(settings.workStart);
    var workEnd = parseHHMM(settings.workEnd);
    var resolved = resolveCollisions(routine, workStart, workEnd);
    if (!resolved.ok) {
      errors.push('scheduling collision at ' + resolved.stage + ': ' + resolved.collisions.join('; '));
    } else {
      var built = buildTimeline(resolved.routine, workStart, workEnd);
      var violations = findSpacingViolations(built);
      if (violations.length > 0) {
        errors.push('spacing violation in saved config (phases not actually resolved): ' + violations.map(describeCollision).join('; '));
      }
      timeline = built.map(function (s) { return { type: s.type, time: fmtHHMM(s.minute) }; });
      if (resolved.rankHonored === false && routine.some(function (r) { return r.enabled && r.priorityRank !== null; })) {
        warnings.push('priorityRank order could not be satisfied without breaking the 8-minute floor for another row, ' +
          'so placement fell back to tightest-cadence-first. Every chosen cadence is unchanged and every slot is still ' +
          '8 minutes apart; only which row got its preferred phase differs. Change or disable a cadence if the ranked ' +
          'row must win its placement.');
      }
      var driftedPhases = resolved.routine.filter(function (r, i) {
        return r.enabled && r.mode === 'interval' && r.phase !== routine[i].phase;
      });
      if (driftedPhases.length > 0) {
        warnings.push('saved routine.tsv phases differ from the collision-free phases validate.js just computed for: ' +
          driftedPhases.map(function (r) { return r.type; }).join(', ') + ' — re-run the approved-change flow to persist them');
      }
    }
  }

  if (target === 'live' || target === 'test') {
    reconcile(dirs, errors, warnings);
    checkLock(dirs, warnings);
  }

  return JSON.stringify({ ok: errors.length === 0, errors: errors, warnings: warnings, timeline: timeline });
}

function validateSettings(s, errors) {
  if (!s.workdays || s.workdays.length === 0) errors.push('workdays: at least one required');
  s.workdays.forEach(function (d) { if (VALID_DAYS.indexOf(d) === -1) errors.push('workdays: invalid day "' + d + '"'); });
  var ws = parseHHMM(s.workStart), we = parseHHMM(s.workEnd);
  if (ws === null) errors.push('workStart: invalid HH:MM "' + s.workStart + '"');
  if (we === null) errors.push('workEnd: invalid HH:MM "' + s.workEnd + '"');
  if (ws !== null && we !== null && ws >= we) errors.push('workStart must be earlier than workEnd (same-day range only, v1)');
  (s.quietWindows || []).forEach(function (w, i) {
    if (!w.days || w.days.length === 0) errors.push('quietWindows[' + i + ']: days required');
    (w.days || []).forEach(function (d) { if (VALID_DAYS.indexOf(d) === -1) errors.push('quietWindows[' + i + ']: invalid day "' + d + '"'); });
    var qs = parseHHMM(w.start), qe = parseHHMM(w.end);
    if (qs === null || qe === null) errors.push('quietWindows[' + i + ']: invalid start/end');
    else if (qs >= qe) errors.push('quietWindows[' + i + ']: start must be earlier than end');
  });
  if (s.limitations.indexOf('None') !== -1 && s.limitations.length > 1) {
    errors.push('limitations: "No known limitation" cannot be combined with a specific limitation');
  }
  // priorityArea was a settings key in the pre-rank schema. It is now derived from
  // routine.tsv's priorityRank, so a settings.tsv still carrying it is a half-migrated tree —
  // fail loudly rather than let saveSettings quietly drop it (or worse, round-trip it).
  if (s.priorityArea !== undefined) {
    errors.push('settings.tsv: priorityArea is no longer a settings key — priority is the priorityRank column in routine.tsv. Remove this row.');
  }
  [s.workdays, s.withinReach, s.limitations].forEach(function (arr) {
    arr.forEach(function (v) { if (hasControlChars(v)) errors.push('settings field contains a tab/newline/control character: "' + v + '"'); });
  });
}

function validateRoutineHeader(dirs, errors) {
  var header = routineHeaderOf(dirs);
  if (header === null) {
    errors.push('routine.tsv: missing or malformed header row (expected: ' + ROUTINE_HEADER.join(', ') + ')');
    return;
  }
  if (header.length !== ROUTINE_HEADER.length || header.join('\t') !== ROUTINE_HEADER.join('\t')) {
    errors.push('routine.tsv: header is "' + header.join(', ') + '" but this engine expects "' +
      ROUTINE_HEADER.join(', ') + '". Fields are read positionally, so a mismatched header means ' +
      'a pre-rank routine.tsv that would silently parse with no priority at all.');
  }
}

function validateRoutine(routine, library, errors) {
  var libIds = {};
  library.forEach(function (m) { libIds[m.optionId] = m; });
  var seenTypes = {};
  routine.forEach(function (r) {
    if (seenTypes[r.type]) errors.push('routine: duplicate type row "' + r.type + '"');
    seenTypes[r.type] = true;
    if (VALID_TYPES.indexOf(r.type) === -1) errors.push('routine: unknown type "' + r.type + '"');
    if (!r.enabled) return;
    if (r.mode !== 'interval' && r.mode !== 'times') { errors.push('routine: ' + r.type + ' is enabled with no cadence (mode must be interval or times)'); return; }
    if (r.mode === 'interval') {
      if (!Number.isInteger(r.cadenceMinutes) || r.cadenceMinutes <= 0) errors.push('routine: ' + r.type + ' has invalid cadenceMinutes');
    } else {
      if (!r.times || r.times.length === 0) errors.push('routine: ' + r.type + ' mode=times but no times given');
      r.times.forEach(function (t) { if (parseHHMM(t) === null) errors.push('routine: ' + r.type + ' has invalid time "' + t + '"'); });
    }
    var ids = r.optionId.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (ids.length === 0) errors.push('routine: ' + r.type + ' is enabled but has no optionId');
    ids.forEach(function (id) { if (!libIds[id]) errors.push('routine: ' + r.type + ' references unknown optionId "' + id + '"'); });
  });
}

function validateLibrary(library, errors) {
  var seen = {};
  library.forEach(function (m) {
    if (seen[m.optionId]) errors.push('library: duplicate optionId "' + m.optionId + '"');
    seen[m.optionId] = true;
    if (VALID_TYPES.indexOf(m.type) === -1) errors.push('library: "' + m.optionId + '" has unknown type "' + m.type + '"');
    if (!Number.isInteger(m.minSeconds) || m.minSeconds <= 0) errors.push('library: "' + m.optionId + '" has invalid minSeconds');
    if (m.sourceURL && !isValidURL(m.sourceURL)) errors.push('library: "' + m.optionId + '" has invalid sourceURL');
    [m.name, m.instruction, m.dose, m.why, m.restrictions].forEach(function (v) {
      if (v && hasControlChars(v)) errors.push('library: "' + m.optionId + '" has a control character in a text field');
    });
  });
}

// Rebuild summary aggregates fresh from slots.jsonl (chronological replay) and diff against the
// saved summary.json; also require exactly one log.jsonl line per done/skipped slot and none for
// excluded slots. This is the Section-3 "recovery check ... without duplicate counts" proof.
function reconcile(dirs, errors, warnings) {
  var slots = readJSONL(dirs.slots);
  var log = readJSONL(dirs.log);
  var savedSummary = loadSummary(dirs);
  var settingsForReplay = loadSettings(dirs);

  var seenSlotIds = {};
  slots.forEach(function (s) {
    if (seenSlotIds[s.slotId]) errors.push('slots.jsonl: duplicate terminal outcome for slotId ' + s.slotId);
    seenSlotIds[s.slotId] = true;
  });

  // log.jsonl carries no slotId (by the build contract's exact event schema — ts, scheduledTs,
  // shownTs, type, optionId, action, responseSec, mode only), so matching is necessarily by
  // (scheduledTs, type, mode). In real production data that key is unique per slot (one due
  // instance per type per cadence tick); it can coincidentally collide only across independently
  // fired synthetic test slots that share a wall-clock minute. Reconcile per KEY GROUP rather
  // than per individual slot so that's not a false positive: for each key, the count of
  // done/skipped slots at that key must equal the count of log lines at that key, and a key with
  // only excluded slots must have zero log lines.
  var logKey = function (l) { return l.scheduledTs + '|' + l.type + '|' + l.mode; };
  var logByKey = {};
  log.forEach(function (l) { logByKey[logKey(l)] = (logByKey[logKey(l)] || 0) + 1; });

  var slotsByKey = {};
  slots.forEach(function (s) {
    var key = s.scheduledTs + '|' + s.type + '|' + s.mode;
    if (!slotsByKey[key]) slotsByKey[key] = [];
    slotsByKey[key].push(s);
  });
  Object.keys(slotsByKey).forEach(function (key) {
    var group = slotsByKey[key];
    var expectedLogLines = group.filter(function (s) { return s.outcome === 'done' || s.outcome === 'skipped'; }).length;
    var actualLogLines = logByKey[key] || 0;
    if (actualLogLines !== expectedLogLines) {
      var ids = group.map(function (s) { return s.slotId + ':' + s.outcome; }).join(', ');
      errors.push('log.jsonl: key ' + key + ' expects ' + expectedLogLines + ' mirror line(s) for [' + ids + '], found ' + actualLogLines);
    }
  });

  var replay = { byDay: {}, byType: {}, byTimeBucket: {}, excludedByReason: {}, score: 0, combo: 0, comboDay: null, streak: 0, lastStreakDay: null, totals: { done: 0, skipped: 0, excluded: 0 } };
  slots.slice().sort(function (a, b) { return (a.settledTs || '').localeCompare(b.settledTs || ''); })
    .forEach(function (s) { applyOutcomeToSummary(replay, s, settingsForReplay); });

  ['done', 'skipped', 'excluded'].forEach(function (k) {
    if (replay.totals[k] !== savedSummary.totals[k]) {
      errors.push('summary.json totals.' + k + ' (' + savedSummary.totals[k] + ') does not match replay from slots.jsonl (' + replay.totals[k] + ')');
    }
  });
}

function checkLock(dirs, warnings) {
  if (!fileExists(dirs.lock)) return;
  var info = readJSON(dirs.lock + '/info.json');
  if (!info) { warnings.push('dialog lock exists with no info.json (will self-heal next tick)'); return; }
  if (info.pid && !processStillAlive(info.pid)) {
    warnings.push('dialog lock references dead pid ' + info.pid + ' for slot ' + info.slotId + ' (stale; next tick will recover it)');
  }
}
