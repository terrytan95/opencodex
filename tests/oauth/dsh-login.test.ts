import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectDshAccount,
  validateDshAccountToken,
  loginDshAccount,
  refreshDshAccountToken,
  resolveDshCredentialsPath,
  DSH_PROFILE_MAX_BYTES,
} from "../../src/oauth/dsh";
import { removeTreeWithRetry } from "../helpers/remove-tree";

let tmp: string;
let prevDshHome: string | undefined;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ocx-dsh-test-"));
  prevDshHome = process.env.DSH_HOME;
});

afterAll(() => {
  removeTreeWithRetry(tmp);
});

afterEach(() => {
  if (prevDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = prevDshHome;
});

describe("DSH Account Detection (read-only)", () => {
  test("returns detected: false when credentials file does not exist", () => {
    process.env.DSH_HOME = join(tmp, "missing-dir");
    const res = detectDshAccount();
    expect(res.detected).toBe(false);
  });

  test("returns detected: false when yaml is invalid", () => {
    const dir = join(tmp, "invalid-yaml");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".credentials.yaml"), "records: [secret-yaml-token");
    process.env.DSH_HOME = dir;

    const res = detectDshAccount();
    expect(res.detected).toBe(false);
    expect(res.error).toBe("CREDENTIAL_FILE_READ_FAILED");
  });

  test("returns detected: false when grant record is missing", () => {
    const dir = join(tmp, "no-grant");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".credentials.yaml"), "records:\n  other-key:\n    kind: grant\n");
    process.env.DSH_HOME = dir;

    const res = detectDshAccount();
    expect(res.detected).toBe(false);
  });

  test("detects valid grant and extracts token without mutating the file", () => {
    const dir = join(tmp, "valid-grant");
    mkdirSync(dir, { recursive: true });
    const credPath = join(dir, ".credentials.yaml");
    const yamlContent = `records:
  deepseek-account-platform/default:
    kind: grant
    payload:
      version: 1
      token: dsh_test_token_12345
      issuer: https://platform.deepseek.com
`;
    writeFileSync(credPath, yamlContent);
    const beforeStat = statSync(credPath);
    process.env.DSH_HOME = dir;

    const res = detectDshAccount();
    expect(res.detected).toBe(true);
    expect(res.token).toBe("dsh_test_token_12345");
    expect(res.issuer).toBe("https://platform.deepseek.com");

    const afterStat = statSync(credPath);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    expect(afterStat.size).toBe(beforeStat.size);
  });
});

