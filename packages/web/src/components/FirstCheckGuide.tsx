import { useState } from 'react';
import type { CollisionInterval } from '@pathblender/core';
import { useI18n } from '../i18n';
import { engagementText } from '../engagement-copy';
import { ProjectSupport } from './ProjectSupport';
import './FirstCheckGuide.css';

export function FirstCheckGuide({ conflict, clear, delayed, onPlay, onLocate, onDelay, onRestart, onExit }: {
  conflict?: CollisionInterval;
  clear: boolean;
  delayed: boolean;
  onPlay: () => void;
  onLocate: (conflict: CollisionInterval) => void;
  onDelay: () => void;
  onRestart: () => void;
  onExit: () => void;
}) {
  const { lang } = useI18n();
  const copy = (key: Parameters<typeof engagementText>[1]) => engagementText(lang, key);
  const [step, setStep] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [replayed, setReplayed] = useState(false);
  // Undo must show the live check again, not leave a stale congratulations.
  const showingResult = delayed || step === 3;
  const title = showingResult ? 'resultTitle' : step === 0 ? 'playTitle' : step === 1 ? 'findTitle' : 'compareTitle';
  const body = showingResult ? (clear ? 'resultBody' : 'changedBody') : step === 0 ? 'playBody' : step === 1 ? 'findBody' : 'compareBody';
  return <aside className="first-check-guide" aria-label={copy('lessonTitle')}>
    <header><strong>{copy('lessonTitle')}</strong><div>
      <button className="btn small" type="button" aria-expanded={!hidden} onClick={() => setHidden(!hidden)}>{copy(hidden ? 'showLesson' : 'closeLesson')}</button>
      <button className="btn small" type="button" onClick={onExit}>{copy('exitLesson')}</button>
    </div></header>
    {!hidden && <>
      <p className="first-check-note">{copy('lessonNote')}</p>
      <h3>{copy(title)}</h3><p aria-live="polite">{copy(body)}</p>
      <div className="first-check-actions">
        {!showingResult && step === 0 && <button className="btn" type="button" onClick={() => { onPlay(); setStep(1); }}>{copy('play')}</button>}
        {!showingResult && step === 1 && <button className="btn" type="button" disabled={!conflict} onClick={() => { if (conflict) { onLocate(conflict); setStep(2); } }}>{copy('find')}</button>}
        {!showingResult && step === 2 && <button className="btn" type="button" onClick={() => { onDelay(); setStep(3); }}>{copy('compare')}</button>}
        {showingResult && <button className="btn" type="button" onClick={() => { onPlay(); setReplayed(true); }}>{copy('replay')}</button>}
        <button className="btn small" type="button" onClick={() => { setStep(0); setReplayed(false); onRestart(); }}>{copy('restart')}</button>
      </div>
      {showingResult && clear && replayed && <ProjectSupport dismissible />}
    </>}
  </aside>;
}
