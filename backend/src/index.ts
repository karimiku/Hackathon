import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { GoogleGenAI } from "@google/genai";

type Bindings = {
    API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定を追加
app.use('/*', cors())

app.get('/', (c) => c.text('Hello Hono!'))

// フロントエンドから文字起こしされた文字列を受け取るエンドポイント
app.post('/chat', async (c) => {
    try {
        // フロントエンドから送られてきたJSONを取得
        const body = await c.req.json()
        const userMessage = body.message  // ← 文字起こしされた文字列
        
        console.log('受信したメッセージ:', userMessage)
        
        if (!userMessage) {
            return c.json({ error: 'message is required' }, 400)
        }

        const apiKey = c.env.API_KEY
        if (!apiKey) {
            return c.json({ error: 'API_KEY is not set' }, 500)
        }

        // Gemini APIに送信
        const genAI = new GoogleGenAI({apiKey: apiKey})
        const result = await genAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: userMessage  // ← 文字起こしされた文字列をGeminiに送信
        });

        const text = result.text
        const responseText = text ?? "";
        
        if (!responseText) {
            return c.json({ error: 'Gemini returned an empty response.' }, 500);
        }
        
        // Geminiのレスポンスをフロントエンドに返す
        return c.json({ reply: responseText });

    } catch (err) {
        console.error('Gemini error:', err)
        const message =
          err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
        return c.json({ error: 'failed to call Gemini', detail: message }, 500)
    }
})

// 既存のテストエンドポイント
app.all('/gemini', async (c) => {

    const prompt = '日本猫の寿命';
    const apiKey = c.env.API_KEY
    if (!apiKey) return c.json({ error: 'API_KEY is not set' }, 500)

     try {
        const genAI = new GoogleGenAI({apiKey: apiKey})
        const result = await genAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt
        });

        const text = result.text
        const responseText = text ?? "";
        if (!responseText) {
            return c.json({ error: 'Gemini returned an empty response.' }, 500);
        }
        return c.text(responseText);

    } catch (err) {
        console.error('Gemini error:', err)
        const message =
          err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
        return c.json({ error: 'failed to call Gemini', detail: message }, 500)
    }
})

export default app