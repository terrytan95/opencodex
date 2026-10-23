export const CONTEXT_PARTS = ["instructions", "tools", "mcp", "files", "results", "conversation"] as const;
export type ContextPart = typeof CONTEXT_PARTS[number];
export interface ContextSample {
  at: number;
  model: string;
  provider: string;
  parts: Record<ContextPart, number>;
  estimatedTokens: number;
  reportedTokens?: number;
  cachedTokens?: number;
  delta?: number;
  truncated: boolean;
  remoteHistory: boolean;
  largest: Array<{ part: ContextPart; tokens: number; index: number }>;
}
export interface ContextSession { id: string; samples: ContextSample[] }
export interface ContextSnapshot { enabled: boolean; expiresAt: number; sessions: ContextSession[] }
export interface ContextDraft extends Pick<ContextSample, "parts" | "estimatedTokens" | "truncated" | "remoteHistory" | "largest"> {
  session: string;
  generation: number;
}
