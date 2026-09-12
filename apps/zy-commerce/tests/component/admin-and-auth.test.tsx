/**
 * Admin navigation and the sign-in form. The sidebar decides which admin
 * features are reachable at all, so it is checked link by link.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/actions", () => ({ signOutAction: vi.fn() }));

import type { Tenant } from "@/generated/prisma/client";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SuspendedNotice } from "@/components/tenant/suspended-notice";
import type { VerifiedUser } from "@/lib/auth/guards";

const tenant = { id: "t-acme", name: "Acme Store" } as Tenant;
const user = { id: "u1", email: "admin@acme.test", name: "Admin", role: "STORE_ADMIN", tenantId: "t-acme" } as VerifiedUser;

describe("AdminSidebar", () => {
  it("links to every section that exists, including Settings", () => {
    render(<AdminSidebar tenant={tenant} user={user} />);
    for (const [label, href] of [["Dashboard", "/admin"], ["Conversations", "/admin/conversations"], ["Settings", "/admin/settings"]]) {
      expect(screen.getByRole("link", { name: label }).getAttribute("href"), label).toBe(href);
    }
  });

  it("shows unbuilt sections as disabled with their phase, not as links", () => {
    render(<AdminSidebar tenant={tenant} user={user} />);
    for (const [label, phase] of [["Products", "Phase 1"], ["Categories", "Phase 1"], ["Orders", "Phase 4"]]) {
      expect(screen.queryByRole("link", { name: label }), label).toBeNull();
      expect(screen.getByText(label).closest("[aria-disabled]")?.textContent).toContain(phase);
    }
  });

  it("names the store and the signed-in admin, and offers sign-out and the storefront", () => {
    render(<AdminSidebar tenant={tenant} user={user} />);
    expect(screen.getByText("Acme Store")).toBeTruthy();
    expect(screen.getByText("admin@acme.test")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View storefront ↗" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

describe("LoginForm", () => {
  it("shows the error the action returns", async () => {
    const action = vi.fn(async () => ({ error: "Invalid email or password." }));
    render(<LoginForm action={action} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@acme.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid email or password.");
    const sent = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(sent.get("email")).toBe("admin@acme.test");
    expect(sent.get("password")).toBe("wrong");
  });

  it("lets the browser's password manager do its job", () => {
    render(<LoginForm action={vi.fn()} submitLabel="Enter" />);
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe("email");
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("current-password");
    expect(screen.getByRole("button", { name: "Enter" })).toBeTruthy();
  });
});

describe("small shared pieces", () => {
  it("render their content", () => {
    render(
      <>
        <AuthShell title="Acme admin" description="Sign in with your store admin account." footer="Need help?">
          <p>form here</p>
        </AuthShell>
        <PageHeader title="Settings" description="Branding" actions={<button type="button">Act</button>} />
        <StatCard label="Products" value={192} hint="See Products" />
        <SuspendedNotice storeName="Acme Store" />
      </>,
    );
    expect(screen.getByText("Acme admin")).toBeTruthy();
    expect(screen.getByText("Need help?")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Act" })).toBeTruthy();
    expect(screen.getByText("192")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Acme Store is temporarily unavailable" })).toBeTruthy();
  });
});
