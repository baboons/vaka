import { RefreshCw } from "lucide-react";

import { requestFeedCheck } from "@/app/actions";

import { ActionButton } from "./action-button";

export function CheckFeedsButton() {
  return (
    <ActionButton
      action={requestFeedCheck}
      icon={<RefreshCw className="size-3.5" />}
      variant="ghost"
      size="sm"
      className="mt-1.5 w-full justify-start text-[12px] text-muted-foreground hover:text-foreground"
      pendingLabel="Queuing…"
    >
      Check feeds now
    </ActionButton>
  );
}
