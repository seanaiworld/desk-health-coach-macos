// Desk Health Coach — regenerates dashboard.html and/or coach-summary.json on demand.
// Never runs automatically; only on /desk-health dashboard, /desk-health how am I doing, or
// right after live cutover. Read-only with respect to canonical data.

function run(argv) {
  setPrivateUmask();
  var baseDir = argv[0];
  var mode = argv[1];
  var what = argv[2] || 'both'; // 'dashboard' | 'coach-summary' | 'both'

  if (!modeIsConsistent(baseDir, mode)) return 'FAIL_CLOSED mode-mismatch';
  var dirs = resolveDirs(baseDir, mode);

  var wrote = [];
  if (what === 'dashboard' || what === 'both') {
    atomicWriteFile(dirs.dashboard, buildDashboardHTML(dirs, mode));
    wrote.push(dirs.dashboard);
  }
  if (what === 'coach-summary' || what === 'both') {
    atomicWriteFile(dirs.coachSummary, JSON.stringify(buildCoachSummary(dirs, mode), null, 2));
    wrote.push(dirs.coachSummary);
  }
  return 'OK ' + wrote.join(' ');
}
