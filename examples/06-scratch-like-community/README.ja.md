# 06-scratch-like-community

ユーザ登録、ログイン、作品投稿、作品一覧/詳細、SB3 ダウンロード、リミックス投稿の流れを示す Scratch 風コミュニティサイトの学習用ローカル実装です。

この example は production-ready な認証基盤ではありません。`src/community.ts` の optional community app をそのまま起動し、Hono 側安全対策として学習用に次の最小限だけを含めています。

- password は Node 標準 `crypto.scrypt` で hash 化して保存する。
- session cookie は `HttpOnly`、`SameSite=Lax` にする。
- state-changing request は CSRF token を検証する。
- upload は multipart body、`.sb3`、SB3/zip 系 MIME、file signature、size limit で検証する。
- owner だけが作品の metadata edit、SB3 replace、delete を実行できる。
- remix 作成時に元 project ID を保存する。
- OAuth demo route は環境変数で provider を設定した場合だけ有効になる。

## 起動

```bash
corepack pnpm exec tsx examples/06-scratch-like-community/server.mjs
```

ブラウザで `http://127.0.0.1:9106/` を開きます。

## HTTP route

| Method | Path | 期待されるレスポンス |
|---|---|---|
| `GET` | `/` | 作品一覧 |
| `GET` | `/signup` | 登録フォーム |
| `POST` | `/signup` | ユーザ作成とログイン |
| `GET` | `/login` | ログインフォーム |
| `POST` | `/login` | session 作成 |
| `POST` | `/logout` | session 破棄 |
| `GET` | `/auth/:provider/start` | configured OAuth demo flow の開始 |
| `GET` | `/auth/:provider/callback` | OAuth demo flow の完了 |
| `POST` | `/projects` | `.sb3` upload と作品作成 |
| `GET` | `/projects/:id` | 作品詳細 |
| `GET` | `/projects/:id.sb3` | SB3 download |
| `POST` | `/projects/:id/remix` | remix 作品作成 |
| `POST` | `/projects/:id/update` | owner-only metadata edit |
| `POST` | `/projects/:id/replace` | owner-only SB3 replace |
| `POST` | `/projects/:id/delete` | owner-only delete |

OAuth demo provider の設定例:

```bash
COMMUNITY_OAUTH_DEMO_CLIENT_ID=demo-client
COMMUNITY_OAUTH_DEMO_AUTHORIZATION_URL=https://example.test/oauth/authorize
COMMUNITY_OAUTH_DEMO_REDIRECT_URI=http://127.0.0.1:9106/auth/demo/callback
COMMUNITY_OAUTH_DEMO_SCOPE=profile
```

## TurboWarp 側のブロック構成

```text
when HTTP request received
use HTTP request [current request ID]
if <GET /> then
  Markdown builder で作品一覧を作る
  respond with HTML [一覧 page]
end

if <GET /projects/:id.sb3> then
  権限を確認する
  set response header [content-type] to [application/x.scratch.sb3]
  set response header [content-disposition] to [attachment; filename="project.sb3"]
  send response [SB3 bytes を返す処理]
end

if <POST /projects/:id/remix> then
  login/session と CSRF token を確認する
  upload validation を行う
  remix 元 ID を記録して新しい作品として保存する
end
```

## 動作確認

1. `/signup` でユーザを作成します。
2. `/` の投稿フォームから `.sb3` ファイルを投稿します。
3. 作品詳細から download と remix を確認します。

`curl` で CSRF cookie と hidden input を扱うのは煩雑なため、通常はブラウザで確認してください。
