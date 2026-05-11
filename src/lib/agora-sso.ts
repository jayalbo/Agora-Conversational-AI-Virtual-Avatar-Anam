/**
 * Agora SSO OAuth 2.0 authorization-code client (confidential client mode).
 *
 * Flow:
 *   1. Redirect the browser to `buildAuthorizeUrl()`.
 *   2. Agora SSO redirects back to AGORA_SSO_REDIRECT_URI with `?code=...&state=...`.
 *   3. Swap the code for tokens via `exchangeCodeForToken()`.
 *   4. Fetch the user profile via `fetchCustomer()` to identify the account.
 *
 * We never persist Agora SSO tokens — we use them once at callback to
 * identify the user, then issue our own session JWT (see `lib/auth.ts`).
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function ssoBaseUrl(): string {
  // Defaults to the international endpoint. Override with env to point
  // at staging or the China cluster (`https://sso.shengwang.cn`).
  return (process.env.AGORA_SSO_BASE_URL || "https://sso2.agora.io").replace(
    /\/+$/,
    "",
  );
}

export function ssoOpenApiBase(): string {
  return (
    process.env.AGORA_SSO_OPEN_API_BASE || "https://sso-open.agora.io/api-docs/v1"
  ).replace(/\/+$/, "");
}

function ssoClientId(): string {
  return requiredEnv("AGORA_SSO_CLIENT_ID");
}

function ssoClientSecret(): string {
  return requiredEnv("AGORA_SSO_CLIENT_SECRET");
}

export function ssoRedirectUri(): string {
  return requiredEnv("AGORA_SSO_REDIRECT_URI");
}

/** Build the browser-facing authorize URL with a caller-supplied CSRF state. */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: ssoClientId(),
    redirect_uri: ssoRedirectUri(),
    // basic_info is enough to identify the user and scope them to a quota.
    scope: "basic_info",
    state,
  });
  return `${ssoBaseUrl()}/api/v0/oauth/authorize?${params.toString()}`;
}

/** Full browser logout URL for Agora SSO. */
export function buildLogoutUrl(redirectUri: string): string {
  const params = new URLSearchParams({ redirect_uri: redirectUri });
  return `${ssoBaseUrl()}/api/v0/logout?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: ssoClientId(),
    client_secret: ssoClientSecret(),
    code,
    redirect_uri: ssoRedirectUri(),
  });
  const res = await fetch(`${ssoBaseUrl()}/api/v0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    // Avoid Next.js accidentally caching POSTs to this endpoint.
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SSO token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

/**
 * The /customer endpoint returns the authenticated Agora account profile.
 * We don't have a reliable schema reference, so we probe common fields
 * and normalize to a stable shape downstream code can depend on.
 *
 * Returned `id` is the most stable identifier we can find on the payload;
 * `email` is always preserved when present since we use it for the
 * allowlist check as a fallback.
 */
export type AgoraCustomer = {
  id: string;
  email: string;
  name: string;
  raw: Record<string, unknown>;
};

export async function fetchCustomer(
  accessToken: string,
): Promise<AgoraCustomer> {
  // We've learned from prior probes:
  //   - sso2.agora.io/api/v0/* endpoints all 401 with
  //     `redirectToLoginPage:true` — that host wants its own browser
  //     session cookie, not an OAuth bearer token. So the OAuth
  //     resource server is a *different* host.
  //   - sso-open.agora.io/api-docs/v1/* returns 404 / HTML — that path
  //     is the Swagger docs site, not a live API.
  // The real resource server is almost certainly sso-open.agora.io
  // under /api/v1 or /api/v0 (dropping "-docs"). Probe both, plus a
  // few neighboring hosts Agora uses for OpenAPI surfaces.
  const base = ssoBaseUrl();
  const openBase = ssoOpenApiBase();
  const openHost = (() => {
    try {
      return new URL(openBase).origin;
    } catch {
      return "https://sso-open.agora.io";
    }
  })();
  const candidates = [
    `${openHost}/api/v1/customer/info`,
    `${openHost}/api/v1/customer`,
    `${openHost}/api/v1/customer/me`,
    `${openHost}/api/v0/customer/info`,
    `${openHost}/api/v0/customer`,
    `${openHost}/api/v1/user/info`,
    `${openHost}/api/v1/userinfo`,
    `${openHost}/oauth/userinfo`,
    `${base}/api/v0/oauth/userinfo`,
    `${openBase}/customer/info`,
  ];
  let lastError: string | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = `${url} → ${res.status} ${text.slice(0, 200)}`;
        console.warn(`[sso] customer probe miss: ${lastError}`);
        continue;
      }
      const json = (await res.json()) as Record<string, unknown>;
      console.log(
        `[sso] customer probe hit ${url}, top-level keys=${JSON.stringify(
          Object.keys(json),
        )}`,
      );
      // Agora usually wraps responses in `{ code, message, data }`.
      const data =
        (json.data as Record<string, unknown> | undefined) ??
        (json.customer as Record<string, unknown> | undefined) ??
        json;
      try {
        return normalizeCustomer(data);
      } catch (normErr) {
        lastError = `${url} → 200 but ${(normErr as Error).message}; keys=${JSON.stringify(
          Object.keys(data),
        )}`;
        console.warn(`[sso] ${lastError}`);
        continue;
      }
    } catch (err) {
      lastError = `${url} → ${(err as Error).message}`;
      console.warn(`[sso] customer probe threw: ${lastError}`);
    }
  }
  throw new Error(
    `Failed to fetch Agora customer profile. Last error: ${lastError ?? "unknown"}`,
  );
}

function normalizeCustomer(data: Record<string, unknown>): AgoraCustomer {
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const v = data[key];
      if (v == null) continue;
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return "";
  };

  const id =
    pick("customerId", "customer_id", "userId", "user_id", "id", "uid") ||
    pick("accountId", "account_id") ||
    pick("email", "emailAddress", "email_address", "loginEmail");
  const email = pick("email", "emailAddress", "email_address", "loginEmail");
  const name = pick(
    "name",
    "displayName",
    "display_name",
    "nickname",
    "fullName",
    "full_name",
    "username",
  );

  if (!id) {
    throw new Error(
      "Agora /customer response did not include a stable user identifier.",
    );
  }

  return {
    id,
    email,
    name: name || email || id,
    raw: data,
  };
}
