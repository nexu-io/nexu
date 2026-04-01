# トラブルシューティング

## 問題1：Nexu が起動しない / OpenClaw との競合

**症状：** Nexu を開いても応答がない、すぐにクラッシュする、またはポートが使用中というエラーが表示される。

**根本原因：** OpenClaw のバックグラウンドゲートウェイサービス（`ai.openclaw.gateway`）が必要なポートを占有しており、Nexu が正常に起動できない。

**修正手順：**

1. ターミナルを開き（`Command + スペース` で「ターミナル」を検索）、以下のコマンドを1行ずつ実行してください：

```bash
launchctl bootout gui/$(id -u)/ai.openclaw.gateway
rm ~/Library/LaunchAgents/ai.openclaw.gateway.plist
```

> 1行目：OpenClaw ゲートウェイのバックグラウンドサービスを即座に停止します。2行目：自動起動の設定を削除し、再起動後に競合が再発するのを防ぎます。

2. コマンド実行後、Nexu を再度開いて正常に起動するか確認してください。

---

## 問題2：インストールまたはアップデート時に「Nexu.app は使用中です」と表示される

**症状：** 「"Nexu.app" が使用中のため、この操作を完了できません。」というダイアログが表示される。

![Nexu.app は使用中です](/assets/nexu-app-in-use.webp)

**根本原因：** Nexu のバックグラウンドプロセスがまだ実行中のため、新しいバージョンを上書きインストールできない。

**修正手順：**

1. ターミナルを開き（`Command + スペース` で「ターミナル」を検索）、以下のコマンドを実行して Nexu 関連のプロセスをすべて終了してください：

```bash
curl -fsSL https://desktop-releases.nexu.io/scripts/kill-all.sh | bash
```

2. 実行完了後、新しいバージョンの Nexu.app を再インストールまたはドラッグしてください。

---

## サポートへのお問い合わせ

問題が解決しない場合は、以下の方法でお問い合わせください：

- **GitHub Issues：** [https://github.com/nexu-io/nexu/issues](https://github.com/nexu-io/nexu/issues)
- **コミュニティ：** [https://docs.nexu.io/ja/guide/contact](/ja/guide/contact)
