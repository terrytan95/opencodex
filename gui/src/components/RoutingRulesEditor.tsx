import { useId } from "react";
import type { RoutingRule } from "../../../src/routing/rules";
import { useI18n } from "../i18n/shared";
import { Select } from "../ui";

export default function RoutingRulesEditor({ rules, candidates, disabled, onChange }: {
  rules: RoutingRule[]; candidates: Array<{ provider: string; model: string }>;
  disabled?: boolean; onChange: (rules: RoutingRule[]) => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const patch = (index: number, change: Partial<RoutingRule>) => onChange(rules.map((rule, i) => i === index ? { ...rule, ...change } : rule));
  const condition = (index: number, key: "project" | "client", value: string) => {
    const when = { ...rules[index]!.when };
    if (value.trim()) when[key] = value; else delete when[key];
    patch(index, { when });
  };
  return <fieldset disabled={disabled} className="routing-rules">
    <legend className="field-label">{t("rules.title")}</legend>
    {rules.map((rule, index) => <div className="routing-rule card" key={rule.id}>
      <div className="routing-rule-head">
        <span className="badge badge-muted">{index + 1}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || index === 0}
          aria-label={t("sub.moveUp", { m: rule.id })} onClick={() => { const next = [...rules]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; onChange(next); }}>↑</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || index === rules.length - 1}
          aria-label={t("sub.moveDown", { m: rule.id })} onClick={() => { const next = [...rules]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; onChange(next); }}>↓</button>
        <Select value={rule.action} label={t("rules.action")} disabled={disabled}
          options={[{ value: "prefer", label: t("rules.prefer") }, { value: "pause", label: t("rules.pause") }]}
          onChange={action => patch(index, { action: action as RoutingRule["action"] })} />
        <Select value={`${rule.target.provider}/${rule.target.model}`} label={t("rules.target")} disabled={disabled}
          options={candidates.map(candidate => ({ value: `${candidate.provider}/${candidate.model}`, label: `${candidate.provider}/${candidate.model}` }))}
          onChange={value => { const target = candidates.find(c => `${c.provider}/${c.model}` === value); if (target) patch(index, { target: { provider: target.provider, model: target.model } }); }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(rules.filter((_, i) => i !== index))}>{t("common.remove")}</button>
      </div>
      <div className="model-grid">
        <label className="field-label" htmlFor={`${id}-${index}-project`}>{t("rules.project")}
          <input id={`${id}-${index}-project`} className="input" value={rule.when.project ?? ""} maxLength={512}
            onChange={event => condition(index, "project", event.target.value)} /></label>
        <label className="field-label" htmlFor={`${id}-${index}-client`}>{t("rules.client")}
          <input id={`${id}-${index}-client`} className="input" value={rule.when.client ?? ""} maxLength={64}
            onChange={event => condition(index, "client", event.target.value)} /></label>
      </div>
      <label className="checkbox"><input type="checkbox" checked={!!rule.when.time} onChange={event => {
        const when = { ...rule.when };
        if (event.target.checked) when.time = { start: "09:00", end: "18:00", zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
        else delete when.time;
        patch(index, { when });
      }} />{t("rules.schedule")}</label>
      {rule.when.time && <div className="model-grid">
        {(["start", "end", "zone"] as const).map(key => <label className="field-label" key={key}>
          {t(`rules.${key}`)}<input className="input" type={key === "zone" ? "text" : "time"}
            value={rule.when.time![key]} onChange={event => patch(index, { when: { ...rule.when, time: { ...rule.when.time!, [key]: event.target.value } } })} />
        </label>)}
        <div className="routing-rule-days">{[1, 2, 3, 4, 5, 6, 0].map(day => {
          const selected = rule.when.time!.days ?? [0, 1, 2, 3, 4, 5, 6];
          return <button type="button" key={day} className={`btn btn-sm ${selected.includes(day) ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={selected.includes(day)} disabled={disabled || selected.length === 1 && selected.includes(day)}
            onClick={() => { const days = selected.includes(day) ? selected.filter(value => value !== day) : [...selected, day].sort();
              patch(index, { when: { ...rule.when, time: { ...rule.when.time!, days } } }); }}>
            {new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2026, 0, 4 + day))}
          </button>;
        })}</div>
      </div>}
    </div>)}
    <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || candidates.length === 0 || rules.length >= 32}
      onClick={() => { let n = rules.length + 1; while (rules.some(r => r.id === `rule-${n}`)) n++;
        onChange([...rules, { id: `rule-${n}`, action: "prefer", target: { provider: candidates[0]!.provider, model: candidates[0]!.model }, when: {} }]); }}>
      {t("rules.add")}
    </button>
  </fieldset>;
}
