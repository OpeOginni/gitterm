/** Only an explicit missing resource is successful teardown; auth and transport failures retry. */
export function isProviderResourceNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    errors?: { extensions?: { code?: string } }[];
    name?: string;
    message?: string;
  };
  return (
    details.status === 404 ||
    details.statusCode === 404 ||
    details.response?.status === 404 ||
    details.name === "DaytonaNotFoundError" ||
    details.errors?.some(({ extensions }) => extensions?.code === "NotFound") === true ||
    /\b(?:sandbox|service|volume|vm|box|domain|resource)\b.{0,40}\b(?:not found|does not exist|already deleted)\b/i.test(
      details.message ?? "",
    )
  );
}
