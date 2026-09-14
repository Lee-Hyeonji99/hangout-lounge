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

## 진행 상태

지금은 1단계(로컬 프로토타입) — 네트워킹 없이 아바타 하나 + 카메라만 있다.
다음 단계는 `docs/PLAN.md`의 "8. 구현 순서" 참고.
