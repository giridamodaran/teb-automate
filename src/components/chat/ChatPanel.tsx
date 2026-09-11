"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runReportQuestion } from "@/lib/chat/execute";
import { isGreeting } from "@/lib/chat/parse";
import type { ReportIntent, ReportResult } from "@/lib/chat/types";
import {
  appPrompt,
  historyTurns,
  HOME_PROMPT,
  isHomeCommand,
  journeysForUser,
  looksLikeSearch,
  matchApp,
  matchTopic,
  questionsFor,
  readStoredJourney,
  seedJourneyIntent,
  writeStoredJourney,
  clearStoredJourney,
  type AskAppJourney,
  type JourneyTopic,
  type JourneyTopicId,
} from "@/lib/chat/journey";
import type { TebMenuApp, TebUserDetail } from "@/lib/api/types";
import { userFacingAskError } from "@/lib/chat/user-copy";
import { formatAmount } from "@/lib/money";
import { sessionUserId } from "@/lib/auth/session";
import { Icon } from "@/components/ui/Icon";
import { ReportCharts } from "@/components/chat/ReportCharts";
import { WorkforceMap } from "@/components/chat/WorkforceMap";
import { QuoteViewBlock } from "@/components/chat/QuoteViewBlock";
import type { PartyCard, PartyProfile, QuoteCard } from "@/lib/chat/types";

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      result?: ReportResult;
      apps?: AskAppJourney[];
      topics?: JourneyTopic[];
      questions?: string[];
      journeyAppCode?: string;
      showApps?: boolean;
    };

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function restoreJourney(userId: string): {
  messages: ChatMessage[];
  appCode: string | null;
  topicId: JourneyTopicId | null;
  intent: ReportIntent | null;
} {
  const empty = {
    messages: [{ id: "welcome", role: "assistant" as const, text: HOME_PROMPT, showApps: true }] as ChatMessage[],
    appCode: null,
    topicId: null,
    intent: null,
  };
  try {
    const saved = readStoredJourney(userId);
    const hasThread = Boolean(saved?.messages.some((row) => row.role === "user") || saved?.appCode);
    if (!hasThread || !saved) return empty;
    return {
      messages: saved.messages.map((row) =>
        row.role === "assistant" && (row.apps != null || row.showApps)
          ? { ...row, role: "assistant" as const, text: row.id === "welcome" ? HOME_PROMPT : row.text, showApps: true }
          : row,
      ) as ChatMessage[],
      appCode: saved.appCode,
      topicId: saved.topicId,
      intent: saved.intent,
    };
  } catch {
    return empty;
  }
}

