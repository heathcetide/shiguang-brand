import { pathToFileURL } from 'node:url';

export const ADVISORY_IDS = [
  'GHSA-w3rx-r6r6-pgpr',
  'GHSA-5p2g-fcmc-qvqq',
];

export const NOTIFICATION_MARKER =
  '<!-- image-size-upstream-fix-available -->';

const NPM_LATEST_URL = 'https://registry.npmjs.org/image-size/latest';
const GITHUB_API_URL = 'https://api.github.com';

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported semantic version: ${version}`);
  }

  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }

  return 0;
}

function imageSizeVulnerability(advisory) {
  const vulnerability = advisory.vulnerabilities?.find(
    (entry) =>
      entry.package?.ecosystem === 'npm' &&
      entry.package?.name === 'image-size',
  );

  if (!vulnerability) {
    throw new Error(
      `${advisory.ghsa_id ?? 'Unknown advisory'} has no npm image-size vulnerability`,
    );
  }

  return vulnerability;
}

export function evaluateUpstreamState(latestVersion, advisories) {
  if (advisories.length !== ADVISORY_IDS.length) {
    throw new Error(
      `Expected ${ADVISORY_IDS.length} advisories, received ${advisories.length}`,
    );
  }

  const advisoryStates = advisories.map((advisory) => {
    const vulnerability = imageSizeVulnerability(advisory);
    const patchedVersion = vulnerability.first_patched_version?.identifier ?? null;

    return {
      id: advisory.ghsa_id,
      patchedVersion,
      vulnerableRange: vulnerability.vulnerable_version_range,
      updatedAt: advisory.updated_at,
    };
  });

  const fixAvailable = advisoryStates.every(
    ({ patchedVersion }) =>
      patchedVersion !== null &&
      compareVersions(latestVersion, patchedVersion) >= 0,
  );

  return {
    package: 'image-size',
    latestVersion,
    fixAvailable,
    advisories: advisoryStates,
  };
}

async function fetchJson(url, token) {
  const isGitHubRequest = url.startsWith(GITHUB_API_URL);
  const headers = {
    Accept: isGitHubRequest ? 'application/vnd.github+json' : 'application/json',
    'User-Agent': 'DietDigiDose-upstream-security-watch',
  };

  if (token && isGitHubRequest) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  return response.json();
}

async function getUpstreamState(token) {
  const [npmMetadata, ...advisories] = await Promise.all([
    fetchJson(NPM_LATEST_URL),
    ...ADVISORY_IDS.map((id) =>
      fetchJson(`${GITHUB_API_URL}/advisories/${id}`, token),
    ),
  ]);

  return evaluateUpstreamState(npmMetadata.version, advisories);
}

async function githubRequest(path, token, init = {}) {
  if (!token) {
    throw new Error('GITHUB_TOKEN is required when --notify is used');
  }

  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DietDigiDose-upstream-security-watch',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${path}`);
  }

  return response.status === 204 ? null : response.json();
}

async function hasNotification(repository, issueNumber, token) {
  for (let page = 1; ; page += 1) {
    const comments = await githubRequest(
      `/repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      token,
    );

    if (comments.some((comment) => comment.body.includes(NOTIFICATION_MARKER))) {
      return true;
    }
    if (comments.length < 100) {
      return false;
    }
  }
}

export function buildNotification(state) {
  const patchedVersions = state.advisories
    .map(({ id, patchedVersion }) => `- ${id}: \`${patchedVersion}\``)
    .join('\n');

  return `${NOTIFICATION_MARKER}
上游自动复核发现两个 \`image-size\` Advisory 均已有 npm 可用修复版本；当前 npm latest 为 \`${state.latestVersion}\`：

${patchedVersions}

请重新评估 Expo/Metro 升级或兼容 override，并完成本 issue 的完整验收（审计、客户端测试、Web export、Android/iOS 资源构建）后删除精确 CVE 例外。本通知只会发布一次。`;
}

async function notifyIfReady(state, token) {
  if (!state.fixAvailable) {
    return { notified: false, reason: 'fix-not-yet-available' };
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const issueNumber = Number(process.env.IMAGE_SIZE_ISSUE_NUMBER ?? '98');
  if (!repository || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(
      'GITHUB_REPOSITORY and a positive IMAGE_SIZE_ISSUE_NUMBER are required',
    );
  }

  const issue = await githubRequest(
    `/repos/${repository}/issues/${issueNumber}`,
    token,
  );
  if (issue.state !== 'open') {
    return { notified: false, reason: 'issue-not-open' };
  }
  if (await hasNotification(repository, issueNumber, token)) {
    return { notified: false, reason: 'already-notified' };
  }

  await githubRequest(`/repos/${repository}/issues/${issueNumber}/comments`, token, {
    method: 'POST',
    body: JSON.stringify({ body: buildNotification(state) }),
  });

  return { notified: true, reason: 'fix-available' };
}

async function main() {
  const notify = process.argv.includes('--notify');
  const token = process.env.GITHUB_TOKEN;
  const state = await getUpstreamState(token);
  const notification = notify
    ? await notifyIfReady(state, token)
    : { notified: false, reason: 'notification-disabled' };

  console.log(JSON.stringify({ ...state, notification }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
