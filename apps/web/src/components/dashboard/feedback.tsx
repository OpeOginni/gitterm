"use client";

import { Loader2, MessageCircleMoreIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogHeader,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { trpc, trpcClient } from "@/utils/trpc";
import { useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { toast } from "sonner";

export function FeedbackForm() {
  const [showThankYou, setShowThankYou] = useState(false);
  const [open, setOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { mutate: submitFeedback, isPending } = useMutation(
    trpc.user.submitFeedback.mutationOptions({
      onSuccess: () => {
        setShowThankYou(true);
        if (textareaRef.current) {
          textareaRef.current.value = "";
        }
      },
      onError: () => {
        toast.error("Failed to submit feedback");
      },
    }),
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const feedback = textareaRef.current?.value || "";
    if (feedback.trim()) {
      submitFeedback({ feedback });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="default"
          size="icon"
          className="size-10 rounded-full shadow-lg hover:shadow-xl transition-shadow bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <MessageCircleMoreIcon className="size-6" />
        </Button>
      </DialogTrigger>
      {showThankYou ? (
        <DialogContent className="bg-accent">
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold">Thank you for your feedback!</h1>
            <p className="text-sm text-muted-foreground">
              We appreciate your feedback and will use it to improve our product.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowThankYou(false);
                setOpen(false);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : (
        <DialogContent className="bg-accent">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Feedback</DialogTitle>

              <DialogDescription>Share your thoughts and suggestions with us.</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <Textarea
                ref={textareaRef}
                name="feedback"
                placeholder="What do you think about the product?"
                className="bg-secondary/50 border-border/50 shadow-none"
              />
            </div>

            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="size-4 animate-spin" /> : "Submit Feedback"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
