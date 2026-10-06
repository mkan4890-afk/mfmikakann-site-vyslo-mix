# Vyslo Music

Vyslo Tube の音楽版です。**完全無料・登録不要・APIキー不要**で動きます。

- 検索・ランキング・アルバム・アーティスト・ポッドキャスト: Apple iTunes Search API(キー不要の公開API)
- 曲を再生すると、サーバーが裏で曲名とアーティスト名から Spotify の曲IDを探し(ListenBrainz Labs の公開API)、**Spotify公式の埋め込みプレーヤー**でその曲を再生します
- Spotifyで見つからない曲は Apple の30秒試聴で再生します
- ポッドキャストは配信元の音声をそのままフル再生します
- SpotifyのプレイリストやアルバムのURLを検索欄に貼り付けると、公式プレーヤーでそのまま再生できます
- プレイリストの作成・編集・並べ替え(ドラッグ&ドロップ)、お気に入りの曲、アルバムの保存、アーティスト・ポッドキャストのフォロー
- アーティスト写真は Apple Music の公開ページから取得(写真がない場合は代表アルバムのジャケット)
- シャッフルは解除すると元の曲順に戻ります。プレイリストから削除・キューの消去・履歴の消去・プレイリストの削除は「元に戻す」で取り消せます
- 歌詞表示(LRCLIB)。フル再生中は歌詞が曲に合わせて自動スクロールし、行を押すとその位置へ移動します
- ライブラリ・お気に入り・履歴・再生キューはブラウザ(localStorage)に保存されます。アカウントは不要です。設定画面からバックアップの書き出し・読み込みができます

## 再生について

Spotifyの埋め込みプレーヤーは、ブラウザでSpotifyにログインしていればフル再生、していなければ各曲30秒のプレビュー再生になります(Spotify側の仕様)。

## Railway へのデプロイ

1. このフォルダを GitHub に push するか、Railway CLI で `railway up` を実行します
2. Railway は `Dockerfile` を使って自動でビルドします(`railway.toml` 設定済み)
3. Settings → Networking で「Generate Domain」を押せば公開されます

環境変数の設定は不要です(`PORT` は Railway が自動で設定します)。任意で `COUNTRY`(既定 `JP`)を変更できます。

## ローカルで動かす

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

http://localhost:8000 を開きます。

## 構成

```
main.py        FastAPI (API・画像プロキシ・SPA配信)
sources.py     無料データソース (iTunes / ListenBrainz / Spotify oEmbed)
static/        画面 (index.html, css, js)
Dockerfile     Railway 用
railway.toml   Railway 設定 (ヘルスチェック /version)
```

## 利用しているサービス

- [iTunes Search API](https://performance-partners.apple.com/search-api) — 曲・アルバム・アーティスト・ポッドキャスト情報、ランキング、30秒試聴
- [ListenBrainz Labs](https://labs.api.listenbrainz.org/) — 曲名とアーティスト名から Spotify の曲IDを検索
- [LRCLIB](https://lrclib.net/) — 歌詞(キー不要の公開API)
- [Spotify Embeds](https://developer.spotify.com/documentation/embeds) — 公式埋め込みプレーヤー(iFrame API)と oEmbed

iTunes API は1つのIPあたり1分間に約20回までの制限があるため、サーバー側で結果をキャッシュしています。
