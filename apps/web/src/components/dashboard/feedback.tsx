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
import { trpc } from "@/utils/trpc";
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
          size="icon"
          aria-label="Send feedback"
          className="size-11 rounded-full shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]"
        >
          <MessageCircleMoreIcon className="size-5" />
        </Button>
      </DialogTrigger>
      {showThankYou ? (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thanks for the feedback</DialogTitle>
            <DialogDescription>
              We read every message and use it to improve Gitterm.
            </DialogDescription>
          </DialogHeader>
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
        <DialogContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Feedback</DialogTitle>
              <DialogDescription>
                Tell us what works, what doesn't, or what you'd like next.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <Textarea
                ref={textareaRef}
                name="feedback"
                placeholder="What's on your mind?"
                className="min-h-28"
              />
            </div>

            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="size-4 animate-spin" /> : "Send feedback"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
