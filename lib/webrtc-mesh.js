/* WebRTC P2P 메시 — 시그널링은 PeerJS 무료 브로커(docs/PLAN.md 3-a).
   이 모듈은 순수 네트워킹만 담당한다 — 아바타/렌더링/애니메이션은 전혀
   모른다(누가 이 모듈을 갖다 써도 되게). window.Peer 는 lib/vendor/peerjs/
   peerjs.min.js 를 평범한 <script> 태그로 먼저 로드해서 전역으로 준비해둔다
   (UMD 빌드 — 모듈이 아니라서 import 가 아니라 <script> 로드 순서에 의존).

   연결이 맺어지기 전(peer.connect 상대가 아직 나를 모를 때)의 중개만
   PeerJS 브로커가 하고, 연결된 뒤로는 순수 P2P다 — 서버는 중간에 없다. */

export function createMesh({ onPeerJoin, onPeerLeave, onData, peerId, iceServers } = {}) {
  if (typeof window.Peer !== 'function') {
    throw new Error('window.Peer 가 없다 — peerjs.min.js를 <script>로 먼저 로드했는지 확인');
  }
  // iceServers를 넘기면(index.html이 api/turn.js에서 미리 받아온다) STUN
  // 기본값 대신 TURN 포함 목록을 쓴다 — 대칭형 NAT 등에서 STUN만으론 P2P
  // 직접 연결이 안 되는 조합을 위한 중계 경로(docs/PLAN.md 3-b). 안 넘기면
  // (환경변수 미설정 등) PeerJS 기본 설정 그대로 — 기존 동작과 동일.
  const peer = iceServers && iceServers.length
    ? new window.Peer(peerId, { config: { iceServers } })
    : new window.Peer(peerId);
  const conns = new Map(); // 상대 peerId -> DataConnection

  function wireConn(conn) {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      onPeerJoin && onPeerJoin(conn.peer);
    });
    conn.on('data', (data) => { onData && onData(conn.peer, data); });
    conn.on('close', () => {
      if (!conns.has(conn.peer)) return; // disconnect()가 이미 정리했으면 중복 호출 방지
      conns.delete(conn.peer);
      onPeerLeave && onPeerLeave(conn.peer);
    });
    conn.on('error', (err) => console.error('[webrtc-mesh] 연결 오류', conn.peer, err));
  }

  // 남이 나에게 걸어온 연결
  peer.on('connection', (conn) => wireConn(conn));
  peer.on('error', (err) => console.error('[webrtc-mesh] peer 오류', err));

  /** 내가 상대에게 먼저 연결한다(메시니까 양쪽 다 이걸 부를 수 있다 —
   *  이미 연결돼 있으면 조용히 무시). */
  function connectTo(remoteId) {
    if (!remoteId || remoteId === peer.id || conns.has(remoteId)) return;
    wireConn(peer.connect(remoteId));
  }

  /** 지금 연결된 전원에게 보낸다. 채널 하나로 상태/위치를 다 보내고,
   *  msg.type 으로 구분한다(docs/PLAN.md 4번 — 위치는 초당 ~10회,
   *  상태/채팅은 바뀔 때만). */
  function broadcast(msg) {
    conns.forEach((c) => { if (c.open) c.send(msg); });
  }

  function ready() {
    return new Promise((resolve) => {
      if (peer.id) resolve(peer.id);
      else peer.on('open', (id) => resolve(id));
    });
  }

  /** 특정 상대와의 연결을 강제로 끊는다. WebRTC 자체의 접속 끊김 감지가
   *  느리거나(탭을 그냥 닫아버린 경우 등) 아예 안 되는 사례가 있어서,
   *  상위 코드(index.html)가 "한동안 이 상대한테서 아무 데이터도 안 온다"를
   *  직접 판단해 정리할 수 있게 열어둔 창구 — 호출하면 close 이벤트를
   *  기다리지 않고 그 자리에서 바로 onPeerLeave가 불린다. */
  function disconnect(remoteId) {
    const conn = conns.get(remoteId);
    if (!conn) return;
    conns.delete(remoteId);
    conn.close();
    onPeerLeave && onPeerLeave(remoteId);
  }

  return {
    ready,
    connectTo,
    disconnect,
    broadcast,
    get peerId() { return peer.id; },
    get peers() { return [...conns.keys()]; },
  };
}
