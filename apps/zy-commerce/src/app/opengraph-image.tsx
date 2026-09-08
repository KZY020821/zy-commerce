import { renderLinkPreview } from "@/lib/og/link-preview";

export { alt, size, contentType } from "@/lib/og/link-preview";

export default function OpengraphImage() {
  return renderLinkPreview();
}
