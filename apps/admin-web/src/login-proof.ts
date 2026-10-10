export interface LoginChallenge { challenge: string; bits: number; expiresAt: string }

/** WebCrypto runs off the UI thread; bounded batches yield between attempts so
 * typing/navigation remain responsive. No credentials are part of the work. */
export async function solveLoginChallenge(value: LoginChallenge): Promise<{ challenge: string; nonce: string }> {
  if (value.bits < 8 || value.bits > 22 || value.challenge.length > 1024) throw new Error("无效的安全验证");
  const encoder = new TextEncoder();
  for (let start = 0; start < 100_000_000; start += 128) {
    if (Date.now() >= Date.parse(value.expiresAt)) throw new Error("安全验证已失效，请重试");
    const results = await Promise.all(Array.from({ length: 128 }, async (_, offset) => {
      const nonce = String(start + offset);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${value.challenge}:${nonce}`)));
      for (let bit = 0; bit < value.bits; bit += 1) if ((digest[Math.floor(bit / 8)]! & (128 >> (bit % 8))) !== 0) return null;
      return nonce;
    }));
    const nonce = results.find(result => result !== null);
    if (nonce !== undefined) return { challenge: value.challenge, nonce };
  }
  throw new Error("安全验证未完成，请重试");
}
