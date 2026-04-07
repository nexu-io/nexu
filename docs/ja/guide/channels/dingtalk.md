# DingTalk

DingTalk ボットを nexu に接続するには、**Client ID** と **Client Secret** だけで足ります。

## ステップ 1：nexu で DingTalk チャンネルを開く

1. nexu クライアントを開き、Channels セクションで **DingTalk** をクリックします。

![Choose DingTalk in nexu](/assets/dingtalk/step7-choose-dingtalk-channel.webp)

2. DingTalk 開発者プラットフォームを開きます：https://open.dingtalk.com/

![Open the DingTalk platform from nexu](/assets/dingtalk/step7-open-platform-link.webp)

## ステップ 2：DingTalk 開発者プラットフォームにログイン

1. DingTalk アプリでログイン QR コードをスキャンします。

![DingTalk developer platform login QR](/assets/dingtalk/step1-login-qr.webp)

## ステップ 3：DingTalk アプリを作成

1. ログイン後、開発ガイド画面で「Create App」をクリックします。

![Create app entry on the home page](/assets/dingtalk/step2-home-create-entry.webp)

2. アプリ開発ページ右上の「Create App」をクリックします。

![Create DingTalk app entry](/assets/dingtalk/step2-create-app.webp)

3. アプリ名・説明・アイコンを入力して「Save」をクリックします。

![Fill in app name and description](/assets/dingtalk/step2-fill-app-info.webp)

## ステップ 4：アプリにボット機能を追加

1. アプリ詳細ページで「Add App Capability」を開き、Bot カードの「Add」をクリックします。

![Add bot capability](/assets/dingtalk/step3-add-bot-capability.webp)

2. 左側の「Bot」ページを開き、ボット設定を有効にします。

![Enable bot configuration](/assets/dingtalk/step3-enable-bot.webp)

3. ボット名、プロフィール、アイコン、言語設定、受信モードを入力し、下部の「Publish」をクリックします。

![Fill in the bot configuration and publish](/assets/dingtalk/step3-bot-config-form.webp)

## ステップ 5：必要な権限を付与

左側の「Permission Management」を開き、nexu に必要な権限を申請します。

より滑らかな AI 会話体験のため、次の AI Card 権限を有効にすることをおすすめします。

- **Card.Instance.Write** - AI Card 書き込み権限
- **Card.Streaming.Write** - AI Card ストリーミング出力権限

補足:

- AI Card を有効にすると、返信が ChatGPT のように順次表示されます
- 有効にしなくても通常のテキストメッセージとして会話は可能です

下のスクリーンショットは `Card.Instance.Write` を有効にする画面です。

![Grant card-related permissions](/assets/dingtalk/step4-permission-card-write.webp)

## ステップ 6：Client ID と Client Secret をコピー

認証情報ページに戻り、次の 2 つをコピーします。

- **Client ID**
- **Client Secret**

![Copy Client ID and Client Secret](/assets/dingtalk/step5-copy-credentials.webp)

## ステップ 7：バージョンを作成して公開

1. 左側の「Version Management & Release」を開き、空のバージョン一覧で「Create New Version」をクリックします。

![Open the version management page](/assets/dingtalk/step6-version-list.webp)

2. バージョン番号、リリースノート、表示範囲を入力して保存します。

![Create a new version](/assets/dingtalk/step6-create-version.webp)

3. DingTalk の公開フローを完了し、ボットを有効化します。

## ステップ 8：nexu で DingTalk を接続

1. nexu の DingTalk チャンネルダイアログに Client ID と Client Secret を貼り付け、「Connect DingTalk」をクリックします。

![Connect DingTalk in nexu](/assets/dingtalk/step7-nexu-connect.webp)

2. 接続が完了したら、DingTalk を開いてボットとの会話を始めます。

![Bot chat working in DingTalk](/assets/dingtalk/step8-chat-success.webp)

---

## FAQ

**Q: アプリを作成しただけでは足りないのはなぜですか？**

DingTalk ボットは通常、ボット機能の追加、権限付与、バージョン公開まで必要です。どれか 1 つでも欠けると正常に動かないことがあります。

**Q: 公開サーバーは必要ですか？**

いいえ。現在の nexu の DingTalk 連携では、通常は自分で公開 Callback サービスを用意する必要はありません。

**Q: 公開後にメンバーがアプリを見られないのはなぜですか？**

バージョン公開時に設定した表示範囲を確認し、対象のユーザーまたは部署が含まれていることを確認してください。

**Q: ボットが返信しないのはなぜですか？**

まず Client ID と Client Secret を確認し、そのうえでボット機能が有効か、権限が付与されているか、バージョンが公開済みか、nexu クライアントが起動中かを確認してください。
