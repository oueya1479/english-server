/**
 * Extract storage path from a Supabase public URL.
 * Example: https://xxx.supabase.co/storage/v1/object/public/images/teachers/abc.jpg
 * Example: https://xxx.supabase.co/storage/v1/object/public/images/teachers/abc.jpg?v=123
 * Returns: teachers/abc.jpg (query params stripped)
 */
export function extractStoragePath(
  url: string | null | undefined,
  bucket: string,
): string | null {
  if (!url) return null;
  try {
    // Strip query parameters before matching
    const cleanUrl = url.split('?')[0];
    const pattern = new RegExp(`/storage/v1/object/public/${bucket}/(.+)$`);
    const match = cleanUrl.match(pattern);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
