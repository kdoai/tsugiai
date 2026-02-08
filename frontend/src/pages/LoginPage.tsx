/**
 * Login Page - Magic Link, Google authentication, and System admin login
 */

import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth } from "../contexts/AuthContext";
import { isSystemLoginAllowed, sendMagicLink } from "../lib/firebase";

type LoginTab = "general" | "system";
type GeneralLoginMode = "options" | "email" | "emailSent";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signInWithGoogle, signInWithEmail, isAuthenticated, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<LoginTab>("general");
  const [generalLoginMode, setGeneralLoginMode] = useState<GeneralLoginMode>("options");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemLoginEnabled, setSystemLoginEnabled] = useState<boolean>(true);

  // Email for magic link
  const [magicLinkEmail, setMagicLinkEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");

  // System login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Check if system login is enabled
  useEffect(() => {
    const checkSystemLogin = async () => {
      try {
        const allowed = await isSystemLoginAllowed();
        setSystemLoginEnabled(allowed);
      } catch (err) {
        console.error("Failed to check system login status:", err);
        setSystemLoginEnabled(true);
      }
    };
    checkSystemLogin();
  }, []);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const from = (location.state as { from?: string })?.from || "/";
      navigate(from, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, location.state]);

  // Get the redirect path from location state, default to home
  const from = (location.state as { from?: string })?.from || "/";

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setError(null);

    try {
      await signInWithGoogle();
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error("Sign-in error:", err);
      if (err.code === "auth/popup-closed-by-user") {
        setError("ログインがキャンセルされました");
      } else if (err.code === "auth/popup-blocked") {
        setError("ポップアップがブロックされました。ポップアップを許可してください。");
      } else {
        setError("ログインに失敗しました。もう一度お試しください。");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!magicLinkEmail) {
      setError("メールアドレスを入力してください");
      return;
    }

    setIsSigningIn(true);
    setError(null);

    try {
      await sendMagicLink(magicLinkEmail);
      setSentEmail(magicLinkEmail);
      setGeneralLoginMode("emailSent");
    } catch (err: any) {
      console.error("Magic link error:", err);
      if (err.code === "auth/invalid-email") {
        setError("メールアドレスの形式が正しくありません");
      } else {
        setError("メール送信に失敗しました。もう一度お試しください。");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSystemSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("メールアドレスとパスワードを入力してください");
      return;
    }

    setIsSigningIn(true);
    setError(null);

    try {
      await signInWithEmail(email, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error("Sign-in error:", err);
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        setError("メールアドレスまたはパスワードが正しくありません");
      } else if (err.code === "auth/invalid-email") {
        setError("メールアドレスの形式が正しくありません");
      } else if (err.code === "auth/too-many-requests") {
        setError("ログイン試行回数が多すぎます。しばらく待ってから再試行してください。");
      } else {
        setError("ログインに失敗しました。もう一度お試しください。");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const resetGeneralLogin = () => {
    setGeneralLoginMode("options");
    setMagicLinkEmail("");
    setSentEmail("");
    setError(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="size-8 spinner" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-sm">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-16 bg-primary-600 text-white rounded-2xl mb-4">
            <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#202124]">TSUGIAI</h1>
          <p className="text-[#5f6368] mt-2">
            AI引継ぎチェックリストシステム
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-xl border border-[#dadce0] shadow-sm overflow-hidden">
          {/* Tabs - only show if system login is enabled */}
          {systemLoginEnabled && (
            <div className="flex border-b border-[#dadce0]">
              <button
                onClick={() => { setActiveTab("general"); resetGeneralLogin(); }}
                className={clsx(
                  "flex-1 py-3 text-sm font-medium transition-colors",
                  activeTab === "general"
                    ? "text-primary-600 border-b-2 border-primary-600 bg-primary-50/50"
                    : "text-[#5f6368] hover:text-[#202124] hover:bg-[#f8f9fa]"
                )}
              >
                ログイン
              </button>
              <button
                onClick={() => { setActiveTab("system"); setError(null); }}
                className={clsx(
                  "flex-1 py-3 text-sm font-medium transition-colors",
                  activeTab === "system"
                    ? "text-primary-600 border-b-2 border-primary-600 bg-primary-50/50"
                    : "text-[#5f6368] hover:text-[#202124] hover:bg-[#f8f9fa]"
                )}
              >
                デモ用ログイン
              </button>
            </div>
          )}

          <div className="p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-[#d93025]">
                {error}
              </div>
            )}

            {(activeTab === "general" || !systemLoginEnabled) ? (
              <>
                {generalLoginMode === "options" && (
                  <>
                    <h2 className="text-lg font-medium text-[#202124] text-center mb-6">
                      ログイン方法を選択
                    </h2>

                    {/* Google Sign-in Button */}
                    <button
                      onClick={handleGoogleSignIn}
                      disabled={isSigningIn}
                      className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-[#dadce0] rounded-lg hover:bg-[#f8f9fa] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSigningIn ? (
                        <div className="size-5 spinner" />
                      ) : (
                        <svg className="size-5" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          />
                        </svg>
                      )}
                      <span className="text-[#202124] font-medium">
                        {isSigningIn ? "ログイン中..." : "Googleでログイン"}
                      </span>
                    </button>

                    <div className="relative my-6">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-[#dadce0]" />
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="bg-white px-4 text-[#5f6368]">または</span>
                      </div>
                    </div>

                    {/* Email Magic Link Button */}
                    <button
                      onClick={() => setGeneralLoginMode("email")}
                      disabled={isSigningIn}
                      className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-[#dadce0] rounded-lg hover:bg-[#f8f9fa] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <svg className="size-5 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="text-[#202124] font-medium">
                        メールアドレスでログイン
                      </span>
                    </button>
                  </>
                )}

                {generalLoginMode === "email" && (
                  <>
                    <button
                      onClick={resetGeneralLogin}
                      className="flex items-center gap-1 text-sm text-[#5f6368] hover:text-[#202124] mb-4"
                    >
                      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      戻る
                    </button>

                    <h2 className="text-lg font-medium text-[#202124] text-center mb-2">
                      メールアドレスでログイン
                    </h2>
                    <p className="text-sm text-[#5f6368] text-center mb-6">
                      ログインリンクをメールで送信します
                    </p>

                    <form onSubmit={handleSendMagicLink} className="space-y-4">
                      <div>
                        <label htmlFor="magicLinkEmail" className="block text-sm font-medium text-[#202124] mb-1">
                          メールアドレス
                        </label>
                        <input
                          id="magicLinkEmail"
                          type="email"
                          value={magicLinkEmail}
                          onChange={(e) => setMagicLinkEmail(e.target.value)}
                          placeholder="example@company.com"
                          className="input"
                          disabled={isSigningIn}
                          autoFocus
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isSigningIn || !magicLinkEmail}
                        className="w-full btn btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSigningIn ? (
                          <span className="flex items-center justify-center gap-2">
                            <div className="size-4 spinner border-white/30 border-t-white" />
                            送信中...
                          </span>
                        ) : (
                          "ログインリンクを送信"
                        )}
                      </button>
                    </form>
                  </>
                )}

                {generalLoginMode === "emailSent" && (
                  <>
                    <div className="text-center">
                      <div className="inline-flex items-center justify-center size-16 bg-green-100 text-green-600 rounded-full mb-4">
                        <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76" />
                        </svg>
                      </div>
                      <h2 className="text-lg font-medium text-[#202124] mb-2">
                        メールを送信しました
                      </h2>
                      <p className="text-sm text-[#5f6368] mb-4">
                        <span className="font-medium text-[#202124]">{sentEmail}</span>
                        <br />
                        にログインリンクを送信しました。
                      </p>
                      <p className="text-xs text-[#5f6368] mb-6">
                        メールに記載されたリンクをクリックしてログインしてください。
                        <br />
                        メールが届かない場合は、迷惑メールフォルダをご確認ください。
                      </p>

                      <div className="space-y-3">
                        <button
                          onClick={() => {
                            setMagicLinkEmail(sentEmail);
                            setGeneralLoginMode("email");
                          }}
                          className="w-full btn btn-secondary py-2"
                        >
                          再送信する
                        </button>
                        <button
                          onClick={resetGeneralLogin}
                          className="w-full text-sm text-[#5f6368] hover:text-[#202124]"
                        >
                          別の方法でログイン
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <h2 className="text-lg font-medium text-[#202124] text-center mb-6">
                  デモ用ログイン
                </h2>

                <form onSubmit={handleSystemSignIn} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-[#202124] mb-1">
                      メールアドレス
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@example.com"
                      className="input"
                      disabled={isSigningIn}
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-[#202124] mb-1">
                      パスワード
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="input"
                      disabled={isSigningIn}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSigningIn}
                    className="w-full btn btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSigningIn ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="size-4 spinner border-white/30 border-t-white" />
                        ログイン中...
                      </span>
                    ) : (
                      "ログイン"
                    )}
                  </button>
                </form>

                <p className="mt-4 text-xs text-center text-[#5f6368]">
                  デモ用アカウントでログインしてください
                </p>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-[#9aa0a6]">
          Powered by Firebase Authentication
        </p>
      </div>
    </div>
  );
}
