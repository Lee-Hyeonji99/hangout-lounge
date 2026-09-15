# hangout-lounge

앉아서 채팅치고, 먹고, 담배 피고 하는 캐주얼 3D 소셜 라운지. 빌드 도구 없이
브라우저에서 바로 여는 정적 페이지 + WebRTC 기반 소규모(최대 12명) 멀티플레이어.

`Lee-Hyeonji99/web-games` 아케이드 저장소와는 별도 저장소다 — 이유와 구조는
`docs/PLAN.md` 참고. 아트 스타일 규칙은 `docs/ART_STYLE.md`에서 web-games의
관련 규칙을 이식해 시작한다(이후 이 프로젝트 사정에 맞게 독립적으로 발전시킨다).

## 실행

빌드 없음. 정적 서버로 열면 된다(모듈 import + fetch 때문에 `file://`는 안 됨):

```bash
python3 -m http.server 8000
# http://localhost:8000/index.html
```

## 배포(Vercel)

정적 파일이라 저장소 연결 → 그대로 배포하면 대부분 동작한다. 단, **방 자동
배정(매칭 서버, `api/room.js`)이 동작하려면 Vercel 프로젝트에 Upstash Redis
연동을 추가**해야 한다(대시보드 → Storage → Upstash for Redis 연결 → 자동으로
`KV_REST_API_URL`/`KV_REST_API_TOKEN` 환경변수 주입). 연동을 안 해도 사이트
자체는 그대로 열리고, 방 자동 배정만 꺼진 채로 수동 "상대 ID 붙여넣기"로
동작한다(`index.html` 우측 패널).

**버그 리포트를 Jira 이슈로 자동 생성**(`api/bugreport.js`)하려면 Vercel
프로젝트에 아래 환경변수를 추가해야 한다(Jira API 토큰은 Atlassian 계정
설정 → 보안 → API 토큰에서 발급):

```
JIRA_BASE_URL=https://wbg2.atlassian.net
JIRA_EMAIL=<토큰을 발급한 계정 이메일>
JIRA_API_TOKEN=<발급한 토큰>
JIRA_PROJECT_KEY=SCRUM   # 생략 시 기본값 SCRUM
```

이 환경변수도 안 넣으면(매칭 서버와 같은 방침) 버그 신고 기능만 조용히
꺼진 채로 사이트는 정상 동작한다.

**일부 네트워크(대칭형 NAT 등)에서 P2P 연결이 아예 안 되는 문제를
줄이려면**(`api/turn.js`) [metered.ca](https://www.metered.ca) 무료 가입
후 아래 환경변수를 추가한다(대시보드의 "TURN Server Credentials"에서
확인):

```
METERED_DOMAIN=xxx.metered.live
METERED_API_KEY=<발급받은 키>
```

안 넣으면 기존처럼 STUN만 쓰고(일부 네트워크 조합에서 연결 실패 가능),
넣으면 STUN으로 직접 연결이 안 될 때 TURN 중계로 자동 대체된다.

## 진행 상태

`docs/PLAN.md`의 "8. 구현 순서" 참고 — 현재 3단계(WebRTC 메시 연결)까지 코드
있음 + 오토 인스턴싱(매칭 서버) 추가됨.
