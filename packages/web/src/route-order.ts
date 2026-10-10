import { useState } from 'react';

/** Route-library display order (user request 2026-10-09): plain filename
 * order, or routes grouped by where they start (Trench / Hub / other) in
 * seasons that define startRegions. First use is alphabetical; later
 * launches retain the user's choice. */
export type RouteOrder = 'name' | 'start';
const KEY = 'pb.routeOrder';

export function useRouteOrder() {
  const [order, setOrder] = useState<RouteOrder>(() => {
    try { return localStorage.getItem(KEY) === 'start' ? 'start' : 'name'; } catch { return 'name'; }
  });
  const update = (value: RouteOrder) => {
    setOrder(value);
    try { localStorage.setItem(KEY, value); } catch { /* Storage is optional. */ }
  };
  return [order, update] as const;
}
