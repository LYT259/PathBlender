import { en, type MessageKey } from './en';

/**
 * English (United Kingdom) — an **override table on top of en**, not a second
 * copy of it. The US/UK divergence in this UI is a handful of spellings, so
 * only those are listed and everything else is inherited verbatim. Spelling
 * follows the Apple/Microsoft en-GB consumer convention: -ise (customise,
 * minimise, unrecognised), -our (colour), centre-/metre; file-format names,
 * brand names, placeholders and punctuation stay byte-identical to en.
 */
export const enGbOverrides: Partial<Record<MessageKey, string>> = {
  // centreline is the only British spelling that had stayed in en.ts; en now
  // carries US "centerline" and the UK form lives here.
  'tour.task.mirror.hint': "Press Mirror left/right on 8814’s row — only that robot, with its route library, flips across the centreline. Then look at the checks panel again.",
  // behaviour (-our)
  'prefs.mouse.defaultConstrained': 'Set default rotation behaviour to constrained rotate',
  // Customise (-ise)
  'prefs.mouse.custom.editor': 'Customise what each drag does',
  // Metres / Centimetres (-metre)
  'prefs.unit.m': 'Metres (m)',
  'prefs.unit.cm': 'Centimetres (cm)',
  // Accent colour (-our)
  'prefs.accent': 'Accent colour',
  // Colour-blind (-our)
  'prefs.colorblind': 'Colour-blind palette',
  // unrecognised (-ise)
  'import.unrecognized': 'unrecognised format ({f}) — supported: Choreo .traj, .ghostauto, PathPlanner .path',
  // Minimise (-ise)
  'menu.minimize': 'Minimise',
};

/** What `DICTS` consumes: the US dictionary with the UK rows applied. */
export const enGb: Record<MessageKey, string> = { ...en, ...enGbOverrides };
