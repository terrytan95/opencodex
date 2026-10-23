export interface AssetSource { client: string; kind: "skill" | "mcp"; path: string; format?: "toml" | "json"; key?: string }
export interface InventoryAsset {
  kind: "skill" | "mcp";
  name: string;
  clients: string[];
  sources: string[];
  status: "present" | "linked" | "broken" | "unavailable";
  duplicate: boolean;
  version?: string;
  transport?: string;
}
export interface AssetInventory {
  generatedAt: number;
  partial: boolean;
  entries: InventoryAsset[];
  sources: Array<AssetSource & { status: "read" | "missing" | "unavailable" }>;
}
