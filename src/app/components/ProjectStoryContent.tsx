import type { ProjectStory, ProjectStoryImage } from "@/types/supabase";

export type ProjectStoryDisplayImage = ProjectStoryImage & {
  publicUrl: string;
};

type ProjectStoryContentProps = {
  images?: ProjectStoryDisplayImage[];
  project: ProjectStory;
};

const storySections = [
  ["problem", "Problem or existing condition"],
  ["findings", "What we found"],
  ["approach", "How we approached it"],
  ["preparation", "Repair and preparation"],
  ["result", "Finished result"],
] as const;

function formatProjectDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function ProjectStoryContent({
  images = [],
  project,
}: ProjectStoryContentProps) {
  const details = [
    project.service_type,
    project.location,
    project.project_date ? formatProjectDate(project.project_date) : null,
  ].filter(Boolean);
  const hasStoryContent = storySections.some(([field]) =>
    Boolean(project[field])
  );

  return (
    <>
      <header className="border-b border-[#20231F]/20 pb-10">
        <h1 className="max-w-3xl font-serif text-4xl leading-tight text-[#17352B] sm:text-5xl">
          {project.title}
        </h1>
        {project.summary ? (
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#20231F]/75">
            {project.summary}
          </p>
        ) : null}
        {details.length > 0 ? (
          <p className="mt-6 text-sm text-[#20231F]/60">
            {details.join(" · ")}
          </p>
        ) : null}
      </header>

      {images.length > 0 ? (
        <div className="grid gap-4 border-b border-[#20231F]/15 py-8 sm:grid-cols-2">
          {images.map((image, index) => (
            <figure
              className={index === 0 ? "sm:col-span-2" : undefined}
              key={image.id}
            >
              <div
                className={`${
                  index === 0 ? "aspect-[16/9]" : "aspect-[4/3]"
                } overflow-hidden bg-[#E5DFD3]`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={image.alt_text}
                  className="h-full w-full object-cover"
                  height={image.height ?? 900}
                  loading={index === 0 ? "eager" : "lazy"}
                  src={image.publicUrl}
                  width={image.width ?? 1200}
                />
              </div>
              {image.caption ? (
                <figcaption className="mt-2 text-sm leading-5 text-[#20231F]/60">
                  {image.caption}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : null}

      <div className="divide-y divide-[#20231F]/15">
        {storySections.map(([field, heading]) =>
          project[field] ? (
            <section
              className="grid gap-4 py-9 sm:grid-cols-[14rem_1fr]"
              key={field}
            >
              <h2 className="font-serif text-2xl text-[#17352B]">{heading}</h2>
              <p className="whitespace-pre-line text-base leading-7 text-[#20231F]/75">
                {project[field]}
              </p>
            </section>
          ) : null
        )}
      </div>

      {!project.summary && !hasStoryContent ? (
        <p className="mt-10 border border-dashed border-[#20231F]/30 px-6 py-10 text-center text-sm text-[#20231F]/65">
          This project does not have story content yet.
        </p>
      ) : null}
    </>
  );
}
