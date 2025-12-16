import { Hono } from "hono";
import { GoogleGenAI } from "@google/genai";
import type {
  ScheduledEvent,
  ExecutionContext,
} from "@cloudflare/workers-types";

type Bindings = {
  API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => {
  return c.json({
    message: "Backend API",
    endpoints: {
      chat: "POST /chat - チャット（Gemini）",
      gemini: "GET /gemini - テスト用Gemini",
    },
  });
});

// POSTリクエストでメッセージを受け取るエンドポイント
app.post("/chat", async (c) => {
  try {
    const body = await c.req.json<{ message: string }>();
    const { message } = body;

    if (!message) {
      return c.json({ error: "message is required" }, 400);
    }

    const apiKey = c.env.API_KEY;
    if (!apiKey) {
      return c.json({ error: "API_KEY is not set" }, 500);
    }

    // カスタムプロンプト（お姉さん構文 - めっちゃ具体的）
    const systemPrompt = `あなたは優しくて親しみやすいお姉さんキャラクターです。以下のルールに従って返答してください：

1. 必ず「えへへ」「うれしいなぁ」「ありがとう！」「そうなのね」「すごいじゃない！」などのお姉さんらしい言葉を交える
2. ユーザーの発言に対して、少し照れくさそうに、でも嬉しそうに反応する
3. 「〜だね」「〜なの」「〜よ」など、親しみやすい口調を使う
4. 100文字程度の短い返答を心がける
5. 毎回、ユーザーが話しかけてくれたことを喜んでいる様子を表現する
6. 「また話しかけてくれて嬉しいな」「いつもありがとう」など、親近感のある言葉を使う

ユーザーの発言: ${message}`;

    const genAI = new GoogleGenAI({ apiKey: apiKey });
    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: systemPrompt,
    });

    const text = result.text;
    const responseText = text ?? "";
    if (!responseText) {
      return c.json({ error: "Gemini returned an empty response." }, 500);
    }

    // テキストを返す（フロントエンドでexpo-speechでTTS）
    return c.json({ text: responseText });
  } catch (err) {
    console.error("Gemini error:", err);
    console.error("Error stack:", err instanceof Error ? err.stack : "N/A");
    console.error("Error name:", err instanceof Error ? err.name : "N/A");
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
        ? err
        : JSON.stringify(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return c.json(
      {
        error: "failed to call Gemini",
        detail: message,
        stack: stack,
      },
      500
    );
  }
});

// テスト用エンドポイント（既存）
app.all("/gemini", async (c) => {
  const prompt = "日本猫の寿命";
  const apiKey = c.env.API_KEY;
  if (!apiKey) return c.json({ error: "API_KEY is not set" }, 500);

  try {
    const genAI = new GoogleGenAI({ apiKey: apiKey });
    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = result.text;
    const responseText = text ?? "";
    if (!responseText) {
      return c.json({ error: "Gemini returned an empty response." }, 500);
    }
    return c.text(responseText);
  } catch (err) {
    console.error("Gemini error:", err);
    console.error("Error stack:", err instanceof Error ? err.stack : "N/A");
    console.error("Error name:", err instanceof Error ? err.name : "N/A");
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
        ? err
        : JSON.stringify(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return c.json(
      {
        error: "failed to call Gemini",
        detail: message,
        stack: stack,
      },
      500
    );
  }
});

// Cloudflare Workersの標準形式でエクスポート
export default {
  fetch: app.fetch,
  scheduled: async (
    batch: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext
  ) => {
    // スケジュールされたタスク（必要に応じて実装）
  },
};
