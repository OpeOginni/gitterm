import { expect, test } from "bun:test";
import type { Context } from "@opencode/plugin/tui/context";
import { cloudFormDialogs } from "./form-dialog";
import { FORM_KEY } from "./marker";

test("cloud forms open dialogs, reply or cancel, and leave unrelated forms alone", async () => {
  const handlers = new Map<string, (event: any) => void>();
  const replies: unknown[] = [];
  const cancellations: unknown[] = [];
  const dialogs: Array<{ title: string; message?: string; options?: unknown[] }> = [];
  let resolve: (value: string | boolean | undefined) => void = () => {};
  let cleared = 0;
  const show = (options: (typeof dialogs)[number]) => {
    dialogs.push(options);
    return new Promise<string | boolean | undefined>((done) => (resolve = done));
  };
  const context = {
    data: {
      on: (name: string, handler: (event: any) => void) => {
        handlers.set(name, handler);
        return () => handlers.delete(name);
      },
      session: {
        form: {
          reply: async (input: unknown) => {
            replies.push(input);
          },
          cancel: async (input: unknown) => {
            cancellations.push(input);
          },
        },
      },
    },
    ui: {
      router: { current: () => ({ type: "session", sessionID: "ses_test" }) },
      dialog: {
        select: show,
        confirm: show,
        clear: () => {
          cleared++;
          resolve(undefined);
        },
      },
      toast: {
        show: () => {
          throw new Error("Unexpected dialog failure");
        },
      },
    },
  } as unknown as Context;
  const stop = cloudFormDialogs(context);
  const form = {
    id: "form_test",
    sessionID: "ses_test",
    title: "Bring your changes?",
    metadata: { [FORM_KEY]: true },
    fields: [
      {
        key: "changes",
        type: "string",
        description: "Other sessions share this checkout.",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
    ],
  };
  const emit = (value: unknown) => handlers.get("form.created")!({ data: { form: value } });
  emit({ ...form, metadata: {} });
  emit({ ...form, sessionID: "another_session" });
  expect(dialogs).toHaveLength(0);
  emit(form);
  expect(dialogs[0]).toMatchObject({
    title: form.title,
    options: [{ value: "yes", footer: form.fields[0]!.description }, { value: "no" }],
  });
  resolve("no");
  await Bun.sleep(0);
  expect(replies).toEqual([{ sessionID: "ses_test", formID: form.id, answer: { changes: "no" } }]);
  emit({ ...form, fields: [{ key: "create", type: "boolean", description: "Uploads history." }] });
  expect(dialogs[1]).toMatchObject({ message: "Uploads history." });
  resolve(false);
  await Bun.sleep(0);
  expect(replies.at(-1)).toMatchObject({ answer: { create: false } });
  emit(form);
  resolve(undefined);
  await Bun.sleep(0);
  expect(cancellations).toEqual([{ sessionID: "ses_test", formID: form.id }]);
  emit(form);
  handlers.get("form.cancelled")!({ data: { id: form.id } });
  await Bun.sleep(0);
  expect(cleared).toBe(1);
  expect(cancellations).toHaveLength(1);
  stop();
  expect(handlers.size).toBe(0);
});
