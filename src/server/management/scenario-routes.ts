import type { ManagementContext } from "./context";
import { readManagementJsonBody, rethrowManagementBodyTooLarge } from "./body";
import { applyWorkspaceScenario, previewWorkspaceScenario, readWorkspaceScenarios, removeWorkspaceScenario, saveWorkspaceScenario, scenarioCurrent } from "../../integrations/scenarios";

const errors = new Set(["scenario_busy", "scenario_changed", "scenario_not_found", "scenario_name_exists", "invalid_scenario", "scenario_store_unavailable"]);
export async function handleScenarioRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { req, url } = ctx;
  if (!url.pathname.startsWith("/api/scenarios")) return null;
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if (url.pathname === "/api/scenarios" && req.method === "GET") return json({ scenarios: readWorkspaceScenarios(), current: scenarioCurrent() });
    if (url.pathname === "/api/scenarios" && req.method === "POST") {
      const raw = await readManagementJsonBody(req);
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => key !== "name" && key !== "clients")) return json({ error: "invalid_scenario" }, 400);
      const body = raw as Record<string, unknown>;
      return json({ scenario: saveWorkspaceScenario(body.name, body.clients) });
    }
    if (url.pathname === "/api/scenarios" && req.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id || id.length > 64) return json({ error: "invalid_scenario" }, 400);
      removeWorkspaceScenario(id); return json({ success: true });
    }
    if (url.pathname === "/api/scenarios/preview" && req.method === "POST") {
      const raw = await readManagementJsonBody(req);
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1
        || !("id" in raw) || typeof raw.id !== "string" || raw.id.length > 64) return json({ error: "invalid_scenario" }, 400);
      return json(previewWorkspaceScenario(raw.id));
    }
    if (url.pathname === "/api/scenarios/apply" && req.method === "POST") {
      const raw = await readManagementJsonBody(req);
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 2
        || !("id" in raw) || typeof raw.id !== "string" || raw.id.length > 64
        || !("fingerprint" in raw) || typeof raw.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(raw.fingerprint)) return json({ error: "invalid_scenario" }, 400);
      return json(applyWorkspaceScenario(raw.id, raw.fingerprint));
    }
  } catch (error) {
    rethrowManagementBodyTooLarge(error);
    const code = error instanceof Error && errors.has(error.message) ? error.message : "settings_unavailable";
    return json({ error: code }, code === "scenario_changed" || code === "scenario_busy" ? 409 : code === "scenario_not_found" ? 404 : 400);
  }
  return null;
}
