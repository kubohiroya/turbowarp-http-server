# Examples

このディレクトリには、TurboWarp HTTP Server の使い方を段階的に確認するためのサンプルを置いています。

各サンプルは独立した Hono app です。リポジトリ root から次のように起動できます。

```bash
corepack pnpm exec tsx examples/01-hello-form/server.mjs
```

| Example | 内容 |
|---|---|
| `01-hello-form` | `GET /` のフォームと `POST /hello` の応答 |
| `02-visitor-counter` | 日付ごとの訪問者カウンタ |
| `03-message-board` | 投稿フォーム付きの簡易掲示板 |
| `04-image-upload` | 画像 upload と `@assets` named resource 参照 |
| `05-live-camera` | stable asset URL を atomic replace するライブカメラ |
| `06-scratch-like-community` | 登録、ログイン、作品投稿、SB3 download、remix の学習用コミュニティ |

TurboWarp 側は README の「TurboWarp 側のブロック構成」を参考に、HTTP request hat、response block、HTML/Markdown builder、Asset Manager block を組み合わせて同じ流れを再現できます。
