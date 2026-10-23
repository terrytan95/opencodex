import { useCallback, useEffect, useRef, useState } from "react";
import ProviderAuthPanel from "../components/provider-workspace/ProviderAuthPanel";
import OAuthTosWarningModal from "../components/OAuthTosWarningModal";
import type { LoginHint, ProviderAuthHandlers } from "../components/provider-workspace/types";
import { useProviderAccountPools, type OAuthStatus } from "../hooks/useProviderAccountPools";
import { useProvidersOAuth } from "./use-providers-oauth";
import { useT } from "../i18n/shared";
import { ToastNotice } from "../ui";
import "../styles/antigravity-accounts.css";

const PROVIDER = "google-antigravity";
const ITEM = { name: PROVIDER, adapter: "google", baseUrl: "https://daily-cloudcode-pa.googleapis.com", authMode: "oauth" };
const noRefresh = async () => {};
const noModelsRefresh = () => {};

/** A dedicated view of the existing OAuth pool; credentials stay in the server. */
export default function AntigravityAccounts({ apiBase }: { apiBase: string }) {
  const t = useT();
  const aliveRef = useRef(true);
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loginInfo, setLoginInfo] = useState<LoginHint | null>(null);
  const [oauthStatus, setOauthStatus] = useState<Record<string, OAuthStatus>>({});
  const [pendingLogin, setPendingLogin] = useState<{ addAccount: boolean; accountId?: string } | null>(null);
  const notify = useCallback((message: string, ok = true) => { setStatus(message); setStatusOk(ok); }, []);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  const fetchOauth = useCallback(async () => {
    const response = await fetch(`${apiBase}/api/oauth/status?provider=${PROVIDER}`);
    if (!response.ok) return;
    const current = await response.json() as OAuthStatus;
    if (aliveRef.current) setOauthStatus({ [PROVIDER]: current });
  }, [apiBase]);

  const pools = useProviderAccountPools({
    apiBase, t: t as Parameters<typeof useProviderAccountPools>[0]["t"],
    config: null, oauthStatus, aliveRef, notify,
    fetchConfig: noRefresh, fetchOauth, fetchProviderQuotas: noRefresh,
    codexActiveNeedsReauth: false,
  });
  const { fetchAccountSets, refreshAccountRosters } = pools;
  useEffect(() => {
    void fetchAccountSets([PROVIDER]);
    const refresh = () => { void refreshAccountRosters({ provider: PROVIDER, kind: "oauth" }); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [fetchAccountSets, refreshAccountRosters]);

  const oauth = useProvidersOAuth({
    apiBase, t, aliveRef, accountSets: pools.accountSets, setAccountSets: pools.setAccountSets,
    setBusy, setStatus, setLoginInfo, setOauthStatus, notify,
    fetchConfig: noRefresh, fetchOauth, fetchAccountSets,
    fetchProviderQuotas: noRefresh, bumpModelsRefresh: noModelsRefresh,
  });
  const requestLogin = (_provider: string, addAccount = false, accountId?: string) => {
    if (!busy) setPendingLogin({ addAccount, accountId });
  };
  const handlers: ProviderAuthHandlers = {
    onLogin: requestLogin,
    onReauth: (provider, accountId) => requestLogin(provider, true, accountId),
    onCancelLogin: provider => { void oauth.cancelLoginOAuth(provider); },
    onLogout: oauth.logoutOAuth,
    onSwitchAccount: pools.switchAccount,
    onPauseAccount: pools.pauseAccount,
    onRemoveAccount: pools.removeAccount,
    onEditAlias: pools.editCredentialAlias,
    onRetryAccounts: async () => { await fetchAccountSets([PROVIDER]); },
    onRefreshQuota: () => fetchAccountSets([PROVIDER], true),
    onAddApiKey: pools.addApiKeyValue,
    onSwitchApiKey: pools.switchApiKey,
    onRemoveApiKey: pools.removeApiKey,
  };

  return <div className="antigravity-accounts">
    <div className="page-head"><h2>{t("nav.antigravity")}</h2></div>
    {status && <ToastNotice tone={statusOk ? "ok" : "err"} onDismiss={() => setStatus("")} dismissLabel={t("common.close")}>{status}</ToastNotice>}
    <ProviderAuthPanel item={ITEM} apiBase={apiBase}
      accounts={pools.accountSets[PROVIDER]?.accounts ?? []}
      oauth={oauthStatus[PROVIDER]}
      accountLoadState={pools.accountLoadStates[PROVIDER] ?? "loading"}
      switchingAccountId={pools.switchingAccounts[PROVIDER]?.accountId}
      pausingAccountId={pools.pausingAccounts[PROVIDER]?.accountId}
      busy={busy === PROVIDER} loginHint={loginInfo} authHandlers={handlers} />
    {pendingLogin && <OAuthTosWarningModal providerId={PROVIDER} providerLabel={t("nav.antigravity")}
      onCancel={() => setPendingLogin(null)} onContinue={() => {
        const pending = pendingLogin;
        setPendingLogin(null);
        void oauth.loginOAuth(PROVIDER, pending.addAccount, pending.accountId);
      }} />}
  </div>;
}
