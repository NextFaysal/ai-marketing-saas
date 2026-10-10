export function getOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("organizationId");
}
