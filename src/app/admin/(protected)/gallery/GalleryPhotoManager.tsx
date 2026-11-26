"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { GalleryKey } from "@/lib/gallery";
import type { GalleryImage } from "@/types/supabase";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createSignedGalleryImageUpload,
  deleteGalleryImage,
  finalizeGalleryImageUpload,
  reorderGalleryImages,
  updateGalleryImageDescription,
} from "./actions";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumImages = 250;
const maximumSelection = 20;
const maximumDimension = 2400;
const maximumImageBytes = 3 * 1024 * 1024;
const targetImageBytes = 2.75 * 1024 * 1024;

export type GalleryImageWithUrl = GalleryImage & { publicUrl: string };

type PendingPhoto = {
  altText: string;
  file: File;
  height: number;
  id: string;
  originalBytes: number;
  previewUrl: string;
  width: number;
};

type GalleryPhotoManagerProps = {
  galleryKey: GalleryKey;
  images: GalleryImageWithUrl[];
};

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function toWebpBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("This browser could not convert the photo.")),
      "image/webp",
      quality
    );
  });
}

function getOutputName(originalName: string) {
  const baseName = originalName
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${baseName || "gallery-photo"}.webp`;
}

async function optimizePhoto(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  let scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height));
  let lastBlob: Blob | null = null;
  let outputWidth = 0;
  let outputHeight = 0;

  try {
    for (let sizeAttempt = 0; sizeAttempt < 4; sizeAttempt += 1) {
      outputWidth = Math.max(1, Math.round(bitmap.width * scale));
      outputHeight = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d");

      if (!context) throw new Error("This browser could not process the photo.");
      context.drawImage(bitmap, 0, 0, outputWidth, outputHeight);

      for (const quality of [0.82, 0.72, 0.62]) {
        lastBlob = await toWebpBlob(canvas, quality);
        if (lastBlob.size <= targetImageBytes) break;
      }

      if (lastBlob && lastBlob.size <= maximumImageBytes) break;
      scale *= 0.82;
    }
  } finally {
    bitmap.close();
  }

  if (!lastBlob || lastBlob.size > maximumImageBytes) {
    throw new Error("The photo is still too large after optimization.");
  }

  return {
    file: new File([lastBlob], getOutputName(file.name), {
      lastModified: Date.now(),
      type: "image/webp",
    }),
    height: outputHeight,
    width: outputWidth,
  };
}

export default function GalleryPhotoManager({
  galleryKey,
  images,
}: GalleryPhotoManagerProps) {
  const router = useRouter();
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const orderedImagesRef = useRef(images);
  const dragSnapshotRef = useRef<GalleryImageWithUrl[] | null>(null);
  const draggedImageIdRef = useRef<number | null>(null);
  const [orderedImages, setOrderedImages] = useState(images);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [descriptionDrafts, setDescriptionDrafts] = useState<
    Record<number, string>
  >(() => Object.fromEntries(images.map((image) => [image.id, image.alt_text])));
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [draggedImageId, setDraggedImageId] = useState<number | null>(null);
  const [dragOverImageId, setDragOverImageId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);

  useEffect(() => {
    orderedImagesRef.current = images;
    setOrderedImages(images);
    setDescriptionDrafts((current) =>
      Object.fromEntries(
        images.map((image) => [image.id, current[image.id] ?? image.alt_text])
      )
    );
  }, [images]);

  useEffect(() => {
    return () => {
      pendingPhotosRef.current.forEach((photo) =>
        URL.revokeObjectURL(photo.previewUrl)
      );
    };
  }, []);

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const spacesRemaining = maximumImages - images.length - pendingPhotos.length;
    setError(null);
    setMessage(null);

    if (files.length === 0) return;
    if (files.length > maximumSelection) {
      setError(`Choose no more than ${maximumSelection} photos at a time.`);
      event.target.value = "";
      return;
    }
    if (spacesRemaining < 1 || files.length > spacesRemaining) {
      setError(`Choose up to ${spacesRemaining} more photo${spacesRemaining === 1 ? "" : "s"}.`);
      event.target.value = "";
      return;
    }
    if (files.some((file) => !acceptedTypes.has(file.type))) {
      setError("Use JPEG, PNG, or WebP photos. HEIC is not supported yet.");
      event.target.value = "";
      return;
    }

    setIsProcessing(true);
    const optimized: PendingPhoto[] = [];

    try {
      for (const file of files) {
        const result = await optimizePhoto(file);
        optimized.push({
          altText: "",
          file: result.file,
          height: result.height,
          id: crypto.randomUUID(),
          originalBytes: file.size,
          previewUrl: URL.createObjectURL(result.file),
          width: result.width,
        });
      }
      setPendingPhotos((current) => [...current, ...optimized]);
    } catch (selectionError) {
      optimized.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "The selected photos could not be processed."
      );
    } finally {
      setIsProcessing(false);
      event.target.value = "";
    }
  }

  function removePendingPhoto(id: string) {
    setPendingPhotos((current) => {
      const photo = current.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function uploadPhotos() {
    setError(null);
    setMessage(null);

    if (pendingPhotos.some((photo) => photo.altText.trim().length < 3)) {
      setError("Add a short image description to every photo before uploading.");
      return;
    }

    setIsUploading(true);
    const uploadedIds = new Set<string>();

    try {
      const supabase = createSupabaseBrowserClient();

      for (let index = 0; index < pendingPhotos.length; index += 1) {
        const photo = pendingPhotos[index];
        setMessage(`Uploading photo ${index + 1} of ${pendingPhotos.length}…`);
        const signedUpload = await createSignedGalleryImageUpload(galleryKey);
        if (!signedUpload.ok) throw new Error(signedUpload.error);

        const { error: uploadError } = await supabase.storage
          .from("gallery-images")
          .uploadToSignedUrl(signedUpload.path, signedUpload.token, photo.file, {
            cacheControl: "31536000",
            contentType: "image/webp",
          });
        if (uploadError) throw new Error("The photo upload failed. Try again.");

        const finalized = await finalizeGalleryImageUpload(galleryKey, {
          altText: photo.altText,
          height: photo.height,
          path: signedUpload.path,
          width: photo.width,
        });
        if (!finalized.ok) throw new Error(finalized.error);
        uploadedIds.add(photo.id);
      }

      setMessage(
        `${uploadedIds.size} photo${uploadedIds.size === 1 ? "" : "s"} uploaded.`
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The photos could not be uploaded."
      );
      setMessage(null);
    } finally {
      setPendingPhotos((current) => {
        current
          .filter((photo) => uploadedIds.has(photo.id))
          .forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
        return current.filter((photo) => !uploadedIds.has(photo.id));
      });
      setIsUploading(false);
      if (uploadedIds.size > 0) router.refresh();
    }
  }

  async function saveImageOrder(
    next: GalleryImageWithUrl[],
    previous: GalleryImageWithUrl[]
  ) {
    orderedImagesRef.current = next;
    setOrderedImages(next);
    setError(null);
    setMessage(null);
    setIsReordering(true);

    const result = await reorderGalleryImages(
      galleryKey,
      next.map((image) => image.id)
    );
    setIsReordering(false);

    if (!result.ok) {
      orderedImagesRef.current = previous;
      setOrderedImages(previous);
      setError(result.error);
      return;
    }

    setMessage("Gallery order saved.");
    router.refresh();
  }

  async function moveImage(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= orderedImages.length) return;

    const previous = orderedImages;
    const next = [...orderedImages];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    await saveImageOrder(next, previous);
  }

  function handleDragStart(
    event: DragEvent<HTMLButtonElement>,
    imageId: number
  ) {
    if (controlsDisabled) {
      event.preventDefault();
      return;
    }

    dragSnapshotRef.current = orderedImagesRef.current;
    draggedImageIdRef.current = imageId;
    setDraggedImageId(imageId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(imageId));
  }

  function handleDragEnter(imageId: number) {
    const activeId = draggedImageIdRef.current;
    if (activeId === null || activeId === imageId || controlsDisabled) return;

    const current = orderedImagesRef.current;
    const fromIndex = current.findIndex((image) => image.id === activeId);
    const targetIndex = current.findIndex((image) => image.id === imageId);
    if (fromIndex < 0 || targetIndex < 0) return;

    const next = [...current];
    const [movedImage] = next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, movedImage);
    orderedImagesRef.current = next;
    setOrderedImages(next);
    setDragOverImageId(imageId);
  }

  async function handleDrop(event: DragEvent<HTMLOListElement>) {
    event.preventDefault();
    const activeId = draggedImageIdRef.current;
    const previous = dragSnapshotRef.current;
    const next = orderedImagesRef.current;

    draggedImageIdRef.current = null;
    dragSnapshotRef.current = null;
    setDraggedImageId(null);
    setDragOverImageId(null);

    if (
      activeId === null ||
      !previous ||
      previous.every((image, index) => image.id === next[index]?.id)
    ) {
      return;
    }

    await saveImageOrder(next, previous);
  }

  function handleDragEnd() {
    if (draggedImageIdRef.current !== null && dragSnapshotRef.current) {
      orderedImagesRef.current = dragSnapshotRef.current;
      setOrderedImages(dragSnapshotRef.current);
    }

    draggedImageIdRef.current = null;
    dragSnapshotRef.current = null;
    setDraggedImageId(null);
    setDragOverImageId(null);
  }

  async function saveDescription(image: GalleryImageWithUrl) {
    const description = (descriptionDrafts[image.id] ?? "").trim();
    setError(null);
    setMessage(null);
    setSavingId(image.id);
    const result = await updateGalleryImageDescription(
      galleryKey,
      image.id,
      description
    );
    setSavingId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setMessage("Photo description saved.");
    router.refresh();
  }

  async function removeImage(image: GalleryImageWithUrl) {
    if (!window.confirm("Remove this photo from the public gallery?")) return;
    setError(null);
    setMessage(null);
    setDeletingId(image.id);
    const result = await deleteGalleryImage(galleryKey, image.id);
    setDeletingId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setMessage("Photo removed.");
    router.refresh();
  }

  const spacesRemaining = maximumImages - images.length - pendingPhotos.length;
  const controlsDisabled =
    isUploading || isProcessing || isReordering || deletingId !== null || savingId !== null;

  return (
    <section className="mt-8" aria-labelledby="gallery-photos-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl text-[#17352B]" id="gallery-photos-heading">
            Gallery photos
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#20231F]/65">
            Drag photos into order, or use the arrow buttons from a keyboard.
            New uploads are resized, converted to WebP, and stripped of embedded
            metadata.
          </p>
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-[#687760]">
          {orderedImages.length} photos
        </p>
      </div>

      {orderedImages.length > 0 ? (
        <ol
          className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {orderedImages.map((image, index) => (
            <li
              className={`border bg-white p-2 transition [contain-intrinsic-size:0_260px] [content-visibility:auto] ${
                draggedImageId === image.id
                  ? "border-[#17352B] opacity-45"
                  : dragOverImageId === image.id
                    ? "border-[#A84F36] ring-2 ring-[#A84F36]/20"
                    : "border-[#20231F]/20"
              }`}
              key={image.id}
              onDragEnter={() => handleDragEnter(image.id)}
            >
              <div className="aspect-[4/3] overflow-hidden bg-[#E5DFD3]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={image.alt_text}
                  className="h-full w-full object-cover"
                  height={image.height ?? 900}
                  loading="lazy"
                  src={image.publicUrl}
                  width={image.width ?? 1200}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    aria-label={`Drag photo ${index + 1} to a new position`}
                    className="cursor-grab border border-[#20231F]/25 px-2 py-1 font-mono text-xs text-[#17352B] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-35"
                    disabled={controlsDisabled}
                    draggable={!controlsDisabled}
                    onDragEnd={handleDragEnd}
                    onDragStart={(event) => handleDragStart(event, image.id)}
                    title="Drag to reorder"
                    type="button"
                  >
                    ⠿
                  </button>
                  <span className="font-mono text-xs text-[#687760]">
                    #{index + 1}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    aria-label={`Move photo ${index + 1} earlier`}
                    className="border border-[#20231F]/25 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-35"
                    disabled={controlsDisabled || index === 0}
                    onClick={() => moveImage(index, -1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move photo ${index + 1} later`}
                    className="border border-[#20231F]/25 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-35"
                    disabled={controlsDisabled || index === orderedImages.length - 1}
                    onClick={() => moveImage(index, 1)}
                    type="button"
                  >
                    ↓
                  </button>
                </div>
              </div>
              <details className="mt-2 border-t border-[#20231F]/15 pt-2">
                <summary className="cursor-pointer text-xs font-semibold text-[#17352B]">
                  Edit details
                </summary>
                <label
                  className="mt-3 block text-xs font-medium"
                  htmlFor={`gallery-alt-${image.id}`}
                >
                  Image description
                </label>
                <textarea
                  className="mt-2 w-full border border-[#20231F]/30 px-2 py-2 text-xs leading-5 outline-none focus:border-[#17352B] focus:ring-2 focus:ring-[#17352B]/20"
                  id={`gallery-alt-${image.id}`}
                  maxLength={240}
                  onChange={(event) =>
                    setDescriptionDrafts((current) => ({
                      ...current,
                      [image.id]: event.target.value,
                    }))
                  }
                  rows={3}
                  value={descriptionDrafts[image.id] ?? image.alt_text}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    className="border border-[#17352B] px-2 py-1 text-xs font-semibold text-[#17352B] disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={
                      controlsDisabled ||
                      (descriptionDrafts[image.id] ?? "").trim().length < 3 ||
                      (descriptionDrafts[image.id] ?? "").trim() === image.alt_text
                    }
                    onClick={() => saveDescription(image)}
                    type="button"
                  >
                    {savingId === image.id ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="text-xs font-medium text-[#7A3525] underline decoration-[#7A3525]/35 underline-offset-4 disabled:opacity-40"
                    disabled={controlsDisabled}
                    onClick={() => removeImage(image)}
                    type="button"
                  >
                    {deletingId === image.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-6 border border-dashed border-[#20231F]/30 px-5 py-8 text-center text-sm text-[#20231F]/60">
          No photos are currently shown in this gallery.
        </p>
      )}

      {pendingPhotos.length > 0 ? (
        <div className="mt-10 space-y-5">
          <h3 className="font-serif text-xl text-[#17352B]">Ready to upload</h3>
          {pendingPhotos.map((photo) => (
            <div
              className="grid gap-4 border border-[#20231F]/20 bg-[#FAF8F3] p-4 sm:grid-cols-[10rem_1fr]"
              key={photo.id}
            >
              <div className="aspect-[4/3] overflow-hidden bg-[#E5DFD3]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" className="h-full w-full object-cover" src={photo.previewUrl} />
              </div>
              <div>
                <label className="block text-sm font-medium" htmlFor={`pending-alt-${photo.id}`}>
                  Image description
                </label>
                <input
                  className="mt-2 w-full border border-[#20231F]/30 bg-white px-3 py-2 text-sm outline-none focus:border-[#17352B] focus:ring-2 focus:ring-[#17352B]/20"
                  id={`pending-alt-${photo.id}`}
                  maxLength={240}
                  onChange={(event) =>
                    setPendingPhotos((current) =>
                      current.map((item) =>
                        item.id === photo.id
                          ? { ...item, altText: event.target.value }
                          : item
                      )
                    )
                  }
                  placeholder="Freshly painted living room with white trim"
                  value={photo.altText}
                />
                <p className="mt-2 text-xs text-[#20231F]/55">
                  {formatBytes(photo.originalBytes)} → {formatBytes(photo.file.size)} · {photo.width} × {photo.height}
                </p>
                <button
                  className="mt-3 text-sm font-medium text-[#7A3525] underline underline-offset-4"
                  disabled={isUploading}
                  onClick={() => removePendingPhoto(photo.id)}
                  type="button"
                >
                  Remove selection
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-[#20231F]/15 pt-6">
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={controlsDisabled || spacesRemaining < 1}
          id="gallery-photo-files"
          multiple
          onChange={handleFileSelection}
          type="file"
        />
        <label
          className={`border border-[#17352B] px-5 py-3 text-sm font-semibold text-[#17352B] ${
            controlsDisabled || spacesRemaining < 1
              ? "cursor-not-allowed opacity-50"
              : "cursor-pointer hover:bg-white focus-within:ring-2 focus-within:ring-[#17352B]"
          }`}
          htmlFor="gallery-photo-files"
        >
          {isProcessing ? "Optimizing…" : "Choose photos"}
        </label>
        {pendingPhotos.length > 0 ? (
          <button
            className="bg-[#17352B] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={controlsDisabled}
            onClick={uploadPhotos}
            type="button"
          >
            {isUploading
              ? "Uploading…"
              : `Upload ${pendingPhotos.length} photo${pendingPhotos.length === 1 ? "" : "s"}`}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 border-l-2 border-[#A84F36] bg-[#A84F36]/10 px-4 py-3 text-sm text-[#7A3525]" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 border-l-2 border-[#687760] bg-[#687760]/10 px-4 py-3 text-sm text-[#17352B]" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
