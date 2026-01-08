import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export default function Loader({ className }: { className?: string }) {
  return (
    <div className="flex h-full items-center justify-center pt-8">
      <Loader2 className={cn("animate-spin", className)} />
    </div>
  );
}
