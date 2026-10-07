import { useCallback, useState } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import './OnboardingTasks.css';

/**
 * Interactive onboarding checklist for the built-in example (2026-10-07
 * onboarding plan §3): five verifiable exercises that walk a first-time
 * user through playback, issue location, plan comparison and both spatial
 * transforms — the plan demands the teaching scenes be real, so the task
 * copy states only what was actually measured on the example session
 * (mirroring #8814 clears its conflict; the alliance switch moves the whole
 * session and changes no verdicts).
 *
 * Progress and dismissal live in localStorage only (plan §3: local, no
 * accounts, no telemetry) and survive reloads; the Help menu can reopen a
 * dismissed card. Completion detection is fed by the app (each action
 * marks its task while the example session is active) — this component
 * never inspects the workspace itself.
 */

export type TourTaskId = 'play' | 'issue' | 'plan' | 'alliance' | 'mirror';
export const TOUR_TASK_IDS: readonly TourTaskId[] = ['play', 'issue', 'plan', 'alliance', 'mirror'];

export type TourDone = Record<TourTaskId, boolean>;

const STORE_KEY = 'pb.tour.v1';

interface TourState {
  dismissed: boolean;
  done: TourDone;
}

const emptyDone = (): TourDone => ({ play: false, issue: false, plan: false, alliance: false, mirror: false });

function loadTour(): TourState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { dismissed: false, done: emptyDone() };
    const parsed = JSON.parse(raw) as Partial<TourState>;
    return {
      dismissed: parsed.dismissed === true,
      done: { ...emptyDone(), ...(parsed.done ?? {}) },
    };
  } catch {
    return { dismissed: false, done: emptyDone() };
  }
}

/** Remember completion locally; unavailable storage must not block the app. */
export function useTourProgress() {
  const [state, setState] = useState<TourState>(loadTour);
  const mark = useCallback((id: TourTaskId) => {
    setState((prev) => {
      if (prev.done[id]) return prev;
      const next = { ...prev, done: { ...prev.done, [id]: true } };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* session-only progress */ }
      return next;
    });
  }, []);
  const dismiss = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, dismissed: true };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* session-only */ }
      return next;
    });
  }, []);
  /** Help-menu reopen: brings a dismissed card back, progress intact. */
  const reopen = useCallback(() => {
    setState((prev) => {
      if (!prev.dismissed) return prev;
      const next = { ...prev, dismissed: false };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* session-only */ }
      return next;
    });
  }, []);
  return { done: state.done, dismissed: state.dismissed, mark, dismiss, reopen };
}

export function OnboardingTasks({ done, onDismiss }: { done: TourDone; onDismiss: () => void }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const completed = TOUR_TASK_IDS.filter((id) => done[id]).length;
  const allDone = completed === TOUR_TASK_IDS.length;
  return <aside className="tour-card" aria-label={t('tour.title')}>
    <header className="tour-head">
      <span className="tour-name">{t('tour.title')}</span>
      <span className="tour-progress" role="status">{t('tour.progress', { n: completed, m: TOUR_TASK_IDS.length })}</span>
      <button type="button" className="tour-toggle" aria-expanded={!collapsed}
        aria-label={t(collapsed ? 'tour.expand' : 'tour.collapse')} onClick={() => setCollapsed((v) => !v)}>
        <Icon name="back" size={14} />
      </button>
      <button type="button" className="tour-close" aria-label={t('tour.hide')} title={t('tour.hide')} onClick={onDismiss}>
        <Icon name="close" size={14} />
      </button>
    </header>
    {!collapsed && <ol className="tour-tasks">
      {TOUR_TASK_IDS.map((id) => <li key={id} className={done[id] ? 'is-done' : ''}>
        <span className="tour-check" aria-hidden={true}>{done[id] ? <Icon name="check" size={13} /> : null}</span>
        <span className="tour-text">
          <span className="tour-task-title">{t(`tour.task.${id}.title` as const)}</span>
          <span className="tour-task-hint">{t(`tour.task.${id}.hint` as const)}</span>
        </span>
      </li>)}
    </ol>}
    {!collapsed && allDone && <p className="tour-finished">{t('tour.finished')}</p>}
  </aside>;
}
