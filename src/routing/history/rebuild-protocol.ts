/** Messages between the indexer and its rebuild worker (#6990). Types only. */

import type { UsageLogRevision } from "../../usage/log";

export type RebuildWorkerRequest = {
  type: "build";
  indexPath: string;
  buildPath: string;
  reason: string;
  revision: UsageLogRevision;
  /** When present, seed the private build from the existing index and ingest only its tail. */
  fromOffset?: number;
};

export type RebuildWorkerReply =
  | { type: "built"; rows: number }
  | { type: "error"; name: string; message: string };
