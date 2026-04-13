# Discord

Application ID와 Bot Token만 있으면 Discord 봇을 nexu에 연결할 수 있습니다.

## 1단계: Discord 애플리케이션 생성

1. [Discord Developer Portal](https://discord.com/developers/applications)에 접속하고 "New Application"을 클릭합니다.

![Discord Applications 페이지](/assets/discord/step1-applications.webp)

2. 애플리케이션 이름을 입력하고 "Create"를 클릭합니다.

![애플리케이션 생성](/assets/discord/step1-create-app.webp)

3. "General Information" 페이지에서 다음을 복사하고 저장합니다:
   - **Application ID**

![Application ID 가져오기](/assets/discord/step1-general-info.webp)

4. 왼쪽 메뉴에서 "Bot"으로 이동하고, "Reset Token"을 클릭하여 Bot Token을 생성한 후 복사합니다:
   - **Bot Token**

![Bot Token 생성](/assets/discord/step3-bot-token.webp)

## 2단계: nexu에 자격 증명 추가

nexu 클라이언트를 열고, Discord 채널 설정에서 App ID와 Bot Token을 입력한 후 "Connect"를 클릭합니다.

![nexu에서 자격 증명 추가](/assets/discord/step2-nexu-connect.webp)

## 3단계: 권한 설정 및 봇 초대

1. Discord Developer Portal에서 "Bot" 페이지로 돌아가 다음 Privileged Gateway Intent를 활성화합니다:
   - **Message Content Intent**

![Message Content Intent 활성화](/assets/discord/step4-intents.webp)

2. 왼쪽 메뉴에서 "OAuth2"로 이동합니다. Scopes에서 `bot`을 선택합니다. Bot Permissions에서 `Administrator`를 선택합니다.

![Scopes & Bot Permissions 선택](/assets/discord/step5-scopes.webp)

3. 페이지 하단에 생성된 URL을 복사하여 브라우저에서 엽니다.

![생성된 URL 복사](/assets/discord/step5-generated-url.webp)

4. 서버를 선택하고 "Continue"를 클릭합니다.

![서버 선택](/assets/discord/step3-select-server.webp)

5. 권한을 확인하고 "Authorize"를 클릭하여 봇을 추가합니다.

![봇 인증](/assets/discord/step3-authorize.webp)

## 4단계: 테스트

연결되면 nexu 클라이언트에서 "Chat"을 클릭하여 Discord로 이동하고 봇과 채팅하세요 🎉

![Discord 연결됨](/assets/discord/step4-connected.webp)

## FAQ

**Q: 공개 서버가 필요한가요?**

아니요. nexu는 Discord Gateway(WebSocket)를 사용합니다 — 공개 IP나 콜백 URL 불필요.

**Q: 봇이 메시지에 응답하지 않나요?**

Message Content Intent를 활성화했는지 확인하세요. 활성화하지 않으면 봇이 메시지 내용을 읽을 수 없습니다.
