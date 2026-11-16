import { expect, test } from "bun:test";
import type { OpenCodeClient } from "@opencode/client";
import type { GittermClient } from "@gitterm/sdk";
import { suggestModels } from "./signin";

/** A local OpenCode that answers each question in turn, and a GitTerm whose model list changes. */
function setup(answers: string[], lists: Array<Array<{ isActive: boolean }> | Error>) {
  const asked: Array<{ title: string; description?: string }> = [];
  const local = {
    session: {
      form: {
        create: async (input: { title: string; fields: Array<{ description?: string }> }) => {
          asked.push({ title: input.title, description: input.fields[0]?.description });
          return { id: "form" };
        },
        get: async () => ({ state: { status: "answered", answer: { models: answers.shift() } } }),
        cancel: async () => {},
      },
    },
  } as unknown as OpenCodeClient;
  const gitterm = {
    serverUrl: "https://api.gitterm.dev",
    credentials: {
      list: async () => {
        const next = lists.shift();
        if (next instanceof Error) throw next;
        return next ?? [];
      },
    },
  } as unknown as GittermClient;
  return { local, gitterm, asked };
}

const signal = AbortSignal.timeout(5_000);

test("a user with a model is not asked", async () => {
  const f = setup([], [[{ isActive: true }]]);
  await suggestModels(f.local, f.gitterm, "ses", signal);
  expect(f.asked).toEqual([]);
});

test("adding a model while asked lets the same /cloud carry on", async () => {
  const f = setup(["check", "check"], [[], [], [{ isActive: true }]]);
  await suggestModels(f.local, f.gitterm, "ses", signal);
  expect(f.asked.map((question) => question.title)).toEqual([
    "Use your own models in the cloud?",
    "Still no models in GitTerm",
  ]);
  expect(f.asked[0]!.description).toContain("https://gitterm.dev/dashboard/models");
});

test("the free models are the default and end the question", async () => {
  const f = setup(["continue"], [[]]);
  await suggestModels(f.local, f.gitterm, "ses", signal);
  expect(f.asked).toHaveLength(1);
});

test("nothing is asked when GitTerm can't list models", async () => {
  const f = setup([], [new Error("GitTerm is unavailable")]);
  await suggestModels(f.local, f.gitterm, "ses", signal);
  expect(f.asked).toEqual([]);
});
