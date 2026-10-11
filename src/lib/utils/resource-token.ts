import crypto from "crypto"

const EXPIRY_MS = 60 * 60 * 1000 // 1 hour

const FALLBACK_SECRET = "dev-fallback-secret"

// M-06: fail-closed. The intake/gated-download token HMAC must never fall back
// to a known, committed dev secret. If PUBLIC_INTAKE_KEY is absent (or still
// set to the legacy placeholder) we refuse to sign — minting/verifying both
// short-circuit instead of silently using a public secret.
function loadSecret(): string {
  const secret = process.env.PUBLIC_INTAKE_KEY
  if (!secret || secret === FALLBACK_SECRET) {
    throw new Error("PUBLIC_INTAKE_KEY is not configured")
  }
  return secret
}

function sign(payload: string): string {
  const secret = loadSecret()
  return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

// Generates a signed token granting access to gated resources for 1 hour.
// Format: base64url(JSON({phone,exp})).hmac
export function generateResourceToken(phone: string): string {
  const exp = Date.now() + EXPIRY_MS
  const payload = Buffer.from(JSON.stringify({ phone, exp })).toString("base64url")
  const sig = sign(payload)
  return `${payload}.${sig}`
}

export function verifyResourceToken(token: string): { valid: boolean; phone?: string } {
  try {
    const dotIdx = token.lastIndexOf(".")
    if (dotIdx < 0) return { valid: false }

    const payload = token.slice(0, dotIdx)
    const sig = token.slice(dotIdx + 1)

    const expectedSig = sign(payload)
    // Constant-time comparison to prevent timing attacks
    if (sig.length !== expectedSig.length) return { valid: false }
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"))) {
      return { valid: false }
    }

    const { phone, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
      phone: string
      exp: number
    }

    if (!phone || !exp || Date.now() > exp) return { valid: false }

    return { valid: true, phone }
  } catch {
    return { valid: false }
  }
}
