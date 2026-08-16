// Desk Health Coach — one-shot JXA dialog worker. Spawned as a detached background child by
// runner.sh: osascript -l JavaScript dialog.js <scriptDir> <requestPath>
// Writes exactly one result file into the request's inboxDir, then exits. Never blocks its
// parent (runner.sh already backgrounded it with &). At most one of these should ever be
// running at once — the lock in lockDir enforces that; this worker claims it on start.

function run(argv) {
  setPrivateUmask();
  var requestPath = argv[0];
  var req = readJSON(requestPath);
  if (!req) return 'no-request';

  // Everything from here on can fail in ways that have nothing to do with the user's click
  // (a bad JXA/Foundation call, an unexpected null, etc.) — per spec, ANY such failure must
  // still resolve the slot as excluded-error rather than leave it stuck open forever in
  // state.shownSlots. Only a JSON-unparseable request (above) has no addressable inbox to
  // write to at all.
  var outcomeAction = 'excluded-error';
  var responseSec = null;
  try {
    outcomeAction = runDialogLoop(req);
    responseSec = LAST_RESPONSE_SEC;
  } catch (e) {
    outcomeAction = 'excluded-error';
    responseSec = null;
  }

  var resultFile = req.inboxDir + '/' + uuid() + '.json';
  var resultRec = { slotId: req.slotId, action: outcomeAction, responseSec: responseSec, ts: toLocalISOString(new Date()), mode: req.mode };
  try {
    atomicWriteFile(resultFile, JSON.stringify(resultRec));
  } catch (e) {
    // If we can't even write the result, there is nothing more this worker can safely do;
    // the lock will be recovered as stale by the next tick once this process exits.
  }
  return outcomeAction;
}

var LAST_RESPONSE_SEC = null;

function runDialogLoop(req) {
  // Claim the lock tick.js pre-created with a placeholder — record our real PID + start time
  // so a future tick can tell a live worker from a crashed one apart from PID reuse.
  var pid = $.NSProcessInfo.processInfo.processIdentifier;
  var startTime = processStartTime(pid);
  try {
    atomicWriteFile(req.lockDir + '/info.json', JSON.stringify({ slotId: req.slotId, pid: pid, startTime: startTime, startedTs: toLocalISOString(new Date()) }));
  } catch (e) { /* if this fails the lock dir is gone already; tick.js will reconcile next beat */ }

  var promptStart = new Date();
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;

  var title = 'Desk Health — ' + req.type;
  var notSoFast = false;

  while (true) {
    var bodyLines = [];
    if (notSoFast) bodyLines.push('Not so fast — give it a few more seconds.');
    bodyLines.push(req.name + '  (' + req.dose + ')');
    if (req.instruction) bodyLines.push(req.instruction);
    if (req.why) bodyLines.push('Why: ' + req.why);
    var text = bodyLines.join('\n\n');

    var clickTs;
    var buttonReturned;
    try {
      var result = app.displayDialog(text, { buttons: ['Skip', 'Done'], defaultButton: 'Done', withTitle: title });
      buttonReturned = result.buttonReturned;
      clickTs = new Date();
    } catch (e) {
      // Escape, window-close (no Cancel button was offered, but macOS still allows this and
      // raises -128), or any other JXA/AppleEvent error. Never treated as Skip.
      LAST_RESPONSE_SEC = null;
      return 'excluded-error';
    }

    var elapsedSec = (clickTs - promptStart) / 1000;
    if (buttonReturned === 'Skip') {
      LAST_RESPONSE_SEC = elapsedSec;
      return 'skipped';
    }
    // Done
    if (elapsedSec < (req.minSeconds || 0)) {
      notSoFast = true;
      continue; // show the same action again; keep promptStart as the ORIGINAL show time
    }
    LAST_RESPONSE_SEC = elapsedSec;
    return 'done';
  }
}
