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
          className="size-10 rounded-full bg-primary text-primary-foreground shadow-lg transition-shadow hover:bg-primary/85 hover:shadow-xl"
        >
          <MessageCircleMoreIcon className="size-5" />
        </Button>
      </DialogTrigger>
      {showThankYou ? (
        <DialogContent>
          <div className="flex flex-col gap-4">
            <h1 className="text-xl font-bold text-white">Thank you!</h1>
            <p className="text-sm text-white/40">
              We appreciate your feedback and will use it to improve GitTerm.
            </p>
          </div>
          <DialogFooter>
            <Button
              className="bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
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
              <DialogTitle className="text-white">Feedback</DialogTitle>
              <DialogDescription className="text-white/40">
                Share your thoughts and suggestions with us.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <Textarea
                ref={textareaRef}
                name="feedback"
                placeholder="What do you think about the product?"
              />
            </div>

            <DialogFooter>
              <Button
                type="submit"
                disabled={isPending}
                className="bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Submit Feedback"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
