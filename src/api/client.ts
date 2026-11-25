const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export function postChat(messages: unknown[]): Promise<Response> {
  return fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
}

export function postClean(file: File): Promise<Response> {
  const form = new FormData();
  form.append('file', file);
  return fetch(`${API_URL}/clean`, { method: 'POST', body: form });
}