import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import sharp from "sharp";
import ts from "typescript";

const projectRoot = process.cwd();
const bucketName = "gallery-images";
const maximumImageBytes = 3 * 1024 * 1024;

function readEnvironment() {
  const environmentPath = path.join(projectRoot, ".env");
  const contents = fs.readFileSync(environmentPath, "utf8");

  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
      .filter(Boolean)
      .map((match) => [
        match[1],
        match[2].trim().replace(/^['"]|['"]$/g, ""),
      ])
  );
}

function loadTypeScriptDefault(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absolutePath,
  }).outputText;
  const loadedModule = new Module(absolutePath);
  loadedModule.filename = absolutePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
  loadedModule._compile(compiled, absolutePath);
  return loadedModule.exports.default;
}

function deterministicUuid(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

async function optimizeImage(absolutePath) {
  for (const quality of [82, 72, 62, 52]) {
    const { data, info } = await sharp(absolutePath)
      .rotate()
      .resize({
        fit: "inside",
        height: 2400,
        width: 2400,
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });

    if (data.length <= maximumImageBytes) {
      return { data, height: info.height, width: info.width };
    }
  }

  throw new Error(`Could not reduce ${absolutePath} below 3 MB.`);
}

function titleForGallery(galleryKey) {
  return galleryKey === "interior" ? "Interior" : "Exterior";
}

async function importGallery(supabase, galleryKey, imageUrls) {
  const { data: collection, error: collectionError } = await supabase
    .from("gallery_collections")
    .select("cms_enabled")
    .eq("gallery_key", galleryKey)
    .maybeSingle();

  if (collectionError || !collection) {
    throw new Error(
      `The ${galleryKey} collection is missing. Apply the gallery CMS migration first.`
    );
  }

  const { count, error: countError } = await supabase
    .from("gallery_images")
    .select("id", { count: "exact", head: true })
    .eq("gallery_key", galleryKey);

  if (countError) throw countError;
  if (collection.cms_enabled && count === imageUrls.length) {
    console.log(
      `${titleForGallery(galleryKey)}: already imported (${count} photos); skipping.`
    );
    return;
  }

  if (collection.cms_enabled || (count ?? 0) > 0) {
    throw new Error(
      `The ${galleryKey} gallery already contains CMS data. Import stopped to protect existing edits.`
    );
  }

  const rows = [];

  for (let index = 0; index < imageUrls.length; index += 1) {
    const imageUrl = imageUrls[index];
    const absolutePath = path.join(projectRoot, "public", imageUrl.slice(1));
    const storagePath = `${galleryKey}/${deterministicUuid(`${galleryKey}:${imageUrl}`)}.webp`;
    const optimized = await optimizeImage(absolutePath);
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, optimized.data, {
        cacheControl: "31536000",
        contentType: "image/webp",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    rows.push({
      alt_text: `${titleForGallery(galleryKey)} painting project, photo ${index + 1} of ${imageUrls.length}`,
      gallery_key: galleryKey,
      height: optimized.height,
      sort_order: index,
      storage_path: storagePath,
      width: optimized.width,
    });

    process.stdout.write(
      `\r${titleForGallery(galleryKey)}: ${index + 1}/${imageUrls.length}`
    );
  }

  process.stdout.write("\n");
  const { error: insertError } = await supabase.from("gallery_images").insert(rows);
  if (insertError) throw insertError;

  const { error: enableError } = await supabase
    .from("gallery_collections")
    .update({ cms_enabled: true, updated_at: new Date().toISOString() })
    .eq("gallery_key", galleryKey);
  if (enableError) throw enableError;
}

async function main() {
  const environment = readEnvironment();
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required in .env."
    );
  }

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const galleries = {
    exterior: loadTypeScriptDefault("src/app/gallery/exterior/galleryFiles.ts"),
    interior: loadTypeScriptDefault("src/app/gallery/interior/galleryFiles.ts"),
  };

  for (const [galleryKey, imageUrls] of Object.entries(galleries)) {
    await importGallery(supabase, galleryKey, imageUrls);
  }

  console.log(
    `Imported ${galleries.interior.length + galleries.exterior.length} gallery photos.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
