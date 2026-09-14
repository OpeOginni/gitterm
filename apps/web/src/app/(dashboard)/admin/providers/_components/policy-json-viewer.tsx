"use client";

import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { Copy, Download } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Read-only, syntax-highlighted IAM policy with copy and download actions. */
export function PolicyJsonViewer({
  value,
  fileName,
  height = "240px",
}: {
  value: string;
  fileName: string;
  height?: string;
}) {
  const { resolvedTheme } = useTheme();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Policy JSON copied");
    } catch {
      toast.error("Could not copy. Download the policy instead.");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-fill px-3 py-1.5">
        <span className="truncate font-mono text-[11px] text-fg-4">{fileName}</span>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={copy}
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={download}
          >
            <Download className="size-3.5" />
            Download
          </Button>
        </div>
      </div>
      <CodeMirror
        value={value}
        height={height}
        extensions={[json()]}
        editable={false}
        readOnly
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        className="text-xs [&_.cm-editor]:bg-transparent [&_.cm-gutters]:bg-transparent"
      />
    </div>
  );
}
