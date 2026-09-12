/**
 * The logo form in jsdom, with the Server Action replaced. Checks what an
 * admin sees at each step; the real upload in a real browser is covered by
 * the end-to-end suite.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/[tenant]/admin/(dashboard)/settings/actions", () => ({ updateLogoAction: vi.fn() }));

import { updateLogoAction } from "@/app/[tenant]/admin/(dashboard)/settings/actions";
import { LogoSettings } from "@/components/admin/logo-settings";
import { LOGO_MAX_BYTES } from "@/lib/tenant/logo";

const action = vi.mocked(updateLogoAction);
const CURRENT = "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-old.png";

const fileInput = () => screen.getByLabelText("Upload a new logo") as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "Save logo" }) as HTMLButtonElement;
const choose = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const png = (bytes = 64, name = "logo.png") => new File([new Uint8Array(bytes)], name, { type: "image/png" });

beforeEach(() => {
  action.mockReset();
});

describe("LogoSettings", () => {
  it("shows a placeholder, and no Remove button, when the store has no logo", () => {
    render(<LogoSettings storeName="Acme" logoUrl={null} storageConfigured />);
    expect(screen.getByText("No logo yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it("shows the current logo with a Remove button", () => {
    render(<LogoSettings storeName="Acme" logoUrl={CURRENT} storageConfigured />);
    expect(screen.getByRole("img", { name: "Acme logo" }).getAttribute("src")).toBe(CURRENT);
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeTruthy();
  });

  it("offers only the accepted image types to the file picker", () => {
    render(<LogoSettings storeName="Acme" logoUrl={null} storageConfigured />);
    expect(fileInput().accept).toBe("image/png,image/jpeg,image/webp");
  });

  it("explains when no storage is connected, and locks the picker", () => {
    render(<LogoSettings storeName="Acme" logoUrl={null} storageConfigured={false} />);
    expect(screen.getByText(/no file storage is connected/)).toBeTruthy();
    expect(fileInput().disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it("refuses a file over 1 MB on the spot, saying how big it is", () => {
    render(<LogoSettings storeName="Acme" logoUrl={null} storageConfigured />);
    choose(png(LOGO_MAX_BYTES + 200_000, "huge.png"));
    expect(screen.getByRole("alert").textContent).toBe("The logo must be 1 MB or smaller — this file is 1.2 MB.");
    expect(fileInput().getAttribute("aria-invalid")).toBe("true");
    expect(saveButton().disabled).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });

  it("previews a chosen image before anything is saved", () => {
    render(<LogoSettings storeName="Acme" logoUrl={CURRENT} storageConfigured />);
    choose(png(64, "new-logo.png"));
    expect(screen.getByRole("img", { name: "Preview of new-logo.png" })).toBeTruthy();
    expect(screen.getByText("Preview of new-logo.png. Not saved yet.")).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
  });

  it("sends the upload and then shows the saved logo and the confirmation", async () => {
    action.mockResolvedValueOnce({ ok: true, message: "Logo saved. It's now showing on your storefront.", logoUrl: "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-new.png" });
    render(<LogoSettings storeName="Acme" logoUrl={null} storageConfigured />);
    choose(png());
    fireEvent.click(saveButton());

    expect(await screen.findByText("Logo saved. It's now showing on your storefront.")).toBeTruthy();
    const [, sent] = action.mock.calls[0]!;
    expect((sent as FormData).get("intent")).toBe("upload");
    expect(screen.getByRole("img", { name: "Acme logo" }).getAttribute("src")).toBe("https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-new.png");
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeTruthy();
  });

  it("shows the server's reason when it refuses a file", async () => {
    action.mockResolvedValueOnce({ ok: false, error: "Upload a PNG, JPEG or WebP image." });
    render(<LogoSettings storeName="Acme" logoUrl={null} storageConfigured />);
    choose(png(64, "disguised.png"));
    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Upload a PNG, JPEG or WebP image.");
  });

  it("removes the logo and returns to the placeholder", async () => {
    action.mockResolvedValueOnce({ ok: true, message: "Logo removed. Your storefront shows the coloured square again.", logoUrl: null });
    render(<LogoSettings storeName="Acme" logoUrl={CURRENT} storageConfigured />);
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));

    expect(await screen.findByText("Logo removed. Your storefront shows the coloured square again.")).toBeTruthy();
    const [, sent] = action.mock.calls[0]!;
    expect((sent as FormData).get("intent")).toBe("remove");
    expect(screen.getByText("No logo yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull();
  });
});
