"use client";

import { useAuth } from "@/lib/auth/AuthProvider";
import { userAvatarUrl, getMenu, sessionUserId } from "@/lib/auth/session";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { IconLabel } from "@/components/ui/Icon";
import { ShellErrorBoundary } from "@/components/shell/ShellErrorBoundary";

export function AppShell({ children: _children }: { children: React.ReactNode }) {
  const { user, menu, displayName, signOut, ready } = useAuth();
  const askMenu = menu.length > 0 ? menu : getMenu();

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#111827] text-slate-200">
        Restoring session…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#111827] text-slate-200">
        Redirecting to sign in…
      </div>
    );
  }

  return (
    <ShellErrorBoundary>
      <div className="flex h-dvh flex-col bg-[#f4f7fb]">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
          <div>
            <p className="text-sm font-medium text-slate-800">TEB Ask</p>
            <p className="text-xs text-slate-500">Ask about your live TEB data</p>
          </div>
          <div className="flex items-center gap-3">
            {userAvatarUrl(user) ? (
              <img src={userAvatarUrl(user)!} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#086fb8] text-xs font-semibold text-white">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="hidden text-sm text-slate-700 sm:inline">{displayName}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              <IconLabel icon="logout">Sign out</IconLabel>
            </button>
          </div>
        </header>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatPanel key={sessionUserId(user) || displayName} user={user} menu={askMenu} />
        </main>
      </div>
    </ShellErrorBoundary>
  );
}
