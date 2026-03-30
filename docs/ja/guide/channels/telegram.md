# Telegram

Bot Token を取得するだけで、Telegram ボットを nexu に接続できます。

## ステップ 1：Telegram ボットを作成する

1. Telegram を開き、**BotFather** を検索して「Open」をクリックします。

![BotFather を検索して開く](/assets/telegram/step1-search-botfather.webp)

2. `/newbot` コマンドを送信します。

![/newbot を送信](/assets/telegram/step1-newbot.webp)

3. 指示に従って以下を入力します：
   - **ボット名**（表示名、例：`nexu_eli`）
   - **ボットユーザー名**（`bot` で終わる必要があります、例：`nexu_elibot`）

4. 作成が完了すると、BotFather から **Bot Token**（形式：`8549010317:AAEZw-DEou...`）が届きます。コピーして保存します。

![Bot Token を取得](/assets/telegram/step1-bot-token.webp)

## ステップ 2：nexu で Telegram を接続する

1. nexu クライアントを開き、「Choose a channel to get started」セクションで **Telegram** をクリックします。

![Telegram チャンネルを選択](/assets/telegram/step2-choose-telegram.webp)

2. 「Connect Telegram」ダイアログで Bot Token を入力欄に貼り付け、「連接 Telegram」をクリックします。

![Bot Token を入力して接続](/assets/telegram/step2-nexu-connect.webp)

## ステップ 3：チャットを開始する

接続が完了したら、Telegram でボットのユーザー名を検索し、`/start` を送信して OpenClaw Agent とのチャットを始めましょう 🎉

![Telegram でボットとチャット](/assets/telegram/step3-chat.webp)

---

## よくある質問

**Q: 公開サーバーは必要ですか？**

不要です。nexu は Telegram Bot API のロングポーリング方式を使用しているため、公開 IP や Webhook URL は不要です。

**Q: ボットがメッセージに返信しません。**

Bot Token が正しく入力されているか、nexu クライアントが起動しているかを確認してください。

**Q: グループチャットでも使えますか？**

はい。ボットを Telegram グループに追加し、メッセージでボットのユーザー名をメンションすると返信が届きます。

**Q: パソコンの電源が切れていても Agent は返信できますか？**

nexu クライアントが起動している必要があります。nexu がバックグラウンドで動作している限り（パソコンがスリープしていない場合）、Agent は 24 時間 365 日 Telegram メッセージに返信できます。
