# WeChat

nexu 클라이언트를 사용하면 **한 번의 스캔**으로 개인 WeChat을 OpenClaw 🦞 ClawBot에 연결할 수 있습니다 — 전체 과정은 5분 이내입니다.

## 사전 요구사항

- **WeChat** ≥ 8.0.7 (ClawBot 플러그인을 지원하는 최소 버전)
- **macOS** 12+ (Apple Silicon)

## 1단계: WeChat을 8.0.7로 업데이트

WeChat을 열고 버전 8.0.7 이상으로 업데이트하세요. ClawBot 플러그인을 지원하는 최소 버전입니다.

## 2단계: nexu 다운로드 및 설치

1. [nexu 웹사이트](https://nexu.io)에서 "Download for Mac"을 클릭합니다.

![nexu 다운로드 페이지](/assets/wechat/step1-download.webp)

2. 다운로드한 `.dmg` 파일을 열고 **Nexu** 아이콘을 **Applications** 폴더로 드래그합니다.

![nexu 설치](/assets/wechat/step1-install.webp)

## 3단계: nexu 시작 및 로그인

1. Applications에서 nexu를 엽니다.
2. 환영 화면에서 로그인 방법을 선택합니다:
   - **Nexu 계정 사용** (권장) — nexu 계정으로 로그인하면 Claude, GPT, Gemini 등 최상위 모델을 무료로 사용할 수 있습니다.
   - **자체 모델 사용 (BYOK)** — 자체 API 키를 입력하면 가입 불필요.

![로그인 방법 선택](/assets/wechat/step2-login.webp)

## 4단계: WeChat 채널 선택

로그인 후 nexu 홈 화면에서 "Choose a channel to get started" 섹션의 **WeChat**을 클릭합니다.

![WeChat 채널 선택](/assets/wechat/step3-choose-wechat.webp)

## 5단계: 스캔하여 WeChat 연결

1. "Connect WeChat" 대화상자가 나타나면 녹색 "Scan to Connect" 버튼을 클릭합니다.

![Scan to Connect 클릭](/assets/wechat/step4-connect-dialog.webp)

2. nexu가 자동으로 WeChat ClawBot 플러그인을 설치하고 QR 코드를 생성합니다. 화면에 "Waiting for scan…"이 표시됩니다.

![스캔 대기 중](/assets/wechat/step4-scan-qrcode.webp)

3. 스마트폰에서 **WeChat**을 열고, "Scan"을 사용하여 화면의 QR 코드를 스캔한 후, 스마트폰에서 **Confirm**을 탭합니다.

## 6단계: 연결 완료

스캔을 확인하면 nexu 홈 화면의 WeChat 채널에 **Connected** 상태가 표시됩니다.

![WeChat 연결됨](/assets/wechat/step5-connected.webp)

## 7단계: WeChat에서 채팅

WeChat을 열면 **WeChat ClawBot**이라는 대화가 보입니다. 메시지를 보내면 OpenClaw Agent와 채팅을 시작할 수 있습니다 — 스마트폰에서 언제든 가능하며, 데스크톱이 필요 없습니다.

![WeChat에서 ClawBot과 채팅](/assets/wechat/step6-chat.webp)

---

## FAQ

**Q: 공개 서버가 필요한가요?**

아니요. nexu는 WeChat ClawBot 플러그인을 통해 직접 연결합니다 — 공개 IP나 콜백 URL 불필요.

**Q: WeChat Work나 공식 계정이 필요한가요?**

아니요. WeChat 8.0.7은 기본적으로 ClawBot 플러그인을 지원합니다. 개인 WeChat 계정만 있으면 됩니다.

**Q: 계정이 차단될 수 있나요?**

아니요. ClawBot은 WeChat 공식 플러그인이며 완전히 규정을 준수합니다.

**Q: 스마트폰과 컴퓨터가 모두 꺼져 있어도 Agent가 응답할 수 있나요?**

nexu 클라이언트가 실행 중이어야 합니다. nexu가 백그라운드에서 실행 중이고 컴퓨터가 잠들지 않는 한, Agent는 24시간 WeChat 메시지에 응답할 수 있습니다.

**Q: 여러 채널을 동시에 연결할 수 있나요?**

네. nexu는 WeChat, Feishu, Slack, Discord 등을 동시에 연결할 수 있습니다.

**Q: AI 모델을 전환하려면 어떻게 하나요?**

nexu 홈 화면 상단의 모델 선택기를 사용하여 Claude, GPT, Gemini 등 모델을 원클릭으로 전환할 수 있습니다.