function ChannelLink({ channel }: { channel: PartyCard["phones"][number] }) {
  return (
    <a
      href={channel.href}
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-[#086fb8] hover:border-[#086fb8]"
    >
      <Icon name={channel.kind === "phone" ? "call" : "mail"} size={13} />
      <span>{channel.value}</span>
    </a>
  );
}

function PartyCardView({
  card,
  busy,
  onAsk,
}: {
  card: PartyCard;
  busy: boolean;
  onAsk: (question: string) => void;
}) {
  const meta = [card.subtitle, card.owner, card.location, card.industry].filter(Boolean);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
      <p className="text-[13px] font-semibold text-slate-900">{card.name}</p>
      {meta.length ? <p className="mt-0.5 text-[11px] text-slate-500">{meta.join(" · ")}</p> : null}
      {card.phones.length || card.emails.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.phones.map((channel) => (
            <ChannelLink key={`${card.id}-p-${channel.href}`} channel={channel} />
          ))}
          {card.emails.map((channel) => (
            <ChannelLink key={`${card.id}-e-${channel.href}`} channel={channel} />
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">No phone or email on this record.</p>
      )}
      <div className="mt-1.5">
        <Chip
          label="View profile"
          disabled={busy}
          onClick={() => onAsk(`View ${card.kind} profile for ${card.name}`)}
        />
      </div>
    </div>
  );
}

function PartyProfileView({
  profile,
  busy,
  onAsk,
}: {
  profile: PartyProfile;
  busy: boolean;
  onAsk: (question: string) => void;
}) {
  return (
    <div className="space-y-2">
      <PartyCardView card={profile} busy={busy} onAsk={onAsk} />
      {profile.fields.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px]">
          {profile.fields.map((field) => (
            <div key={field.label} className="contents">
              <dt className="text-slate-500">{field.label}</dt>
              <dd className="text-slate-800">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {profile.companyName && profile.kind === "contact" ? (
        <Chip
          label={`View company profile`}
          disabled={busy}
          onClick={() => onAsk(`View company profile for ${profile.companyName}`)}
        />
      ) : null}
      {profile.related.length ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">People</p>
          {profile.related.slice(0, 6).map((card) => (
            <PartyCardView key={card.id} card={card} busy={busy} onAsk={onAsk} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OpenInTeb({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-[#086fb8] hover:border-[#086fb8]"
    >
      <Icon name="open_in_new" size={13} />
      Open in TEB
    </a>
  );
}

function QuoteCardView({
  card,
  busy,
  onAsk,
}: {
  card: QuoteCard;
  busy: boolean;
  onAsk: (question: string) => void;
}) {
  const meta = [card.code, card.company, card.status, card.owner, card.amountFormatted].filter(Boolean);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
      <p className="text-[13px] font-semibold text-slate-900">{card.title}</p>
      {meta.length ? <p className="mt-0.5 text-[11px] text-slate-500">{meta.join(" · ")}</p> : null}
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Chip
          label="View quote"
          disabled={busy}
          onClick={() => onAsk(card.code ? `View quote ${card.code}` : `View quote ${card.title}`)}
        />
        <OpenInTeb href={card.openUrl} />
      </div>
    </div>
  );
}


function ReportBlock({
  result,
  busy,
  onChip,
}: {
  result: ReportResult;
  busy: boolean;
  onChip: (chip: string) => void;
}) {
  const showCharts =
    !result.quoteView &&
    !result.partyProfile &&
    !((result.map && result.map.length > 0) || (result.paths && result.paths.length > 0));
  return (
    <div className="mt-2 space-y-2">
      {result.chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {result.chips.map((chip) =>
            /^(records|count|dashboard|total value|search|profile|view)$/i.test(chip) ? (
              <span key={chip} className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-slate-600">
                {chip}
              </span>
            ) : (
              <Chip key={chip} label={chip} disabled={busy} onClick={() => onChip(chip)} />
            ),
          )}
        </div>
      ) : null}
      {result.quoteView ? null : result.metric === "value" ? (
        <p className="text-lg font-semibold tabular-nums text-slate-900">
          {formatAmount(result.amount, result.currencySymbol)}
          <span className="ml-2 text-xs font-normal text-slate-500">
            sum of {result.total.toLocaleString()} {result.total === 1 ? "record" : "records"}
          </span>
        </p>
      ) : result.total > 0 ? (
        <p className="text-lg font-semibold tabular-nums text-slate-900">{result.total.toLocaleString()}</p>
      ) : null}
      {result.quoteView ? (
        <QuoteViewBlock view={result.quoteView} />
      ) : result.quoteCards?.length ? (
        <div className="space-y-1.5">
          {result.quoteCards.map((card) => (
            <QuoteCardView key={card.id} card={card} busy={busy} onAsk={onChip} />
          ))}
        </div>
      ) : result.partyProfile ? (
        <PartyProfileView profile={result.partyProfile} busy={busy} onAsk={onChip} />
      ) : result.partyCards?.length ? (
        <div className="space-y-1.5">
          {result.partyCards.map((card) => (
            <PartyCardView key={card.id} card={card} busy={busy} onAsk={onChip} />
          ))}
        </div>
      ) : null}
      {(result.map && result.map.length > 0) || (result.paths && result.paths.length > 0) ? (
        <WorkforceMap pins={result.map ?? []} paths={result.paths} title={result.mapTitle} />
      ) : showCharts ? (
        <ReportCharts charts={result.charts} />
      ) : null}
      {result.analysis ? (
        <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[12px] leading-5 text-slate-700">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Analysis</p>
          <div className="whitespace-pre-wrap">{result.analysis}</div>
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:border-[#086fb8] hover:text-[#086fb8] disabled:opacity-40"
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {label}
    </button>
  );
}

export function ChatPanel({ user, menu }: { user: TebUserDetail | null; menu: TebMenuApp[] }) {
  const apps = useMemo(() => journeysForUser(menu), [menu]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [appCode, setAppCode] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<JourneyTopicId | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "assistant", text: HOME_PROMPT, showApps: true },
  ]);
  const intentRef = useRef<ReportIntent | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const selectedApp = apps.find((app) => app.appCode === appCode) ?? null;
  const selectedTopic = selectedApp?.topics.find((topic) => topic.id === topicId) ?? null;

  const userId = sessionUserId(user);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const next = restoreJourney(userId);
    const frame = window.requestAnimationFrame(() => {
      intentRef.current = next.intent;
      setMessages(next.messages);
      setAppCode(next.appCode);
      setTopicId(next.topicId);
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [userId]);

  useEffect(() => {
    if (!hydrated || messages.length === 0) return;
    writeStoredJourney(
      {
        messages,
        appCode,
        topicId,
        intent: intentRef.current,
        userId,
      },
      userId,
    );
  }, [messages, appCode, topicId, userId, hydrated]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  function applyJourney(intent: ReportIntent | null) {
    if (!intent) return;
    if (intent.stack === "dashboard" && !intent.entity) {
      const dashApp = selectedApp?.topics.some((topic) => topic.id === "dashboard")
        ? selectedApp
        : apps.find((app) => app.topics.some((topic) => topic.id === "dashboard"));
      if (dashApp) {
        setAppCode(dashApp.appCode);
        setTopicId("dashboard");
      }
      return;
    }
    if (!intent.entity) return;
    const inApp = selectedApp?.topics.find((topic) => topic.entity === intent.entity);
    if (inApp && selectedApp) {
      setTopicId(inApp.id);
      return;
    }
    const other = apps.find((app) => app.topics.some((topic) => topic.entity === intent.entity));
    const topic = other?.topics.find((item) => item.entity === intent.entity);
    if (other && topic) {
      setAppCode(other.appCode);
      setTopicId(topic.id);
    }
  }

  function goHome(announce = true) {
    setAppCode(null);
    setTopicId(null);
    intentRef.current = null;
    if (!announce) return;
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === "assistant" && last.apps?.length) return current;
      return [...current, { id: nextId(), role: "assistant", text: HOME_PROMPT, showApps: true }];
    });
  }

  function clearChat() {
    clearStoredJourney(userId);
    intentRef.current = null;
    setAppCode(null);
    setTopicId(null);
    setInput("");
    setMessages([{ id: "welcome", role: "assistant", text: HOME_PROMPT, showApps: true }]);
    fieldRef.current?.focus();
  }

  function selectApp(app: AskAppJourney) {
    setAppCode(app.appCode);
    setTopicId(null);
    intentRef.current = null;
    setMessages((current) => [
      ...current,
      { id: nextId(), role: "user", text: app.title },
      {
        id: nextId(),
        role: "assistant",
        text: appPrompt(app),
        journeyAppCode: app.appCode,
        topics: app.topics,
        questions: questionsFor(app),
      },
    ]);
  }

  function selectTopic(app: AskAppJourney, topic: JourneyTopic) {
    setAppCode(app.appCode);
    setTopicId(topic.id);
    intentRef.current = seedJourneyIntent(topic);
    setMessages((current) => [
      ...current,
      { id: nextId(), role: "user", text: topic.title },
      {
        id: nextId(),
        role: "assistant",
        text: appPrompt(app, topic),
        journeyAppCode: app.appCode,
        questions: questionsFor(app, topic),
      },
    ]);
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;

    if (isHomeCommand(text)) {
      setInput("");
      setMessages((current) => [...current, { id: nextId(), role: "user", text }]);
      goHome();
      return;
    }

    if (isGreeting(text)) {
      setInput("");
      if (!selectedApp) {
        setMessages((current) => [...current, { id: nextId(), role: "user", text }]);
        goHome();
        return;
      }
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "user", text },
        {
          id: nextId(),
          role: "assistant",
          text: appPrompt(selectedApp, selectedTopic),
          journeyAppCode: selectedApp.appCode,
          topics: selectedTopic ? undefined : selectedApp.topics,
          questions: questionsFor(selectedApp, selectedTopic),
        },
      ]);
      return;
    }

    if (!looksLikeSearch(text)) {
      const appHit = matchApp(apps, text);
      if (appHit && (!selectedApp || appHit.appCode !== selectedApp.appCode)) {
        setInput("");
        selectApp(appHit);
        return;
      }
      if (selectedApp) {
        const topicHit = matchTopic(selectedApp, text);
        if (topicHit && topicHit.id !== topicId) {
          setInput("");
          selectTopic(selectedApp, topicHit);
          return;
        }
      }
    }

    setInput("");
    setBusy(true);
    const history = historyTurns(messages);
    setMessages((current) => [...current, { id: nextId(), role: "user", text }]);
    try {
      const { intent, result } = await runReportQuestion(
        text,
        intentRef.current,
        user,
        selectedTopic?.entity,
        history,
      );
      intentRef.current = intent;
      applyJourney(intent);
      setMessages((current) => [...current, { id: nextId(), role: "assistant", text: result.text, result }]);
    } catch (err) {
      const message = userFacingAskError(err);
      setMessages((current) => [...current, { id: nextId(), role: "assistant", text: message }]);
    } finally {
      setBusy(false);
    }
  }

  const placeholder = selectedTopic
    ? `Ask about ${selectedTopic.title} in ${selectedApp?.title ?? "this app"}, or search`
    : selectedApp
      ? `Ask about ${selectedApp.title}, pick a topic, or search`
      : "Pick an app or type a search";

  const hasHistory = messages.some((message) => message.role === "user" || Boolean(message.role === "assistant" && message.result));

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col bg-white sm:border-x sm:border-slate-200">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <p className="truncate text-xs text-slate-500">
          {selectedApp ? (
            <>
              <span className="font-medium text-slate-800">{selectedApp.title}</span>
              {selectedTopic ? <span> · {selectedTopic.title}</span> : null}
            </>
          ) : (
            "History stays on this browser"
          )}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {selectedApp ? (
            <button
              type="button"
              onClick={() => goHome()}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-[#086fb8] hover:text-[#086fb8]"
            >
              All apps
            </button>
          ) : null}
          <button
            type="button"
            disabled={!hasHistory}
            onClick={() => clearChat()}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-red-400 hover:text-red-600 disabled:opacity-40"
          >
            <Icon name="delete" size={14} />
            Clear chat
          </button>
        </div>
      </div>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto px-4 py-5">
        <div className="space-y-3">
          {messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  message.role === "user"
                    ? "max-w-[90%] rounded-2xl bg-[#086fb8] px-3 py-2 text-sm text-white"
                    : "max-w-[95%] rounded-2xl bg-slate-100 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800"
                }
              >
                {message.text}
                {message.role === "assistant" && (message.showApps || message.apps) ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {apps.map((app) => (
                      <Chip
                        key={app.appCode}
                        label={app.title}
                        icon={app.icon}
                        disabled={busy}
                        onClick={() => selectApp(app)}
                      />
                    ))}
                  </div>
                ) : null}
                {message.role === "assistant" && message.topics?.length ? (
                  <div className="mt-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ask about</p>
                    <div className="flex flex-wrap gap-1.5">
                      {message.topics.map((topic) => (
                        <Chip
                          key={topic.id}
                          label={topic.title}
                          disabled={busy}
                          onClick={() => {
                            const app =
                              apps.find((item) => item.appCode === message.journeyAppCode) ?? selectedApp;
                            if (app) selectTopic(app, topic);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {message.role === "assistant" && message.questions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {message.questions.map((question) => (
                      <Chip key={question} label={question} disabled={busy} onClick={() => void ask(question)} />
                    ))}
                  </div>
                ) : null}
                {message.role === "assistant" && message.result ? (
                  <ReportBlock
                    result={message.result}
                    busy={busy}
                    onChip={(chip) => void ask(chip)}
                  />
                ) : null}
                {message.role === "assistant" && message.result?.suggestions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {message.result.suggestions.map((suggestion) => (
                      <Chip key={suggestion} label={suggestion} disabled={busy} onClick={() => void ask(suggestion)} />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {busy ? <p className="text-xs text-slate-500">Filtering and analysing…</p> : null}
        </div>
      </div>

      {selectedApp ? (
        <div className="flex flex-wrap gap-1 border-t border-slate-100 px-4 py-2">
          {questionsFor(selectedApp, selectedTopic)
            .slice(0, 4)
            .map((question) => (
              <Chip key={question} label={question} disabled={busy} onClick={() => void ask(question)} />
            ))}
        </div>
      ) : null}

      <form
        className="border-t border-slate-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
          <textarea
            ref={fieldRef}
            value={input}
            rows={2}
            placeholder={placeholder}
            className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm text-slate-800 outline-none"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(input);
              }
            }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="mb-0.5 rounded-md bg-[#086fb8] p-2 text-white disabled:opacity-40"
            aria-label="Send"
          >
            <Icon name="send" size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
