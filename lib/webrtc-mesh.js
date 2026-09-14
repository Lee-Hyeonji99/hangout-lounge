/* WebRTC P2P 메시 — 시그널링은 PeerJS 무료 브로커(docs/PLAN.md 3-a).
   이 모듈은 순수 네트워킹만 담당한다 — 아바타/렌더링/애니메이션은 전혀
   모른다(누가 이 모듈을 갖다 써도 되게). window.Peer 는 lib/vendor/peerjs/
   peerjs.min.js 를 평범한 <script> 태그로 먼저 로드해서 전역으로 준비해둔다
   (UMD 빌드 — 모듈이 아니라서 import 가 아니라 <script> 로드 순서에 의존).

   연결이 맺어지기 전(peer.connect 상대가 아직 나를 모를 때)의 중개만
   PeerJS 브로커가 하고, 연결된 뒤로는 순수 P2P다 — 서버는 중간에 없다. */

export function createMesh({ onPeerJoin, onPeerLeave, onData, peerId } = {}) {
  if (typeof window.Peer !== 'function') {
    throw new Error('window.Peer 가 없다 — peerjs.min.js를 <script>로 먼저 로드했는지 확인');
  }
  const peer = new window.Peer(peerId);
  const conns = new Map(); // 상대 peerId -> DataConnection

  function wireConn(conn) {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      onPeerJoin && onPeerJoin(conn.peer);
    });
    conn.on('data', (data) => { onData && onData(conn.peer, data); });
    conn.on('close', () => {
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

  return {
    ready,
    connectTo,
    broadcast,
    get peerId() { return peer.id; },
    get peers() { return [...conns.keys()]; },
  };
}
