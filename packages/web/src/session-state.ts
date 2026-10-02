import { useCallback, useState } from 'react';
import type { Alliance, FieldArtStyle, FieldPackage, SessionTrajectory } from '@pathblender/core';

type RobotUpdate = SessionTrajectory[] | ((previous: SessionTrajectory[]) => SessionTrajectory[]);
interface Scene {
  robots: SessionTrajectory[];
  alliance: Alliance;
  fieldId: string;
  fieldVariant: 'welded' | 'andymark';
  fieldStyle: FieldArtStyle;
  customField?: FieldPackage;
  customImageUrl?: string;
}

/** The session scene: robots plus the field, variant and alliance they play on. */
export function useSessionState(initial: { id: string; variant: 'welded' | 'andymark'; style: FieldArtStyle }) {
  const [scene, setSceneState] = useState<Scene>({ robots: [], alliance: 'blue' as Alliance, fieldId: initial.id, fieldVariant: initial.variant, fieldStyle: initial.style });
  const setRobots = useCallback((update: RobotUpdate) => setSceneState((previous) => ({ ...previous, robots: typeof update === 'function' ? update(previous.robots) : update })), []);
  const setScene = useCallback((patch: Partial<Scene>) => setSceneState((previous) => ({ ...previous, ...patch })), []);
  return { ...scene, setRobots, setScene };
}
