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
  skillDescriptionError,
  skillNameError,
} from "@shared/skills";

/**
 * The Skills destination: reusable procedures Nova follows on demand, in the
 * open Agent Skills format (name + description + markdown instructions).
 *
 * The page keeps that three-field shape but hides the format itself: the name
 * is formatted for the user as they type, hints only appear when something
 * actually needs fixing, and there is nothing to configure beyond the fields
 * themselves.
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
 * Whatever the user types becomes a valid skill id, so nobody has to know the
 * naming rules: "Weekly Report" is quietly saved as "weekly-report".
 */
export function formatSkillName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, SKILL_NAME_MAX_LENGTH);
}

/**
 * The whole form's validation, exported so the rule that decides whether a
 * save is accepted is also the rule the tests exercise.
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

/** Create/edit dialog: the spec's three fields and nothing else. */
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

  // A trailing hyphen while typing ("weekly-report-") is not worth a red
  // warning: it is dropped on save.
  const nameValue = name.replace(/-+$/, "");
  const error = skillFormError({
    name: nameValue,
    description: description.trim(),
    body: body.trim(),
  });
  // Live hints only once the user has typed something: an untouched field
  // should not glow red the moment the dialog opens.
  const nameHint = nameValue ? skillNameError(nameValue) : null;
  const descriptionHint = description
    ? skillDescriptionError(description)
    : null;
  const bodyHint = body.trim() ? null : "One step per line. Markdown is fine.";

  const save = () => {
    if (error) {
      toast.error(error);
      return;
    }
    if (skill) {
      updateSkill.mutate({
        id: skill.id,
        name: nameValue.trim(),
        description: description.trim(),
        body: body.trim(),
      });
    } else {
      createSkill.mutate({
        name: nameValue.trim(),
        description: description.trim(),
        body: body.trim(),
      });
    }
  };

  const pending = createSkill.isPending || updateSkill.isPending;

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
              ? "Change the name, when Nova should use it, or the steps it follows."
              : "What it is called, when Nova should use it, and the steps to follow."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="skill-name">Name</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={event => setName(formatSkillName(event.target.value))}
              placeholder="e.g. weekly-report"
              maxLength={SKILL_NAME_MAX_LENGTH}
              autoFocus
            />
            <Hint error={nameHint} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-description">When to use it</Label>
            <Textarea
              id="skill-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder="e.g. Writes the weekly report. Use when I ask for the weekly update."
              rows={2}
              maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
            />
            <Hint error={descriptionHint} />
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
              rows={8}
              maxLength={SKILL_BODY_MAX_LENGTH}
              className="font-mono text-sm"
            />
            <Hint error={null}>{bodyHint}</Hint>
          </div>
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending} className="gap-2">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {skill ? "Save changes" : "Create skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One line under a field: red when something is wrong, muted otherwise. */
function Hint({
  error,
  children,
}: {
  error: string | null;
  children?: React.ReactNode;
}) {
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!children) return null;
  return <p className="text-xs text-muted-foreground">{children}</p>;
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
              Teach Nova how you like something done once. Nova sees the name
              and description, and loads the instructions only when it needs
              them.
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
