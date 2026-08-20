import "server-only";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type R2Config = {
  bucketName: string;
  publicBaseUrl: string;
  client: S3Client;
};

let r2Config: R2Config | null = null;

const getRequiredEnvironmentVariable = (name: string) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required R2 configuration: ${name}`);
  }

  return value;
};

const getR2Config = (): R2Config => {
  if (r2Config) return r2Config;

  const accountId = getRequiredEnvironmentVariable("R2_ACCOUNT_ID");
  const accessKeyId = getRequiredEnvironmentVariable("R2_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnvironmentVariable("R2_SECRET_ACCESS_KEY");
  const bucketName = getRequiredEnvironmentVariable("R2_BUCKET_NAME");
  const publicBaseUrl = getRequiredEnvironmentVariable("R2_PUBLIC_BASE_URL").replace(
    /\/+$/,
    ""
  );

  const parsedPublicBaseUrl = new URL(publicBaseUrl);
  if (parsedPublicBaseUrl.protocol !== "https:") {
    throw new Error("R2_PUBLIC_BASE_URL must use HTTPS");
  }

  r2Config = {
    bucketName,
    publicBaseUrl,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };

  return r2Config;
};

const buildPublicUrl = (publicBaseUrl: string, objectKey: string) =>
  `${publicBaseUrl}/${objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

export const uploadImageToR2 = async ({
  body,
  contentType,
  objectKey,
}: {
  body: Uint8Array;
  contentType: string;
  objectKey: string;
}) => {
  const { bucketName, client, publicBaseUrl } = getR2Config();

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    })
  );

  return {
    imageUrl: buildPublicUrl(publicBaseUrl, objectKey),
    objectKey,
  };
};
