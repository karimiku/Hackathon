import { Hono } from "hono";

type Bindings = {
  VOICEVOX_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const VOICEVOX_API_BASE = "https://deprecatedapis.tts.quest/v2/voicevox";

// 型定義
type TTSRequest = {
  text: string;
  speaker?: number;
  pitch?: number;
  intonationScale?: number;
  speed?: number;
  apiKey?: string;
};

app.get("/", (c) => {
  return c.json(
    {
      message: "VOICEVOX API Proxy",
      endpoints: {
        tts: "POST /tts - テキストを音声に変換",
        speakers: "GET /speakers - 利用可能な話者一覧を取得",
      },
    },
    200,
    {
      "Content-Type": "application/json; charset=utf-8",
    }
  );
});

// テキストを音声に変換
app.post("/tts", async (c) => {
  try {
    const body = await c.req.json<TTSRequest>();
    const {
      text,
      speaker = 0,
      pitch = 0,
      intonationScale = 1,
      speed = 1,
      apiKey,
    } = body;

    if (!text) {
      return c.json({ error: "text is required" }, 400, {
        "Content-Type": "application/json; charset=utf-8",
      });
    }

    // apiKeyは環境変数またはリクエストから取得
    const key = apiKey || c.env?.VOICEVOX_API_KEY;
    if (!key) {
      return c.json(
        {
          error:
            "apiKey is required (set VOICEVOX_API_KEY env or include in request)",
        },
        400,
        {
          "Content-Type": "application/json; charset=utf-8",
        }
      );
    }

    // VOICEVOX APIにリクエスト
    const params = new URLSearchParams({
      key,
      text,
      speaker: speaker.toString(),
      pitch: pitch.toString(),
      intonationScale: intonationScale.toString(),
      speed: speed.toString(),
    });

    const response = await fetch(
      `${VOICEVOX_API_BASE}/audio/?${params.toString()}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = "Failed to generate audio";

      if (errorText.includes("invalidApiKey")) {
        errorMessage = "Invalid API key";
      } else if (errorText.includes("notEnoughPoints")) {
        errorMessage = "Not enough points";
      } else if (errorText.includes("failed")) {
        errorMessage = "Audio synthesis failed";
      }

      return c.json({ error: errorMessage }, response.status as any, {
        "Content-Type": "application/json; charset=utf-8",
      });
    }

    // 音声データを取得
    const audioData = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "audio/wav";

    // 音声データを返す
    return c.body(audioData, 200, {
      "Content-Type": contentType,
      "Content-Disposition": 'inline; filename="voice.wav"',
    });
  } catch (error) {
    console.error("TTS Error:", error);
    return c.json({ error: "Internal server error" }, 500, {
      "Content-Type": "application/json; charset=utf-8",
    });
  }
});

// 利用可能な話者一覧を取得
app.get("/speakers", async (c) => {
  try {
    // apiKeyは環境変数またはクエリパラメータから取得
    const apiKey = c.req.query("key") || c.env?.VOICEVOX_API_KEY;

    const url = apiKey
      ? `${VOICEVOX_API_BASE}/speakers/?key=${apiKey}`
      : `${VOICEVOX_API_BASE}/speakers/`;

    const response = await fetch(url);

    if (!response.ok) {
      return c.json(
        { error: "Failed to fetch speakers" },
        response.status as any,
        {
          "Content-Type": "application/json; charset=utf-8",
        }
      );
    }

    const speakers = await response.json();
    return c.json(speakers, 200, {
      "Content-Type": "application/json; charset=utf-8",
    });
  } catch (error) {
    console.error("Speakers Error:", error);
    return c.json({ error: "Internal server error" }, 500, {
      "Content-Type": "application/json; charset=utf-8",
    });
  }
});

export default app;
