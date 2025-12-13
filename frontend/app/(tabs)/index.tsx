import { useState, useRef } from "react";
import { StyleSheet, View, Button, Text, ScrollView } from "react-native";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { ThemedText } from "@/components/themed-text";
import {
  useSpeechRecognitionEvent,
  ExpoSpeechRecognitionModule,
} from "expo-speech-recognition";

// チャットメッセージの型
type ChatMessage = {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
};

export default function HomeScreen() {
  const [facing, setFacing] = useState<CameraType>("back");
  const [permission, requestPermission] = useCameraPermissions();
  const [isChatActive, setIsChatActive] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentBubbleText, setCurrentBubbleText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const scrollViewRef = useRef<ScrollView>(null);

  // 音声認識イベント
  useSpeechRecognitionEvent("result", (event) => {
    const transcribedText = event.results[0]?.transcript;
    if (transcribedText) {
      setTranscript(transcribedText);
    }
  });

  useSpeechRecognitionEvent("end", async () => {
    console.log("音声認識終了");
    setIsRecording(false);

    if (transcript.trim()) {
      await sendToBackend(transcript);
      setTranscript("");
    }
  });

  // チャット開始
  const startChat = async () => {
    setIsChatActive(true);
  };

  // チャット停止
  const stopChat = async () => {
    setIsChatActive(false);
    if (isRecording) {
      ExpoSpeechRecognitionModule.stop();
    }
    setIsRecording(false);
  };

  // バックエンドに送信する関数
  const sendToBackend = async (text: string) => {
    if (!text.trim()) return;

    try {
      console.log("✅ 確定テキスト:", text);

      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        text: text,
        isUser: true,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, userMessage]);
      setCurrentBubbleText("");

      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);

      // バックエンドにリクエスト送信 (エンドポイントを /chat に修正)
      // Windowsの場合、ローカルIPアドレスを使用
      const response = await fetch('http://127.0.0.1:8787/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text }),  // ← 音声認識のテキストがここに入る
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: data.reply,  // ← バックエンドからのGeminiレスポンス
        isUser: false,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, aiMessage]);
      setCurrentBubbleText(data.reply);

      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error("❌ バックエンド送信エラー:", error);
      
      // エラーメッセージを表示
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: "エラーが発生しました。もう一度お試しください。",
        isUser: false,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    }
  };

  // 音声認識開始
  const startRecording = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        console.warn("音声認識の権限が拒否されました");
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: "ja-JP",
        interimResults: true,
        maxAlternatives: 1,
        continuous: true,
      });
      setIsRecording(true);
      console.log("🎤 音声認識開始");
    } catch (err) {
      console.error("音声認識開始失敗", err);
    }
  };

  // 音声認識停止
  const stopRecording = async () => {
    ExpoSpeechRecognitionModule.stop();
    setIsRecording(false);
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text>読み込み中...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <ThemedText style={styles.message}>カメラの許可が必要です</ThemedText>
        <Button title="許可する" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing={facing} />

      <View style={styles.contentArea}>
        <View style={styles.arArea}>
          <View style={styles.arPlaceholder}>
            <ThemedText style={styles.arPlaceholderText}>3Dモデル</ThemedText>
          </View>

          {currentBubbleText ? (
            <View style={styles.speechBubble}>
              <ThemedText style={styles.speechBubbleText}>
                {currentBubbleText}
              </ThemedText>
            </View>
          ) : null}
        </View>

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

              {/* リアルタイムで認識中のテキストを表示 */}
              {isRecording && transcript && (
                <View
                  style={[
                    styles.messageContainer,
                    styles.userMessage,
                    { opacity: 0.6 },
                  ]}
                >
                  <ThemedText style={styles.userMessageText}>
                    {transcript}...
                  </ThemedText>
                </View>
              )}
            </ScrollView>
          </View>
        )}
      </View>

      <View style={styles.buttonArea}>
        <Button
          title={isChatActive ? "チャット停止" : "チャット開始"}
          onPress={isChatActive ? stopChat : startChat}
        />
        {isChatActive && (
          <Button
            title={isRecording ? "音声停止" : "音声開始"}
            onPress={isRecording ? stopRecording : startRecording}
          />
        )}
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
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
