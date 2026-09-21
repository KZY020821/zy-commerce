"use client";

/**
 * The assistant's own settings.
 *
 * "Shop information" is the one that changes what customers get: without it
 * the assistant can only answer from the catalogue, so a question about
 * delivery or returns — which people ask constantly — gets "I don't know".
 */
import { useActionState } from "react";
import { updateAssistantAction } from "@/app/[tenant]/admin/(dashboard)/settings/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface AssistantSettingsProps {
  assistantName: string;
  assistantGreeting: string | null;
  assistantPolicies: string | null;
  assistantSynonyms: string | null;
  supportWhatsapp: string | null;
}

const POLICIES_PLACEHOLDER = `Delivery: free over RM 200, 2–4 working days within Malaysia.
Returns: 14 days, unused and in its packaging.
Opening hours: Monday to Saturday, 10am–7pm.`;

export function AssistantSettings({ assistantName, assistantGreeting, assistantPolicies, assistantSynonyms, supportWhatsapp }: AssistantSettingsProps) {
  const [state, action, pending] = useActionState(updateAssistantAction, undefined);

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="assistantName">Name</Label>
        <Input id="assistantName" name="assistantName" defaultValue={assistantName} maxLength={60} required />
        <p className="text-xs text-muted-foreground">Shown on the chat button and in its header.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assistantGreeting">Opening message</Label>
        <Textarea id="assistantGreeting" name="assistantGreeting" defaultValue={assistantGreeting ?? ""} maxLength={300} rows={2} />
        <p className="text-xs text-muted-foreground">Leave empty to use the generated one.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assistantPolicies">Shop information</Label>
        <Textarea id="assistantPolicies" name="assistantPolicies" defaultValue={assistantPolicies ?? ""} maxLength={4000} rows={7} placeholder={POLICIES_PLACEHOLDER} />
        <p className="text-xs text-muted-foreground">
          Delivery, returns, payment, opening hours — anything customers ask that is not about a product. The assistant may only state what is written here, word for word, and says it doesn&apos;t know about anything else.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assistantSynonyms">Words your customers use</Label>
        <Input id="assistantSynonyms" name="assistantSynonyms" defaultValue={assistantSynonyms ?? ""} maxLength={500} placeholder="shoes, sneakers, trainers" />
        <p className="text-xs text-muted-foreground">
          Comma separated. The assistant decides what is about your shop from your own product names and categories, so a customer asking for &ldquo;shoes&rdquo; when your category is &ldquo;Footwear&rdquo; is turned away. Add their word here and it counts as yours.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="supportWhatsapp">WhatsApp number</Label>
        <Input id="supportWhatsapp" name="supportWhatsapp" defaultValue={supportWhatsapp ?? ""} maxLength={24} placeholder="+60 12-345 6789" inputMode="tel" />
        <p className="text-xs text-muted-foreground">Gives customers a way to reach a person from the chat. Without it, your contact email is offered instead.</p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save assistant settings"}
        </Button>
      </div>

      {state ? (
        <Alert variant={state.ok ? "default" : "destructive"}>
          <AlertDescription>{state.ok ? state.message : state.error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
