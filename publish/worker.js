/*
 * ホームページを受け取って、GitHub に置いて、アドレスを返すだけの窓口。
 *
 * これは Cloudflare Workers で動かします。設置のしかたは、
 * となりの README.md に書いてあります。
 *
 * GitHub の鍵（トークン）は、この窓口の中だけにあります。
 * アプリ側には持たせません。
 */

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return say({ error: "使い方がちがいます。" }, 405, cors);

    // 設定のとりだし
    const [owner, repo] = String(env.REPO || "").split("/");
    const branch = env.BRANCH || "main";
    const dir = (env.DIR || "sites").replace(/^\/+|\/+$/g, "");
    if (!owner || !repo || !env.GH_TOKEN || !env.PASS)
      return say({ error: "窓口の設定がまだ終わっていません。" }, 500, cors);

    // 受け取り
    let body;
    try { body = await req.json(); }
    catch { return say({ error: "受け取れませんでした。もう一度おためしください。" }, 400, cors); }
    const pass = String(body?.pass ?? "");
    const slug = String(body?.slug ?? "");
    const html = body?.html;

    // 合言葉
    if (!same(pass, env.PASS))
      return say({ error: "合言葉がちがいます。" }, 401, cors);

    // ページの名前
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug))
      return say({ error: "ページの名前は、英字の小文字・数字・ハイフンだけにしてください。" }, 400, cors);

    // 中身
    if (typeof html !== "string" || html.length < 50)
      return say({ error: "ホームページの中身がありませんでした。" }, 400, cors);
    const MAX = Number(env.MAX_BYTES || 6 * 1024 * 1024);
    if (html.length > MAX)
      return say({ error: "写真が多すぎます。枚数を減らすか、小さめの写真にしてください。" }, 413, cors);

    // GitHub へ
    const path = `${dir}/${slug}.html`;
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}`;
    const head = {
      "Authorization": `Bearer ${env.GH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tsukuru-publisher",
      "Content-Type": "application/json",
    };

    // すでに同じ名前があるなら、上書きのために目印（sha）が要る
    let sha;
    const now = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: head });
    if (now.status === 200) sha = (await now.json()).sha;
    else if (now.status !== 404) return say({ error: "GitHub につながりませんでした。" }, 502, cors);

    const put = await fetch(api, {
      method: "PUT",
      headers: head,
      body: JSON.stringify({
        message: `ホームページを公開: ${slug}`,
        content: toBase64(html),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok)
      return say({ error: `置けませんでした（${put.status}）。少し待ってもう一度おためしください。` }, 502, cors);

    return say({
      url: `https://${owner}.github.io/${repo}/${dir}/${slug}.html`,
      updated: Boolean(sha),
    }, 200, cors);
  },
};

function say(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

/* 合言葉くらべ。かかった時間から中身が漏れないよう、最後まで見る */
function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* 日本語まじりの文字列を、GitHub が受け取れる形に直す */
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}
