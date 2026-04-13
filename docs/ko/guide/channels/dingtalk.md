# DingTalk

Client ID와 Client Secret만 있으면 DingTalk 봇을 nexu에 연결할 수 있습니다.

## 1단계: nexu에서 DingTalk 채널 열기

1. nexu 클라이언트를 열고 채널 섹션에서 **DingTalk**을 클릭합니다.

![nexu에서 DingTalk 선택](/assets/dingtalk/step7-choose-dingtalk-channel.webp)

2. DingTalk 개발자 플랫폼을 엽니다: https://open.dingtalk.com/

![nexu에서 DingTalk 플랫폼 열기](/assets/dingtalk/step7-open-platform-link.webp)

## 2단계: DingTalk 개발자 플랫폼에 로그인

1. DingTalk 앱으로 로그인 QR 코드를 스캔합니다.

![DingTalk 개발자 플랫폼 로그인 QR](/assets/dingtalk/step1-login-qr.webp)

## 3단계: DingTalk 앱 생성

1. 로그인 후, 앱 개발 가이드 페이지에서 "Create App"을 클릭합니다.

![홈 페이지의 앱 생성 항목](/assets/dingtalk/step2-home-create-entry.webp)

2. 앱 개발 페이지에서 오른쪽 상단의 "Create App"을 클릭합니다.

![DingTalk 앱 생성 항목](/assets/dingtalk/step2-create-app.webp)

3. 앱 이름, 설명, 아이콘을 입력한 후 "Save"를 클릭합니다.

![앱 이름 및 설명 입력](/assets/dingtalk/step2-fill-app-info.webp)

## 4단계: 앱에 봇 기능 추가

1. 앱 상세 페이지를 열고, "Add App Capability"에서 Bot 카드의 "Add"를 클릭합니다.

![봇 기능 추가](/assets/dingtalk/step3-add-bot-capability.webp)

2. 왼쪽의 "Bot" 페이지를 열고 봇 설정을 활성화합니다.

![봇 설정 활성화](/assets/dingtalk/step3-enable-bot.webp)

3. 봇 이름, 프로필, 아바타, 언어 설정, 수신 모드를 완성한 후 하단의 "Publish"를 클릭합니다.

![봇 설정 입력 및 게시](/assets/dingtalk/step3-bot-config-form.webp)

## 5단계: 필요한 권한 부여

왼쪽의 "Permission Management"를 열고 nexu에 필요한 권한을 신청합니다.

더 원활한 AI 채팅 경험을 위해 다음 AI Card 권한을 활성화하는 것을 권장합니다:

- **Card.Instance.Write** - AI Card 쓰기 권한
- **Card.Streaming.Write** - AI Card 스트리밍 출력 권한

팁:

- AI Card를 활성화하면 ChatGPT처럼 응답이 점진적으로 표시됩니다
- 활성화하지 않아도 봇은 작동하지만, 응답이 일반 텍스트 메시지로 전송됩니다

아래 스크린샷은 `Card.Instance.Write` 활성화 페이지입니다.

![카드 관련 권한 부여](/assets/dingtalk/step4-permission-card-write.webp)

## 6단계: Client ID와 Client Secret 복사

자격 증명 페이지로 돌아가서 다음 두 값을 복사합니다:

- **Client ID**
- **Client Secret**

![Client ID와 Client Secret 복사](/assets/dingtalk/step5-copy-credentials.webp)

## 7단계: 버전 생성 및 게시

1. 왼쪽의 "Version Management & Release"를 열고, 빈 버전 목록에서 "Create New Version"을 클릭합니다.

![버전 관리 페이지 열기](/assets/dingtalk/step6-version-list.webp)

2. 버전 번호, 릴리스 노트, 가시 범위를 입력한 후 저장합니다.

![새 버전 생성](/assets/dingtalk/step6-create-version.webp)

3. DingTalk 게시 흐름을 완료하여 봇이 라이브로 전환되도록 합니다.

## 8단계: nexu에서 DingTalk 연결

1. nexu의 DingTalk 채널 대화상자에 Client ID와 Client Secret을 붙여넣고 "Connect DingTalk"를 클릭합니다.

![nexu에서 DingTalk 연결](/assets/dingtalk/step7-nexu-connect.webp)

2. 연결되면 DingTalk를 열고 봇과 채팅을 시작하세요.

![DingTalk에서 봇 채팅 작동](/assets/dingtalk/step8-chat-success.webp)

---

## FAQ

**Q: 앱만 생성하면 되지 않나요?**

DingTalk 봇은 보통 봇 기능 활성화, 권한 부여, 버전 게시가 추가로 필요합니다. 이 중 하나라도 누락되면 봇이 작동하지 않을 수 있습니다.

**Q: 공개 서버가 필요한가요?**

아니요. nexu의 현재 DingTalk 통합에서는 일반적으로 자체 공개 콜백 서비스를 호스팅할 필요가 없습니다.

**Q: 게시 후 팀원이 앱을 볼 수 없는 이유는?**

버전 게시 시 설정한 가시 범위를 확인하고, 올바른 사용자 또는 부서가 포함되었는지 확인하세요.

**Q: 봇이 응답하지 않는 이유는?**

먼저 Client ID와 Client Secret을 확인한 후, 봇 기능이 활성화되었는지, 권한이 부여되었는지, 버전이 게시되었는지, nexu 클라이언트가 여전히 실행 중인지 확인하세요.
