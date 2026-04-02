# Discord

Application ID と Bot Token を取得すれば、Discord ボットを nexu に接続できます。

## ステップ 1: Discord アプリを作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) を開き、**New Application** をクリックします。

![Discord Applications ページ](/assets/discord/step1-applications.webp)

2. アプリ名を入力して **Create** をクリックします。

![アプリを作成](/assets/discord/step1-create-app.webp)

3. **General Information** ページで次の値を控えます。

   - **Application ID**

![Application ID を取得](/assets/discord/step1-general-info.webp)

4. 左側メニューの **Bot** を開き、**Reset Token** を押して Bot Token を生成し、控えておきます。

   - **Bot Token**

![Bot Token を生成](/assets/discord/step3-bot-token.webp)

## ステップ 2: nexu に認証情報を入力する

nexu クライアントを開き、Discord チャンネル設定に App ID と Bot Token を入力して **Connect** をクリックします。

![nexu に認証情報を入力](/assets/discord/step2-nexu-connect.webp)

## ステップ 3: 権限を設定してボットを招待する

1. Discord Developer Portal に戻り、**Bot** ページの下部で次の Privileged Gateway Intent を有効にします。

   - **Message Content Intent**

![Message Content Intent を有効化](/assets/discord/step4-intents.webp)

2. 左側メニューの **OAuth2** を開き、Scopes で `bot` を選び、下の Bot Permissions で `Administrator` を選択します。

![Scopes と Bot Permissions を選択](/assets/discord/step5-scopes.webp)

3. ページ下部で生成された URL をコピーし、ブラウザで開きます。

![生成された URL をコピー](/assets/discord/step5-generated-url.webp)

4. サーバーを選択して **Continue** をクリックします。

![サーバーを選択](/assets/discord/step3-select-server.webp)

5. 権限一覧を確認し、**Authorize** をクリックしてボットを招待します。

![ボットを認可](/assets/discord/step3-authorize.webp)

## ステップ 4: テストする

接続に成功したら、nexu クライアントで **Chat** をクリックして Discord でボットと会話できます。

![Discord 接続完了](/assets/discord/step4-connected.webp)

## よくある質問

**Q: 公開サーバーは必要ですか？**

不要です。nexu は Discord Gateway（WebSocket）を使うため、公開 IP やコールバック URL は必要ありません。

**Q: ボットがメッセージに返信しません。**

**Message Content Intent** が有効になっているか確認してください。これが無効だと、ボットはメッセージ本文を読めません。
