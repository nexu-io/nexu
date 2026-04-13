# WhatsApp

QR 코드 한 번 스캔으로 개인 WhatsApp을 nexu에 연결할 수 있습니다 — 2분 이내에 완료됩니다.

## 1단계: WhatsApp 채널 선택

nexu 클라이언트를 열고 "Choose a channel to get started" 섹션에서 **WhatsApp**을 클릭합니다.

![WhatsApp 채널 선택](/assets/whatsapp/step1-choose-whatsapp.webp)

## 2단계: QR 코드 스캔

1. "Connect WhatsApp" 대화상자에서 **Scan WhatsApp QR** 버튼을 클릭합니다.

![Scan WhatsApp QR 클릭](/assets/whatsapp/step2-scan-qr-button.webp)

2. nexu가 QR 코드를 생성하고 "Waiting for WhatsApp scan"이 표시됩니다.

![스캔 대기 중](/assets/whatsapp/step2-waiting-scan.webp)

3. 스마트폰에서 **WhatsApp**을 열고 하단의 "You" 탭을 탭한 후 오른쪽 상단의 QR 코드 아이콘을 탭합니다.

![스마트폰에서 QR 코드 아이콘 탭](/assets/whatsapp/step3-phone-settings.webp)

4. QR 코드 페이지에서 하단의 **Scan** 버튼을 탭합니다.

![스캔 버튼 탭](/assets/whatsapp/step3-phone-scan-button.webp)

5. 스마트폰을 컴퓨터 화면의 QR 코드에 향합니다. 스캔이 완료되면 **OK**를 탭하여 연결을 확인합니다.

![연결 확인](/assets/whatsapp/step3-phone-confirm.webp)

## 3단계: 채팅 시작

QR 코드가 스캔되면 WhatsApp 채널이 연결된 것으로 표시됩니다. **Chat**을 클릭하여 Agent와 대화를 시작하세요 🎉

---

## FAQ

**Q: QR 코드가 계속 로딩 중이고 나타나지 않으면 어떻게 하나요?**

WhatsApp은 QR 코드를 생성하기 위해 서버와의 안정적인 연결이 필요합니다. 프록시 도구(Clash, Surge 등)를 사용 중이라면 아웃바운드 모드를 **Global**로 전환한 후 "Scan WhatsApp QR"을 다시 클릭하세요.

Clash의 경우: 메뉴 바 아이콘 클릭 → Outbound Mode → **Global**.

![Clash를 Global 모드로 전환](/assets/whatsapp/clash-global-mode.webp)

---

**Q: 공개 서버가 필요한가요?**

아니요. nexu는 WhatsApp Web 프로토콜을 통해 직접 연결합니다 — 공개 IP나 콜백 URL 불필요.

**Q: WhatsApp Business 계정이 필요한가요?**

아니요. 개인 WhatsApp 계정으로 충분합니다.

**Q: 일반 WhatsApp 사용에 영향이 있나요?**

아니요. nexu는 연결된 기기로 연결되며, 컴퓨터에서 WhatsApp Web을 사용하는 것과 동일합니다. 스마트폰은 정상적으로 사용할 수 있습니다.

**Q: 컴퓨터가 꺼져 있어도 Agent가 응답할 수 있나요?**

nexu가 실행 중이어야 합니다. nexu 클라이언트가 백그라운드에서 활성화되어 있고 컴퓨터가 잠들지 않는 한, Agent는 24시간 WhatsApp 메시지에 응답할 수 있습니다.
