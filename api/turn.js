/* Metered.ca 무료 TURN 자격증명 발급 프록시(docs/PLAN.md 3-b).
   왜 필요한가: 지금까지는 STUN만 썼는데(Google 공개 STUN), 대칭형 NAT나
   일부 셀룰러/사내망 조합에서는 STUN만으론 두 피어가 서로에게 도달할
   경로를 못 찾아서 P2P 직접 연결 자체가 실패한다(실사용 중 실제로
   재현됨 — 한쪽은 되고 한쪽은 안 되는 문제). TURN은 직접 연결이 안 될 때
   중간에서 트래픽을 대신 중계해주는 서버라 이 경우 대부분 뚫린다.

   Metered.ca API 키를 클라이언트에 그대로 노출하면 남이 갖다 써서 무료
   할당량을 다 써버릴 수 있으니, room.js/bugreport.js와 같은 패턴으로
   서버리스 함수 하나가 중개한다(npm 의존성 없음, fetch만 사용).

   필요한 환경변수(Vercel 프로젝트 설정에 수동으로 추가 — metered.ca 무료
   가입 후 대시보드의 "TURN Server Credentials"에서 확인):
     METERED_DOMAIN    예) xxx.metered.live ("https://"를 붙여 넣어도
                        아래에서 알아서 떼어내니 상관없음 — Metered 문서의
                        예제 코드엔 fetch() URL 전체가 나와서 프로토콜까지
                        같이 복사해 넣기 쉬움)
     METERED_API_KEY
   둘 다 없으면 이 함수는 501을 돌려주고, 클라이언트는 이를 조용히
   무시한 채 기존처럼 STUN만으로 계속 진행한다(room.js/bugreport.js와
   같은 방침 — 있으면 좋고 없어도 앱은 정상 동작). */

module.exports = async function handler(req, res) {
  // "https://xxx.metered.live"처럼 프로토콜/슬래시까지 통째로 넣는 경우가
  // 흔해서(Metered 문서의 예제가 fetch() URL 전체를 보여줌) 방어적으로
  // 제거한다 — 안 그러면 아래에서 "https://https://..."가 돼서 fetch 자체가
  // 깨진다(실제로 겪은 문제).
  const domain = (process.env.METERED_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const apiKey = (process.env.METERED_API_KEY || '').trim();
  if (!domain || !apiKey) {
    res.status(501).json({ error: 'TURN 환경변수 없음 — METERED_DOMAIN/METERED_API_KEY 확인' });
    return;
  }

  try {
    const r = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`);
    if (!r.ok) throw new Error(`Metered 요청 실패: HTTP ${r.status} ${await r.text().catch(()=> '')}`);
    const iceServers = await r.json(); // Metered가 WebRTC iceServers 형식 그대로 돌려줌
    res.status(200).json({ iceServers });
  } catch (err) {
    console.error('[api/turn]', err);
    // fetch 실패(TypeError: fetch failed)는 진짜 이유가 err.cause에 있는
    // 경우가 많아서(DNS 실패 등) 같이 실어 보낸다 — 디버깅용.
    const detail = err && err.cause ? String(err.cause.message || err.cause) : null;
    res.status(500).json({ error: String((err && err.message) || err), detail, domainUsed: domain });
  }
};
