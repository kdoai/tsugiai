/**
 * Voice Checkout Page - Real-time voice conversation using Gemini Live API
 * Uses WebSocket for bidirectional audio streaming with ultra-low latency
 */

import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  decodeBase64,
  decodeAudioData,
  createPcmBlob,
  calculateAudioLevel,
} from "../services/audioUtils";

interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

type CallState = "connecting" | "active" | "speaking" | "ended" | "error";

export function VoiceCheckoutPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [callState, setCallState] = useState<CallState>("connecting");
  const [callDuration, setCallDuration] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentText, setCurrentText] = useState("接続中...");
  const [currentUserText, setCurrentUserText] = useState("");
  const [lastUserText, setLastUserText] = useState(""); // Keep last user message visible
  const [isComplete, setIsComplete] = useState(false);
  const [whoIsSpeaking, setWhoIsSpeaking] = useState<"ai" | "user" | "none">("none");
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [userLevel, setUserLevel] = useState(0);
  const [aiLevel, setAiLevel] = useState(0);

  // Refs for audio and connection management
  const outputContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isConnectedRef = useRef(false);
  const isMutedRef = useRef(false);

  // Keep isMutedRef in sync
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Format duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Main effect - runs once on mount
  useEffect(() => {
    if (!sessionId || isConnectedRef.current) return;
    isConnectedRef.current = true;

    let mounted = true;

    const connect = async () => {
      try {
        // Initialize audio contexts
        outputContextRef.current = new AudioContext({ sampleRate: 24000 });
        inputContextRef.current = new AudioContext({ sampleRate: 16000 });

        // Resume if suspended
        if (outputContextRef.current.state === "suspended") {
          await outputContextRef.current.resume();
        }
        if (inputContextRef.current.state === "suspended") {
          await inputContextRef.current.resume();
        }

        // Determine WebSocket URL
        const apiUrl = import.meta.env.VITE_HANDOVER_API_URL;
        let wsUrl: string;
        if (apiUrl) {
          wsUrl = apiUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + `/ws/voice/${sessionId}`;
        } else {
          const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          wsUrl = `${protocol}//${window.location.host}/ws/voice/${sessionId}`;
        }

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = async () => {
          if (!mounted) return;
          setCurrentText("接続しました。お話しください...");

          // Start timer
          callStartTimeRef.current = Date.now();
          timerRef.current = setInterval(() => {
            if (callStartTimeRef.current) {
              setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
            }
          }, 1000);

          // Start audio capture
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!mounted) {
              stream.getTracks().forEach(t => t.stop());
              return;
            }
            streamRef.current = stream;

            const ctx = inputContextRef.current;
            if (!ctx || ctx.state === "closed") return;

            const source = ctx.createMediaStreamSource(stream);
            // Use small buffer size (512 samples = 32ms) for low-latency streaming
            // Google recommends 20-40ms chunks for Gemini Live API
            const scriptProcessor = ctx.createScriptProcessor(512, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              // Don't send audio when muted or disconnected
              if (isMutedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                return;
              }

              const inputData = e.inputBuffer.getChannelData(0);
              const level = calculateAudioLevel(inputData);
              setUserLevel(level);

              // Always send audio - let Gemini's VAD handle speech detection
              const pcmBlob = createPcmBlob(inputData);
              wsRef.current.send(JSON.stringify({
                type: "audio",
                media: pcmBlob,
              }));
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(ctx.destination);

            setCallState("active");
          } catch (err) {
            console.error("Error starting audio capture:", err);
            setError("マイクへのアクセスが許可されていません");
            setCallState("error");
          }
        };

        ws.onmessage = async (event) => {
          if (!mounted) return;
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case "ready":
                // Setup complete, AI will start speaking
                setCurrentText("AIが話し始めます...");
                setCallState("speaking");
                break;

              case "audio":
                // Play received audio
                if (outputContextRef.current && outputContextRef.current.state !== "closed") {
                  try {
                    const ctx = outputContextRef.current;
                    const audioData = decodeBase64(data.data);
                    const audioBuffer = await decodeAudioData(audioData, ctx, 24000, 1);

                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;

                    const analyzer = ctx.createAnalyser();
                    analyzer.fftSize = 32;
                    const dataArray = new Uint8Array(analyzer.frequencyBinCount);

                    source.connect(analyzer);
                    analyzer.connect(ctx.destination);

                    const updateLevel = () => {
                      if (source.buffer && sourcesRef.current.has(source)) {
                        analyzer.getByteFrequencyData(dataArray);
                        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                        setAiLevel(avg / 255);
                        requestAnimationFrame(updateLevel);
                      }
                    };
                    updateLevel();

                    source.addEventListener("ended", () => {
                      sourcesRef.current.delete(source);
                      if (sourcesRef.current.size === 0) {
                        setAiLevel(0);
                      }
                    });

                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sourcesRef.current.add(source);

                    setCallState("speaking");
                  } catch (err) {
                    console.error("Error playing audio:", err);
                  }
                }
                break;

              case "transcript_partial":
                // Real-time partial transcription
                if (data.role === "assistant") {
                  setCurrentText(data.text);
                  setWhoIsSpeaking("ai");
                } else if (data.role === "user") {
                  setCurrentUserText(data.text);
                  setWhoIsSpeaking("user");
                }
                break;

              case "transcript":
                // Final complete transcription
                const entry: TranscriptEntry = {
                  id: `${data.role}-${Date.now()}`,
                  role: data.role,
                  text: data.text,
                  timestamp: new Date(),
                };
                setTranscript((prev) => [...prev, entry]);
                if (data.role === "assistant") {
                  setCurrentText(data.text);
                  setWhoIsSpeaking("ai");
                }
                if (data.role === "user") {
                  // Keep user's message visible instead of clearing immediately
                  setLastUserText(data.text);
                  setCurrentUserText(""); // Clear partial text
                }
                if (
                  data.role === "assistant" &&
                  (data.text.includes("確認は終了です") || data.text.includes("お疲れ様でした"))
                ) {
                  setIsComplete(true);
                }
                break;

              case "interrupted":
                // User interrupted AI - stop current audio playback
                sourcesRef.current.forEach((source) => {
                  try { source.stop(); } catch (e) { /* ignore */ }
                });
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                setAiLevel(0);
                break;

              case "turn_complete":
                // AI finished speaking
                setCallState("active");
                setWhoIsSpeaking("none");
                break;

              case "error":
                setError(data.message);
                setCallState("error");
                break;
            }
          } catch (err) {
            console.error("Error processing message:", err);
          }
        };

        ws.onerror = () => {
          if (!mounted) return;
          console.error("WebSocket error");
          setError("接続エラーが発生しました");
          setCallState("error");
        };

        ws.onclose = (event) => {
          if (!mounted) return;
          if (event.code === 4004) {
            setError("セッションが見つかりません");
          }
        };

      } catch (err) {
        console.error("Connection error:", err);
        if (mounted) {
          setError("接続に失敗しました");
          setCallState("error");
        }
      }
    };

    connect();

    // Cleanup function
    return () => {
      mounted = false;

      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try { wsRef.current.close(); } catch (e) { /* ignore */ }
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (scriptProcessorRef.current) {
        try { scriptProcessorRef.current.disconnect(); } catch (e) { /* ignore */ }
      }

      if (outputContextRef.current && outputContextRef.current.state !== "closed") {
        try { outputContextRef.current.close(); } catch (e) { /* ignore */ }
      }

      if (inputContextRef.current && inputContextRef.current.state !== "closed") {
        try { inputContextRef.current.close(); } catch (e) { /* ignore */ }
      }

      sourcesRef.current.forEach((source) => {
        try { source.stop(); } catch (e) { /* ignore */ }
      });
    };
  }, [sessionId]);

  // Handle end call
  const handleEndCall = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end" }));
      wsRef.current.close();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    sourcesRef.current.forEach((source) => {
      try { source.stop(); } catch (e) { /* ignore */ }
    });

    setCallState("ended");
    setIsComplete(true);
  };

  // Handle mute toggle
  const toggleMute = () => {
    setIsMuted((prev) => !prev);
    if (!isMuted) {
      setUserLevel(0);
    }
  };

  // Get state text
  const getStateText = () => {
    switch (callState) {
      case "connecting":
        return "接続中...";
      case "active":
        return "お話しください";
      case "speaking":
        return "AI応答中...";
      case "ended":
        return "通話終了";
      case "error":
        return "エラー";
      default:
        return "";
    }
  };

  return (
    <div className="flex flex-col h-dvh bg-gradient-to-b from-slate-900 to-slate-800">
      {/* Call header */}
      <div className="safe-area-inset-top px-6 pt-8 pb-4 text-center">
        <p className="text-slate-400 text-sm">{getStateText()}</p>
        <h1 className="text-white text-2xl font-medium mt-1">引継ぎAI</h1>
        <p className="text-emerald-400 text-lg font-mono mt-2 tabular-nums">
          {formatDuration(callDuration)}
        </p>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Avatar / Visualizer - Shows AI or User based on who is speaking */}
        <div className="relative mb-8 flex items-center gap-6">
          {/* AI Avatar */}
          <div
            className={`size-28 rounded-full flex items-center justify-center transition-all duration-150 ${
              whoIsSpeaking === "ai" || callState === "speaking"
                ? "bg-gradient-to-br from-violet-500 to-purple-600 ring-4 ring-violet-400/50"
                : "bg-gradient-to-br from-violet-400/50 to-purple-500/50"
            }`}
            style={{
              transform: `scale(${whoIsSpeaking === "ai" ? 1 + aiLevel * 0.3 : 1})`,
            }}
          >
            {/* AI Icon - Sound wave bars */}
            <div className="flex items-center justify-center gap-[5px] h-14">
              {[0, 1, 2, 3, 4].map((i) => {
                const isActive = whoIsSpeaking === "ai" || callState === "speaking";
                const staticHeights = [14, 22, 32, 22, 14];
                return (
                  <div
                    key={i}
                    className="w-[5px] rounded-full bg-white/90"
                    style={{
                      height: isActive ? undefined : staticHeights[i],
                      animation: isActive
                        ? `voiceBar 0.8s ease-in-out ${i * 0.12}s infinite alternate`
                        : "none",
                      transition: "height 0.3s ease",
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* User Avatar */}
          <div
            className={`size-28 rounded-full flex items-center justify-center transition-all duration-150 ${
              whoIsSpeaking === "user" || userLevel > 0.02
                ? "bg-gradient-to-br from-blue-500 to-cyan-600 ring-4 ring-blue-400/50"
                : "bg-gradient-to-br from-blue-400/50 to-cyan-500/50"
            }`}
            style={{
              transform: `scale(${whoIsSpeaking === "user" || userLevel > 0.02 ? 1 + userLevel * 0.3 : 1})`,
            }}
          >
            {/* User Icon */}
            <svg className="size-14 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        </div>

        {/* Speaking indicator */}
        <div className="mb-4 h-6 flex items-center justify-center">
          {whoIsSpeaking === "ai" && (
            <span className="text-violet-400 text-sm flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
              </span>
              AIが話しています
            </span>
          )}
          {(whoIsSpeaking === "user" || userLevel > 0.02) && (
            <span className="text-blue-400 text-sm flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              あなたが話しています
            </span>
          )}
        </div>

        {/* Current message display */}
        <div className="w-full max-w-md px-4 space-y-3">
          {/* User's message - show current partial OR last completed message */}
          {(currentUserText || lastUserText) && (
            <div className={`rounded-2xl p-4 border transition-all ${
              currentUserText
                ? "bg-blue-900/40 border-blue-500/50"
                : "bg-blue-900/20 border-blue-500/20"
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="size-6 rounded-full bg-blue-500 flex items-center justify-center">
                  <svg className="size-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <span className="text-xs text-blue-400 font-medium">あなた</span>
                {currentUserText && (
                  <span className="text-xs text-blue-300 animate-pulse">入力中...</span>
                )}
              </div>
              <p className="text-blue-100 text-sm leading-relaxed pl-8">
                {currentUserText || lastUserText}
              </p>
            </div>
          )}

          {/* AI's current text */}
          <div className={`rounded-2xl p-4 transition-all ${
            whoIsSpeaking === "ai"
              ? "bg-violet-900/40 border border-violet-500/50"
              : "bg-slate-800/50 border border-slate-700/50"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <div className="size-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center gap-[2px]">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-[2px] rounded-full bg-white/90"
                    style={{
                      height: [4, 8, 4][i],
                      animation: whoIsSpeaking === "ai"
                        ? `voiceBar 0.6s ease-in-out ${i * 0.1}s infinite alternate`
                        : "none",
                    }}
                  />
                ))}
              </div>
              <span className="text-xs text-violet-400 font-medium">引継ぎAI</span>
              {whoIsSpeaking === "ai" && (
                <span className="text-xs text-violet-300 animate-pulse">応答中...</span>
              )}
            </div>
            <p className="text-white text-sm leading-relaxed pl-8 min-h-[40px]">
              {currentText || "..."}
            </p>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
      </div>

      {/* Call controls */}
      <div className="safe-area-inset-bottom px-6 pb-8">
        {isComplete ? (
          <div className="space-y-3">
            <button
              onClick={() => navigate(`/checkout/${sessionId}`)}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-medium transition-colors"
            >
              チェックアウトに戻る
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-6">
            {/* Mute/Unmute button */}
            <button
              onClick={toggleMute}
              className={`size-14 rounded-full flex items-center justify-center transition-colors ${
                isMuted ? "bg-red-500 hover:bg-red-400" : "bg-slate-700 hover:bg-slate-600"
              }`}
            >
              {isMuted ? (
                <svg className="size-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                </svg>
              ) : (
                <svg className="size-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>

            {/* Status indicator */}
            <div
              className={`size-20 rounded-full flex items-center justify-center transition-all ${
                callState === "active"
                  ? "bg-emerald-500"
                  : callState === "speaking"
                    ? "bg-blue-500"
                    : callState === "connecting"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-slate-600"
              }`}
              style={{ transform: `scale(${1 + userLevel * 0.2})` }}
            >
              {callState === "connecting" ? (
                <svg className="size-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="size-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </div>

            {/* End call button */}
            <button
              onClick={handleEndCall}
              className="size-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-colors"
            >
              <svg className="size-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.28 3H5z" />
              </svg>
            </button>
          </div>
        )}

        {/* Transcript toggle */}
        {!isComplete && (
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="w-full mt-4 py-2 text-slate-400 text-sm"
          >
            {showTranscript ? "テキストログを隠す" : "テキストログを表示"}
          </button>
        )}
      </div>

      {/* Transcript panel */}
      {showTranscript && (
        <div className="absolute inset-x-0 top-28 bottom-48 bg-slate-900/95 rounded-3xl mx-4 border border-slate-700">
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
              <h2 className="text-white font-medium">会話ログ</h2>
              <button
                onClick={() => setShowTranscript(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {transcript.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                      entry.role === "user" ? "bg-emerald-600 text-white" : "bg-slate-700 text-white"
                    }`}
                  >
                    <p className="text-sm">{entry.text}</p>
                    <p className="text-xs opacity-60 mt-1">
                      {entry.timestamp.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
              {transcript.length === 0 && (
                <p className="text-slate-500 text-center text-sm">会話が始まるとここに表示されます</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
