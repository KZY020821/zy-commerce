import { AdminSidebar } from "@/components/admin/sidebar";
import { requireStoreAdmin } from "@/lib/auth/guards";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant } = await requireStoreAdmin();
  return (
    <div className="flex min-h-full flex-1">
      <AdminSidebar tenant={tenant} user={user} />
      <main className="flex-1 overflow-x-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
