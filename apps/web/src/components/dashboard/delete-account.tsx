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
    <div className="space-y-6 pt-10">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10">
          <AlertTriangle className="h-4 w-4 text-destructive" />
        </div>
        <div>
          <h2 className="text-base font-medium text-destructive">Danger Zone</h2>
          <p className="text-sm text-muted-foreground">Irreversible and destructive actions</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg bg-destructive/5 p-4">
        <div className="space-y-1">
          <h3 className="font-medium text-foreground">Delete Account</h3>
          <p className="text-sm text-muted-foreground">
            Permanently delete your account and all associated data
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm" className="gap-2 shrink-0">
              <Trash2 className="h-4 w-4" />
              Delete Account
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Delete Account
              </DialogTitle>
              <DialogDescription className="text-left">
                This action is permanent and cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-destructive/5 p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">
                  The following will be permanently deleted:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1.5 ml-1">
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
                    Connected integrations (GitHub, Railway, etc.)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-destructive/70" />
                    Usage history and billing data
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-destructive/70" />
                    Any feedback you&apos;ve submitted
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-sm text-muted-foreground">
                  Type{" "}
                  <span className="font-mono text-destructive font-medium">delete my account</span>{" "}
                  to confirm
                </Label>
                <Input
                  id="confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="delete my account"
                  className="font-mono border-border/50"
                  autoComplete="off"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <DialogClose asChild>
                <Button variant="ghost" onClick={() => setConfirmText("")}>
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
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete Account
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
