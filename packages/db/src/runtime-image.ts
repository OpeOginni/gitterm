/**
 * Version line of the workspace runtime images (Docker Hub) and E2B templates
 * this platform runs. The seed references `:<major>`, a tag every runtime build
 * moves forward, so runtime fixes ship without a platform release.
 *
 * Bump only when a runtime change needs a newer server. Installs on older
 * platform versions keep the previous line. See docs/runtime-images.md.
 */
export const RUNTIME_IMAGE_MAJOR = "1";
