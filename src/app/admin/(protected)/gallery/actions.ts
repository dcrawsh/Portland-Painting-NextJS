"use server";

import { hasValidAdminSession } from "@/lib/admin-session";
import { getStaticGalleryImages } from "@/lib/gallery-data";
import { isGalleryKey, type GalleryKey } from "@/lib/gallery";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const bucketName = "gallery-images";
const maximumImages = 250;
const maximumImageBytes = 3 * 1024 * 1024;
const maximumDimension = 2400;

type ActionResult = { ok: true } | { ok: false; error: string };
type SignedUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

type FinalizeImageInput = {
  altText: string;
  height: number;
  path: string;
  width: number;
};

async function requireAdminSession() {
  if (!(await hasValidAdminSession())) redirect("/admin/login");
}

function isValidImageId(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function isGalleryImagePath(galleryKey: GalleryKey, path: string) {
  return new RegExp(`^${galleryKey}/[0-9a-f-]{36}\\.webp$`).test(path);
}

function revalidateGallery(galleryKey: GalleryKey) {
  revalidatePath("/admin/gallery");
  revalidatePath(`/gallery/${galleryKey}`);
}

export async function startManagingGallery(galleryKey: string) {
  await requireAdminSession();

  if (!isGalleryKey(galleryKey) || !isSupabaseAdminConfigured()) {
    redirect("/admin/gallery?error=setup");
  }

  const supabase = createSupabaseAdminClient();
  const { data: collection, error: collectionError } = await supabase
    .from("gallery_collections")
    .select("cms_enabled")
    .eq("gallery_key", galleryKey)
    .maybeSingle();

  if (collectionError || !collection) {
    redirect(`/admin/gallery?gallery=${galleryKey}&error=load`);
  }

  if (!collection.cms_enabled) {
    const { count, error: countError } = await supabase
      .from("gallery_images")
      .select("id", { count: "exact", head: true })
      .eq("gallery_key", galleryKey);

    if (countError) {
      redirect(`/admin/gallery?gallery=${galleryKey}&error=load`);
    }

    if ((count ?? 0) === 0) {
      const staticImages = getStaticGalleryImages(galleryKey);
      const { error: insertError } = await supabase
        .from("gallery_images")
        .insert(
          staticImages.map((imageUrl, index) => ({
            alt_text: `${galleryKey === "interior" ? "Interior" : "Exterior"} painting project, photo ${index + 1} of ${staticImages.length}`,
            gallery_key: galleryKey,
            image_url: imageUrl,
            sort_order: index,
          }))
        );

      if (insertError) {
        redirect(`/admin/gallery?gallery=${galleryKey}&error=import`);
      }
    }

    const { error: enableError } = await supabase
      .from("gallery_collections")
      .update({ cms_enabled: true, updated_at: new Date().toISOString() })
      .eq("gallery_key", galleryKey);

    if (enableError) {
      redirect(`/admin/gallery?gallery=${galleryKey}&error=enable`);
    }
  }

  revalidateGallery(galleryKey);
  redirect(`/admin/gallery?gallery=${galleryKey}&started=1`);
}

export async function createSignedGalleryImageUpload(
  galleryKey: string
): Promise<SignedUploadResult> {
  await requireAdminSession();

  if (!isGalleryKey(galleryKey) || !isSupabaseAdminConfigured()) {
    return { ok: false, error: "Photo uploads are not configured." };
  }

  const supabase = createSupabaseAdminClient();
  const [{ count, error: countError }, { data: collection }] = await Promise.all([
    supabase
      .from("gallery_images")
      .select("id", { count: "exact", head: true })
      .eq("gallery_key", galleryKey),
    supabase
      .from("gallery_collections")
      .select("cms_enabled")
      .eq("gallery_key", galleryKey)
      .maybeSingle(),
  ]);

  if (countError || !collection?.cms_enabled) {
    return { ok: false, error: "The gallery could not be loaded." };
  }

  if ((count ?? 0) >= maximumImages) {
    return { ok: false, error: `Galleries can have up to ${maximumImages} photos.` };
  }

  const path = `${galleryKey}/${randomUUID()}.webp`;
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUploadUrl(path);

  if (error || !data?.token) {
    return { ok: false, error: "A secure upload could not be started." };
  }

  return { ok: true, path, token: data.token };
}

export async function finalizeGalleryImageUpload(
  galleryKey: string,
  input: FinalizeImageInput
): Promise<ActionResult> {
  await requireAdminSession();

  if (
    !isGalleryKey(galleryKey) ||
    !isSupabaseAdminConfigured() ||
    !isGalleryImagePath(galleryKey, input.path)
  ) {
    return { ok: false, error: "The photo details are invalid." };
  }

  const altText = input.altText.trim();
  const dimensionsAreValid =
    Number.isSafeInteger(input.width) &&
    Number.isSafeInteger(input.height) &&
    input.width > 0 &&
    input.height > 0 &&
    input.width <= maximumDimension &&
    input.height <= maximumDimension;

  const supabase = createSupabaseAdminClient();

  if (altText.length < 3 || altText.length > 240 || !dimensionsAreValid) {
    await supabase.storage.from(bucketName).remove([input.path]);
    return { ok: false, error: "The photo details are invalid." };
  }

  const fileName = input.path.split("/").at(-1)!;
  const { data: objects, error: objectError } = await supabase.storage
    .from(bucketName)
    .list(galleryKey, { limit: 2, search: fileName });
  const uploadedObject = objects?.find((object) => object.name === fileName);
  const uploadedSize = Number(uploadedObject?.metadata?.size ?? 0);
  const uploadedMimeType = String(uploadedObject?.metadata?.mimetype ?? "");

  if (
    objectError ||
    !uploadedObject ||
    uploadedSize < 1 ||
    uploadedSize > maximumImageBytes ||
    uploadedMimeType !== "image/webp"
  ) {
    await supabase.storage.from(bucketName).remove([input.path]);
    return { ok: false, error: "The uploaded photo did not pass validation." };
  }

  const { data: lastImage, error: orderError } = await supabase
    .from("gallery_images")
    .select("sort_order")
    .eq("gallery_key", galleryKey)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError) {
    await supabase.storage.from(bucketName).remove([input.path]);
    return { ok: false, error: "The gallery order could not be loaded." };
  }

  const { error: insertError } = await supabase.from("gallery_images").insert({
    alt_text: altText,
    gallery_key: galleryKey,
    height: input.height,
    sort_order: (lastImage?.sort_order ?? -1) + 1,
    storage_path: input.path,
    width: input.width,
  });

  if (insertError) {
    await supabase.storage.from(bucketName).remove([input.path]);
    return { ok: false, error: "The photo could not be saved." };
  }

  revalidateGallery(galleryKey);
  return { ok: true };
}