describe("DSH Account Validation", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns valid: true and identity when upstream returns 200 with code 0", async () => {
    let capturedAuthToken: string | undefined;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth-api/v0/users/current")) {
        const headers = init?.headers as Record<string, string>;
        capturedAuthToken = headers?.["x-dsh-auth-token"];
        return new Response(JSON.stringify({
          code: 0,
          data: {
            biz_code: 0,
            biz_data: {
              id: "user-123",
              email: "user@example.com",
              id_profile: { name: "Test User" },
            },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    };

    const res = await validateDshAccountToken("mock-valid-token");
    expect(capturedAuthToken).toBe("mock-valid-token");
    expect(res.valid).toBe(true);
    expect(res.accountId).toBe("user-123");
    expect(res.email).toBe("user@example.com");
    expect(res.name).toBe("Test User");
  });

  test("rejects profiles without a stable ID instead of sharing a fallback account slot", async () => {
    for (const id of [undefined, null, "", "   ", 123]) {
      globalThis.fetch = async () => Response.json({
        code: 0, data: { biz_code: 0, biz_data: { id, email: "same@example.com", mobile: "123", id_profile: { name: "Same Name" } } },
      });
      const result = await validateDshAccountToken("mock-token");
      expect(result).toEqual({ valid: false, error: "ACCOUNT_IDENTITY_UNVERIFIED" });
    }
  });

  test("imports WAF-blocked grants only after summary validation and keeps token slots separate", async () => {
    const previousHome = process.env.OPENCODEX_HOME;
    process.env.OPENCODEX_HOME = join(tmp, "grant-slots");
    const dir = join(tmp, "blocked-profile");
    mkdirSync(dir, { recursive: true });
    process.env.DSH_HOME = dir;
    try {
      const { saveCredential, getAccountSet } = await import("../../src/oauth/store");
      for (const [index, token] of ["grant-a", "grant-b", "grant-a"].entries()) {
        const content = `records:\n  deepseek-account-platform/default:\n    kind: grant\n    payload:\n      token: ${token}\n`;
        const path = join(dir, ".credentials.yaml");
        writeFileSync(path, content);
        const before = statSync(path);
        const calls: string[] = [];
        globalThis.fetch = async (input, init) => {
          calls.push(String(input));
          expect(init?.redirect).toBe("manual");
          expect(new Headers(init?.headers).get("x-dsh-auth-token")).toBe(token);
          return calls.length === 1
            ? new Response(null, { status: index === 1 ? 202 : 403, headers: { "x-amzn-waf-action": "challenge" } })
            : Response.json({ code: 0, data: { biz_code: 0, biz_data: { normal_wallets: [], bonus_wallets: [], total_costs: [] } } });
        };
        const credential = await loginDshAccount({ signal: new AbortController().signal });
        expect(calls).toEqual([
          "https://platform.deepseek.com/auth-api/v0/users/current",
          "https://platform.deepseek.com/api/v0/users/get_user_summary",
        ]);
        expect(credential.accountId).toMatch(/^dsh-grant:[a-f0-9]{64}$/);
        expect(credential.accountId).not.toContain(token);
        expect(credential.email).toBeUndefined();
        await saveCredential("dsh-account", credential);
        expect(readFileSync(path, "utf8")).toBe(content);
        expect(statSync(path).mtimeMs).toBe(before.mtimeMs);
      }
      expect(getAccountSet("dsh-account")!.accounts.map(a => a.credential.access)).toEqual(["grant-a", "grant-b"]);
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODEX_HOME;
      else process.env.OPENCODEX_HOME = previousHome;
    }
  });

  test("summary fallback rejects errors, redirects, missing wallets and oversized bodies", async () => {
    const failures = [
      () => new Response(null, { status: 401 }),
      () => new Response(null, { status: 403 }),
      () => new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
      () => Response.json({ code: 0, data: { biz_code: 1, biz_data: { normal_wallets: [] } } }),
      () => Response.json({ code: 0, data: { biz_code: 0, biz_data: {} } }),
      () => new Response("secret-invalid-json"),
      () => new Response("x".repeat(DSH_PROFILE_MAX_BYTES + 1)),
    ];
    for (const failure of failures) {
      let calls = 0;
      globalThis.fetch = async () => ++calls === 1 ? new Response(null, { status: 403 }) : failure();
      const result = await validateDshAccountToken("grant-a");
      expect(calls).toBe(2);
      expect(result.valid).toBe(false);
      expect(result.error).not.toContain("secret");
    }
  });

  test("keeps distinct upstream identities separate even when email and display names coincide", async () => {
    const previousHome = process.env.OPENCODEX_HOME;
    process.env.OPENCODEX_HOME = join(tmp, "identity-slots");
    try {
      const { saveCredential, getAccountSet } = await import("../../src/oauth/store");
      for (const [index, id] of ["account-a", "account-b", "account-a"].entries()) {
        globalThis.fetch = async () => Response.json({
          code: 0, data: { biz_code: 0, biz_data: { id, email: "same@example.com", id_profile: { name: "Same Name" } } },
        });
        const result = await validateDshAccountToken("mock-token");
        expect(result.valid).toBe(true);
        await saveCredential("dsh-account", { accountId: result.accountId, email: result.email, access: `mock-token-${index}`, refresh: `mock-token-${index}`, expires: Number.MAX_SAFE_INTEGER });
      }
      const accounts = getAccountSet("dsh-account")!.accounts;
      expect(accounts).toHaveLength(2);
      expect(accounts.map(a => a.credential.accountId)).toEqual(["account-a", "account-b"]);
      expect(accounts.map(a => a.credential.access)).toEqual(["mock-token-2", "mock-token-1"]);
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODEX_HOME;
      else process.env.OPENCODEX_HOME = previousHome;
    }
  });

  test("rejects a failed business response even if it includes a profile", async () => {
    globalThis.fetch = async () => Response.json({ code: 0, data: { biz_code: 1, biz_data: { id: "account-a" } } });
    expect((await validateDshAccountToken("mock-token")).valid).toBe(false);
  });

  test("does not reflect secret profile fragments from parser failures", async () => {
    globalThis.fetch = async () => new Response('invalid-json-with-secret-token-and-identity', { status: 200 });
    expect(await validateDshAccountToken("mock-token")).toEqual({ valid: false, error: "PROFILE_VALIDATION_FAILED" });
  });

  test("rejects malformed UTF-8 inside the authoritative account ID instead of accepting an altered ID", async () => {
    const encoder = new TextEncoder();
    const prefix = encoder.encode('{"code":0,"data":{"biz_code":0,"biz_data":{"id":"user-');
    const suffix = encoder.encode('","email":"u@example.com"}}}');
    const malformed = new Uint8Array(prefix.length + 1 + suffix.length);
    malformed.set(prefix);
    malformed.set([0xff], prefix.length);
    malformed.set(suffix, prefix.length + 1);
    globalThis.fetch = async () => new Response(malformed, { status: 200 });

    expect(await validateDshAccountToken("mock-token")).toEqual({ valid: false, error: "PROFILE_VALIDATION_FAILED" });
  });

  test("returns ACCOUNT_TOKEN_INVALID when upstream returns 401", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth-api/v0/users/current")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return originalFetch(input, init);
    };

    const res = await validateDshAccountToken("expired-token");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("ACCOUNT_TOKEN_INVALID");
  });

  test("profile endpoint rejects 3xx redirect with manual policy and does not forward token", async () => {
    let evilTargetReceivedToken = false;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth-api/v0/users/current")) {
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example.com/steal" },
        });
      }
      if (url.includes("evil.example.com")) {
        evilTargetReceivedToken = true;
        return new Response("ok");
      }
      return originalFetch(input, init);
    };

    const res = await validateDshAccountToken("secret-token");
    expect(res.valid).toBe(false);
    expect(evilTargetReceivedToken).toBe(false);
  });

  test("rejects a declared oversized profile body without reading the stream", async () => {
    let cancelReason: unknown;
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // A regression that reads the body closes it instead of stalling on an
        // open stream, so this asserts the pull flag directly instead of
        // failing through an indirect timeout path.
        pulled = true;
        controller.close();
      },
      cancel(reason) {
        cancelReason = reason;
      },
    }, { highWaterMark: 0 });
    globalThis.fetch = async () => new Response(body, {
      status: 200,
      headers: { "content-length": String(DSH_PROFILE_MAX_BYTES + 1) },
    });

    const res = await validateDshAccountToken("mock-token");
    expect(res).toEqual({ valid: false, error: "PROFILE_VALIDATION_FAILED" });
    expect(cancelReason).toBeInstanceOf(DOMException);
    expect((cancelReason as DOMException).name).toBe("QuotaExceededError");
    expect(pulled).toBe(false);
  });

  test("rejects an oversized profile stream when content-length is missing or understated", async () => {
    for (const headers of [undefined, { "content-length": "8" }]) {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(DSH_PROFILE_MAX_BYTES + 1));
        },
        cancel() {
          cancelled = true;
        },
      });
      globalThis.fetch = async () => new Response(body, { status: 200, headers });

      const res = await validateDshAccountToken("mock-token");
      expect(res).toEqual({ valid: false, error: "PROFILE_VALIDATION_FAILED" });
      expect(cancelled).toBe(true);
    }
  });

  test("accepts a profile document at the byte cap and rejects one byte over a chunked boundary", async () => {
    const base = JSON.stringify({
      code: 0,
      data: { biz_code: 0, biz_data: { id: "user-cap", email: "cap@example.com" } },
    });
    const encoder = new TextEncoder();
    const atCap = base + " ".repeat(DSH_PROFILE_MAX_BYTES - base.length);
    expect(encoder.encode(atCap).byteLength).toBe(DSH_PROFILE_MAX_BYTES);

    globalThis.fetch = async () => new Response(atCap, { status: 200 });
    const ok = await validateDshAccountToken("mock-token");
    expect(ok.valid).toBe(true);
    expect(ok.accountId).toBe("user-cap");

    const overCap = encoder.encode(atCap + " ");
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(overCap.subarray(0, DSH_PROFILE_MAX_BYTES));
        controller.enqueue(overCap.subarray(DSH_PROFILE_MAX_BYTES));
      },
    });
    globalThis.fetch = async () => new Response(chunked, { status: 200 });
    expect(await validateDshAccountToken("mock-token")).toEqual({ valid: false, error: "PROFILE_VALIDATION_FAILED" });
  });

  test("rejects with the caller's abort reason while the profile body is still streaming", async () => {
    const body = new ReadableStream<Uint8Array>({ start() { /* open stream, no data */ } });
    globalThis.fetch = async () => new Response(body, { status: 200 });
    const controller = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    const pending = validateDshAccountToken("mock-token", controller.signal);
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  test("surfaces a stalled profile body as PROFILE_VALIDATION_FAILED instead of hanging", async () => {
    const body = new ReadableStream<Uint8Array>({ start() { /* open stream, no data */ } });
    globalThis.fetch = async () => new Response(body, { status: 200 });
    expect(await validateDshAccountToken("mock-token"))
      .toEqual({ valid: false, error: "PROFILE_VALIDATION_FAILED" });
  }, 30_000);
});

