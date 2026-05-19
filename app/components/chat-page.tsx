import { useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ChatComposer } from "@/components/chat-composer";
import { ChatTimeline } from "@/components/chat-timeline";
import { useChatUi } from "@/components/chat-ui-context";
import { sessionIdFromPath } from "@/components/chat-page-helpers";
import { SubSessionDrawer } from "@/components/sub-session-drawer";
import { ThemeSync } from "@/components/theme-sync";
import { useChatController } from "@/components/use-chat-controller";
import type { WebStateDto } from "@/server/dto";

export function ChatPage({ initialState }: { initialState: WebStateDto }) {
  const navigate = useNavigate();
  const location = useLocation();
  const routeSessionId = useMemo(() => sessionIdFromPath(location.pathname), [location.pathname]);
  const resolvedInitialSessionId = routeSessionId ?? initialState.activeSessionId;
  const initialPage = useMemo(
    () => initialState.messagePage ?? {
      items: initialState.messages.map((message, index) => ({
        id: `initial-${message.createdAt}-${index}`,
        message,
      })),
      oldestId: null,
      newestId: null,
      hasMoreBefore: false,
    },
    [initialState.messagePage, initialState.messages],
  );
  const navigateToSession = useCallback(
    (sessionId: string) => navigate({
      to: "/chat/$sessionId",
      params: { sessionId },
    }),
    [navigate],
  );
  const chat = useChatController({
    initialState,
    resolvedInitialSessionId,
    initialPage,
    navigateToSession,
  });
  const { details } = useChatUi();

  return (
    <section className="app-chat-page mx-auto flex min-h-screen w-full flex-col pt-24">
      <ThemeSync ui={initialState.settings.ui} />
      {chat.activeSession?.parentSessionId ? (
        <header className="app-chat-header">
          <Link
            to="/chat/$sessionId"
            params={{ sessionId: chat.activeSession.parentSessionId }}
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
          >
            <ArrowLeft className="h-3 w-3" /> back to parent
          </Link>
        </header>
      ) : null}

      <div className={`${chat.activeSession?.parentSessionId ? "mt-5 " : ""}app-chat-timeline flex flex-1 flex-col gap-5`}>
        <ChatTimeline
          messages={chat.messages}
          activities={chat.activities}
          permissionRequests={chat.permissionRequests}
          retryableTasks={chat.retryableChatTasks}
          retryingTaskIds={chat.retryingTaskIds}
          details={details}
          sending={chat.sessionBusy}
          retryDisabled={chat.sessionBusy}
          resetKey={chat.activeSessionId}
          hasMoreBefore={chat.hasMoreBefore}
          loadingMore={chat.loadingMore}
          onLoadMore={chat.loadMoreMessages}
          subSessions={chat.childSessions}
          onOpenSession={(session) => chat.setPreviewSessionId(session.conversationId)}
          onPermissionDecision={chat.handlePermissionDecision}
          onPermissionRetry={(message) => void chat.retryPermission(message)}
          onRetryTask={(taskId) => void chat.retryFailedTask(taskId)}
        />
      </div>

      <ChatComposer
        input={chat.input}
        sending={chat.sessionBusy}
        pendingMessages={chat.pendingMessages}
        selectedSkills={chat.selectedSkills}
        onPendingDelete={chat.deletePendingMessage}
        onPendingEdit={chat.editPendingMessage}
        onInputChange={chat.setInput}
        onSelectedSkillsChange={chat.setSelectedSkills}
        onSubmit={() => void chat.submit()}
        onStop={chat.stop}
      />

      <SubSessionDrawer
        session={chat.previewSession}
        onClose={() => chat.setPreviewSessionId(null)}
      />
    </section>
  );
}
