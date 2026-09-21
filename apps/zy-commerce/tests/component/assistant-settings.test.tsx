/**
 * The assistant settings form in jsdom, with the Server Action replaced. What
 * the admin types here is what customers are told about delivery and returns,
 * so the form is checked on what it sends and what it says back.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/[tenant]/admin/(dashboard)/settings/actions", () => ({ updateAssistantAction: vi.fn() }));

import { updateAssistantAction } from "@/app/[tenant]/admin/(dashboard)/settings/actions";
import { AssistantSettings } from "@/components/admin/assistant-settings";

const action = vi.mocked(updateAssistantAction);

const current = {
  assistantName: "Fit Assistant",
  assistantGreeting: "Hi! Ask me anything.",
  assistantPolicies: "Delivery: free over RM 200.",
  assistantSynonyms: "shoes, sneakers",
  supportWhatsapp: "+60 12-345 6789",
};

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save assistant settings" }));

beforeEach(() => {
  action.mockReset();
});

describe("AssistantSettings", () => {
  it("shows what the store has already set", () => {
    render(<AssistantSettings {...current} />);

    expect(field("Name").value).toBe("Fit Assistant");
    expect(field("Opening message").value).toBe("Hi! Ask me anything.");
    expect(field("Shop information").value).toBe("Delivery: free over RM 200.");
    expect(field("Words your customers use").value).toBe("shoes, sneakers");
    expect(field("WhatsApp number").value).toBe("+60 12-345 6789");
  });

  it("starts empty for a store that has set nothing, and says what each box is for", () => {
    render(<AssistantSettings assistantName="Product Assistant" assistantGreeting={null} assistantPolicies={null} assistantSynonyms={null} supportWhatsapp={null} />);

    expect(field("Opening message").value).toBe("");
    expect(field("Shop information").value).toBe("");
    expect(screen.getByText(/may only state what is written here/)).toBeTruthy();
    expect(screen.getByText(/a way to reach a person from the chat/)).toBeTruthy();
    expect(screen.getByText(/counts as yours/)).toBeTruthy();
  });

  it("sends every field to the server and shows what it says", async () => {
    action.mockResolvedValueOnce({ ok: true, message: "Saved. Your storefront assistant is using it now." });
    render(<AssistantSettings {...current} />);

    fireEvent.change(field("Shop information"), { target: { value: "Returns within 14 days." } });
    save();

    expect(await screen.findByText("Saved. Your storefront assistant is using it now.")).toBeTruthy();
    const [, sent] = action.mock.calls[0]!;
    expect((sent as FormData).get("assistantPolicies")).toBe("Returns within 14 days.");
    expect((sent as FormData).get("assistantName")).toBe("Fit Assistant");
  });

  it("shows the server's reason when it refuses", async () => {
    action.mockResolvedValueOnce({ ok: false, error: "Write the WhatsApp number in international format, e.g. +60 12-345 6789." });
    render(<AssistantSettings {...current} />);

    save();

    expect((await screen.findByText(/international format/)).textContent).toContain("+60 12-345 6789");
  });
});
