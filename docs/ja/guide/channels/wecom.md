# WeCom

WeCom クライアント内の「インテリジェントボット」機能を使えば、`Bot ID` と `Secret` をコピーするだけで WeCom を nexu に接続できます。

## 前提条件

- すでに WeCom 組織に所属している場合は、その組織の企業管理者権限が必要です。
- 個人ユーザーの場合は、先に自分の WeCom アカウントを登録して利用できます。個人登録は無料で、法人資格は不要です。

## ステップ 1：インテリジェントボットを開いて作成を始める

1. nexu クライアントを開き、Channels セクションで **WeCom** をクリックします。

![Choose WeCom in nexu](/assets/wecom/step0-choose-wecom-channel.webp)

2. WeCom クライアントで左側の「Workbench」を開き、上部の「Smart Office」に切り替えて、「Intelligent Bot」を開きます。

![Open the Intelligent Bot page](/assets/wecom/step1-open-workbench.webp)

3. インテリジェントボット画面で「Create Bot」をクリックします。

![Click Create Bot](/assets/wecom/step2-create-bot-entry.webp)

4. 作成ダイアログで左下の「Manual Create」をクリックします。

![Choose Manual Create](/assets/wecom/step3-manual-create.webp)

## ステップ 2：API モードに切り替えて認証情報をコピー

1. 作成ページで右側の「Create in API Mode」をクリックします。

![Switch to API mode](/assets/wecom/step4-api-mode.webp)

2. API 設定で「Use Long Connection」を選択します。

3. 次の 2 つの値をコピーして保存します。
   - **Bot ID**
   - **Secret**

nexu で WeCom を接続するときに使います。

![Choose long connection and copy Bot ID and Secret](/assets/wecom/step5-copy-botid-secret.webp)

## ステップ 3：権限を付与

1. 同じページを下へスクロールし、「Available Permissions」を開きます。

![Open the permissions panel](/assets/wecom/step6-open-permissions.webp)

2. 権限ダイアログで「Authorize All」をクリックします。

![Authorize all permissions](/assets/wecom/step7-authorize-all.webp)

## ステップ 4：ボット設定を仕上げて保存

1. ボット設定ページに戻り、表示範囲を確認または変更して、自分や対象メンバーがボットを利用できるようにします。

![Set the visibility scope](/assets/wecom/step8-visible-range.webp)

2. 必要に応じてボットのアイコン、名前、説明を編集し、「Confirm」をクリックします。

![Edit bot information](/assets/wecom/step9-edit-bot-info.webp)

3. 設定を確認したら、下部の「Save」をクリックします。

![Save the bot configuration](/assets/wecom/step10-save-bot.webp)

## ステップ 5：ボットを開いて使い始める

1. 保存後、ボット詳細ページで「Use Now」をクリックします。

![Open the bot details page](/assets/wecom/step11-use-bot.webp)

2. nexu に戻り、`Bot ID` と `Secret` を WeCom チャンネルダイアログに貼り付け、「Connect WeCom」をクリックします。

![Enter Bot ID and Secret in nexu](/assets/wecom/step12-nexu-connect.webp)

3. 連絡先またはボット一覧で作成したボットを見つけ、「Send Message」をクリックします。

![Open the bot conversation](/assets/wecom/step12-send-message.webp)

4. 接続後は、次のように WeCom 上で Agent と会話できます。

![Chat with the bot in WeCom](/assets/wecom/step13-chat.webp)

---

## FAQ

**Q: 企業管理者でなくても使えますか？**

はい。既存組織の管理者でない場合でも、自分で WeCom アカウントを登録してインテリジェントボットを作成できます。

**Q: 自分でサーバーや公開 Callback URL を用意する必要がありますか？**

いいえ。この手順で「Use Long Connection」を選べば、自分で公開 Callback を設定する必要はありません。

**Q: 接続後にボットが返信しないのはなぜですか？**

まず次の点を確認してください。

- nexu に入力した `Bot ID` と `Secret` が正しいか
- WeCom 側の権限付与が完了しているか
- 表示範囲に自分が含まれているか
- nexu クライアントが起動中か

**Q: このボットをグループチャットに追加できますか？**

はい。まず 1 対 1 の会話で動作確認をしてから、WeCom のグループチャットに追加するのがおすすめです。
