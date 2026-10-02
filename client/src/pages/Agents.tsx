import React, { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  Bot,
  CheckCircle2,
  Mail,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * The Agents destination: Nova's Cue-style personal agents. Each agent gets
 * an identity (email alias, phone handle), a wallet the user tops up as a
 * credit budget, its own chat, and team chats where several agents work
 * toward one goal. Gated actions (purchases, outbound email) land here as
 * approvals the user runs.
 */

type AgentRow = {
  id: number;
  name: string;
  role: string | null;
  instructions: string | null;
  emailAlias: string;
  phoneHandle: string;
  walletBudgetCredits: number;
  walletSpentCredits: number;
};

type ApprovalRow = {
  id: number;
  agentId: number;
  agentName: string;
  action: "wallet_purchase" | "send_email";
  summary: string;
  status: "pending" | "executed" | "denied" | "failed";
  resultSummary: string | null;
  chatId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

type AgentChatRow = {
  id: string;
  title: string;
  kind: "personal" | "team";
  goal: string | null;
  agentId: number | null;
  members: Array<{ id: number; name: string; role: string | null }>;
  updatedAt: Date;
};

type AgentEmailRow = {
  id: number;
  fromAgentName: string;
  toAgentId: number | null;
  toAgentName: string | null;
  subject: string;
  body: string;
  createdAt: Date;
};

const sectionHeading = "text-sm font-bold text-foreground dark:text-foreground";
const cardClass =
  "rounded-2xl border border-border bg-card p-4 dark:border-white/10 dark:bg-card";
const chipClass =
  "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground dark:border-white/10";

/** Progress bar for the wallet: spent portion first, remainder after. */
function WalletBar({ agent }: { agent: AgentRow }) {
  const budget = Math.max(0, agent.walletBudgetCredits);
  const spent = Math.min(budget, Math.max(0, agent.walletSpentCredits));
  const remaining = budget - spent;
  const spentPercent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  return (
    <div className="mt-3" data-testid={`wallet-${agent.id}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Wallet className="size-3.5 text-primary" /> Wallet
        </span>
        <span>
          {remaining} of {budget} credits left
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted dark:bg-white/10">
        <div
          className="h-full rounded-full bg-primary/70"
          style={{ width: `${spentPercent}%` }}
        />
      </div>
    </div>
  );
}

/** Create-or-edit dialog for one agent. `agent` null means "create". */
function AgentDialog({
  agent,
  open,
  onClose,
}: {
  agent: AgentRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(agent?.name ?? "");
  const [role, setRole] = useState(agent?.role ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [budget, setBudget] = useState(
    String(agent?.walletBudgetCredits ?? 500)
  );

  const createAgent = trpc.agents.create.useMutation({
    onSuccess: created => {
      toast.success(`${created.name} is ready - identity and wallet created.`);
      void utils.agents.list.invalidate();
      onClose();
    },
    onError: error => toast.error(error.message),
  });
  const updateAgent = trpc.agents.update.useMutation({
    onSuccess: updated => {
      toast.success(`${updated.name} updated.`);
      void utils.agents.list.invalidate();
      onClose();
    },
    onError: error => toast.error(error.message),
  });

  const save = () => {
    const budgetCredits = Number.parseInt(budget, 10);
    if (!Number.isFinite(budgetCredits) || budgetCredits < 0) {
      toast.error("The wallet budget must be 0 or more credits.");
      return;
    }
    if (agent) {
      updateAgent.mutate({
        id: agent.id,
        name: name.trim(),
        role: role.trim() || null,
        instructions: instructions.trim() || null,
        walletBudgetCredits: budgetCredits,
      });
    } else {
      createAgent.mutate({
        name: name.trim(),
        role: role.trim() || null,
        instructions: instructions.trim() || null,
        walletBudgetCredits: budgetCredits,
      });
    }
  };

  const pending = createAgent.isPending || updateAgent.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left text-xl font-extrabold tracking-tight">
            {agent ? `Edit ${agent.name}` : "New agent"}
          </DialogTitle>
          <DialogDescription className="text-left leading-6">
            {agent
              ? "Tune this agent's role, instructions, and wallet. The wallet budget can never drop below what it has already spent."
              : "Give your agent a name, a role, and a budget. Nova mints its email alias and phone handle automatically."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="e.g. Mira"
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-role">Role</Label>
            <Input
              id="agent-role"
              value={role}
              onChange={event => setRole(event.target.value)}
              placeholder="e.g. Researcher"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-instructions">Instructions</Label>
            <Textarea
              id="agent-instructions"
              value={instructions}
              onChange={event => setInstructions(event.target.value)}
              placeholder="What this agent is for, how it should work, anything it should always do..."
              rows={4}
              maxLength={4000}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-budget">Wallet budget (credits)</Label>
            <Input
              id="agent-budget"
              type="number"
              min={0}
              max={100000}
              value={budget}
              onChange={event => setBudget(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Purchases from this wallet always wait for your approval in the
              Agents page.
            </p>
          </div>
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={pending || !name.trim()}
            className="gap-2"
          >
            {agent ? "Save changes" : "Create agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Team builder: name, shared goal, and at least two agents. */
function TeamDialog({
  open,
  agents,
  onClose,
}: {
  open: boolean;
  agents: AgentRow[];
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [selected, setSelected] = useState<number[]>([]);

  const createTeam = trpc.agents.createTeam.useMutation({
    onSuccess: result => {
      toast.success(`${result.chat.title} created.`);
      void utils.agents.chats.invalidate();
      setName("");
      setGoal("");
      setSelected([]);
      onClose();
      setLocation(`/app?chatId=${result.chat.id}`);
    },
    onError: error => toast.error(error.message),
  });

  const toggle = (id: number) =>
    setSelected(current =>
      current.includes(id)
        ? current.filter(value => value !== id)
        : [...current, id]
    );

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left text-xl font-extrabold tracking-tight">
            New agent team
          </DialogTitle>
          <DialogDescription className="text-left leading-6">
            Put several agents in one group chat with a shared goal. They take
            turns working on it - you set the direction and make the final
            call.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Team name</Label>
            <Input
              id="team-name"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="e.g. Launch crew"
              maxLength={160}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-goal">Shared goal</Label>
            <Textarea
              id="team-goal"
              value={goal}
              onChange={event => setGoal(event.target.value)}
              placeholder="What this team should accomplish together, e.g. research venues for the New York launch, shortlist them, and draft the deck."
              rows={3}
              maxLength={2000}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Members (at least two)</Label>
            <div className="space-y-1.5">
              {agents.map(agent => {
                const checked = selected.includes(agent.id);
                return (
                  <label
                    key={agent.id}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition ${
                      checked
                        ? "border-primary/40 bg-primary/5"
                        : "border-border dark:border-white/10"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(agent.id)}
                      className="size-4 accent-primary"
                    />
                    <span className="font-semibold">{agent.name}</span>
                    {agent.role && (
                      <span className="truncate text-xs text-muted-foreground">
                        {agent.role}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              createTeam.mutate({ name: name.trim(), goal: goal.trim(), agentIds: selected })
            }
            disabled={
              createTeam.isPending ||
              !name.trim() ||
              !goal.trim() ||
              selected.length < 2
            }
          >
            Create team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Agents() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const agents = trpc.agents.list.useQuery();
  const agentChats = trpc.agents.chats.useQuery();
  const approvals = trpc.agents.approvals.useQuery();
  const inbox = trpc.agents.inbox.useQuery();

  const [agentDialog, setAgentDialog] = useState<
    { mode: "new" } | { mode: "edit"; agent: AgentRow } | null
  >(null);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);

  const deleteAgent = trpc.agents.delete.useMutation({
    onSuccess: () => {
      toast.success("Agent deleted.");
      void utils.agents.list.invalidate();
      void utils.agents.chats.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const startChat = trpc.agents.startChat.useMutation({
    onSuccess: chat => setLocation(`/app?chatId=${chat.id}`),
    onError: error => toast.error(error.message),
  });
  const decide = (decision: "approve" | "deny") =>
    decision === "approve"
      ? trpc.agents.approve.useMutation({
          onSuccess: result => {
            toast.success(
              result.approval.resultSummary ?? "Request approved."
            );
            void utils.agents.approvals.invalidate();
            void utils.agents.list.invalidate();
            void utils.agents.inbox.invalidate();
          },
          onError: error => toast.error(error.message),
        })
      : trpc.agents.deny.useMutation({
          onSuccess: () => {
            toast.success("Request declined.");
            void utils.agents.approvals.invalidate();
          },
          onError: error => toast.error(error.message),
        });
  const approve = decide("approve");
  const deny = decide("deny");

  const agentRows = (agents.data ?? []) as AgentRow[];
  const pending = ((approvals.data?.pending ?? []) as ApprovalRow[]).filter(
    row => row.status === "pending"
  );
  const recent = (approvals.data?.recent ?? []) as ApprovalRow[];
  const teamRows = ((agentChats.data ?? []) as AgentChatRow[]).filter(
    chat => chat.kind === "team"
  );
  const emailRows = (inbox.data ?? []) as AgentEmailRow[];

  const confirmDelete = (agent: AgentRow) => {
    if (
      !window.confirm(
        `Delete ${agent.name}? Its memories and team memberships are removed; its chat stays as an ordinary Nova conversation.`
      )
    )
      return;
    deleteAgent.mutate({ id: agent.id });
  };

  return (
    <DashboardLayout>
      <section className="relative mx-auto max-w-4xl px-4 py-6 md:px-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-primary/[0.045] to-transparent dark:from-primary/[0.07]" />
        <div className="rise-in">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            Personal agents
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Agents</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            A personal team of agents - each with its own identity, wallet,
            memory, and chat. Ask them for anything; gated actions come here
            for your approval.
          </p>
        </div>

        {/* Pending approvals - the gate for purchases and outbound email. */}
        {pending.length > 0 && (
          <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-50 p-4 dark:border-amber-500/25 dark:bg-amber-500/5">
            <h2 className={sectionHeading}>
              Waiting for your approval ({pending.length})
            </h2>
            <div className="mt-3 space-y-2">
              {pending.map(row => (
                <div
                  key={row.id}
                  data-testid={`approval-${row.id}`}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center dark:border-white/10"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      {row.agentName} ·{" "}
                      {row.action === "wallet_purchase" ? "Purchase" : "Email"}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                      {row.summary}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => approve.mutate({ id: row.id })}
                      disabled={approve.isPending}
                    >
                      <CheckCircle2 className="size-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => deny.mutate({ id: row.id })}
                      disabled={deny.isPending}
                    >
                      <XCircle className="size-3.5" /> Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agents */}
        <div className="mt-8 flex items-center justify-between">
          <h2 className={sectionHeading}>
            Your agents{" "}
            <span className="font-normal text-muted-foreground">
              ({agentRows.length})
            </span>
          </h2>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setAgentDialog({ mode: "new" })}
          >
            <Plus className="size-4" /> New agent
          </Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {agentRows.map(agent => (
            <div key={agent.id} className={cardClass} data-testid={`agent-${agent.id}`}>
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-extrabold text-primary ring-1 ring-primary/15">
                  {agent.name.charAt(0).toUpperCase() || "A"}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold text-foreground">
                    {agent.name}
                  </h3>
                  <p className="truncate text-xs text-muted-foreground">
                    {agent.role || "Personal agent"}
                  </p>
                </div>
                <button
                  onClick={() => setAgentDialog({ mode: "edit", agent })}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  aria-label={`Edit ${agent.name}`}
                  title="Edit agent"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={() => confirmDelete(agent)}
                  disabled={deleteAgent.isPending}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  aria-label={`Delete ${agent.name}`}
                  title="Delete agent"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className={chipClass} title="Nova-internal email alias">
                  <Mail className="size-3 shrink-0" />
                  <span className="truncate">{agent.emailAlias}</span>
                </span>
                <span className={chipClass} title="Virtual phone handle">
                  <Phone className="size-3 shrink-0" />
                  {agent.phoneHandle}
                </span>
              </div>
              <WalletBar agent={agent} />
              <Button
                size="sm"
                variant="secondary"
                className="mt-3 w-full gap-1.5"
                onClick={() => startChat.mutate({ agentId: agent.id })}
                disabled={startChat.isPending}
              >
                <MessageSquareText className="size-3.5" /> Open chat
              </Button>
            </div>
          ))}
        </div>
        {agentRows.length === 0 && !agents.isLoading && (
          <div className="mt-3 grid min-h-40 place-items-center rounded-2xl border border-dashed border-border bg-card text-center dark:border-white/10">
            <div className="px-6">
              <Bot className="mx-auto size-5 text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">
                No agents yet. Create your first - give it a role like
                researcher, planner, or inbox manager.
              </p>
              <Button
                size="sm"
                className="mt-4 gap-1.5"
                onClick={() => setAgentDialog({ mode: "new" })}
              >
                <Plus className="size-4" /> New agent
              </Button>
            </div>
          </div>
        )}

        {/* Teams */}
        <div className="mt-8 flex items-center justify-between">
          <h2 className={sectionHeading}>
            Teams{" "}
            <span className="font-normal text-muted-foreground">
              ({teamRows.length})
            </span>
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setTeamDialogOpen(true)}
            disabled={agentRows.length < 2}
            title={
              agentRows.length < 2
                ? "Create at least two agents first"
                : "Create a team"
            }
          >
            <Users className="size-4" /> New team
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {teamRows.map(team => (
            <div
              key={team.id}
              className={`${cardClass} flex flex-col gap-3 sm:flex-row sm:items-center`}
              data-testid={`team-${team.id}`}
            >
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-bold text-foreground">
                  {team.title}
                </h3>
                {team.goal && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {team.goal}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {team.members.map(member => (
                    <span key={member.id} className={chipClass}>
                      <Bot className="size-3 shrink-0" />
                      {member.name}
                    </span>
                  ))}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0 gap-1.5"
                onClick={() => setLocation(`/app?chatId=${team.id}`)}
              >
                <MessageSquareText className="size-3.5" /> Open chat
              </Button>
            </div>
          ))}
          {teamRows.length === 0 && !agentChats.isLoading && (
            <div className="grid min-h-32 place-items-center rounded-2xl border border-dashed border-border bg-card px-6 text-center dark:border-white/10">
              <p className="text-sm text-muted-foreground">
                {agentRows.length < 2
                  ? "Create at least two agents to start a team - they will hand work to each other in one shared chat."
                  : "No teams yet. Put two or more agents in a group chat with a shared goal."}
              </p>
            </div>
          )}
        </div>

        {/* Recent decisions - the wallet's transaction history. */}
        {recent.length > 0 && (
          <>
            <h2 className={`${sectionHeading} mt-8`}>Recent decisions</h2>
            <div className="mt-3 space-y-1.5">
              {recent.map(row => (
                <div
                  key={row.id}
                  className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs dark:border-white/10"
                >
                  <span
                    className={`mt-0.5 shrink-0 font-bold uppercase tracking-wide ${
                      row.status === "executed"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : row.status === "denied"
                          ? "text-muted-foreground"
                          : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {row.status}
                  </span>
                  <span className="min-w-0 text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {row.agentName}
                    </span>
                    : {row.resultSummary ?? row.summary}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Nova-internal agent mail */}
        {emailRows.length > 0 && (
          <>
            <h2 className={`${sectionHeading} mt-8`}>Agent inbox</h2>
            <div className="mt-3 space-y-2">
              {emailRows.map(email => (
                <div key={email.id} className={cardClass}>
                  <p className="truncate text-sm font-semibold text-foreground">
                    {email.subject}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    From {email.fromAgentName} to{" "}
                    {email.toAgentName ?? "you"} ·{" "}
                    {new Date(email.createdAt).toLocaleDateString()}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                    {email.body}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Empty-state hint when the whole surface is empty. */}
        {agentRows.length === 0 && teamRows.length === 0 && (
          <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> Each agent keeps its
            own memory, chats in its own conversation, and spends only within
            the wallet you grant it.
          </p>
        )}

        {agentDialog && (
          <AgentDialog
            key={agentDialog.mode === "edit" ? agentDialog.agent.id : "new"}
            agent={agentDialog.mode === "edit" ? agentDialog.agent : null}
            open
            onClose={() => setAgentDialog(null)}
          />
        )}
        <TeamDialog
          open={teamDialogOpen}
          agents={agentRows}
          onClose={() => setTeamDialogOpen(false)}
        />
      </section>
    </DashboardLayout>
  );
}
