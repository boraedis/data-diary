import { describe, expect, it } from "vitest";
import { completeMultipartXml, parseListPartsXml, xmlDecode, xmlEncode, xmlTag } from "@/lib/video-journal/r2";

// Shapes as R2/S3 return them (ETags quoted and entity-encoded).
const LIST_PARTS_PAGE = `<?xml version="1.0" encoding="UTF-8"?>
<ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>data-diary-video</Bucket>
  <Key>video-journal/2026-10-08/abc.mp4</Key>
  <UploadId>up-123</UploadId>
  <PartNumberMarker>0</PartNumberMarker>
  <NextPartNumberMarker>2</NextPartNumberMarker>
  <MaxParts>2</MaxParts>
  <IsTruncated>true</IsTruncated>
  <Part>
    <PartNumber>1</PartNumber>
    <LastModified>2026-10-08T21:00:00.000Z</LastModified>
    <ETag>&quot;9b2cf535f27731c974343645a3985328&quot;</ETag>
    <Size>10485760</Size>
  </Part>
  <Part>
    <PartNumber>2</PartNumber>
    <LastModified>2026-10-08T21:00:01.000Z</LastModified>
    <ETag>&quot;6f8db599de986fab7a21625b7916589c&quot;</ETag>
    <Size>10485760</Size>
  </Part>
</ListPartsResult>`;

describe("parseListPartsXml", () => {
  it("reads parts, decoded ETags and pagination", () => {
    expect(parseListPartsXml(LIST_PARTS_PAGE)).toEqual({
      parts: [
        { partNumber: 1, etag: '"9b2cf535f27731c974343645a3985328"', size: 10485760 },
        { partNumber: 2, etag: '"6f8db599de986fab7a21625b7916589c"', size: 10485760 },
      ],
      isTruncated: true,
      nextMarker: "2",
    });
  });

  it("handles an upload with no parts yet", () => {
    const xml = "<ListPartsResult><UploadId>u</UploadId><IsTruncated>false</IsTruncated></ListPartsResult>";
    expect(parseListPartsXml(xml)).toEqual({ parts: [], isTruncated: false, nextMarker: undefined });
  });
});

describe("completeMultipartXml", () => {
  it("lists parts in order with re-encoded ETags", () => {
    const xml = completeMultipartXml([
      { partNumber: 2, etag: '"bbb"', size: 5 },
      { partNumber: 1, etag: '"aaa"', size: 10 },
    ]);
    expect(xml).toBe(
      "<CompleteMultipartUpload>" +
        "<Part><PartNumber>1</PartNumber><ETag>&quot;aaa&quot;</ETag></Part>" +
        "<Part><PartNumber>2</PartNumber><ETag>&quot;bbb&quot;</ETag></Part>" +
        "</CompleteMultipartUpload>",
    );
  });
});

describe("xml helpers", () => {
  it("round-trips special characters", () => {
    const raw = `a & b < c > "d"`;
    expect(xmlDecode(xmlEncode(raw))).toBe(raw);
  });

  it("reads an UploadId from an initiate response", () => {
    const xml =
      "<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>AbC-123_x</UploadId></InitiateMultipartUploadResult>";
    expect(xmlTag(xml, "UploadId")).toBe("AbC-123_x");
  });

  it("reads an error code", () => {
    expect(xmlTag("<Error><Code>NoSuchUpload</Code><Message>gone</Message></Error>", "Code")).toBe("NoSuchUpload");
  });
});
