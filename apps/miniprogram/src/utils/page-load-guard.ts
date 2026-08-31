/** A deterministic guard for async page work that may finish after identity or lifecycle changes. */
export interface PageLoadGuard {
  readonly epoch: number;
  readonly generation: number;
  readonly isActive: boolean;
}

export function beginPageLoad(epoch: number, generation: number): PageLoadGuard {
  return { epoch, generation, isActive: true };
}

export function invalidatePageLoad(guard: PageLoadGuard): PageLoadGuard {
  return { ...guard, isActive: false };
}

export function isCurrentPageLoad(
  guard: PageLoadGuard,
  current: { epoch: number; generation: number; active: boolean },
): boolean {
  return guard.isActive && current.active && guard.epoch === current.epoch && guard.generation === current.generation;
}

export class PageLoadCoordinator {
  private generation = 0;
  private active = true;

  begin(epoch: number): PageLoadGuard {
    this.generation += 1;
    return beginPageLoad(epoch, this.generation);
  }

  hide(): void { this.active = false; this.generation += 1; }
  show(): void { this.active = true; }
  unload(): void { this.active = false; this.generation += 1; }

  isCurrent(guard: PageLoadGuard, epoch: number): boolean {
    return isCurrentPageLoad(guard, { epoch, generation: this.generation, active: this.active });
  }

  /** Lifecycle-only check for a session-expiry branch.  The epoch is expected
   * to change when the session is cleared, so navigation must use this in
   * addition to the normal epoch-aware guard. */
  isLive(guard: PageLoadGuard): boolean {
    return guard.isActive && this.active && guard.generation === this.generation;
  }
}
