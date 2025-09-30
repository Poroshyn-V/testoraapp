const handled = new Set();
export function wasHandled(id) {
    return handled.has(id);
}
export function markHandled(id) {
    handled.add(id);
}
