# Discord

Discord ボットを nexu に接続するには、**Application ID** と **Bot Token** が必要です。

## ステップ 1：Discord アプリケーションを作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセスし、「New Application」をクリックします。
![Discord Applications page](/assets/discord/step1-applications.webp)

2. アプリケーション名を入力し、「Create」をクリックします。
![Create application](/assets/discord/step1-create-app.webp)

3. 「General Information」ページで **Application ID** をコピーして保存します。
![Get Application ID](/assets/discord/step1-general-info.webp)

4. 左メニューから「Bot」を開き、「Reset Token」で Bot Token を生成し、**Bot Token** をコピーします。
![Generate Bot Token](/assets/discord/step3-bot-token.webp)

## ステップ 2：nexu に認証情報を追加

nexu クライアントを開き、Discord チャンネル設定に App ID と Bot Token を入力し、「接続」をクリックします。
![Add credentials in nexu](/assets/discord/step2-nexu-connect.webp)

## ステップ 3：権限を設定しボットを招待

1. Discord Developer Portal に戻り、「Bot」ページで次の特権ゲートウェイインテントを有効にします：**Message Content Intent**
![Enable Message Content Intent](/assets/discord/step4-intents.webp)

2. 左メニューから「OAuth2」→「URL Generator」に移動し、スコープで `bot` と `applications.commands` を選択します。
![Select Scopes](/assets/discord/step5-scopes.webp)

3. Bot Permissions で次を選択します：チャンネルの表示、メッセージの送信、メッセージ履歴の読み取り、リンクの埋め込み、ファイルの添付、リアクションの追加、外部絵文字の使用、外部ステッカーの使用
![Select Bot Permissions](/assets/discord/step5-permissions.webp)

4. ページ下部に表示された URL をコピーし、ブラウザで開きます。
![Copy generated URL](/assets/discord/step5-generated-url.webp)

5. サーバーを選び、「続行」をクリックします。
![Select server](/assets/discord/step3-select-server.webp)

6. 権限を確認し、「認証」をクリックしてボットを追加します。
![Authorize bot](/assets/discord/step3-authorize.webp)

## ステップ 4：テスト

接続後、nexu クライアントで「チャット」をクリックし、Discord に移動してボットと会話を始めます 🎉
![Discord connected](/assets/discord/step4-connected.webp)

## FAQ

**Q: パブリックサーバーは必要ですか？**

いいえ。nexu は Discord Gateway（WebSocket）を使用するため、パブリック IP やコールバック URL は不要です。

**Q: ボットがメッセージに返信しません？**

Message Content Intent が有効になっていることを確認してください。有効でないとボットはメッセージ内容を読み取れません。
