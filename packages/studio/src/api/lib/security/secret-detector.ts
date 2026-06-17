/**
 * Secret detection and redaction module.
 *
 * Detects common secret patterns (API keys, tokens, private keys, etc.)
 * and replaces them with [REDACTED:type] placeholders.
 *
 * Used in the memory pipeline to prevent secrets from being persisted.
 */

// ── Secret pattern definitions ───────────────────────────────────────────

export interface SecretPattern {
  name: string
  type: string
  regex: RegExp
}

export interface SecretMatch {
  type: string
  start: number
  end: number
  matched: string
}

const SECRET_PATTERNS: SecretPattern[] = [
  // AWS
  { name: 'AWS Access Key ID', type: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'AWS Secret Access Key', type: 'aws_secret_key', regex: /\b[0-9a-zA-Z/+]{40}\b/g },
  { name: 'AWS Session Token', type: 'aws_session_token', regex: /\bFwoGZXIvYXdzE[A-Za-z0-9/+=]{100,}\b/g },

  // GitHub
  { name: 'GitHub PAT', type: 'github_token', regex: /\bghp_[A-Za-z0-9_]{36,}\b/g },
  { name: 'GitHub OAuth', type: 'github_token', regex: /\bgho_[A-Za-z0-9_]{36,}\b/g },
  { name: 'GitHub App Token', type: 'github_token', regex: /\bghs_[A-Za-z0-9_]{36,}\b/g },
  { name: 'GitHub Fine-grained PAT', type: 'github_token', regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },

  // GitLab
  { name: 'GitLab PAT', type: 'gitlab_token', regex: /\bglpat-[A-Za-z0-9\-_]{20,}\b/g },

  // Slack
  { name: 'Slack Token', type: 'slack_token', regex: /\bxox[bpors]-[0-9a-zA-Z\-]{10,}\b/g },
  { name: 'Slack Webhook', type: 'slack_webhook', regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g },

  // Stripe
  { name: 'Stripe Secret Key', type: 'stripe_key', regex: /\bsk_live_[0-9a-zA-Z]{24,}\b/g },
  { name: 'Stripe Restricted Key', type: 'stripe_key', regex: /\brk_live_[0-9a-zA-Z]{24,}\b/g },

  // OpenAI
  { name: 'OpenAI API Key', type: 'openai_key', regex: /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/g },
  { name: 'OpenAI Project Key', type: 'openai_key', regex: /\bsk-proj-[A-Za-z0-9_-]{40,}\b/g },

  // Anthropic
  { name: 'Anthropic API Key', type: 'anthropic_key', regex: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g },

  // Google
  { name: 'Google API Key', type: 'google_key', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { name: 'Google OAuth', type: 'google_oauth', regex: /\b[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com\b/g },

  // Private Keys
  { name: 'Private Key', type: 'private_key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },

  // JWT
  { name: 'JWT', type: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g },

  // Generic patterns (lower confidence — checked last)
  { name: 'Generic Secret Assignment', type: 'generic_secret', regex: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|credentials)\s*[:=]\s*['"][^'"]{8,}['"]/gi },
  { name: 'Bearer Token', type: 'bearer_token', regex: /\bBearer\s+[A-Za-z0-9_\-.]{20,}\b/g },

  // Database URLs with credentials
  { name: 'Database URL', type: 'database_url', regex: /(?:postgres|mysql|mongodb|redis|amqp):\/\/[^:]+:[^@]+@[^\s'"]+/g },

  // npm tokens
  { name: 'npm Token', type: 'npm_token', regex: /\bnpm_[A-Za-z0-9]{36}\b/g },

  // Heroku
  { name: 'Heroku API Key', type: 'heroku_key', regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g },

  // SendGrid
  { name: 'SendGrid API Key', type: 'sendgrid_key', regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },

  // Twilio
  { name: 'Twilio API Key', type: 'twilio_key', regex: /\bSK[0-9a-fA-F]{32}\b/g },
]

// Patterns that are too generic and produce false positives — skip for containsSecrets fast check
const HIGH_CONFIDENCE_PATTERNS = SECRET_PATTERNS.filter(
  p => !['generic_secret', 'bearer_token', 'heroku_key'].includes(p.type)
)

// ── Public API ───────────────────────────────────────────────────────────

export function detectSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = []

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.regex.exec(text)) !== null) {
      matches.push({
        type: pattern.type,
        start: match.index,
        end: match.index + match[0].length,
        matched: match[0],
      })
    }
  }

  matches.sort((a, b) => a.start - b.start)
  return deduplicateOverlapping(matches)
}

export function redactSecrets(text: string): string {
  const matches = detectSecrets(text)
  if (matches.length === 0) return text

  let result = ''
  let lastEnd = 0

  for (const match of matches) {
    result += text.slice(lastEnd, match.start)
    result += `[REDACTED:${match.type}]`
    lastEnd = match.end
  }

  result += text.slice(lastEnd)
  return result
}

export function containsSecrets(text: string): boolean {
  for (const pattern of HIGH_CONFIDENCE_PATTERNS) {
    pattern.regex.lastIndex = 0
    if (pattern.regex.test(text)) return true
  }
  return false
}

export function getSecretPatternTypes(): string[] {
  return [...new Set(SECRET_PATTERNS.map(p => p.type))]
}

// ── Helpers ──────────────────────────────────────────────────────────────

function deduplicateOverlapping(matches: SecretMatch[]): SecretMatch[] {
  if (matches.length <= 1) return matches

  const result: SecretMatch[] = [matches[0]!]

  for (let i = 1; i < matches.length; i++) {
    const current = matches[i]!
    const prev = result[result.length - 1]!

    if (current.start < prev.end) {
      if (current.end - current.start > prev.end - prev.start) {
        result[result.length - 1] = current
      }
    } else {
      result.push(current)
    }
  }

  return result
}
