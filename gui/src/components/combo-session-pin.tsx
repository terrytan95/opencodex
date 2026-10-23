import { useId } from "react";
import { JEV_SESSION_PIN_TTL_MAX_MS, JEV_SESSION_PIN_TTL_MIN_MS, type JevSessionPinConfig } from "../../../src/combos/jev-session-pin-config";
import { useT } from "../i18n/shared";
import { Switch } from "../ui";

export function ComboSessionPin({ value, disabled, onChange }: {
  value: JevSessionPinConfig | null;
  disabled?: boolean;
  onChange: (value: JevSessionPinConfig | null) => void;
}) {
  const t = useT();
  const inputId = useId();
  return <div className="cwi-field">
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
      <span className="field-label">{t("cws.jev.sessionPin")}</span>
      <Switch on={value !== null} disabled={disabled} label={t("cws.jev.sessionPin")}
        onClick={() => onChange(value ? null : { ttlMs: 20 * 60_000 })} />
    </div>
    <p className="muted text-label">{t("cws.jev.sessionPinHint")}</p>
    {value !== null && <div className="cwi-field">
      <label htmlFor={inputId}>{t("cws.jev.sessionPinMinutes")}</label>
      <input id={inputId} className="input mono" type="number" inputMode="decimal"
        min={JEV_SESSION_PIN_TTL_MIN_MS / 60_000} max={JEV_SESSION_PIN_TTL_MAX_MS / 60_000}
        step="any" value={value.ttlMs === 0 ? "" : value.ttlMs / 60_000} disabled={disabled}
        onChange={event => onChange({ ttlMs: Math.round(Number(event.target.value) * 60_000) })} />
    </div>}
  </div>;
}
