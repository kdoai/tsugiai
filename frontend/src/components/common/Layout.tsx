import { useState, useEffect } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth } from "../../contexts/AuthContext";
import { inboxApi } from "../../services/handoverApi";

// Navigation item type
interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
  hasNotification?: boolean;
}

// Navigation items
const navItems: NavItem[] = [
  {
    to: "/",
    label: "ホーム",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    ),
    exact: true,
  },
  {
    to: "/checkout",
    label: "チェックアウト",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    ),
  },
  {
    to: "/templates",
    label: "テンプレート",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
      />
    ),
  },
  {
    to: "/handovers",
    label: "引継ぎ一覧",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    ),
  },
  {
    to: "/inbox",
    label: "受信ボックス",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
      />
    ),
    hasNotification: true,
  },
];

export function Layout() {
  const location = useLocation();
  const { user, signOut, isViewer, userRole } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);

  // Fetch inbox unread count
  useEffect(() => {
    const fetchInboxCount = async () => {
      if (!user) return;
      try {
        const result = await inboxApi.getUnreadCount();
        setInboxCount(result.count);
      } catch (error) {
        console.error("Failed to fetch inbox count:", error);
      }
    };

    fetchInboxCount();
    // Refresh every 30 seconds
    const interval = setInterval(fetchInboxCount, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  // Hide sidebar during checkout sessions for immersive experience
  const isCheckoutSession = location.pathname.match(/^\/checkout\/[^/]+$/);

  if (isCheckoutSession) {
    return (
      <div className="min-h-dvh bg-[#f8f9fa]">
        <div className="p-4 sm:p-6">
          <Outlet />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#f8f9fa]">
      {/* Top Header Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 h-12 bg-slate-900 border-b border-slate-700">
        <div className="flex items-center justify-between h-full px-4">
          {/* Left: Menu button (mobile) + Logo */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-1.5 rounded hover:bg-slate-800 transition-colors"
              aria-label="メニューを開く"
            >
              <svg className="size-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Link to="/" className="flex items-center gap-2">
              <div className="size-7 rounded bg-blue-600 flex items-center justify-center">
                <svg className="size-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  />
                </svg>
              </div>
              <span className="text-sm font-semibold text-white tracking-wide">TSUGIAI</span>
            </Link>
          </div>

          {/* Right: Utility icons */}
          <div className="flex items-center gap-3">
            {/* User Menu */}
            {user && (
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-800 transition-colors"
                  aria-label="ユーザーメニュー"
                >
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || "ユーザー"}
                      className="size-7 rounded-full border border-slate-600"
                    />
                  ) : (
                    <div className="size-7 rounded-full bg-slate-600 flex items-center justify-center">
                      <span className="text-xs text-white font-medium">
                        {user.displayName?.[0] || user.email?.[0] || "U"}
                      </span>
                    </div>
                  )}
                  <svg className="size-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {showUserMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUserMenu(false)}
                    />
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg border border-slate-200 shadow-lg z-50">
                      <div className="p-3 border-b border-slate-100">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {user.displayName || "ユーザー"}
                          </p>
                          {userRole === "admin" && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">
                              管理者
                            </span>
                          )}
                          {userRole === "viewer" && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                              参照
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {user.email}
                        </p>
                      </div>
                      <div className="p-1">
                        <button
                          onClick={() => {
                            setShowUserMenu(false);
                            handleSignOut();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                        >
                          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          ログアウト
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed top-12 left-0 z-40 h-[calc(100dvh-3rem)] w-56 bg-white border-r border-slate-200 transition-transform duration-200 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <nav className="flex flex-col h-full">
          {/* Main navigation */}
          <div className="flex-1 py-4 overflow-y-auto">
            <ul className="space-y-0.5 px-2">
              {navItems
                .filter((item) => {
                  // viewerはテンプレートを非表示
                  if (isViewer && item.to === "/templates") {
                    return false;
                  }
                  return true;
                })
                .map((item) => {
                const active = isActive(item.to, item.exact);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={() => setSidebarOpen(false)}
                      className={clsx(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors relative",
                        active
                          ? "bg-blue-50 text-blue-700"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      )}
                    >
                      {/* Active indicator */}
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-blue-600 rounded-r" />
                      )}
                      <svg className="size-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        {item.icon}
                      </svg>
                      <span className="flex-1">{item.label}</span>
                      {/* Inbox notification badge */}
                      {item.hasNotification && inboxCount > 0 && (
                        <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-medium flex items-center justify-center">
                          {inboxCount > 99 ? "99+" : inboxCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}

              {/* Settings (All users) */}
              <li className="mt-4 pt-4 border-t border-slate-200">
                <Link
                  to="/settings"
                  onClick={() => setSidebarOpen(false)}
                  className={clsx(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors relative",
                    isActive("/settings")
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  {isActive("/settings") && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-blue-600 rounded-r" />
                  )}
                  <svg className="size-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span>設定</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Footer */}
          <div className="border-t border-slate-200 p-4">
            <p className="text-xs text-slate-400 text-center text-pretty">
              作業終了チェック＆引継ぎAI
            </p>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <main className="lg:pl-56 pt-12 min-h-dvh">
        <div className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
