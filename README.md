# Ulanzi ChatGPT Alert

Windows용 Ulanzi D200X 플러그인입니다. Ulanzi Studio 3.4.8 이상과 현재 ChatGPT 데스크톱 앱을 대상으로 만들었습니다.

- **ChatGPT 알림:** 완료·입력 요청·승인 요청 알림을 감지해 깜빡임 또는 확 켜진 뒤 서서히 꺼지는 효과를 반복합니다. 버튼을 누르거나 ChatGPT 앱으로 돌아오면 멈춥니다. 버튼 설정에서 효과를 선택할 수 있습니다.
- **ChatGPT 사용량:** 현재 로그인한 계정의 Codex 사용률과 초기화까지 남은 시간을 표시합니다. 1분마다 갱신하며 버튼을 누르면 새로고침합니다. 계정이 제공하는 한도가 하나면 큰 게이지, 두 개면 두 게이지로 표시합니다.

사용량은 앱에 포함된 Codex app-server의 읽기 전용 `account/rateLimits/read`로 조회합니다. `codex` 계정 한도를 표시합니다. 일반 ChatGPT 대화의 모델별 메시지 한도나 API 요금은 포함하지 않습니다. 해당 한도를 읽지 못하면 ‘확인 불가’를 표시합니다. 질문 전송, 크레딧 구매, 사용 한도 초기화는 수행하지 않습니다. 인증 정보는 이 저장소에 포함하지 않습니다.

## 설치

1. Ulanzi Studio를 종료합니다.
2. `com.ulanzi.chatgptalert.ulanziPlugin` 폴더를 `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`에 복사합니다.
3. Ulanzi Studio를 다시 열고 원하는 버튼에 ‘ChatGPT 알림’과 ‘ChatGPT 사용량’을 배치합니다.

별도 npm 패키지는 필요하지 않습니다. Ulanzi Studio에 포함된 Node.js와 Windows PowerShell을 사용합니다. ChatGPT 앱의 알림 로그 형식이나 app-server 프로토콜이 바뀌면 수정이 필요할 수 있습니다.

## 검증

Node.js 20.12.2 이상에서 `npm test`를 실행합니다. 알림 감지·해제, 효과 저장, 실제 WebSocket 통신, 사용량 읽기와 오류 처리, Windows 게이지 이미지 생성을 검사합니다.

사용량 조회 프로토콜: [공식 Codex App Server 문서](https://learn.chatgpt.com/docs/app-server)
