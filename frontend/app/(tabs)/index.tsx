import { useState, useEffect, useRef } from "react";
import { StyleSheet, View, Button, Text, ScrollView } from "react-native";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import Voice from "@react-native-voice/voice";
import { ThemedText } from "@/components/themed-text";

// チャットメッセージの型
type ChatMessage = {
  id: string;
  text: string;
  isUser: boolean; // true: ユーザー, false: AI
  timestamp: Date;
};

export default function HomeScreen() {
  const [facing, setFacing] = useState<CameraType>("back");
  const [permission, requestPermission] = useCameraPermissions();
  const [isChatActive, setIsChatActive] = useState(false); // チャット開始フラグ
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentBubbleText, setCurrentBubbleText] = useState(""); // 3Dモデルの吹き出し用
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const transcriptRef = useRef(""); // 最新のtranscriptを保持
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 無音タイマー
  const isSendingRef = useRef(false); // 送信中のフラグ
  const isVoiceActiveRef = useRef(false); // 音声認識の状態管理
  const scrollViewRef = useRef<ScrollView>(null);

  // チャット開始
  const startChat = async () => {
    setIsChatActive(true);
    // 音声認識を開始
    await startRecording();
  };

  // チャット停止
  const stopChat = async () => {
    setIsChatActive(false);
    // 音声認識を停止
    if (isVoiceActiveRef.current) {
      await Voice.stop();
      isVoiceActiveRef.current = false;
    }
    // タイマーをクリア
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
  };

  // バックエンドに送信する関数
  const sendToBackend = async (text: string) => {
    if (isSendingRef.current || !text.trim()) {
      return;
    }

    isSendingRef.current = true;
    try {
      console.log("✅ 確定テキスト:", text);

      // ユーザーのメッセージを追加
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        text: text,
        isUser: true,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, userMessage]);
      setCurrentBubbleText(""); // 吹き出しをクリア

      // スクロールを最下部に
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);

      // バックエンドに送信（後で実装）
      // const response = await fetch('http://...', {
      //   method: 'POST',
      //   body: JSON.stringify({ message: text }),
      // });
      // const data = await response.json();

      // 仮の応答（後で削除）
      const data = { reply: "応答: " + text };

      // AIの応答を追加
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: data.reply,
        isUser: false,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, aiMessage]);
      setCurrentBubbleText(data.reply); // 吹き出しに表示

      // スクロールを最下部に
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);

      // TTS再生は後で実装
    } catch (error) {
      console.error("❌ バックエンド送信エラー:", error);
    } finally {
      isSendingRef.current = false;
    }
  };

  // 無音タイマーをリセット
  const resetSilenceTimer = () => {
    // 既存のタイマーをクリア
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }

    // 3秒後にバックエンドに送信
    silenceTimerRef.current = setTimeout(async () => {
      const finalText = transcriptRef.current;
      if (finalText && finalText.trim()) {
        // 確定テキストをコンソールに表示
        console.log("✅ 確定テキスト:", finalText);

        // 送信前にテキストを取得（送信後にリセットされるため）
        const textToSend = finalText;

        // 送信
        await sendToBackend(textToSend);

        // 送信後、音声認識を一度停止して再開（新しいセッションとして開始）
        try {
          if (isVoiceActiveRef.current) {
            await Voice.stop();
            isVoiceActiveRef.current = false;
          }
          setTranscript("");
          transcriptRef.current = "";

          // 停止が完了するまで待つ
          await new Promise((resolve) => setTimeout(resolve, 800));

          // 既に開始されていないことを確認してから開始
          if (!isVoiceActiveRef.current) {
            await Voice.start("ja-JP");
            console.log("🔄 新しいセッションを開始しました");
          }
        } catch (error: any) {
          console.error("再開エラー:", error);
          isVoiceActiveRef.current = false;

          // "already started"エラーの場合は無視
          const errorMessage = error?.error?.message || error?.message || "";
          if (errorMessage.includes("already started")) {
            console.log("⚠️ 音声認識は既に開始されています。スキップします。");
            return;
          }

          // エラー時は1秒後に再試行
          setTimeout(() => {
            startRecording();
          }, 1000);
        }
      }
    }, 3000); // 3秒
  };

  // 音声認識の初期化と自動開始
  useEffect(() => {
    // 音声認識開始時
    Voice.onSpeechStart = () => {
      console.log("🎤 音声認識開始");
      setIsRecording(true);
      isVoiceActiveRef.current = true;
    };

    // 音声認識の結果をリアルタイムで取得
    Voice.onSpeechResults = (e) => {
      if (e.value && e.value[0]) {
        const text = e.value[0];
        setTranscript(text);
        transcriptRef.current = text; // refにも保存
        // リアルタイムテキストのログは削除（確定テキストだけ表示）

        // 音声が検出されたら、無音タイマーをリセット
        resetSilenceTimer();
      }
    };

    // 音声認識が終了したタイミング（一時的な無音）
    Voice.onSpeechEnd = () => {
      console.log("🔇 一時的な無音を検出");
      // 3秒間無音が続いたら自動送信される（resetSilenceTimerで処理）
    };

    // エラー処理
    Voice.onSpeechError = (e: any) => {
      const errorMessage = e?.error?.message || e?.message || "";

      // "No speech detected"エラーは無視（音声が検出されなかっただけ）
      if (errorMessage.includes("No speech detected")) {
        // 無視して継続
        return;
      }

      // "already started"エラーの処理
      if (errorMessage.includes("already started")) {
        console.log(
          "⚠️ 音声認識は既に開始されています。再開をスキップします。"
        );
        // 状態を更新
        isVoiceActiveRef.current = true;
        setIsRecording(true);
        return;
      }

      // その他のエラーはログに出力
      console.error("❌ 音声認識エラー:", e);
      setIsRecording(false);
      isVoiceActiveRef.current = false;

      // エラー時も自動的に再開を試みる（既に開始されていない場合のみ）
      setTimeout(() => {
        if (!isVoiceActiveRef.current) {
          startRecording();
        }
      }, 1000);
    };

    // アプリ起動時は自動開始しない（チャット開始ボタンで開始）

    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []); // 依存配列を空にして、一度だけ登録

  // 音声認識開始（再開用）
  const startRecording = async () => {
    try {
      // 既に開始されている場合はスキップ
      if (isVoiceActiveRef.current) {
        console.log("⚠️ 音声認識は既に開始されています。スキップします。");
        return;
      }

      await Voice.start("ja-JP");
      setTranscript("");
      transcriptRef.current = "";
    } catch (error: any) {
      console.error("音声認識開始エラー:", error);
      setIsRecording(false);
      isVoiceActiveRef.current = false;

      // "already started"エラーの場合は無視
      const errorMessage = error?.error?.message || error?.message || "";
      if (errorMessage.includes("already started")) {
        console.log("⚠️ 音声認識は既に開始されています。スキップします。");
        isVoiceActiveRef.current = true;
        setIsRecording(true);
        return;
      }

      // エラー時は1秒後に再試行
      setTimeout(() => {
        if (!isVoiceActiveRef.current) {
          startRecording();
        }
      }, 1000);
    }
  };

  if (!permission) {
    // カメラの権限情報を読み込み中
    return (
      <View style={styles.container}>
        <Text>読み込み中...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    // カメラの権限が許可されていない場合
    return (
      <View style={styles.container}>
        <ThemedText style={styles.message}>カメラの許可が必要です</ThemedText>
        <Button title="許可する" onPress={requestPermission} />
      </View>
    );
  }

  // カメラが許可されている場合、カメラビューを表示
  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing={facing} />

      {/* メインコンテンツエリア */}
      <View style={styles.contentArea}>
        {/* 左側：AR用の3Dモデルエリア（後で実装） */}
        <View style={styles.arArea}>
          {/* 3Dモデルは後で実装 */}
          <View style={styles.arPlaceholder}>
            <ThemedText style={styles.arPlaceholderText}>3Dモデル</ThemedText>
          </View>

          {/* 吹き出し */}
          {currentBubbleText ? (
            <View style={styles.speechBubble}>
              <ThemedText style={styles.speechBubbleText}>
                {currentBubbleText}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {/* 右側：LINE風のチャットUI */}
        {isChatActive && (
          <View style={styles.chatArea}>
            <ScrollView
              ref={scrollViewRef}
              style={styles.chatScrollView}
              contentContainerStyle={styles.chatContent}
            >
              {chatMessages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.messageContainer,
                    message.isUser ? styles.userMessage : styles.aiMessage,
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.messageText,
                      message.isUser
                        ? styles.userMessageText
                        : styles.aiMessageText,
                    ]}
                  >
                    {message.text}
                  </ThemedText>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* 下部：ボタンエリア */}
      <View style={styles.buttonArea}>
        <Button
          title={isChatActive ? "チャット停止" : "チャット開始"}
          onPress={isChatActive ? stopChat : startChat}
        />
        <Button
          title="カメラ切り替え"
          onPress={() => setFacing(facing === "back" ? "front" : "back")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  contentArea: {
    flex: 1,
    flexDirection: "row",
  },
  arArea: {
    width: "40%",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  arPlaceholder: {
    width: 200,
    height: 200,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  arPlaceholderText: {
    color: "#fff",
    fontSize: 16,
  },
  speechBubble: {
    position: "absolute",
    top: 50,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    padding: 10,
    borderRadius: 10,
    maxWidth: 150,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  speechBubbleText: {
    fontSize: 12,
    color: "#000",
  },
  chatArea: {
    width: "60%",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  chatScrollView: {
    flex: 1,
  },
  chatContent: {
    padding: 10,
  },
  messageContainer: {
    marginBottom: 10,
    maxWidth: "80%",
    padding: 10,
    borderRadius: 10,
  },
  userMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#007AFF",
  },
  aiMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#E5E5EA",
  },
  messageText: {
    fontSize: 14,
  },
  userMessageText: {
    color: "#fff",
  },
  aiMessageText: {
    color: "#000",
  },
  buttonArea: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  message: {
    textAlign: "center",
    paddingBottom: 10,
  },
});
