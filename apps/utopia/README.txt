Utopia (EdgeOne Pages 直接アップロード用)

■ 使い方
1. https://pages.edgeone.ai/ja/manage で「プロジェクトを作成」→「直接アップロード」
2. この zip をそのままドラッグ＆ドロップ → デプロイ
3. 発行されたドメインを開き、検索欄に google.com と入力して Enter

■ 構成
- Ultraviolet(Service Worker型)プロキシ。プロキシパスは /math/、SW は graph.js
- classes/ = Ultraviolet 本体 (balance=bundle, calculus=config, science=sw, history=handler, inspire=client)
- edgeone.json = graph.js のヘッダ設定と /math/* のフォールバック

■ 変更点
- 中継先(bare)を https://utopia.nana.kal-ram.co.il/book/ に固定（CORS 全許可のため外部ドメインからも利用可）
- 広告/計測(GA・adc.js・effectivecpmnetwork)、Turnstile、リンク失効バナーを削除
- タブ偽装と Google への自動リダイレクトを無効化
- サーバー側 API が必要な検索サジェスト(/search)を無効化

■ 注意
- HTTPS 必須（Service Worker のため）。EdgeOne Pages のドメインならそのまま動作します。
- 中継は元サーバー依存。停止した場合は classes/calculus.js の bare を
  自前の bare-server-node (https://github.com/tomphttp/bare-server-node) の URL に変更してください。
- 公開URLは誰でも利用できるオープンプロキシになります。公開範囲と各組織の規約にご注意ください。

■ 言語設定 (追加分)
- トップの「表示言語」セレクタで選択（localStorage: ui_lang）。
- YouTube/Google へは hl（YouTube は persist_hl=1 も）を自動付与します。
  persist_hl がないと YouTube は言語を保存せず既定に戻るため、これが修正の要点です。
- Accept-Language は Service Worker 側で送信。既定は classes/calculus.js の
  先頭 __uv$lang で定義（既定 'ja'）。ここを変えると全体の既定言語が変わります。
