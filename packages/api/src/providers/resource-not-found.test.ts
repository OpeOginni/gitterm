import { expect, test } from "bun:test";
import { isProviderResourceNotFound } from "./resource-not-found";

test.each([
  { status: 404 },
  { statusCode: 404 },
  { response: { status: 404 } },
  { name: "DaytonaNotFoundError" },
  { errors: [{ extensions: { code: "NotFound" } }] },
  new Error("Service not found"),
  new Error("VM does not exist"),
])("recognizes explicit missing resources: %j", (error) => {
  expect(isProviderResourceNotFound(error)).toBe(true);
});

test.each([
  null,
  { status: 403 },
  { statusCode: 500 },
  { errors: [{ extensions: { code: "Unauthorized" } }] },
  new Error("Permission denied"),
  new Error("Cloud provider configuration not found"),
  new Error("Timed out deleting service"),
])("does not hide configuration, permission or transient failures: %j", (error) => {
  expect(isProviderResourceNotFound(error)).toBe(false);
});
