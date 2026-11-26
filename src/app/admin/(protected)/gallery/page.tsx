import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  galleryKeys,
  galleryLabels,
  isGalleryKey,
  type GalleryKey,
} from "@/lib/gallery";
import Link from "next/link";
import GalleryPhotoManager, {
  type GalleryImageWithUrl,
} from "./GalleryPhotoManager";
import { startManagingGallery } from "./actions";

type AdminGalleryPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    gallery?: string | string[];
    started?: string | string[];
  }>;
};

export default async function AdminGalleryPage({
  searchParams,
}: AdminGalleryPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedGallery = Array.isArray(resolvedSearchParams.gallery)
    ? resolvedSearchParams.gallery[0]
    : resolvedSearchParams.gallery;
  const galleryKey: GalleryKey =
    requestedGallery && isGalleryKey(requestedGallery)
      ? requestedGallery
      : "interior";
  const hasError = Boolean(resolvedSearchParams.error);
  const wasStarted = Boolean(resolvedSearchParams.started);
  const isConfigured = isSupabaseAdminConfigured();
  let isManaged = false;
  let images: GalleryImageWithUrl[] = [];
  let loadFailed = false;

  if (isConfigured) {
    const supabase = createSupabaseAdminClient();
    const [{ data: collection, error: collectionError }, imageResult] =
      await Promise.all([
        supabase
          .from("gallery_collections")
          .select("cms_enabled")
          .eq("gallery_key", galleryKey)
          .maybeSingle(),
        supabase
          .from("gallery_images")
          .select("*")
          .eq("gallery_key", galleryKey)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true }),
      ]);

    loadFailed = Boolean(collectionError || imageResult.error || !collection);
    isManaged = Boolean(collection?.cms_enabled);
    images = (imageResult.data ?? []).map((image) => ({
      ...image,
      publicUrl:
        image.image_url ??
        supabase.storage
          .from("gallery-images")
          .getPublicUrl(image.storage_path!).data.publicUrl,
    }));
  }

  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 py-10 sm:px-6 lg:px-8">
      <header className="border-b border-[#20231F]/20 pb-8">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#687760]">
          Website photography
        </p>
        <h1 className="mt-3 font-serif text-4xl text-[#17352B]">Gallery</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-[#20231F]/65">
          Add, remove, describe, and arrange the photos shown on the public
          gallery pages.
        </p>
      </header>

      <nav aria-label="Choose a gallery" className="mt-8 flex flex-wrap gap-3">
        {galleryKeys.map((key) => (
          <Link
            aria-current={key === galleryKey ? "page" : undefined}
            className={`border px-4 py-2 text-sm font-semibold transition ${
              key === galleryKey
                ? "border-[#17352B] bg-[#17352B] text-white"
                : "border-[#20231F]/25 text-[#17352B] hover:bg-white"
            }`}
            href={`/admin/gallery?gallery=${key}`}
            key={key}
          >
            {galleryLabels[key]}
          </Link>
        ))}
      </nav>

      {wasStarted ? (
        <p className="mt-8 border-l-2 border-[#687760] bg-[#687760]/10 px-4 py-3 text-sm text-[#17352B]" role="status">
          The existing photos are now managed here.
        </p>
      ) : null}

      {hasError ? (
        <p className="mt-8 border-l-2 border-[#A84F36] bg-[#A84F36]/10 px-4 py-3 text-sm text-[#7A3525]" role="alert">
          The gallery could not be prepared. Refresh and try again.
        </p>
      ) : null}

      {!isConfigured ? (
        <section className="mt-8 border border-[#20231F]/20 bg-[#FAF8F3] p-6">
          <h2 className="font-serif text-2xl text-[#17352B]">
            Supabase configuration required
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#20231F]/70">
            Add the Supabase environment variables, then restart the development
            server.
          </p>
        </section>
      ) : loadFailed ? (
        <p className="mt-8 border-l-2 border-[#A84F36] bg-[#A84F36]/10 px-4 py-3 text-sm text-[#7A3525]" role="alert">
          Gallery records could not be loaded. Apply the gallery CMS migration
          and try again.
        </p>
      ) : !isManaged ? (
        <section className="mt-8 border border-[#20231F]/20 bg-[#FAF8F3] p-6">
          <h2 className="font-serif text-2xl text-[#17352B]">
            Start managing {galleryLabels[galleryKey].toLowerCase()} photos
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#20231F]/70">
            The public page is still using its checked-in image list. Starting
            the CMS copies that order into the database without moving or
            deleting the original files.
          </p>
          <form action={startManagingGallery.bind(null, galleryKey)}>
            <button
              className="mt-5 bg-[#17352B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#244B3D] focus:outline-none focus:ring-2 focus:ring-[#17352B] focus:ring-offset-2 focus:ring-offset-[#FAF8F3]"
              type="submit"
            >
              Start managing this gallery
            </button>
          </form>
        </section>
      ) : (
        <GalleryPhotoManager galleryKey={galleryKey} images={images} />
      )}
    </main>
  );
}
