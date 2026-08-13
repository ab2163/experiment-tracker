/** Generate a 5-char lowercase alphanumeric id, unique against `existing`. */
export function genShortId(existing: Set<string>): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  for (let attempt = 0; attempt < 50; attempt++) {
    let id = ""
    for (let i = 0; i < 5; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (!existing.has(id)) return id
  }
  return Math.random().toString(36).slice(2, 7)
}
