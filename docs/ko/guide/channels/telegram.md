# Telegram

Bot Token만 있으면 Telegram 봇을 nexu에 연결할 수 있습니다.

## 1단계: Telegram 봇 생성

1. Telegram을 열고 **BotFather**를 검색한 후 "Open"을 클릭합니다.

![BotFather 검색 및 열기](/assets/telegram/step1-search-botfather.webp)

2. `/newbot` 명령어를 전송합니다.

![/newbot 전송](/assets/telegram/step1-newbot.webp)

3. 안내에 따라 입력합니다:
   - **Bot name** (표시 이름, 예: `nexu_eli`)
   - **Bot username** (`bot`으로 끝나야 함, 예: `nexu_elibot`)

4. 생성이 완료되면 BotFather가 **Bot Token** (형식: `8549010317:AAEZw-DEou...`)이 포함된 메시지를 보냅니다. 복사하고 저장하세요.

![Bot Token 가져오기](/assets/telegram/step1-bot-token.webp)

## 2단계: nexu에서 Telegram 연결

1. nexu 클라이언트를 열고 "Choose a channel to get started" 섹션에서 **Telegram**을 클릭합니다.

![Telegram 채널 선택](/assets/telegram/step2-choose-telegram.webp)

2. "Connect Telegram" 대화상자에서 Bot Token을 입력란에 붙여넣고 "Connect Telegram"을 클릭합니다.

![Bot Token 입력 및 연결](/assets/telegram/step2-nexu-connect.webp)

## 3단계: 채팅 시작

연결되면 Telegram에서 봇의 사용자 이름을 검색하고 `/start`를 보내 OpenClaw Agent와 채팅을 시작하세요 🎉

![Telegram에서 봇과 채팅](/assets/telegram/step3-chat.webp)

---

## FAQ

**Q: 공개 서버가 필요한가요?**

아니요. nexu는 Telegram Bot API의 Long Polling 모드를 사용합니다 — 공개 IP나 Webhook URL 불필요.

**Q: 봇이 메시지에 응답하지 않나요?**

Bot Token이 올바르게 입력되었는지, nexu 클라이언트가 실행 중인지 확인하세요.

**Q: 그룹 채팅에서 봇을 사용할 수 있나요?**

네. 봇을 Telegram 그룹에 추가하고 메시지에서 봇의 사용자 이름을 멘션하면 응답을 받을 수 있습니다.

**Q: 컴퓨터가 꺼져 있어도 Agent가 응답할 수 있나요?**

nexu 클라이언트가 실행 중이어야 합니다. nexu가 백그라운드에서 실행 중이고 컴퓨터가 잠들지 않는 한, Agent는 24시간 Telegram 메시지에 응답할 수 있습니다.
