import { AwsClient } from "aws4fetch";

// Server-only Cloudflare R2 access for video journal recordings (#339,
// epic #338). Never import this from a client component: it reads the R2
// secret key.
//
// R2 speaks the S3 API, signed with SigV4. This uses `aws4fetch` (a single
// small file that Cloudflare's own R2 docs use) and plain `fetch`, rather
// than the AWS SDK: the handful of calls needed here don't justify the
// SDK's size.
//
// The bucket is private. The browser never gets credentials, only
// presigned URLs scoped to one object and one method that expire within
// the hour: PUT for an upload part, GET for playback.
//
// Credentials are read at call time, never at import (same rule as
// src/lib/db.ts), so `next build` can import routes that use this without
// R2 configured. Without config, `getR2Config()` returns null and the API
// answers 503, which the recorder shows as "upload not configured" while
// keeping recordings on the device.

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export class R2NotConfiguredError extends Error {
  constructor() {
    super("Video storage (R2) is not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET");
  }
}

/** Presigned URLs expire after an hour: long enough for a slow part
 * upload or a long playback session, short enough that a URL left in
 * browser history stops working. */
export const PRESIGN_EXPIRES_SECONDS = 60 * 60;

function requireConfig(): R2Config {
  const config = getR2Config();
  if (!config) throw new R2NotConfiguredError();
  return config;
}

function client(config: R2Config): AwsClient {
  // R2 ignores the region but SigV4 needs one; "auto" is what R2's docs
  // specify.
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

/** Path-style object URL. Each key segment is encoded on its own so the
 * `/` separators survive. */
function objectUrl(config: R2Config, key: string): URL {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${path}`);
}

async function r2Fetch(url: URL, init: RequestInit = {}): Promise<Response> {
  const config = requireConfig();
  const res = await client(config).fetch(url.toString(), init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new R2RequestError(res.status, xmlTag(body, "Code") ?? null, xmlTag(body, "Message") ?? body.slice(0, 200));
  }
  return res;
}

export class R2RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    detail: string,
  ) {
    super(`R2 request failed (${status}${code ? ` ${code}` : ""}): ${detail}`);
  }
}

// --- Minimal XML handling --------------------------------------------------
// The S3 API answers in XML. The responses read here are tiny and fixed in
// shape (an UploadId, a list of parts), so a couple of tag extractors are
// enough. Values come back entity-encoded (ETags are quoted, as
// `&quot;…&quot;`), hence the decode/encode pair.

const XML_ENTITIES: Record<string, string> = { "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };

export function xmlDecode(value: string): string {
  return value.replace(/&(quot|apos|lt|gt|amp);/g, (entity) => XML_ENTITIES[entity]);
}

export function xmlEncode(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** First `<tag>…</tag>` value in `xml`, decoded. */
export function xmlTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? xmlDecode(match[1]) : undefined;
}

/** Every `<tag>…</tag>` block's inner XML, in document order. */
export function xmlBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
}

export type UploadedPart = { partNumber: number; etag: string; size: number };

export function parseListPartsXml(xml: string): {
  parts: UploadedPart[];
  isTruncated: boolean;
  nextMarker: string | undefined;
} {
  const parts = xmlBlocks(xml, "Part").map((block) => ({
    partNumber: Number(xmlTag(block, "PartNumber")),
    etag: xmlTag(block, "ETag") ?? "",
    size: Number(xmlTag(block, "Size")),
  }));
  return {
    parts,
    isTruncated: xmlTag(xml, "IsTruncated") === "true",
    nextMarker: xmlTag(xml, "NextPartNumberMarker"),
  };
}

export function completeMultipartXml(parts: UploadedPart[]): string {
  const body = [...parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEncode(p.etag)}</ETag></Part>`)
    .join("");
  return `<CompleteMultipartUpload>${body}</CompleteMultipartUpload>`;
}

// --- Operations ------------------------------------------------------------

/** Opens a multipart upload and returns its UploadId. The Content-Type set
 * here is what R2 serves the finished object with, which is what lets a
 * `<video>` element play it straight from a presigned GET. */
export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const url = objectUrl(requireConfig(), key);
  url.searchParams.set("uploads", "");
  const res = await r2Fetch(url, { method: "POST", headers: { "Content-Type": contentType } });
  const uploadId = xmlTag(await res.text(), "UploadId");
  if (!uploadId) throw new Error("R2 did not return an UploadId");
  return uploadId;
}

/** A URL the browser can PUT one part's bytes to, with no credentials. */
export async function presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string> {
  const config = requireConfig();
  const url = objectUrl(config, key);
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRES_SECONDS));
  const signed = await client(config).sign(url.toString(), { method: "PUT", aws: { signQuery: true } });
  return signed.url;
}

/** What R2 has actually received for an open upload. The source of truth
 * for resuming and for completing: the browser never has to read ETags off
 * its PUT responses, which would need the bucket's CORS rules to expose
 * the ETag header. */
export async function listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
  const config = requireConfig();
  const parts: UploadedPart[] = [];
  let marker: string | undefined;
  for (;;) {
    const url = objectUrl(config, key);
    url.searchParams.set("uploadId", uploadId);
    if (marker) url.searchParams.set("part-number-marker", marker);
    const page = parseListPartsXml(await (await r2Fetch(url)).text());
    parts.push(...page.parts);
    if (!page.isTruncated || !page.nextMarker) return parts;
    marker = page.nextMarker;
  }
}

export async function completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void> {
  const url = objectUrl(requireConfig(), key);
  url.searchParams.set("uploadId", uploadId);
  const res = await r2Fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: completeMultipartXml(parts),
  });
  // S3 can report a failed completion inside a 200 response; R2 follows
  // the same contract, so check the body too.
  const text = await res.text();
  if (text.includes("<Error>")) {
    throw new R2RequestError(res.status, xmlTag(text, "Code") ?? null, xmlTag(text, "Message") ?? text.slice(0, 200));
  }
}

/** Size and type of a stored object, or null if it doesn't exist. */
export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  const config = requireConfig();
  const res = await client(config).fetch(objectUrl(config, key).toString(), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new R2RequestError(res.status, null, "HEAD failed");
  return { size: Number(res.headers.get("Content-Length") ?? 0), contentType: res.headers.get("Content-Type") };
}

/** A short-lived URL a `<video>` can play the object from. R2 serves range
 * requests on it, so seeking a long recording doesn't download the file. */
export async function presignGetObject(key: string): Promise<string> {
  const config = requireConfig();
  const url = objectUrl(config, key);
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRES_SECONDS));
  const signed = await client(config).sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}
