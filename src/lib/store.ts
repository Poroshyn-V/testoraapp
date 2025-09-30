const handled = new Set<string>();

export function wasHandled(id: string): boolean {
  return handled.has(id);
}

export function markHandled(id: string): void {
  handled.add(id);
}
