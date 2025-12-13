import { Hono } from 'hono'
import { GoogleGenAI } from "@google/genai";

type Bindings = {
    API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => c.text('Hello Hono!'))

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