describe("DSH Account Login Flow", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("loginDshAccount imports credential successfully after authoritative validation", async () => {
    const dir = join(tmp, "login-success");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".credentials.yaml"), `records:
  deepseek-account-platform/default:
    kind: grant
    payload:
      token: dsh_secret_grant_token
`);
    process.env.DSH_HOME = dir;

    globalThis.fetch = async (input) => {
      if (String(input).includes("/auth-api/v0/users/current")) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            biz_code: 0,
            biz_data: {
              id: "dsh-user-999",
              email: "dsh@example.com",
            },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    };

    const ctrl = { signal: new AbortController().signal };
    const cred = await loginDshAccount(ctrl);

    expect(cred.access).toBe("dsh_secret_grant_token");
    expect(cred.accountId).toBe("dsh-user-999");
    expect(cred.email).toBe("dsh@example.com");
    expect(cred.source).toBe("credential-file");
  });

  test("loginDshAccount fails with clear error if credentials file is missing", async () => {
    process.env.DSH_HOME = join(tmp, "no-such-dsh");
    const ctrl = { signal: new AbortController().signal };

    await expect(loginDshAccount(ctrl)).rejects.toThrow("DeepSeek Harness account not found in ~/.dsh/.credentials.yaml");
  });

  test("loginDshAccount fails with clear error if token is expired (401)", async () => {
    const dir = join(tmp, "login-401");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".credentials.yaml"), `records:
  deepseek-account-platform/default:
    kind: grant
    payload:
      token: expired_grant_token
`);
    process.env.DSH_HOME = dir;

    globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });

    const ctrl = { signal: new AbortController().signal };
    await expect(loginDshAccount(ctrl)).rejects.toThrow("invalid or expired (ACCOUNT_TOKEN_INVALID)");
  });
});

describe("DSH Account Refresh Contract (explicit import only)", () => {
  test("refreshDshAccountToken fails terminally without reading ~/.dsh/.credentials.yaml", async () => {
    const dir = join(tmp, "refresh-isolation");
    mkdirSync(dir, { recursive: true });
    const credPath = join(dir, ".credentials.yaml");
    writeFileSync(credPath, `records:
  deepseek-account-platform/default:
    kind: grant
    payload:
      token: newly_logged_in_token
`);
    process.env.DSH_HOME = dir;

    // Even if credentials file exists with a newer token, background refresh MUST NOT adopt it
    const { refreshDshAccountToken } = await import("../../src/oauth/dsh");
    await expect(refreshDshAccountToken("old-token")).rejects.toThrow(
      "DeepSeek Harness account session expired or revoked. Please sign in to DeepSeek Harness Desktop and re-import.",
    );

    // Verify the credentials file was NOT modified
    const content = readFileSync(credPath, "utf8");
    expect(content).toContain("newly_logged_in_token");
  });
});

