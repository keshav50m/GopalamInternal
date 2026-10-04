"use client";

/* eslint-disable @next/next/no-img-element -- dynamic provider URLs require native one-time fallback */

import type { ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  primaryUrl: string;
  fallbackUrl?: string;
  alt: string;
};

export default function ProviderAwareImage({
  primaryUrl,
  fallbackUrl = "",
  alt,
  onError,
  ...props
}: Props) {
  return (
    <img
      key={`${primaryUrl}|${fallbackUrl}`}
      {...props}
      alt={alt}
      src={primaryUrl}
      data-fallback-attempted="false"
      onError={(event) => {
        const image = event.currentTarget;
        if (
          fallbackUrl &&
          fallbackUrl !== image.currentSrc &&
          image.dataset.fallbackAttempted !== "true"
        ) {
          image.dataset.fallbackAttempted = "true";
          image.src = fallbackUrl;
          return;
        }
        onError?.(event);
      }}
    />
  );
}
