import { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Button,
  Text,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import Voice from "@react-native-voice/voice";
import { ThemedText } from "@/components/themed-text";
import * as Speech from "expo-speech";
import { GLView } from "expo-gl";
import { Renderer } from "expo-three";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Asset } from "expo-asset";
import { Ionicons } from "@expo/vector-icons";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";

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
  const isTTSPlayingRef = useRef(false); // TTS再生状態を管理
  const currentTTSTextRef = useRef(""); // 現在再生中のテキストを保持
  const currentTTSVoiceRef = useRef<Speech.Voice | null>(null); // 現在再生中の音声を保持
  const isChatActiveRef = useRef(false); // チャット開始フラグ（ref版）
  const [availableVoices, setAvailableVoices] = useState<Speech.Voice[]>([]);
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState<number>(0);
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const [speechRate, setSpeechRate] = useState(1.0); // 音声速度（0.5-2.0）
  const modelRef = useRef<THREE.Group | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // ジェスチャー操作用のRef
  const targetPosition = useRef({ x: 0, y: 0, z: 0 });
  const targetScale = useRef(1.0);
  const baseScale = useRef(1.0); // ピンチ開始時のスケール保存用
  const basePosition = useRef({ x: 0, y: 0 }); // パン開始時の位置保存用

  // バックエンドURL（環境変数から取得、デフォルト値あり）
  const BACKEND_URL =
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    "https://backend.hono-todo.workers.dev";

  // チャット開始
  const startChat = async () => {
    setIsChatActive(true);
    isChatActiveRef.current = true; // refも更新
    // 状態更新を待ってから音声認識を開始
    await new Promise((resolve) => setTimeout(resolve, 50));
    // 音声認識を開始（startChat内から呼ばれる場合はisChatActiveチェックをスキップ）
    try {
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
      const errorMessage = error?.error?.message || error?.message || "";
      if (errorMessage.includes("already started")) {
        console.log("⚠️ 音声認識は既に開始されています。スキップします。");
        isVoiceActiveRef.current = true;
        setIsRecording(true);
      }
    }
  };

  // チャット停止
  const stopChat = async () => {
    setIsChatActive(false);
    isChatActiveRef.current = false; // refも更新
    // TTSを停止
    Speech.stop();
    isTTSPlayingRef.current = false;
    currentTTSTextRef.current = ""; // テキストをクリア
    currentTTSVoiceRef.current = null; // 音声をクリア
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

  // 音声認識を再開する関数（コンポーネントレベルで定義）
  const resumeRecording = async () => {
    isTTSPlayingRef.current = false;
    // チャットが停止している場合は再開しない
    if (!isChatActiveRef.current) {
      return;
    }
    // 少し待ってから音声認識を再開
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!isVoiceActiveRef.current && isChatActiveRef.current) {
      await startRecording();
    }
  };

  // ジェスチャー定義
  const panGesture = Gesture.Pan()
    .onStart(() => {
      console.log("👆 Pan Start");
      basePosition.current = { x: targetPosition.current.x, y: targetPosition.current.y };
    })
    .onUpdate((e) => {
      targetPosition.current.x = basePosition.current.x + e.translationX * 0.01;
      targetPosition.current.y = basePosition.current.y - e.translationY * 0.01; // 画面Y座標は3Dモデルと逆
    })
    .runOnJS(true);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      console.log("🤏 Pinch Start");
      baseScale.current = targetScale.current;
    })
    .onUpdate((e) => {
      // スケールの更新
      targetScale.current = baseScale.current * e.scale;
      // 最小・最大スケールの制限（緩和）
      targetScale.current = Math.max(0.1, Math.min(targetScale.current, 50.0));
    })
    .runOnJS(true);

  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  // 3Dモデルを読み込む関数
  const loadModel = async (gl: any) => {
    console.log("🎬 loadModel 開始");
    console.log("📐 GLView サイズ:", {
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
    });
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 5); // カメラを原点からZ軸方向に5離れた位置に
    camera.lookAt(0, 0, 0); // 原点を見る
    cameraRef.current = camera;
    console.log("📷 カメラ位置:", camera.position);

    const renderer = new Renderer({ gl });
    (renderer as any).setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    (renderer as any).setClearColor(0x000000, 0); // 透明な背景
    rendererRef.current = renderer;

    // ライトを追加
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    // GLBモデルを読み込む
    // metro.config.jsでGLBファイルをアセットとして認識させる設定を追加済み
    try {
      // アセットを読み込む（metro.config.jsでassetExtsに'glb'を追加しているためrequire可能）
      const assetModule = require("../../assets/models/920_humidifier.glb");
      const asset = Asset.fromModule(assetModule);
      await asset.downloadAsync();

      const uri = asset.localUri || asset.uri;
      console.log("📦 アセットURI:", uri);

      if (!uri) {
        console.error("❌ アセットURIが取得できませんでした");
        return;
      }

      const loader = new GLTFLoader();
      loader.load(
        uri,
        (gltf: any) => {
          const model = gltf.scene;

          // モデルの境界ボックスを正しく計算
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          console.log("📦 モデル境界ボックス:", {
            center: { x: center.x, y: center.y, z: center.z },
            size: { x: size.x, y: size.y, z: size.z },
            min: { x: box.min.x, y: box.min.y, z: box.min.z },
            max: { x: box.max.x, y: box.max.y, z: box.max.z },
          });

          // モデルを原点に移動（中心を原点に）
          model.position.sub(center);

          // モデルのサイズに応じてスケールを調整（最大サイズが2になるように）
          const maxSize = Math.max(size.x, size.y, size.z);
          if (maxSize > 0) {
            const scale = 2 / maxSize;
            model.scale.set(scale, scale, scale);
            targetScale.current = scale; // ジェスチャー用に初期スケールを保存
            console.log("📏 スケール調整:", { maxSize, scale });
          } else {
            // サイズが0の場合はデフォルトスケールを使用
            model.scale.set(1, 1, 1);
            targetScale.current = 1;
            console.log("⚠️ モデルサイズが0のため、デフォルトスケールを使用");
          }

          scene.add(model);
          modelRef.current = model;
          console.log("✅ 3Dモデル読み込み成功");
          console.log("📊 モデル位置（調整後）:", model.position);
          console.log("📊 モデルスケール（調整後）:", model.scale);
        },
        (progress) => {
          // 読み込み進捗（オプション）
          if (progress.lengthComputable) {
            const percentComplete = (progress.loaded / progress.total) * 100;
            console.log(`📥 読み込み進捗: ${percentComplete.toFixed(2)}%`);
          }
        },
        (error: any) => {
          console.error("❌ モデル読み込みエラー:", error);
          // エラーの詳細をログに出力
          console.error("エラー詳細:", JSON.stringify(error, null, 2));
        }
      );
    } catch (error: any) {
      console.error("❌ アセット読み込みエラー:", error);
      console.error("エラー詳細:", JSON.stringify(error, null, 2));
    }

    let frameCount = 0;
    const animate = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(animate);

      // モデルの位置とスケールを更新
      if (modelRef.current) {
        // modelRef.current.rotation.y += 0.01; // 自動回転は無効化
        modelRef.current.position.x = targetPosition.current.x;
        modelRef.current.position.y = targetPosition.current.y;
        modelRef.current.scale.set(
          targetScale.current,
          targetScale.current,
          targetScale.current
        );
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        (rendererRef.current as any).render(
          sceneRef.current,
          cameraRef.current
        );

        // 重要な修正：フレームの終了を通知して描画を反映させる
        gl.endFrameEXP();

        frameCount++;
        if (frameCount === 1) {
          console.log("🎨 初回レンダリング完了");
        }
      }
    };
    animate();
  };

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // バックエンドに送信する関数
  const sendToBackend = async (text: string) => {
    // チャットが停止している場合は送信しない（refを使用）
    if (!isChatActiveRef.current) {
      console.log("⚠️ チャットが停止中なので送信しません");
      return;
    }
    if (isSendingRef.current || !text.trim()) {
      console.log("⚠️ 送信中またはテキストが空なので送信しません", {
        isSending: isSendingRef.current,
        text: text.trim(),
      });
      return;
    }

    console.log("📤 バックエンドに送信:", text);
    isSendingRef.current = true;
    try {
      // バックエンドからGeminiの応答を取得
      const response = await fetch(`${BACKEND_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      });

      console.log("📥 バックエンドからの応答:", response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: "Unknown error",
          detail: "Failed to parse error response",
        }));
        console.error("❌ バックエンドエラー詳細:", errorData);
        throw new Error(
          errorData.detail
            ? `${errorData.error}: ${errorData.detail}`
            : errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      const responseText = data.text;

      console.log("✅ バックエンドからのテキスト:", responseText);

      if (!responseText) {
        throw new Error("バックエンドからの応答が空です");
      }

      // チャットが停止している場合はTTS再生しない
      if (!isChatActiveRef.current) {
        console.log("⚠️ チャットが停止中なのでTTS再生しません");
        return;
      }

      // AIの返答テキストは表示しない（ユーザーの要求により削除）

      // TTS再生前に音声認識を停止
      if (isVoiceActiveRef.current) {
        await Voice.stop();
        isVoiceActiveRef.current = false;
        // 音声認識の停止が完了するまで待つ
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      // 既存のTTSを停止
      Speech.stop();
      // TTS停止が完了するまで少し待つ
      await new Promise((resolve) => setTimeout(resolve, 100));

      isTTSPlayingRef.current = true;

      // 選択された音声を使用してTTS再生
      const selectedVoice = availableVoices[selectedVoiceIndex];
      console.log("🔊 TTS再生開始:", {
        text: responseText,
        voice: selectedVoice?.name,
        rate: speechRate,
      });
      try {
        Speech.speak(responseText, {
          language: selectedVoice?.language || "ja-JP",
          voice: selectedVoice?.identifier,
          pitch: 1.0,
          rate: speechRate,
          onDone: () => {
            console.log("✅ TTS再生完了");
            currentTTSTextRef.current = ""; // 再生完了時にクリア
            currentTTSVoiceRef.current = null;
            resumeRecording();
          },
          onStopped: () => {
            console.log("⏹️ TTS停止");
            currentTTSTextRef.current = ""; // 停止時にクリア
            currentTTSVoiceRef.current = null;
            resumeRecording();
          },
          onError: (error) => {
            console.error("❌ TTSエラー:", error);
            currentTTSTextRef.current = ""; // エラー時にクリア
            currentTTSVoiceRef.current = null;
            resumeRecording();
          },
        });
        currentTTSTextRef.current = responseText; // 再生中のテキストを保持
        currentTTSVoiceRef.current = selectedVoice || null; // 再生中の音声を保持
        isTTSPlayingRef.current = true;
      } catch (error) {
        console.error("❌ TTS再生エラー:", error);
        currentTTSTextRef.current = "";
        currentTTSVoiceRef.current = null;
        isTTSPlayingRef.current = false;
        resumeRecording();
      }
    } catch (error) {
      console.error("❌ バックエンド送信エラー:", error);
      isTTSPlayingRef.current = false;
      // エラー時も音声認識を再開（チャットがアクティブな場合のみ）
      if (!isVoiceActiveRef.current && isChatActiveRef.current) {
        await startRecording();
      }
    } finally {
      // 送信フラグをリセット（次の送信を可能にする）
      isSendingRef.current = false;
      console.log("🔄 送信フラグをリセット");
    }
  };

  // 無音タイマーをリセット
  const resetSilenceTimer = () => {
    // 既存のタイマーをクリア
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }

    // 2秒後にバックエンドに送信
    silenceTimerRef.current = setTimeout(async () => {
      // チャットが停止している場合は何もしない（refを使用）
      if (!isChatActiveRef.current) {
        console.log("⚠️ チャットが停止中なので送信タイマーをスキップ");
        return;
      }
      const finalText = transcriptRef.current;
      console.log("⏱️ 2秒経過、確定テキスト:", finalText);
      if (finalText && finalText.trim()) {
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

          // チャットがアクティブな場合のみ再開（refを使用）
          if (isChatActiveRef.current && !isVoiceActiveRef.current) {
            await Voice.start("ja-JP");
          }
        } catch (error: any) {
          isVoiceActiveRef.current = false;

          // "already started"エラーの場合は無視
          const errorMessage = error?.error?.message || error?.message || "";
          if (errorMessage.includes("already started")) {
            return;
          }

          // エラー時は1秒後に再試行（チャットがアクティブな場合のみ、refを使用）
          setTimeout(() => {
            if (isChatActiveRef.current && !isVoiceActiveRef.current) {
              startRecording();
            }
          }, 1000);
        }
      }
    }, 2000); // 2秒
  };

  // 音声認識の初期化と自動開始
  useEffect(() => {
    // 音声認識開始時
    Voice.onSpeechStart = () => {
      // チャットが停止している場合は処理しない
      if (!isChatActiveRef.current) {
        // チャットOFF時は音声認識を停止
        Voice.stop();
        isVoiceActiveRef.current = false;
        setIsRecording(false);
        return;
      }
      setIsRecording(true);
      isVoiceActiveRef.current = true;
    };

    // 音声認識の結果をリアルタイムで取得
    Voice.onSpeechResults = (e) => {
      // チャットが停止している場合は処理しない（refを使用）
      if (!isChatActiveRef.current) {
        // チャットOFF時は音声認識を停止
        Voice.stop();
        isVoiceActiveRef.current = false;
        setIsRecording(false);
        return;
      }

      if (e.value && e.value[0]) {
        const text = e.value[0];

        // TTS再生中にユーザーが話し始めたらTTSを停止
        if (isTTSPlayingRef.current) {
          Speech.stop();
          isTTSPlayingRef.current = false;

          // 音声認識を開始（既に開始されている場合はそのまま、refを使用）
          if (!isVoiceActiveRef.current && isChatActiveRef.current) {
            startRecording();
          }
        }

        setTranscript(text);
        transcriptRef.current = text; // refにも保存

        // 音声が検出されたら、無音タイマーをリセット
        resetSilenceTimer();
      }
    };

    // 音声認識が終了したタイミング（一時的な無音）
    Voice.onSpeechEnd = () => {
      // チャットが停止している場合は処理しない
      if (!isChatActiveRef.current) {
        return;
      }
    };

    // エラー処理
    Voice.onSpeechError = (e: any) => {
      const errorMessage = e?.error?.message || e?.message || "";

      // "No speech detected"エラーは無視（音声が検出されなかっただけ）
      if (errorMessage.includes("No speech detected")) {
        return;
      }

      // "already started"エラーの処理
      if (errorMessage.includes("already started")) {
        // チャットが停止している場合は状態をリセット
        if (!isChatActiveRef.current) {
          isVoiceActiveRef.current = false;
          setIsRecording(false);
          return;
        }
        isVoiceActiveRef.current = true;
        setIsRecording(true);
        return;
      }

      setIsRecording(false);
      isVoiceActiveRef.current = false;

      // エラー時も自動的に再開を試みる（チャットがアクティブで、既に開始されていない場合のみ）
      setTimeout(() => {
        if (isChatActiveRef.current && !isVoiceActiveRef.current) {
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

  // コンポーネントマウント時に利用可能な音声を取得してコンソールに表示
  useEffect(() => {
    const getVoices = async () => {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        console.log("📢 利用可能な音声一覧:", voices);

        // 日本語の音声をフィルタリング
        const japaneseVoices = voices.filter((voice) =>
          voice.language.startsWith("ja")
        );

        console.log("🇯🇵 日本語の音声:", japaneseVoices);
        console.log(`📊 日本語音声の数: ${japaneseVoices.length}`);

        // 各音声の情報を詳細に表示
        japaneseVoices.forEach((voice, index) => {
          console.log(
            `${index + 1}. ${voice.name} (${voice.language}) - ID: ${
              voice.identifier
            }`
          );
        });

        setAvailableVoices(japaneseVoices);

        // 最初の音声を選択
        if (japaneseVoices.length > 0) {
          setSelectedVoiceIndex(0);
        }
      } catch (error) {
        console.error("❌ 音声取得エラー:", error);
      }
    };

    getVoices();
  }, []);

  // 音声をテストする関数
  const testVoice = async (voiceIndex: number) => {
    if (availableVoices.length === 0) {
      console.log("音声が取得できていません");
      return;
    }

    const voice = availableVoices[voiceIndex];
    const testText = "こんにちは、これは音声テストです。";

    console.log(`🔊 音声テスト: ${voice.name} (${voice.language})`);

    Speech.stop(); // 既存のTTSを停止

    Speech.speak(testText, {
      language: voice.language,
      voice: voice.identifier,
      pitch: 1.0,
      rate: 1.0,
      onDone: () => {
        console.log(`✅ ${voice.name}の再生完了`);
      },
      onError: (error) => {
        console.error(`❌ ${voice.name}の再生エラー:`, error);
      },
    });
  };

  // 音声認識開始（再開用）
  const startRecording = async () => {
    try {
      // チャットが停止している場合は開始しない（refを使用）
      if (!isChatActiveRef.current) {
        return;
      }

      // 既に開始されている場合はスキップ
      if (isVoiceActiveRef.current) {
        return;
      }

      await Voice.start("ja-JP");
      setTranscript("");
      transcriptRef.current = "";
    } catch (error: any) {
      setIsRecording(false);
      isVoiceActiveRef.current = false;

      // "already started"エラーの場合は無視
      const errorMessage = error?.error?.message || error?.message || "";
      if (errorMessage.includes("already started")) {
        // チャットが停止している場合は状態をリセット
        if (!isChatActiveRef.current) {
          return;
        }
        isVoiceActiveRef.current = true;
        setIsRecording(true);
        return;
      }

      // エラー時は1秒後に再試行（チャットがアクティブな場合のみ）
      setTimeout(() => {
        if (isChatActiveRef.current && !isVoiceActiveRef.current) {
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

      {/* 音声選択UI */}
      {showVoiceSelector && availableVoices.length > 0 && (
        <View style={styles.voiceSelector}>
          <View style={styles.voiceSelectorHeader}>
            <ThemedText style={styles.voiceSelectorTitle}>
              音声選択 ({availableVoices.length}種類)
            </ThemedText>
            <Button
              title="閉じる"
              onPress={() => setShowVoiceSelector(false)}
              color="#FF3B30"
            />
          </View>
          <ScrollView
            style={styles.voiceList}
            showsVerticalScrollIndicator={true}
          >
            {availableVoices.map((voice, index) => (
              <View key={voice.identifier} style={styles.voiceButtonContainer}>
                <Button
                  title={`${voice.name} (${index + 1}/${
                    availableVoices.length
                  })`}
                  onPress={() => {
                    setSelectedVoiceIndex(index);
                    testVoice(index);
                    setShowVoiceSelector(false);
                  }}
                  color={selectedVoiceIndex === index ? "#007AFF" : "#E5E5EA"}
                  disabled={isChatActive}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* メインコンテンツエリア */}
      <View style={styles.contentArea}>
        {/* 左側：AR用の3Dモデルエリア */}
        <View style={styles.arArea}>
          <GestureDetector gesture={composedGesture}>
            <View style={styles.modelContainer}>
              <GLView
                key="glview-fixed" // 固定のkey
                style={styles.glView}
                onContextCreate={loadModel}
                pointerEvents="none"
              />
            </View>
          </GestureDetector>
        </View>
      </View>

      {/* 右上：自分のテキスト（リアルタイム表示） */}
      {transcript ? (
        <View style={styles.userTranscriptBubble}>
          <ThemedText style={styles.userTranscriptText}>
            {transcript}
          </ThemedText>
        </View>
      ) : null}

      {/* 下部：ボタンエリア（native-like styling） */}
      <View style={styles.buttonAreaContainer}>
        <View style={styles.buttonArea}>
          {/* チャット開始/停止ボタン */}
          <TouchableOpacity
            style={[
              styles.controlButton,
              isChatActive ? styles.controlButtonActive : null,
            ]}
            onPress={isChatActive ? stopChat : startChat}
          >
            <Ionicons
              name={isChatActive ? "mic-off" : "mic"}
              size={28}
              color={isChatActive ? "#FFF" : "#007AFF"}
            />
            <Text
              style={[
                styles.controlButtonText,
                isChatActive ? styles.controlButtonTextActive : null,
              ]}
            >
              {isChatActive ? "停止" : "開始"}
            </Text>
          </TouchableOpacity>

          {/* カメラ切り替えボタン */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => setFacing(facing === "back" ? "front" : "back")}
          >
            <Ionicons name="camera-reverse" size={28} color="#007AFF" />
            <Text style={styles.controlButtonText}>カメラ</Text>
          </TouchableOpacity>

          {/* 音声選択ボタン */}
          {availableVoices.length > 0 && (
            <TouchableOpacity
              style={styles.controlButton}
              onPress={() => setShowVoiceSelector(!showVoiceSelector)}
              disabled={isChatActive}
            >
              <Ionicons
                name="people"
                size={28}
                color={isChatActive ? "#CCC" : "#007AFF"}
              />
              <Text
                style={[
                  styles.controlButtonText,
                  isChatActive ? styles.textDisabled : null,
                ]}
              >
                音声
              </Text>
            </TouchableOpacity>
          )}

          {/* 速度切り替えボタン */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
              const currentIndex = rates.indexOf(speechRate);
              const nextIndex = (currentIndex + 1) % rates.length;
              setSpeechRate(rates[nextIndex]);
            }}
            disabled={isChatActive}
          >
            <Ionicons
              name="speedometer"
              size={28}
              color={isChatActive ? "#CCC" : "#007AFF"}
            />
            <Text
              style={[
                styles.controlButtonText,
                isChatActive ? styles.textDisabled : null,
              ]}
            >
              {speechRate.toFixed(1)}x
            </Text>
          </TouchableOpacity>
        </View>
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
    width: "100%", // 画面全体に
    height: "100%", // 画面全体に
    justifyContent: "center",
    alignItems: "center",
    position: "absolute", // 絶対配置
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "visible", // 子要素がはみ出しても表示されるように
  },
  speechBubble: {
    position: "absolute",
    top: 50,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    padding: 10,
    borderRadius: 10,
    maxWidth: 150,
    zIndex: 20, // 3Dビューより手前に表示
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
    backgroundColor: "transparent",
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
  messageText: {
    fontSize: 14,
  },
  userMessageText: {
    color: "#fff",
  },
  buttonAreaContainer: {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingVertical: 10,
    paddingHorizontal: 10,
    zIndex: 50, // 3Dビューより手前に表示
  },
  buttonArea: {
    flexDirection: "row",
    justifyContent: "space-between", // ボタン間のスペースを均等に
    alignItems: "center",
    gap: 8, // ボタン間のスペース
    flexWrap: "wrap", // 必要に応じて折り返し
  },
  message: {
    textAlign: "center",
    paddingBottom: 10,
  },
  voiceSelector: {
    position: "absolute",
    top: 50,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    padding: 15,
    zIndex: 1000,
    maxHeight: 400,
    borderRadius: 10,
    margin: 10,
  },
  voiceSelectorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  voiceSelectorTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  voiceList: {
    maxHeight: 250,
  },
  voiceButtonContainer: {
    marginBottom: 10,
    width: "100%",
  },
  userTranscriptBubble: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "rgba(0, 122, 255, 0.95)",
    padding: 12,
    borderRadius: 12,
    maxWidth: 250,
    zIndex: 20, // 3Dビューより手前に表示
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  userTranscriptText: {
    fontSize: 14,
    color: "#fff",
    lineHeight: 20,
  },
  modelContainer: {
    width: "100%",
    height: "100%",
    zIndex: 10,
    backgroundColor: "rgba(255, 255, 255, 0.01)", // タッチ判定のために完全に透明にしない
  },
  glView: {
    width: "100%",
    height: "100%",
  },
  controlButton: {
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 20,
    minWidth: 70,
    height: 70,
  },
  controlButtonActive: {
    backgroundColor: "#FF3B30",
  },
  controlButtonText: {
    fontSize: 12,
    marginTop: 4,
    color: "#007AFF",
    fontWeight: "600",
  },
  controlButtonTextActive: {
    color: "#FFF",
  },
  textDisabled: {
    color: "#CCC",
  },
});
