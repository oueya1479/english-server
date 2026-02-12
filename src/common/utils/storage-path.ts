/**
 * Extract storage path from a Supabase public URL.
 * Example: https://xxx.supabase.co/storage/v1/object/public/images/teachers/abc.jpg
 * Returns: teachers/abc.jpg
 */
export function extractStoragePath(
  url: string | null | undefined,
  bucket: string,
): string | null {
  if (!url) return null;
  try {
    const pattern = new RegExp(`/storage/v1/object/public/${bucket}/(.+)$`);
    const match = url.match(pattern);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
