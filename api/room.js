/* 매칭 서버 — 오토 인스턴싱(docs/PLAN.md 6번 결정).
   Vercel 서버리스 함수(Node.js 런타임) 하나. PeerJS 브로커는 "누가 누구와
   연결할지"만 중개하고 "지금 어느 방에 몇 명 있는지"는 모르기 때문에, 그
   상태만 이 함수가 Upstash Redis(REST API)에 기록해서 추적한다.

   npm 의존성을 두지 않으려고(별도 build 단계를 만들지 않기 위해 — CLAUDE.md
   "정적 파일 + 빌드 없음" 예외 범위를 서버리스 함수 하나로만 한정) fetch만으로
   Upstash REST API를 직접 호출한다. package.json/npm install 없이 Vercel Node
   런타임의 전역 fetch만으로 동작한다.

   필요한 환경변수(Vercel 대시보드 → Storage → Upstash for Redis 연동을 추가하면
   프로젝트에 자동으로 주입됨):
     KV_REST_API_URL / KV_REST_API_TOKEN
     (연동 방식에 따라 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 일 수도
     있어서 둘 다 확인한다.)
   이 환경변수가 없으면(로컬 정적 서버, 또는 아직 Redis 연동 전인 배포) 이
   함수는 에러를 던지고, 클라이언트(index.html)는 이를 조용히 무시하고 기존
   수동 "상대 ID 붙여넣기" 방식으로 계속 동작한다 — 매칭 서버는 없어도 되는
   보강 기능이지, 없으면 아예 안 되는 필수 기능이 아니다고 봤다. */

const ROOM_CAPACITY = 12; // CLAUDE.md 동접 목표
const STALE_MS = 30_000;  // 이 시간 동안 하트비트 없으면 나간 걸로 간주
const MAX_ROOM_SCAN = 50; // 무한 스캔 방지(친구들끼리 쓰는 규모라 이 정도면 충분)

function redisUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
}
function redisToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
}

async function redis(cmd) {
  const url = redisUrl();
  const token = redisToken();
  if (!url || !token) {
    throw new Error('Redis 환경변수 없음 — Vercel 프로젝트에 Upstash Redis 연동 필요');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Redis 요청 실패: HTTP ${res.status}`);
  const body = await res.json();
  return body.result;
}

function membersKey(roomId) {
  return `hangout:room:${roomId}:members`;
}

/** HGETALL 결과([field1,val1,field2,val2,...])에서 살아있는 peerId만 뽑는다.
 *  오래된 항목은 실제로 지워서(HDEL) 다음 스캔 때 또 안 걸리게 청소도 겸한다. */
async function liveMembers(roomId) {
  const flat = await redis(['HGETALL', membersKey(roomId)]);
  if (!flat || flat.length === 0) return [];
  const now = Date.now();
  const live = [];
  const stale = [];
  for (let i = 0; i < flat.length; i += 2) {
    const peerId = flat[i];
    const ts = Number(flat[i + 1]);
    if (now - ts < STALE_MS) live.push(peerId);
    else stale.push(peerId);
  }
  if (stale.length) await redis(['HDEL', membersKey(roomId), ...stale]);
  return live;
}

/** 인원이 12명 미만인 방을 순서대로 찾고, 없으면 새 방을 만들어서 그 방에
 *  peerId를 등록한 뒤 방 번호를 돌려준다. */
async function findOrCreateRoom(peerId) {
  const roomCount = Number(await redis(['GET', 'hangout:roomCount'])) || 0;
  const scanLimit = Math.min(roomCount, MAX_ROOM_SCAN);
  for (let id = 1; id <= scanLimit; id++) {
    const members = await liveMembers(id);
    if (members.length < ROOM_CAPACITY) {
      await redis(['HSET', membersKey(id), peerId, String(Date.now())]);
      return id;
    }
  }
  const newId = await redis(['INCR', 'hangout:roomCount']);
  await redis(['HSET', membersKey(newId), peerId, String(Date.now())]);
  return newId;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원' });
    return;
  }
  const action = req.query.action;
  const { peerId, roomId } = req.body || {};
  if (!peerId) {
    res.status(400).json({ error: 'peerId 필요' });
    return;
  }

  try {
    if (action === 'join') {
      const assignedRoomId = await findOrCreateRoom(peerId);
      const members = await liveMembers(assignedRoomId);
      res.status(200).json({ roomId: assignedRoomId, peers: members.filter((id) => id !== peerId) });
      return;
    }
    if (action === 'heartbeat') {
      if (!roomId) { res.status(400).json({ error: 'roomId 필요' }); return; }
      await redis(['HSET', membersKey(roomId), peerId, String(Date.now())]);
      res.status(200).json({ ok: true });
      return;
    }
    if (action === 'leave') {
      if (!roomId) { res.status(400).json({ error: 'roomId 필요' }); return; }
      await redis(['HDEL', membersKey(roomId), peerId]);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: '알 수 없는 action — join/heartbeat/leave 중 하나' });
  } catch (err) {
    console.error('[api/room]', err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
};
