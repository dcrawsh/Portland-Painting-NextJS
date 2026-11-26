export const galleryKeys = ["interior", "exterior"] as const;

export type GalleryKey = (typeof galleryKeys)[number];

export const galleryLabels: Record<GalleryKey, string> = {
  exterior: "Exterior painting",
  interior: "Interior painting",
};

export function isGalleryKey(value: string): value is GalleryKey {
  return galleryKeys.includes(value as GalleryKey);
}
