'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { ImageOffIcon } from 'lucide-react';

type SignedImageProps = Readonly<{
  photoId: string;
  className?: string;
  alt?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  quality?: number;
}>;

export function SignedImage({
  photoId,
  className = '',
  alt = 'Photo chantier',
  width,
  height,
  fill = false,
  sizes,
  priority = false,
  quality = 75,
}: SignedImageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const src = useMemo(
    () => (photoId ? `/api/photos/${encodeURIComponent(photoId)}/content` : null),
    [photoId],
  );

  useEffect(() => {
    setLoading(Boolean(src));
    setError(!src);
  }, [src]);

  if (error || !src) {
    return <ImageFallback className={className} />;
  }

  if (fill) {
    return (
      <>
        {loading ? <ImageLoading className={className} fill /> : null}
        <Image
          alt={alt}
          className={`${className} ${loading ? 'opacity-0' : 'opacity-100'}`}
          fill
          sizes={sizes}
          src={src}
          unoptimized
          priority={priority}
          quality={quality}
          onError={() => {
            setError(true);
            setLoading(false);
          }}
          onLoad={() => {
            setLoading(false);
          }}
        />
      </>
    );
  }

  return (
    <span className="relative inline-block overflow-hidden">
      {loading ? <ImageLoading className="absolute inset-0 h-full w-full" /> : null}
      <Image
        alt={alt}
        className={`${className} ${loading ? 'opacity-0' : 'opacity-100'}`}
        width={width ?? 320}
        height={height ?? 240}
        src={src}
        unoptimized
        priority={priority}
        quality={quality}
        onError={() => {
          setError(true);
          setLoading(false);
        }}
        onLoad={() => {
          setLoading(false);
        }}
      />
    </span>
  );
}

function ImageLoading({ className, fill = false }: Readonly<{ className: string; fill?: boolean }>) {
  return (
    <div
      className={`${fill ? 'absolute inset-0' : ''} ${className} flex items-center justify-center bg-slate-100 animate-pulse`}
    >
      <div className="h-7 w-7 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
    </div>
  );
}

function ImageFallback({ className }: Readonly<{ className: string }>) {
  return (
    <div className={`${className} flex items-center justify-center border border-slate-200 bg-slate-100`}>
      <ImageOffIcon className="h-6 w-6 text-slate-400" />
    </div>
  );
}
