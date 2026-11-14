import { useEffect, useState } from 'react';
import type { BoothPhoto } from '../db/types';

/** A kept photo's picture, from its file on this laptop. */
export function PhotoImg({ photo, className }: { photo: Pick<BoothPhoto, 'blob' | 'number'>; className?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo.blob]);
  return url ? <img src={url} alt={`Photo ${photo.number}`} className={className} /> : null;
}
