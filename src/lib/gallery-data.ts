import "server-only";

import exteriorImages from "@/app/gallery/exterior/galleryFiles";
import interiorImages from "@/app/gallery/interior/galleryFiles";
import {
  createSupabasePublicClient,
  isSupabasePublicConfigured,
} from "@/lib/supabase/public";
import type { PortfolioGalleryImage } from "@/app/components/ImageGallery/PortfolioGallery";
import type { GalleryKey } from "@/lib/gallery";

const fallbackImages: Record<GalleryKey, string[]> = {
  exterior: exteriorImages,
  interior: interiorImages,
};

export function getStaticGalleryImages(galleryKey: GalleryKey) {
  return fallbackImages[galleryKey];
}

export async function getGalleryImages(
  galleryKey: GalleryKey
): Promise<PortfolioGalleryImage[]> {
  const fallback = fallbackImages[galleryKey].map((src, index, images) => ({
    alt: `${galleryKey === "interior" ? "Interior" : "Exterior"} painting project, photo ${index + 1} of ${images.length}`,
    src,
  }));

  if (!isSupabasePublicConfigured()) return fallback;

  const supabase = createSupabasePublicClient();
  const { data: collection, error: collectionError } = await supabase
    .from("gallery_collections")
    .select("cms_enabled")
    .eq("gallery_key", galleryKey)
    .maybeSingle();

  if (collectionError || !collection?.cms_enabled) return fallback;

  const { data: rows, error: imagesError } = await supabase
    .from("gallery_images")
    .select("alt_text, image_url, storage_path")
    .eq("gallery_key", galleryKey)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (imagesError) return fallback;

  return (rows ?? []).map((image) => ({
    alt: image.alt_text,
    src:
      image.image_url ??
      supabase.storage
        .from("gallery-images")
        .getPublicUrl(image.storage_path!).data.publicUrl,
    unoptimized: Boolean(image.storage_path),
  }));
}
