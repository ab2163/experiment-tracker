import { Badge } from "@mantine/core"
import { useOmniUser } from "@shared/omni-ui"
import type { FolderKind } from "./data"

export interface Me {
  id?: string
  email?: string
}

/** Current viewer identity from the Omni bridge (null until it arrives). */
export function useMe(): Me | null {
  return useOmniUser()
}

/**
 * Whether the current viewer owns a node, by matching the server-set `created_by`
 * against the viewer's id/email. Two deliberate "treated as mine" cases:
 *  - viewer unknown (identity not yet pushed, or running outside the iframe), and
 *  - created_by null (an optimistic local row not yet round-tripped to the server).
 * This is a cosmetic affordance only — real access is enforced server-side.
 */
export function ownedByMe(createdBy: string | null | undefined, me: Me | null): boolean {
  if (!me || (!me.id && !me.email)) return true
  if (!createdBy) return true
  return createdBy === me.id || createdBy === me.email
}

/** An item shared by someone else (public and not owned by the viewer). */
export function sharedByOther(
  item: { visibility: "private" | "public"; created_by: string | null },
  me: Me | null,
): boolean {
  return item.visibility === "public" && !ownedByMe(item.created_by, me)
}

export const SHARED_FOLDER_NAME: Record<FolderKind, string> = {
  experiment: "Shared experiments",
  run_set: "Shared run sets",
  command: "Shared commands",
}

export function SharedBadge() {
  return (
    <Badge size="xs" color="teal" variant="light">
      shared
    </Badge>
  )
}