export async function updateGalleryImageDescription(
  galleryKey: string,
  imageId: number,
  altText: string
): Promise<ActionResult> {
  await requireAdminSession();
  const description = altText.trim();

  if (
    !isGalleryKey(galleryKey) ||
    !isValidImageId(imageId) ||
    description.length < 3 ||
    description.length > 240 ||
    !isSupabaseAdminConfigured()
  ) {
    return { ok: false, error: "The photo description is invalid." };
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("gallery_images")
    .update({ alt_text: description, updated_at: new Date().toISOString() })
    .eq("id", imageId)
    .eq("gallery_key", galleryKey)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "The photo description could not be saved." };
  }

  revalidateGallery(galleryKey);
  return { ok: true };
}

export async function reorderGalleryImages(
  galleryKey: string,
  orderedIds: number[]
): Promise<ActionResult> {
  await requireAdminSession();

  if (
    !isGalleryKey(galleryKey) ||
    orderedIds.length > maximumImages ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !isValidImageId(id)) ||
    !isSupabaseAdminConfigured()
  ) {
    return { ok: false, error: "The gallery order is invalid." };
  }

  const supabase = createSupabaseAdminClient();
  const { data: current, error: loadError } = await supabase
    .from("gallery_images")
    .select("id")
    .eq("gallery_key", galleryKey);
  const currentIds = (current ?? []).map((image) => image.id).sort((a, b) => a - b);
  const submittedIds = [...orderedIds].sort((a, b) => a - b);

  if (
    loadError ||
    currentIds.length !== submittedIds.length ||
    currentIds.some((id, index) => id !== submittedIds[index])
  ) {
    return { ok: false, error: "The gallery changed. Refresh and try again." };
  }

  const updatedAt = new Date().toISOString();
  const results = await Promise.all(
    orderedIds.map((id, sortOrder) =>
      supabase
        .from("gallery_images")
        .update({ sort_order: sortOrder, updated_at: updatedAt })
        .eq("id", id)
        .eq("gallery_key", galleryKey)
    )
  );

  if (results.some((result) => result.error)) {
    return { ok: false, error: "The gallery order could not be saved." };
  }

  revalidateGallery(galleryKey);
  return { ok: true };
}

export async function deleteGalleryImage(
  galleryKey: string,
  imageId: number
): Promise<ActionResult> {
  await requireAdminSession();

  if (
    !isGalleryKey(galleryKey) ||
    !isValidImageId(imageId) ||
    !isSupabaseAdminConfigured()
  ) {
    return { ok: false, error: "The photo could not be removed." };
  }

  const supabase = createSupabaseAdminClient();
  const { data: image, error: loadError } = await supabase
    .from("gallery_images")
    .select("id, storage_path")
    .eq("id", imageId)
    .eq("gallery_key", galleryKey)
    .maybeSingle();

  if (loadError || !image) {
    return { ok: false, error: "The photo could not be found." };
  }

  if (image.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(bucketName)
      .remove([image.storage_path]);
    if (storageError) {
      return { ok: false, error: "The stored photo could not be removed." };
    }
  }

  const { error: deleteError } = await supabase
    .from("gallery_images")
    .delete()
    .eq("id", image.id)
    .eq("gallery_key", galleryKey);

  if (deleteError) {
    return { ok: false, error: "The photo could not be removed." };
  }

  revalidateGallery(galleryKey);
  return { ok: true };
}
