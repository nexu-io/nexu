# QQ

App ID와 App Secret만 있으면 QQ 봇을 nexu에 연결할 수 있습니다.

## 1단계: nexu에서 QQ 채널 열기

1. nexu 클라이언트를 열고 채널 섹션에서 **QQ**를 클릭합니다.

![nexu에서 QQ 선택](/assets/qq/step3-choose-qq-channel.webp)

2. QQ Open Platform을 엽니다: https://q.qq.com/qqbot/openclaw/login.html

![nexu에서 QQ 플랫폼 열기](/assets/qq/step3-open-platform-link.webp)

## 2단계: QQ Open Platform에 로그인

1. 모바일 QQ로 로그인 QR 코드를 스캔합니다.

![QQ Open Platform 로그인 QR](/assets/qq/step1-login-qr.webp)

2. 모바일 QQ에서 "Agree"를 탭하여 로그인을 완료합니다.

![모바일 QQ에서 로그인 확인](/assets/qq/step1-login-confirm.webp)

## 3단계: QQ 봇 생성

1. 로그인 후, 봇 목록에서 "Create Bot"을 클릭합니다.

![QQ 봇 생성](/assets/qq/step1-create-bot.webp)

## 4단계: App ID와 App Secret 복사

![봇 상세 페이지](/assets/qq/step2-create-bot.webp)

봇 상세 페이지에서 다음 두 값을 복사하고 저장합니다:

- **App ID**
- **App Secret**

전체 App Secret은 한 번만 표시될 수 있으므로 즉시 저장하세요.

## 5단계: nexu에서 QQ 연결

nexu의 QQ 채널 대화상자에 App ID와 App Secret을 붙여넣고 "Connect QQ"를 클릭합니다.

![nexu에서 QQ 연결](/assets/qq/step3-nexu-connect.webp)

## 6단계: QQ에서 채팅 시작

연결되면 데스크톱 QQ 또는 모바일 QQ를 열고, 방금 생성한 봇 대화를 찾아 메시지를 보내 Agent와 채팅을 시작하세요.

![QQ에서 Agent와 채팅](/assets/qq/step4-chat.webp)

---

## FAQ

**Q: 자체 서버나 공개 콜백 URL이 필요한가요?**

아니요. nexu의 현재 QQ 통합에서는 클라이언트에 App ID와 App Secret만 입력하면 됩니다.

**Q: 연결 후 QQ 봇을 어디서 찾나요?**

데스크톱 QQ 또는 모바일 QQ를 열고 봇 생성 시 사용한 이름으로 검색하거나, 최근 대화에서 찾으세요.

**Q: 연결에 성공했는데 봇이 응답하지 않는 이유는?**

먼저 다음을 확인하세요:

- App ID와 App Secret이 올바르게 입력되었는지
- nexu 클라이언트가 여전히 실행 중인지
- 방금 생성한 봇에 메시지를 보내고 있는지

**Q: 컴퓨터를 끄면 봇이 계속 응답하나요?**

nexu 클라이언트가 실행 중이어야 합니다. nexu가 백그라운드에서 실행 중이고 컴퓨터가 잠들지 않는 한, 봇은 계속 응답할 수 있습니다.

**Q: 봇을 QQ 그룹에 추가할 수 있나요?**

네. 봇을 QQ 그룹에 추가하여 사용할 수 있습니다. 먼저 개인 채팅에서 봇을 테스트하는 것이 좋습니다.
