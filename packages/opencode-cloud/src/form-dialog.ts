import type { Context } from "@opencode/plugin/tui/context";
import { FORM_KEY } from "./marker";

export function cloudFormDialogs(context: Context) {
  let active: string | undefined;
  const created = context.data.on("form.created", (event) => {
    const form = event.data.form;
    const route = context.ui.router.current();
    if (
      form.metadata?.[FORM_KEY] !== true ||
      form.fields.length !== 1 ||
      route.type !== "session" ||
      route.sessionID !== form.sessionID
    )
      return;
    const field = form.fields[0];
    if (field.type !== "boolean" && !(field.type === "string" && field.options)) return;
    active = form.id;
    const result =
      field.type === "boolean"
        ? context.ui.dialog.confirm({
            title: form.title,
            message: field.description ?? "",
            label: { confirm: "Yes", cancel: "No" },
          })
        : context.ui.dialog.select({
            title: form.title,
            current: field.default,
            options: field.options!.map((option) => ({
              title: option.label ?? option.value,
              value: option.value,
              description: option.description,
              footer: field.description,
            })),
          });
    void result
      .then(async (value) => {
        if (active !== form.id) return;
        active = undefined;
        const input = { sessionID: form.sessionID, formID: form.id };
        if (value === undefined) await context.data.session.form.cancel(input);
        else await context.data.session.form.reply({ ...input, answer: { [field.key]: value } });
      })
      .catch(() =>
        context.ui.toast.show({ message: "Could not answer the cloud prompt.", variant: "error" }),
      );
  });
  const ended = (event: { data: { id: string } }) => {
    if (active !== event.data.id) return;
    active = undefined;
    context.ui.dialog.clear();
  };
  const replied = context.data.on("form.replied", ended);
  const cancelled = context.data.on("form.cancelled", ended);
  return () => {
    created();
    replied();
    cancelled();
    if (active) {
      active = undefined;
      context.ui.dialog.clear();
    }
  };
}
