export interface WorldBuildingCategory {
  id: string;
  name: string;
  color: string;
  notes?: unknown[];
}

export function getCategoryColor(
  categories: WorldBuildingCategory[] | undefined,
  categoryId: string | null
): string {
  if (!categoryId || !categories) return "#94a3b8"; // slate-400 fallback
  const cat = categories.find((c) => c.id === categoryId);
  return cat?.color ?? "#94a3b8";
}

export function stripHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

export function getCategoryLabel(
  categories: WorldBuildingCategory[] | undefined,
  categoryId: string | null
): string {
  if (!categoryId || !categories) return "";
  const cat = categories.find((c) => c.id === categoryId);
  return cat?.name ?? "(category deleted)";
}
