import React, { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { FileText, Loader2, Pencil, Plus, Puzzle, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import {
  SKILL_BODY_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  renderSkillMarkdown,
  skillDescriptionError,
  skillNameError,
} from "@shared/skills";

/**
 * The Skills destination: reusable procedures Nova follows on demand, in the
 * open Agent Skills format (name + description + markdown instructions).
 *
 * The library is deliberately discovery-shaped: the agent's prompt carries
 * only each skill's name and description, and it loads a skill's instructions
 * with read_skill when a task matches - so everything a user writes here is
 * reachable from a chat without ever being pasted into every conversation.
 */

type SkillRow = {
  id: number;
  name: string;
  description: string;
  body: string;
  updatedAt: Date;
};

const sectionHeading = "text-sm font-bold text-foreground dark:text-foreground";
const cardClass =
  "rounded-2xl border border-border bg-card p-4 dark:border-white/10 dark:bg-card";

/**
 * The whole form's validation, exported so the rule that decides whether the
 * save button is enabled is also the rule the tests exercise.
 */
export function skillFormError(fields: {
  name: string;
  description: string;
  body: string;
}): string | null {
  return (
    skillNameError(fields.name) ??
    skillDescriptionError(fields.description) ??
    (fields.body.trim()
      ? null
      : "Write the instructions Nova should follow for this skill.")
  );
}

/** Create/edit dialog: the spec's three fields plus the SKILL.md it becomes. */
function SkillDialog({
  skill,
  open,
  onClose,
}: {
  skill: SkillRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");

  const createSkill = trpc.skills.create.useMutation({
    onSuccess: created => {
      toast.success(`Skill "${created.name}" created.`);
      void utils.skills.list.invalidate();
      onClose();
    },
    onError: error => toast.error(error.message),
  });
  const updateSkill = trpc.skills.update.useMutation({
    onSuccess: updated => {
      toast.success(`Skill "${updated.name}" saved.`);
      void utils.skills.list.invalidate();
      onClose();
    },
    onError: error => toast.error(error.message),
  });

  const fields = { name, description, body };
  const error = skillFormError(fields);
  // Live hints only once the user has typed something: an untouched field
  // should not glow red the moment the dialog opens.
  const nameHint = name ? skillNameError(name) : null;
  const descriptionHint = description
    ? skillDescriptionError(description)
    : null;

  const save = () => {
    if (error) {
      toast.error(error);
      return;
    }
    if (skill) {
      updateSkill.mutate({
        id: skill.id,
        name: name.trim(),
        description: description.trim(),
        body: body.trim(),
      });
    } else {
      createSkill.mutate({
        name: name.trim(),
        description: description.trim(),
        body: body.trim(),
      });
    }
  };

  const pending = createSkill.isPending || updateSkill.isPending;
  const frontmatter = renderSkillMarkdown({
    name: name.trim() || "skill-name",
    description: description.trim(),
    body: "",
  });

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-left text-xl font-extrabold tracking-tight">
            {skill ? `Edit ${skill.name}` : "New skill"}
          </DialogTitle>
          <DialogDescription className="text-left leading-6">
            {skill
              ? "Update the name, when Nova should use this skill, and the instructions it follows."
              : "Describe a procedure you repeat. Nova sees the name and description, and loads the instructions when a task matches."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="skill-name">Name</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="e.g. weekly-report"
              maxLength={SKILL_NAME_MAX_LENGTH}
              autoFocus
            />
            <p
              className={`text-xs ${nameHint ? "text-destructive" : "text-muted-foreground"}`}
            >
              {nameHint ??
                "Lowercase letters, numbers, and single hyphens - this is the skill's id."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-description">When to use it</Label>
            <Textarea
              id="skill-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder="What the skill does and when Nova should reach for it - name the situations that should trigger it."
              rows={3}
              maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
            />
            <p
              className={`text-xs ${descriptionHint ? "text-destructive" : "text-muted-foreground"}`}
            >
              {descriptionHint ??
                `${description.trim().length}/${SKILL_DESCRIPTION_MAX_LENGTH} characters. This line is what Nova matches a request against.`}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-body">Instructions</Label>
            <Textarea
              id="skill-body"
              value={body}
              onChange={event => setBody(event.target.value)}
              placeholder={
                "Step by step, exactly how the task is done...\n1. ...\n2. ..."
              }
              rows={10}
              maxLength={SKILL_BODY_MAX_LENGTH}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Markdown. Nova loads this only when the skill triggers, so long
              reference detail is free until then.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              SKILL.md frontmatter
            </p>
            <pre
              data-testid="skill-frontmatter"
              className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground"
            >
              {frontmatter}
            </pre>
          </div>
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={pending || Boolean(error)}
            className="gap-2"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {skill ? "Save changes" : "Create skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Skills() {
  const utils = trpc.useUtils();
  const skills = trpc.skills.list.useQuery(undefined, { retry: false });
  const [dialog, setDialog] = useState<
    { mode: "new" } | { mode: "edit"; skill: SkillRow } | null
  >(null);

  const deleteSkill = trpc.skills.delete.useMutation({
    onSuccess: () => {
      toast.success("Skill deleted.");
      void utils.skills.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const rows = (skills.data ?? []) as SkillRow[];

  const confirmDelete = (skill: SkillRow) => {
    if (
      !window.confirm(
        `Delete "${skill.name}"? Nova will stop following that procedure. This cannot be undone.`
      )
    )
      return;
    deleteSkill.mutate({ id: skill.id });
  };

  return (
    <DashboardLayout>
      <section className="relative mx-auto max-w-4xl px-4 py-6 md:px-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-primary/[0.045] to-transparent dark:from-primary/[0.07]" />
        <div className="rise-in flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              Reusable instructions
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
              Skills
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Procedures Nova follows when a task matches one. Each skill is
              name, description, and instructions - Nova sees the first two and
              loads the instructions only when it needs them.
            </p>
          </div>
          <Button
            className="gap-2"
            onClick={() => setDialog({ mode: "new" })}
            data-testid="new-skill"
          >
            <Plus className="size-4" /> New skill
          </Button>
        </div>

        {skills.isLoading && (
          <div className="mt-10 grid min-h-40 place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {skills.isError && (
          <div className="mt-10 grid min-h-40 place-items-center rounded-2xl border border-dashed border-border bg-card px-6 text-center dark:border-white/10">
            <div>
              <p className="text-sm font-semibold">
                Your skills could not be loaded.
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {skills.error?.message ??
                  "Nova could not reach your skills right now."}
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => void skills.refetch()}
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {!skills.isLoading && !skills.isError && rows.length === 0 && (
          <div
            className="mt-10 grid min-h-48 place-items-center rounded-2xl border border-dashed border-border bg-card px-6 text-center dark:border-white/10"
            data-testid="skills-empty"
          >
            <div>
              <Puzzle className="mx-auto size-5 text-primary" />
              <p className="mt-3 text-sm font-semibold">No skills yet</p>
              <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                Turn anything you explain more than once - a report format, a
                review checklist, a deploy routine - into a skill Nova can
                follow every time.
              </p>
              <Button
                className="mt-4 gap-2"
                onClick={() => setDialog({ mode: "new" })}
              >
                <Plus className="size-4" /> Create your first skill
              </Button>
            </div>
          </div>
        )}

        {!skills.isLoading && !skills.isError && rows.length > 0 && (
          <div className="mt-8 space-y-3">
            <h2 className={sectionHeading}>
              {rows.length} {rows.length === 1 ? "skill" : "skills"}
            </h2>
            {rows.map(skill => (
              <article
                key={skill.id}
                data-testid={`skill-${skill.id}`}
                className={`${cardClass} flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="size-4 shrink-0 text-primary" />
                    <span className="truncate font-mono text-sm font-bold">
                      {skill.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      updated{" "}
                      {new Date(skill.updatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {skill.description}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setDialog({ mode: "edit", skill })}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => confirmDelete(skill)}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}

        {dialog && (
          <SkillDialog
            key={dialog.mode === "edit" ? dialog.skill.id : "new"}
            open
            skill={dialog.mode === "edit" ? dialog.skill : null}
            onClose={() => setDialog(null)}
          />
        )}
      </section>
    </DashboardLayout>
  );
}
