import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SectionCard } from "@/components/hr/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { askSpineAi } from "@/lib/ai.functions";
import { logAudit } from "@/lib/hr-queries";

export const Route = createFileRoute("/_app/copilot")({
  head: () => ({
    meta: [
      { title: "AI Copilot — Spine AI" },
      {
        name: "description",
        content:
          "Ask questions about your workforce, policies and HR operations. Answers respect your role and data scope.",
      },
      { property: "og:title", content: "Spine AI Copilot" },
      {
        property: "og:description",
        content: "Permission-aware answers about workforce, policy and HR operations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CopilotPage,
});

type AiResult = {
  answer: string;
  table: { columns: string[]; rows: string[][] } | null;
  recommendations: string[];
  sources: string[];
};

type Msg = { role: "user"; content: string } | { role: "assistant"; content: AiResult };

const SUGGESTIONS = [
  "How many employees are currently on leave?",
  "Who has repeated late attendance?",
  "Which employees have probation ending soon?",
  "Show pending leave approvals.",
  "Summarize the Engineering department.",
  "What are our annual leave rules?",
];

function CopilotPage() {
  const { user, fullName } = useAuth();
  const queryClient = useQueryClient();
  const ask = useServerFn(askSpineAi);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const historyQuery = useQuery({
    queryKey: ["ai-conversation", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data: convo } = await supabase
        .from("ai_conversations")
        .select("id")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!convo) return { id: null as string | null, messages: [] as Msg[] };
      const { data: rows } = await supabase
        .from("ai_messages")
        .select("role, content, payload")
        .eq("conversation_id", convo.id)
        .order("created_at", { ascending: true });
      const restored: Msg[] = (rows ?? []).map((r) =>
        r.role === "user"
          ? { role: "user", content: r.content }
          : {
              role: "assistant",
              content: (r.payload as AiResult | null) ?? {
                answer: r.content,
                table: null,
                recommendations: [],
                sources: [],
              },
            },
      );
      return { id: convo.id, messages: restored };
    },
  });

  useEffect(() => {
    if (historyQuery.data && conversationId === null && messages.length === 0) {
      setConversationId(historyQuery.data.id);
      if (historyQuery.data.messages.length) setMessages(historyQuery.data.messages);
    }
  }, [historyQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ensureConversation(question: string) {
    if (conversationId) return conversationId;
    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({ user_id: user!.id, title: question.slice(0, 80) })
      .select("id")
      .single();
    if (error || !data) return null;
    setConversationId(data.id);
    return data.id;
  }

  const send = useMutation({
    mutationFn: async (question: string) => {
      const convoId = user?.id ? await ensureConversation(question) : null;
      if (convoId) {
        await supabase
          .from("ai_messages")
          .insert({ conversation_id: convoId, role: "user", content: question });
      }
      const result = (await ask({ data: { question } })) as AiResult;
      if (convoId) {
        await supabase.from("ai_messages").insert({
          conversation_id: convoId,
          role: "assistant",
          content: result.answer,
          payload: result as unknown as never,
          sources: result.sources,
        });
      }
      await logAudit({
        userId: user?.id,
        action: "ai.query",
        entity: "ai_conversations",
        ...(convoId ? { entityId: convoId } : {}),
        next: { question },
      });
      return result;
    },
    onSuccess: (result) => {
      setMessages((m) => [...m, { role: "assistant", content: result }]);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Spine AI could not answer that right now.");
    },
  });

  function submit(question: string) {
    const q = question.trim();
    if (!q || send.isPending) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    send.mutate(q);
  }

  async function proposeAction(title: string) {
    const { error } = await supabase.from("ai_actions").insert({
      action_type: "ai_recommendation",
      title,
      reason: "Proposed by Spine AI from a copilot conversation",
      risk_level: "medium",
      requested_by: user?.id ?? null,
    });
    if (error) {
      toast.error("You do not have permission to propose this action.");
      return;
    }
    toast.success("Action proposed — it now needs human approval");
    void queryClient.invalidateQueries({ queryKey: ["ai-actions"] });
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden />
          <span className="text-gradient-ai">Spine AI Copilot</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask questions about your workforce, policies and HR operations. Answers only cover data
          you are authorized to see.
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <SectionCard className="ai-surface">
            <p className="font-medium">
              Hello {fullName.split(" ")[0] || "there"} — what would you like to know?
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => submit(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </SectionCard>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                {m.content}
              </p>
            </div>
          ) : (
            <SectionCard key={i} className="ai-surface">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Sparkles className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-sm">{m.content.answer}</p>

                  {m.content.table?.columns?.length ? (
                    <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {m.content.table.columns.map((c) => (
                              <TableHead key={c}>{c}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {m.content.table.rows.map((row, ri) => (
                            <TableRow key={ri}>
                              {row.map((cell, ci) => (
                                <TableCell key={ci}>{cell}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}

                  {m.content.recommendations.length ? (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Recommended actions
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.content.recommendations.map((r) => (
                          <Button
                            key={r}
                            size="sm"
                            variant="outline"
                            onClick={() => proposeAction(r)}
                          >
                            {r}
                          </Button>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Proposals go to the AI Actions queue for human approval.
                      </p>
                    </div>
                  ) : null}

                  {m.content.sources.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {m.content.sources.map((s) => (
                        <Badge key={s} variant="secondary" className="text-[11px]">
                          Source: {s}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </SectionCard>
          ),
        )}

        {send.isPending ? (
          <SectionCard className="ai-surface">
            <p className="text-sm text-muted-foreground">
              Spine AI is analysing your authorized data...
            </p>
          </SectionCard>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Spine AI about your workforce..."
          aria-label="Ask Spine AI"
        />
        <Button type="submit" disabled={send.isPending}>
          <Send className="h-4 w-4" />
          <span className="sr-only">Send</span>
        </Button>
      </form>
    </div>
  );
}
