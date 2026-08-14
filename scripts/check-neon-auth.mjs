const baseUrl = process.env.NEON_AUTH_BASE_URL;

try {
  const response = await fetch(`${baseUrl?.replace(/\/$/, "")}/.well-known/jwks.json`);
  const payload = await response.json();
  console.log(response.ok && Array.isArray(payload.keys) ? "NEON_AUTH_READY" : "NEON_AUTH_NOT_READY");
  if (!response.ok || !Array.isArray(payload.keys)) process.exitCode = 1;
} catch (error) {
  console.error("NEON_AUTH_CHECK_FAILED", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
