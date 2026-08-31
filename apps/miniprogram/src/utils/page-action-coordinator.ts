export interface PageActionGuard { readonly epoch: number; readonly generation: number; readonly active: boolean; }
export interface ActionExpiryLike { requestEpoch?: number; sessionWasCleared?: boolean; }
export function isOwnedAuthExpiry(error: unknown, action: PageActionGuard, currentEpoch: number): boolean {
  const candidate = error as ActionExpiryLike | null;
  return Boolean(candidate && candidate.requestEpoch === action.epoch && candidate.sessionWasCleared === true && currentEpoch === action.epoch + 1 && action.active);
}
export class PageActionCoordinator {
  private generation = 0;
  private active = true;
  private currentState: { active: boolean } | null = null;
  begin(epoch: number): PageActionGuard {
    if (this.currentState) this.currentState.active = false;
    this.generation += 1;
    const state = { active: this.active };
    this.currentState = state;
    return {
      epoch,
      generation: this.generation,
      get active() { return state.active; },
    };
  }
  invalidate(): void {
    this.active = false;
    if (this.currentState) this.currentState.active = false;
    this.currentState = null;
    this.generation += 1;
  }
  activate(): void { this.active = true; }
  isCurrent(action: PageActionGuard, epoch: number): boolean { return this.active && action.active && action.epoch === epoch && action.generation === this.generation; }
  isActive(action: PageActionGuard): boolean { return this.active && action.active && action.generation === this.generation; }
  isAvailable(): boolean { return this.active; }
}
