'use strict';

const REPOSITORY = process.env.GITHUB_REPOSITORY || '';
const TOKEN = process.env.GITHUB_TOKEN || '';
const ISSUE_TITLE = '[TR-os] Webbplatsen svarar inte';
const MARKER = '<!-- tr-os-uptime-monitor -->';

async function github(path, options = {}) {
  const response = await fetch('https://api.github.com/repos/' + REPOSITORY + path, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + TOKEN,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('GitHub issue update failed with HTTP ' + response.status);
  return data;
}

async function run() {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(REPOSITORY) || !TOKEN) throw new Error('GitHub Actions context is missing.');
  let healthy = false, detail = 'TR-os did not return a healthy response.';
  try {
    const response = await fetch('https://tr-os.me/api/ready', { cache: 'no-store', signal: AbortSignal.timeout(65000) });
    const data = await response.json().catch(() => ({}));
    healthy = response.ok && data.ok === true;
    if (!healthy) detail = 'Health endpoint returned HTTP ' + response.status + '.';
  } catch { detail = 'The health endpoint timed out or could not be reached.'; }

  const issues = await github('/issues?state=open&per_page=100');
  const open = Array.isArray(issues) ? issues.find(issue => !issue.pull_request && issue.title === ISSUE_TITLE && String(issue.body || '').includes(MARKER)) : null;
  const timestamp = new Date().toISOString();
  if (!healthy && !open) {
    await github('/issues', { method: 'POST', body: JSON.stringify({
      title: ISSUE_TITLE,
      body: MARKER + '\n\nDen externa kontrollen kunde inte nå TR-os den ' + timestamp + '.\n\n' + detail + '\n\nKontrollera [TR-os](https://tr-os.me) och Render-driften.'
    }) });
    console.log('Opened one outage alert issue.');
  } else if (healthy && open) {
    await github('/issues/' + open.number + '/comments', { method: 'POST', body: JSON.stringify({ body: 'TR-os svarar igen vid ' + timestamp + '. Stänger driftlarmet.\n\n' + MARKER }) });
    await github('/issues/' + open.number, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
    console.log('Closed the recovered outage alert.');
  } else {
    console.log(healthy ? 'TR-os is healthy.' : 'Outage remains open; no duplicate alert created.');
  }
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { ISSUE_TITLE, MARKER, run };
