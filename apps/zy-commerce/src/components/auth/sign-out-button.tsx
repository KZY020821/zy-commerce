import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";

export function SignOutButton({ redirectTo }: { redirectTo: string }) {
  const action = signOutAction.bind(null, redirectTo);
  return (
    <form action={action}>
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
