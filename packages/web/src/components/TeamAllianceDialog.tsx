/**
 * Folder-import alliance dialog (red book #14/§6.1): one folder is one
 * team, and each team's own alliance is chosen explicitly at import —
 * blue (default, today's behavior) or red (files authored from the red
 * wall; the route lands on the red half via the import-layer symmetry).
 * Native radios: two mutually exclusive options, visible persistent
 * labels, keyboard-operable by construction. Cancel aborts the import.
 */

import { useState } from 'react';
import type { Alliance } from '@pathblender/core';
import { Dialog } from './Dialog';
import { useI18n } from '../i18n';

export interface TeamAllianceRow {
  /** Grouping key (the folder root) — stable between listing and commit. */
  key: string;
  /** Human label: the folder name, team number included when known. */
  label: string;
}

export function TeamAllianceDialog({ teams, onApply, onCancel }: {
  teams: TeamAllianceRow[];
  onApply: (choices: Record<string, Alliance>) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [choices, setChoices] = useState<Record<string, Alliance>>(
    () => Object.fromEntries(teams.map((team) => [team.key, 'blue' as Alliance])),
  );
  return <Dialog title={t('import.allianceTitle')} onClose={onCancel} className="team-alliance-dialog">
    <div className="team-alliance-body">
      <p className="team-alliance-note">{t('import.allianceBody')}</p>
      <ul className="team-alliance-teams">
        {teams.map((team) => (
          <li key={team.key} className="team-alliance-team">
            <span className="team-alliance-team-name">{team.label}</span>
            <fieldset className="team-alliance-choice">
              <legend className="sr-only">{t('robots.teamAlliance', { name: team.label })}</legend>
              {(['blue', 'red'] as const).map((side) => (
                <label key={side} className={`alliance-${side}${choices[team.key] === side ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name={`team-alliance-${team.key}`}
                    checked={choices[team.key] === side}
                    onChange={() => setChoices((prev) => ({ ...prev, [team.key]: side }))}
                  />
                  {t(side === 'blue' ? 'robots.blue' : 'robots.red')}
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ul>
    </div>
    <div className="wpilog-actions">
      <button type="button" className="btn" onClick={onCancel}>{t('import.allianceCancel')}</button>
      <button type="button" className="btn accent" onClick={() => onApply(choices)}>{t('import.allianceApply')}</button>
    </div>
  </Dialog>;
}
