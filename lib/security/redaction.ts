const sensitiveJsonKeyPattern =
  /"((?:[A-Z0-9_]*(?:API_KEY|CLIENT_SECRET|DATABASE_URL|ENCRYPTION_KEY|PASSWORD|PRIVATE_KEY|SECRET|SESSION_SECRET|TOKEN|WEBHOOK_URL)[A-Z0-9_]*|access_token|accessToken|refresh_token|refreshToken|id_token|idToken|api_key|apiKey|client_secret|clientSecret|client_password|clientPassword|databaseUrl|encryptionKey|password|privateKey|secret|sessionSecret|token|webhookUrl|resetUrl|resetURL|reset_url|resetToken|session_token|sessionToken|authorization|cookie|set-cookie|setCookie))"\s*:\s*(?:"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/gi;

const sensitiveKeyPattern =
  /^(?:[A-Z0-9_]*(?:API_KEY|CLIENT_SECRET|DATABASE_URL|ENCRYPTION_KEY|PASSWORD|PRIVATE_KEY|SECRET|SESSION_SECRET|TOKEN|WEBHOOK_URL)[A-Z0-9_]*|access_token|accessToken|refresh_token|refreshToken|id_token|idToken|api_key|apiKey|client_secret|clientSecret|client_password|clientPassword|databaseUrl|encryptionKey|password|privateKey|secret|sessionSecret|token|webhookUrl|resetUrl|resetURL|reset_url|resetToken|session_token|sessionToken|authorization|cookie|set-cookie|setCookie)$/i;

export function redactSensitiveText(value: string | undefined) {
  return (value ?? "")
    .replace(sensitiveJsonKeyPattern, '"$1":"[redacted]"')
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s\/:@"]+:[^\s\/@"]+@/gi,
      "$1[redacted]@"
    )
    .replace(
      /\b((?:[A-Z0-9_]*(?:API_KEY|CLIENT_SECRET|DATABASE_URL|ENCRYPTION_KEY|PASSWORD|PRIVATE_KEY|SECRET|SESSION_SECRET|TOKEN|WEBHOOK_URL)[A-Z0-9_]*)\s*=\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/g,
      "$1[redacted]"
    )
    .replace(
      /\b((?:databaseUrl|encryptionKey|privateKey|sessionSecret|webhookUrl)\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
      "$1[redacted]"
    )
    .replace(/\b(https?:\/\/[^\s"]+\/f\/)[A-Za-z0-9_-]{32,128}\b/gi, "$1[redacted]")
    .replace(/(^|[\s"'])\/f\/[A-Za-z0-9_-]{32,128}\b/g, "$1/f/[redacted]")
    .replace(/\b(https?:\/\/[^\s"]+\/q\/)[A-Za-z0-9_-]{32,128}\b/gi, "$1[redacted]")
    .replace(/(^|[\s"'])\/q\/[A-Za-z0-9_-]{32,128}\b/g, "$1/q/[redacted]")
    .replace(/\b(https?:\/\/[^\s"]+\/s\/)[A-Za-z0-9_-]{32,128}\b/gi, "$1[redacted]")
    .replace(/(^|[\s"'])\/s\/[A-Za-z0-9_-]{32,128}\b/g, "$1/s/[redacted]")
    .replace(/\b((?:cookie|set-cookie)\s*:\s*)[^\r\n"]+/gi, "$1[redacted]")
    .replace(/\b(authorization\s*[:=]\s*)(?:[^\s,:;&"]+[ \t]+)?[^\s,:;&"]+/gi, "$1[redacted]")
    .replace(/\b((?:x-api-key|api-key)\s*[:=]\s*)[^\s,:;&"]+/gi, "$1[redacted]")
    .replace(/\b(?:raw\s+)?provider\s+(?:payload|error)\s*[:=]\s*[^\r\n]+/gi, "[redacted provider detail]")
    .replace(/\braw\s+gmail\s+(?:body|headers?|payload|error)\s*[:=]\s*[^\r\n]+/gi, "[redacted provider detail]")
    .replace(/Bearer\s+[\w.+/~=-]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s"]+\/reset-password\?[^\s"]*\btoken=[^&\s"]+[^\s"]*/gi, "[redacted reset url]")
    .replace(/\/reset-password\?[^\s"]*\btoken=[^&\s"]+[^\s"]*/gi, "[redacted reset url]")
    .replace(/\b(reset[-_\s]?token\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\b(reset\s+token\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(token\s*[:=]\s*)[^\s,;&"]+/gi, "$1[redacted]")
    .replace(/([?&](?:code|state|error_description)=)[^&\s"]+/gi, "$1[redacted]")
    .replace(
      /([?&](?:access_token|accessToken|refresh_token|refreshToken|id_token|idToken|api_key|apiKey|client_secret|clientSecret|client_password|clientPassword|password|secret|session_token|sessionToken)=)[^&\s"]+/gi,
      "$1[redacted]"
    )
    .replace(
      /\b((?:access_token|accessToken|refresh_token|refreshToken|id_token|idToken|api_key|apiKey|client_secret|clientSecret|client_password|clientPassword|password|secret|token|session_token|sessionToken)\s*[:=]\s*)[^\s,;&"]+/gi,
      "$1[redacted]"
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]");
}

export function isSensitiveRedactionKey(key: string | undefined) {
  return sensitiveKeyPattern.test(key ?? "");
}
