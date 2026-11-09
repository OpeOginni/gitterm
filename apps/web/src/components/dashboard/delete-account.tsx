"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/utils/trpc";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { SettingsPart } from "@/components/dashboard/settings/settings-page";
import { Panel, PanelRow } from "@/components/dashboard/kit";

export function DeleteAccountSection() {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const router = useRouter();

  const deleteAccountMutation = useMutation(
    trpc.user.deleteUser.mutationOptions({
      onSuccess: async () => {
        toast.success("Account deleted successfully");
        await authClient.signOut();
        router.push("/");
      },
      onError: (error) => {
        toast.error(`Failed to delete account: ${error.message}`);
      },
    }),
  );

  const handleDelete = () => {
    if (confirmText !== "delete my account") {
      toast.error("Please type 'delete my account' to confirm");
      return;
    }
    deleteAccountMutation.mutate();
  };

  const isConfirmValid = confirmText === "delete my account";

  return (
    <SettingsPart id="delete" label="Delete account">
      <Panel>
        <PanelRow className="flex-col items-start gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-[13.5px] leading-relaxed text-fg-3">
            Permanently delete your profile, workspaces, integrations, and usage history. This
            can&apos;t be undone.
          </p>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button
                variant="secondary"
                className="shrink-0 gap-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="size-4" />
                Delete account
              </Button>
            </DialogTrigger>
            <DialogContent className="border-line bg-settings-dialog sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-destructive" />
                  Delete account
                </DialogTitle>
                <DialogDescription className="text-left">
                  This action is permanent and cannot be undone.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-3 rounded-xl bg-destructive/[0.07] p-4">
                  <p className="text-[14px] font-medium text-fg">This permanently deletes</p>
                  <ul className="ml-1 space-y-1.5 text-[14px] text-fg-3">
                    <li className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-destructive/70" />
                      Your profile and account settings
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-destructive/70" />
                      All your workspaces and their configurations
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-destructive/70" />
                      Connected integrations (GitHub, etc.)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-destructive/70" />
                      Usage history and billing data
                    </li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm" className="text-[13.5px] font-normal text-fg-3">
                    Type{" "}
                    <span className="font-mono font-medium text-destructive">
                      delete my account
                    </span>{" "}
                    to confirm
                  </Label>
                  <Input
                    id="confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="delete my account"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary" onClick={() => setConfirmText("")}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={!isConfirmValid || deleteAccountMutation.isPending}
                  className="gap-2"
                >
                  {deleteAccountMutation.isPending ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Deleting…
                    </>
                  ) : (
                    <>
                      <Trash2 className="size-4" />
                      Delete account
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </PanelRow>
      </Panel>
    </SettingsPart>
  );
}
