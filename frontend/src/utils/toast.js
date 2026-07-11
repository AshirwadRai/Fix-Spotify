// Minimal global toast system. Any module can call toast('message') and the
// <Toaster /> mounted in App will show a transient notification.

export function toast(message) {
  if (!message) return;
  window.dispatchEvent(new CustomEvent('app-toast', { detail: String(message) }));
}
