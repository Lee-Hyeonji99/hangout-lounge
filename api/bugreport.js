/* 버그 리포트 → Jira 자동 이슈 생성.
   api/room.js와 같은 패턴: npm 의존성 없이 fetch만으로 Jira REST API를
   직접 호출한다(별도 서버/DB 없음 — CLAUDE.md "정적 파일 + 빌드 없음"
   예외 범위를 넘지 않으려고, 여기서도 room.js가 이미 붙여둔 Upstash
   Redis를 재사용한다. 새 저장소 추가 없음).

   두 가지 진입점:
   - kind:'auto'   — index.html의 전역 window.onerror/unhandledrejection이
     잡은 클라이언트 JS 에러. 같은 메시지가 반복 들어와도 Jira에 중복
     티켓이 쌓이지 않게 Redis에 짧은 TTL로 dedup 키를 남긴다.
   - kind:'manual' — 사용자가 직접 적어서 보낸 리포트("버그 신고" 버튼).
     각각 다른 상황을 설명한 글이라 dedup 없이 항상 새 이슈로 만든다.
     (실제로 이 세션에서 제보된 버그들 — 참가자 조인 레이스, 벤치에서
     내려오면 방향키 반대 등 — 은 JS 에러가 아니라 로직/UX 버그라 자동
     감지로는 못 잡는다. 그래서 수동 신고가 핵심 경로.)

   필요한 환경변수(Vercel 프로젝트 설정에 수동으로 추가 — Jira API 토큰은
   Atlassian 계정 설정 → 보안 → API 토큰에서 발급):
     JIRA_BASE_URL     예) https://wbg2.atlassian.net
     JIRA_EMAIL        토큰을 발급한 Atlassian 계정 이메일
     JIRA_API_TOKEN
     JIRA_PROJECT_KEY  예) SCRUM (기본값)
   환경변수가 없으면 이 함수는 501을 돌려주고, 클라이언트는 이를 조용히
   무시한다 — room.js와 같은 "있으면 좋고 없어도 앱은 정상 동작" 방침. */

const DEDUP_TTL_SEC = 3600; // 자동 감지 에러: 같은 메시지는 1시간에 한 번만 이슈화

function redisUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
}
function redisToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
}

async function redis(cmd) {
  const url = redisUrl();
  const token = redisToken();
  if (!url || !token) return null; // Redis 연동 전이면 dedup 없이(=매번 이슈 생성) 진행
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.result;
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function createJiraIssue({ summary, description, labels }) {
  const base = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY || 'SCRUM';
  if (!base || !email || !token) {
    throw new Error('Jira 환경변수 없음 — JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN 확인');
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const res = await fetch(`${base.replace(/\/$/, '')}/rest/api/3/issue`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        issuetype: { name: 'Bug' },
        summary: summary.slice(0, 250),
        description: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: description.slice(0, 4000) }] }],
        },
        labels: labels || [],
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira 이슈 생성 실패: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원' });
    return;
  }
  const { kind, message, stack, url, userAgent, nickname } = req.body || {};
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message 필요' });
    return;
  }

  try {
    if (kind === 'auto') {
      const key = `hangout:bugreport:${simpleHash(message)}`;
      if (redisUrl() && redisToken()) {
        const existing = await redis(['GET', key]);
        if (existing) {
          res.status(200).json({ ok: true, skipped: true, reason: 'dedup' });
          return;
        }
        await redis(['SET', key, '1', 'EX', String(DEDUP_TTL_SEC)]);
      }
      const issue = await createJiraIssue({
        summary: `[자동감지] ${message}`,
        description: `자동 감지된 클라이언트 JS 에러.\n\nURL: ${url || ''}\nUA: ${userAgent || ''}\n\n${stack || message}`,
        labels: ['auto-detected', 'hangout-lounge'],
      });
      res.status(200).json({ ok: true, key: issue.key });
      return;
    }

    // kind === 'manual' (또는 그 외) — 사용자가 직접 쓴 리포트, dedup 없음
    const issue = await createJiraIssue({
      summary: `[사용자 제보] ${message.slice(0, 80)}`,
      description: `${message}\n\n---\n신고자 닉네임: ${nickname || '(익명)'}\nURL: ${url || ''}\nUA: ${userAgent || ''}`,
      labels: ['user-reported', 'hangout-lounge'],
    });
    res.status(200).json({ ok: true, key: issue.key });
  } catch (err) {
    console.error('[api/bugreport]', err);
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
