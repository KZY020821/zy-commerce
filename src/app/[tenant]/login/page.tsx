import { redirect } from "next/navigation";

/** Auth.js's configured sign-in path. On a tenant subdomain, send people to the store admin login. */
export default function TenantLoginRedirect() {
  redirect("/admin/login");
}
