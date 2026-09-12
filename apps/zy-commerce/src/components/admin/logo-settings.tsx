"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { updateLogoAction } from "@/app/[tenant]/admin/(dashboard)/settings/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LOGO_ACCEPT, LOGO_ERRORS, LOGO_MAX_BYTES } from "@/lib/tenant/logo";

/** A file picked but not yet saved, tied to the result it was picked after. */
interface Selection {
  url: string;
  name: string;
  since: unknown;
}

/**
 * Same look as the shared Input. A native <input> is used on purpose: a file
 * input must stay uncontrolled so the browser owns the chosen file, and the
 * form reset React performs after each submission clears it.
 */
const FILE_INPUT_CLASS =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none file:mr-3 file:inline-flex file:h-7 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:text-sm file:font-medium file:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

export function LogoSettings({ storeName, logoUrl, storageConfigured }: { storeName: string; logoUrl: string | null; storageConfigured: boolean }) {
  const [state, action, pending] = useActionState(updateLogoAction, undefined);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Free a preview's object URL once it is replaced, or when the page closes.
  useEffect(() => () => {
    if (selection) URL.revokeObjectURL(selection.url);
  }, [selection]);

  // React clears the form after every submission, so a preview only stands
  // until the next result arrives.
  const preview = selection && selection.since === state ? selection : null;
  // The action's own answer wins: it is the logo the database now holds.
  const currentLogo = state?.ok ? state.logoUrl : logoUrl;

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setFileError(null);
    if (!file) {
      setSelection(null);
      return;
    }
    // Checked here as well as on the server: a file over the request limit
    // would otherwise be rejected before the server could say why.
    if (file.size > LOGO_MAX_BYTES) {
      setFileError(LOGO_ERRORS.tooLarge(file.size));
      setSelection(null);
      input.value = "";
      return;
    }
    setSelection({ url: URL.createObjectURL(file), name: file.name, since: state });
  }

  return (
    <div className="space-y-6">
      {!storageConfigured ? (
        <Alert variant="destructive">
          <AlertDescription>Logo uploads aren&apos;t available on this deployment: no file storage is connected.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-48 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 p-2">
          {preview ? (
            <Image src={preview.url} alt={`Preview of ${preview.name}`} width={176} height={64} unoptimized className="h-16 w-auto object-contain" />
          ) : currentLogo ? (
            <Image src={currentLogo} alt={`${storeName} logo`} width={176} height={64} unoptimized className="h-16 w-auto object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">No logo yet</span>
          )}
        </div>
        <p className="max-w-xs text-sm text-muted-foreground">
          {preview
            ? `Preview of ${preview.name}. Not saved yet.`
            : currentLogo
              ? "This is the logo customers see now."
              : "Until you upload one, your storefront shows a square in your brand colour."}
        </p>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="intent" value="upload" />
        <div className="space-y-2">
          <Label htmlFor="logo">Upload a new logo</Label>
          <input
            id="logo"
            name="logo"
            type="file"
            accept={LOGO_ACCEPT}
            onChange={onFileChange}
            disabled={pending || !storageConfigured}
            aria-invalid={fileError ? true : undefined}
            aria-describedby="logo-help"
            className={FILE_INPUT_CLASS}
          />
          <p id="logo-help" className="text-xs text-muted-foreground">
            PNG, JPEG or WebP, up to 1 MB.
          </p>
        </div>
        {fileError ? (
          <p role="alert" className="text-sm text-destructive">
            {fileError}
          </p>
        ) : null}
        <Button type="submit" disabled={!preview || pending || !storageConfigured}>
          {pending ? "Saving…" : "Save logo"}
        </Button>
      </form>

      {currentLogo ? (
        <form action={action}>
          <input type="hidden" name="intent" value="remove" />
          <Button type="submit" variant="outline" disabled={pending}>
            Remove logo
          </Button>
        </form>
      ) : null}

      {state ? (
        state.ok ? (
          <Alert role="status">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )
      ) : null}
    </div>
  );
}
