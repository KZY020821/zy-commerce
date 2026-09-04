import { redirect } from "next/navigation";

/** Auth.js's configured sign-in path. On the root domain that means the platform login. */
export default function RootLoginRedirect() {
  redirect("/platform/login");
}
