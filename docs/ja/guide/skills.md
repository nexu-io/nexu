# スキルインストール

スキルはエージェントの能力を拡張します。Web 検索やドキュメント生成、Feishu Bitable の操作、サードパーティ API 呼び出しまで、数秒でインストールできます。

## ステップ 1：スキルページを開く

Nexu クライアントの左サイドバーで **Skills** をクリックし、Skill Hub に入ります。

**Explore** タブには公開スキルが一覧表示されます。カテゴリ（オフィスとコラボレーション、ファイルとナレッジ、クリエイティブとデザイン、ビジネス分析、音声と動画など）で絞り込むか、キーワードで検索できます。

![Nexu skill catalog](/assets/nexu-skills.webp)

## ステップ 2：スキルを見つけてインストール

必要なスキルを閲覧または検索し、カードの **Install** ボタンをクリックします。スキルはホットロードに対応しており、エージェントを再起動しなくてもすぐに有効になります。

![Search and install a skill](/assets/nexu-skills-search.webp)

## ステップ 3：インストールを確認

**Yours** タブに切り替えると、インストール済みスキルが表示されます。トグルで個別のスキルをいつでも有効／無効にできます。

![Installed skills](/assets/nexu-skills-installed.webp)

## ステップ 4：会話で使う

スキルをインストールしたら、チャンネル会話でやりたいことを説明するだけです。エージェントが適切なスキルを自動で選び、タスクを完了します。

![Skill in action during conversation](/assets/nexu-skills-chat.webp)

## 例：TweetClaw で X/Twitter ワークフローを扱う

同じ OpenClaw ワークスペースで X/Twitter の操作も必要な場合は、**Skills** ページで「TweetClaw」を検索します。CLI で管理している OpenClaw ワークスペースでは、プラグインを直接インストールできます。

```bash
openclaw plugins install @xquik/tweetclaw
```

[TweetClaw](https://github.com/Xquik-dev/tweetclaw) は [npm](https://www.npmjs.com/package/@xquik/tweetclaw) でも公開され、[ClawHub](https://clawhub.ai/kriptoburak/xquik-tweetclaw) にも掲載されています。ツイート検索、返信検索、フォロワーエクスポート、ユーザー検索、メディアアップロードとダウンロード、ダイレクトメッセージ、ツイート監視、webhooks、抽選、承認付きの投稿や返信に使えます。

nexu のチャンネル認証情報は、TweetClaw と Xquik の認証情報とは分けて管理してください。投稿、返信、ダイレクトメッセージ、フォロー、フォロー解除など、公開またはアカウント状態を変更する X/Twitter 操作には明示的な承認を求めてください。

## FAQ

**Q: スキルをインストールしたあと、エージェントの再起動は必要ですか？**

いいえ。スキルはホットロードに対応しており、新しいスキルはすぐに認識・有効化されます。

**Q: カタログ以外のスキルをインストールできますか？**

はい。Nexu は個別ニーズ向けのローカルカスタムスキル開発をサポートしています。詳細は開発者向けドキュメントを参照してください。

**Q: スキルをアンインストールするには？**

**Yours** タブを開き、削除したいスキルの横の **Uninstall** をクリックします。
