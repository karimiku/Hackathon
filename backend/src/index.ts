import { Hono } from "hono";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = new Hono();

// 環境変数から API キーを読む
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// 動作確認用
app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// React Native から叩くエンドポイント
app.post("/chat", async (c) => {
  try {
    // JSON ボディをパース
    const { message } = await c.req.json<{ message: string }>();

    if (!message) {
      return c.json({ error: "message is required" }, 400);
    }

    // Gemini モデルを取得（モデル名は好きなものに変更可）
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    // Gemini に問い合わせ
    const result = await model.generateContent(message);
    const text = result.response.text();

    return c.json({ reply: text });
  } catch (e) {
    console.error(e);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

export default app;
