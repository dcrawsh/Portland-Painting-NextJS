"use client";

import Image from "next/image";
import {
  type MutableRefObject,
  useEffect,
  useRef,
  useState,
} from "react";

type PortfolioGalleryProps = {
  images: string[];
  label: string;
};

export default function PortfolioGallery({
  images,
  label,
}: PortfolioGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const desktopThumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mobileThumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const desktopRailRef = useRef<HTMLDivElement>(null);
  const mobileRailRef = useRef<HTMLDivElement>(null);
  const hasSelectedPhoto = useRef(false);
  const selectedImage = images[selectedIndex];

  useEffect(() => {
    if (!hasSelectedPhoto.current) {
      hasSelectedPhoto.current = true;
      return;
    }

    const rails = [
      {
        axis: "vertical",
        container: desktopRailRef.current,
        thumbnail: desktopThumbnailRefs.current[selectedIndex],
      },
      {
        axis: "horizontal",
        container: mobileRailRef.current,
        thumbnail: mobileThumbnailRefs.current[selectedIndex],
      },
    ];

    rails.forEach(({ axis, container, thumbnail }) => {
      if (!container || !thumbnail || container.offsetParent === null) return;

      const containerRect = container.getBoundingClientRect();
      const thumbnailRect = thumbnail.getBoundingClientRect();

      if (axis === "vertical") {
        if (thumbnailRect.top < containerRect.top) {
          container.scrollBy({
            behavior: "smooth",
            top: thumbnailRect.top - containerRect.top,
          });
        } else if (thumbnailRect.bottom > containerRect.bottom) {
          container.scrollBy({
            behavior: "smooth",
            top: thumbnailRect.bottom - containerRect.bottom,
          });
        }
      } else if (thumbnailRect.left < containerRect.left) {
        container.scrollBy({
          behavior: "smooth",
          left: thumbnailRect.left - containerRect.left,
        });
      } else if (thumbnailRect.right > containerRect.right) {
        container.scrollBy({
          behavior: "smooth",
          left: thumbnailRect.right - containerRect.right,
        });
      }
    });
  }, [selectedIndex]);

  useEffect(() => {
    if (!isViewerOpen) return;

    const previousOverflow = document.body.style.overflow;
    const openButton = openButtonRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsViewerOpen(false);
      if (event.key === "ArrowLeft") {
        setSelectedIndex((current) =>
          current === 0 ? images.length - 1 : current - 1
        );
      }
      if (event.key === "ArrowRight") {
        setSelectedIndex((current) => (current + 1) % images.length);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      openButton?.focus();
    };
  }, [images.length, isViewerOpen]);

  if (!selectedImage) {
    return (
      <p className="mx-auto max-w-6xl px-6 pb-16 text-sm text-[#20231F]/65">
        No gallery photos are available yet.
      </p>
    );
  }

  function showPrevious() {
    setSelectedIndex((current) =>
      current === 0 ? images.length - 1 : current - 1
    );
  }

  function showNext() {
    setSelectedIndex((current) => (current + 1) % images.length);
  }

  function getAltText(index: number) {
    return `${label}, photo ${index + 1} of ${images.length}`;
  }

  function renderThumbnailRail(
    className: string,
    thumbnailRefs: MutableRefObject<Array<HTMLButtonElement | null>>,
    railRef: MutableRefObject<HTMLDivElement | null>
  ) {
    return (
      <div
        aria-label={`Choose a ${label.toLowerCase()} photo`}
        className={className}
        ref={railRef}
        role="group"
      >
        {images.map((image, index) => (
          <button
            aria-label={`Show photo ${index + 1} of ${images.length}`}
            aria-pressed={selectedIndex === index}
            className={`relative aspect-[4/3] shrink-0 overflow-hidden border-2 bg-[#E9E2D6] transition focus:outline-none focus:ring-2 focus:ring-[#17352B] focus:ring-offset-2 ${
              selectedIndex === index
                ? "border-[#17352B]"
                : "border-transparent opacity-65 hover:opacity-100"
            }`}
            key={`${image}-${index}`}
            onClick={() => setSelectedIndex(index)}
            ref={(element) => {
              thumbnailRefs.current[index] = element;
            }}
            type="button"
          >
            <Image
              alt=""
              className="object-cover"
              fill
              sizes="96px"
              src={image}
            />
          </button>
        ))}
      </div>
    );
  }

  return (
    <section
      aria-label={`${label} gallery`}
      className="mx-auto max-w-6xl px-6 pb-16 lg:px-20"
      id="portfolio-gallery"
    >
      <div className="lg:grid lg:grid-cols-[6rem_minmax(0,1fr)] lg:gap-5">
        <div className="relative hidden lg:block">
          {renderThumbnailRail(
            "absolute inset-0 flex flex-col gap-3 overflow-y-auto pr-2 [scrollbar-width:thin] [&>button]:w-full",
            desktopThumbnailRefs,
            desktopRailRef
          )}
        </div>

        <figure className="min-w-0">
          <div className="relative aspect-[4/3] overflow-hidden border border-[#20231F]/15 bg-[#E9E2D6]">
            <button
              aria-label={`Open full-screen photo ${selectedIndex + 1} of ${images.length}`}
              className="absolute inset-0 z-0 cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#17352B]"
              onClick={() => setIsViewerOpen(true)}
              ref={openButtonRef}
              type="button"
            >
              <Image
                alt={getAltText(selectedIndex)}
                className="object-contain"
                fill
                priority={selectedIndex === 0}
                sizes="(max-width: 1024px) calc(100vw - 3rem), 900px"
                src={selectedImage}
              />
            </button>

            {images.length > 1 ? (
              <>
                <button
                  aria-label="Show previous photo"
                  className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#17352B]/35 bg-white/45 text-[#17352B] backdrop-blur-[1px] transition hover:bg-white/75 focus:outline-none focus:ring-2 focus:ring-[#17352B]"
                  onClick={showPrevious}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="m15 18-6-6 6-6"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                </button>
                <button
                  aria-label="Show next photo"
                  className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#17352B]/35 bg-white/45 text-[#17352B] backdrop-blur-[1px] transition hover:bg-white/75 focus:outline-none focus:ring-2 focus:ring-[#17352B]"
                  onClick={showNext}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="m9 18 6-6-6-6"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                </button>
              </>
            ) : null}

            <span className="pointer-events-none absolute bottom-3 right-3 z-10 bg-[#17352B] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white">
              {selectedIndex + 1} / {images.length}
            </span>
          </div>
          <figcaption className="mt-3 flex items-center justify-between gap-4 text-sm text-[#20231F]/60">
            <span>{label}</span>
            <button
              className="font-medium text-[#17352B] underline decoration-[#17352B]/35 underline-offset-4 hover:decoration-[#17352B] focus:outline-none focus:ring-2 focus:ring-[#17352B]"
              onClick={() => setIsViewerOpen(true)}
              type="button"
            >
              View full size
            </button>
          </figcaption>
        </figure>
      </div>

      {images.length > 1
        ? renderThumbnailRail(
            "mt-5 flex gap-3 overflow-x-auto pb-2 lg:hidden [&>button]:w-24",
            mobileThumbnailRefs,
            mobileRailRef
          )
        : null}

      {isViewerOpen ? (
        <div
          aria-label={`${label} full-screen viewer`}
          aria-modal="true"
          className="fixed inset-0 z-[100] flex flex-col bg-[#111713]/95 p-4 text-white sm:p-6"
          onClick={() => setIsViewerOpen(false)}
          role="dialog"
        >
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-white/70">
              Photo {selectedIndex + 1} of {images.length}
            </p>
            <button
              className="border border-white/50 px-4 py-2 text-sm font-semibold hover:bg-white hover:text-[#17352B] focus:outline-none focus:ring-2 focus:ring-white"
              onClick={() => setIsViewerOpen(false)}
              ref={closeButtonRef}
              type="button"
            >
              Close
            </button>
          </div>

          <div
            className="relative min-h-0 flex-1 my-5"
            onClick={(event) => event.stopPropagation()}
          >
            <Image
              alt={getAltText(selectedIndex)}
              className="object-contain"
              fill
              priority
              sizes="100vw"
              src={selectedImage}
            />
          </div>

          <div
            className="flex items-center justify-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            {images.length > 1 ? (
              <>
                <button
                  className="border border-white/50 px-5 py-3 text-sm font-semibold hover:bg-white hover:text-[#17352B] focus:outline-none focus:ring-2 focus:ring-white"
                  onClick={showPrevious}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="border border-white/50 px-5 py-3 text-sm font-semibold hover:bg-white hover:text-[#17352B] focus:outline-none focus:ring-2 focus:ring-white"
                  onClick={showNext}
                  type="button"
                >
                  Next
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
