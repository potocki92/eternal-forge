'use client';

import type {
  ProgressionDto,
  StageModeDto as StageMode,
  StageSelectionRequest,
} from '@eternal-forge/contracts';
import { Alert, Button, cn } from '@eternal-forge/ui';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type SubmitEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { formatStage } from '@/player/format-stage';
import { changesSelection, readStageDraft, stepStage } from '../stage-selection/stage-draft';

export interface StageSelectorProps {
  readonly progression: ProgressionDto;
  /** A combat is being requested or played: the choice waits until it is over. */
  readonly locked: boolean;
  readonly pending: boolean;
  /** Why the last choice was not saved. */
  readonly error: string | undefined;
  readonly onSelect: (request: StageSelectionRequest, onSaved: () => void) => void;
  readonly onDismissError: () => void;
}

/**
 * Where the hero fights: keep climbing, or stay on one stage and farm it
 * (ADR-021).
 *
 * A one-line summary sits under the HUD; "Change" opens a small form. The farm
 * stage is chosen with a stepper and a typed number rather than a list, so it
 * works the same at stage 12 and at stage 12 billion. The form shows the
 * unlocked range the server sent and checks the draft against it for
 * convenience only: the server decides, and the screen changes only when its
 * answer arrives.
 */
export function StageSelector({
  progression,
  locked,
  pending,
  error,
  onSelect,
  onDismissError,
}: StageSelectorProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<StageMode>(progression.stageMode);
  const [stageText, setStageText] = useState(progression.currentStage);

  const panelId = useId();
  const stageInputId = useId();
  const stageHintId = useId();
  const stageErrorId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLInputElement>(null);

  const reached = progression.highestStageReached;
  const draft = readStageDraft(stageText, reached);
  const request: StageSelectionRequest | undefined =
    mode === 'PROGRESS'
      ? { mode: 'PROGRESS' }
      : draft.kind === 'valid'
        ? { mode: 'FARM', stage: draft.stage }
        : undefined;
  const canSave =
    request !== undefined && changesSelection(request, progression) && !pending && !locked;

  useEffect(() => {
    if (open) {
      firstChoice.current?.focus();
    }
  }, [open]);

  const openPanel = () => {
    // Every opening starts from the server's current choice.
    setMode(progression.stageMode);
    setStageText(progression.currentStage);
    onDismissError();
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    onDismissError();
    toggle.current?.focus();
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    onSelect(request, () => {
      setOpen(false);
      toggle.current?.focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !pending) {
      event.stopPropagation();
      close();
    }
  };

  const farming = progression.stageMode === 'FARM';

  return (
    <section
      aria-label="Stage selection"
      className="relative flex flex-col gap-2 border-y border-border/60 px-4 py-2"
      data-testid="stage-selector"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-text-secondary" data-testid="stage-mode">
          {farming ? (
            <>
              <span className="font-semibold text-text-primary">Farming</span>
              {` stage ${formatStage(progression.currentStage)} · stays on this stage`}
            </>
          ) : (
            <>
              <span className="font-semibold text-text-primary">Climbing</span>
              {' · moves on after each win'}
            </>
          )}
        </p>
        <Button
          ref={toggle}
          variant="ghost"
          size="sm"
          className="-mr-2 shrink-0"
          aria-expanded={open}
          aria-controls={panelId}
          // Stays enabled while saving: closing only hides the form, the save
          // keeps running (and keeps Fight blocked) until the server answers.
          disabled={locked && !open}
          onClick={open ? close : openPanel}
          data-testid="stage-selector-toggle"
        >
          {open ? 'Close' : 'Change'}
        </Button>
      </div>

      {open ? (
        <form
          id={panelId}
          onSubmit={submit}
          onKeyDown={onKeyDown}
          aria-busy={pending}
          // An overlay over the battlefield, so opening the form never squeezes
          // the scene at 390×844.
          className="absolute inset-x-0 top-full z-20 flex max-h-[70dvh] flex-col gap-3 overflow-y-auto border-b border-border bg-background px-4 pt-2 pb-4 shadow-(--shadow-raised)"
          data-testid="stage-selector-panel"
        >
          <fieldset className="flex flex-col gap-2" disabled={pending}>
            <legend className="mb-1 text-sm font-medium text-text-primary">
              Where should your hero fight?
            </legend>
            <ModeOption
              inputRef={mode === 'PROGRESS' ? firstChoice : undefined}
              value="PROGRESS"
              checked={mode === 'PROGRESS'}
              onChange={setMode}
              title="Continue climbing"
              description={`Fight from stage ${formatStage(reached)}, your furthest, and move on with every victory.`}
            />
            <ModeOption
              inputRef={mode === 'FARM' ? firstChoice : undefined}
              value="FARM"
              checked={mode === 'FARM'}
              onChange={setMode}
              title="Stay on this stage"
              description="Farm a stage you have reached. Victories pay as usual, and your hero stays put."
            />
          </fieldset>

          {mode === 'FARM' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={stageInputId} className="text-sm font-medium text-text-primary">
                Stage to farm
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  className="w-11 shrink-0 px-0 text-lg"
                  aria-label="Previous stage"
                  aria-controls={stageInputId}
                  disabled={pending || (draft.kind === 'valid' && draft.stage === '1')}
                  onClick={() => {
                    setStageText(stepStage(stageText, -1, reached, progression.currentStage));
                  }}
                  data-testid="stage-previous"
                >
                  −
                </Button>
                <input
                  id={stageInputId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={19}
                  value={stageText}
                  disabled={pending}
                  onChange={(event) => {
                    setStageText(event.target.value);
                  }}
                  aria-invalid={draft.kind === 'invalid' ? true : undefined}
                  aria-describedby={
                    draft.kind === 'invalid' ? `${stageHintId} ${stageErrorId}` : stageHintId
                  }
                  className={cn(
                    'h-11 min-w-0 flex-1 rounded-(--radius-control) border bg-surface-elevated px-3 text-center font-mono text-base text-text-primary',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    'disabled:opacity-50',
                    draft.kind === 'invalid' ? 'border-danger' : 'border-border',
                  )}
                  data-testid="stage-input"
                />
                <Button
                  variant="secondary"
                  className="w-11 shrink-0 px-0 text-lg"
                  aria-label="Next stage"
                  aria-controls={stageInputId}
                  disabled={pending || (draft.kind === 'valid' && draft.stage === reached)}
                  onClick={() => {
                    setStageText(stepStage(stageText, 1, reached, progression.currentStage));
                  }}
                  data-testid="stage-next"
                >
                  +
                </Button>
              </div>
              <p id={stageHintId} className="text-xs text-text-muted">
                Stages 1 to {formatStage(reached)} are open.
              </p>
              {draft.kind === 'invalid' ? (
                <p
                  id={stageErrorId}
                  className="text-xs text-danger"
                  data-testid="stage-draft-error"
                >
                  {draft.message}
                </p>
              ) : null}
            </div>
          ) : null}

          {error === undefined ? null : (
            <Alert tone="danger" data-testid="stage-selection-error">
              {error}
            </Alert>
          )}
          {locked ? (
            <p className="text-xs text-text-muted" role="status">
              Your hero is fighting. You can change the stage when the fight is over.
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={close} disabled={pending} className="shrink-0">
              Cancel
            </Button>
            <Button
              type="submit"
              fullWidth
              disabled={!canSave}
              aria-busy={pending}
              data-testid="stage-selection-submit"
            >
              {pending
                ? 'Saving…'
                : request !== undefined && !changesSelection(request, progression)
                  ? 'Already selected'
                  : mode === 'PROGRESS'
                    ? 'Continue climbing'
                    : draft.kind === 'valid'
                      ? `Farm stage ${formatStage(draft.stage)}`
                      : 'Farm'}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ModeOption({
  inputRef,
  value,
  checked,
  onChange,
  title,
  description,
}: {
  readonly inputRef: Ref<HTMLInputElement> | undefined;
  readonly value: StageMode;
  readonly checked: boolean;
  readonly onChange: (mode: StageMode) => void;
  readonly title: string;
  readonly description: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-(--radius-control) border px-3 py-2.5',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary',
        checked ? 'border-primary bg-primary/10' : 'border-border bg-surface-elevated',
      )}
    >
      <input
        ref={inputRef}
        type="radio"
        name="stage-mode"
        value={value}
        checked={checked}
        onChange={() => {
          onChange(value);
        }}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="mt-1 size-4 shrink-0 accent-primary"
        data-testid={`stage-mode-${value.toLowerCase()}`}
      />
      <span className="flex flex-col gap-0.5">
        <span id={titleId} className="text-sm font-medium text-text-primary">
          {title}
        </span>
        <span id={descriptionId} className="text-xs text-text-muted">
          {description}
        </span>
      </span>
    </label>
  );
}
