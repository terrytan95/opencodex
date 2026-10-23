import type { ManagementContext } from "./context";
import { assetInventory } from "../../integrations/asset-inventory";
export async function handleAssetInventoryRoutes(ctx: ManagementContext): Promise<Response | null> {
  if (ctx.url.pathname === "/api/asset-inventory" && ctx.req.method === "GET") {
    try { return Response.json(await assetInventory(), { headers: { "Cache-Control": "no-store" } }); }
    catch { return Response.json({ error: "inventory_unavailable" }, { status: 500, headers: { "Cache-Control": "no-store" } }); }
  }
  return null;
}
