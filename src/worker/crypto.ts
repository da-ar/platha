export function randomId(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Constant-time string comparison. Returns false on a length mismatch. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.byteLength !== y.byteLength) {
    crypto.subtle.timingSafeEqual(x, x)
    return false
  }
  return crypto.subtle.timingSafeEqual(x, y)
}
