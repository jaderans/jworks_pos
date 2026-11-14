import { useEffect, useState } from 'react';
import { useCamera } from '../../booth/camera';
import { FramePreview } from '../../booth/FramePreview';
import type { BoothShow } from '../../display/channel';
import type { BoothFrameKey } from '../../domain/booth';

/**
 * The photo booth on the customer screen: a live mirror in the JoshWorks
 * frame with the countdown, then the photo as a sticker with the question to
 * keep it, then its number.
 */
export function BoothView({ b }: { b: BoothShow }) {
  const live = b.stage === 'live' || b.stage === 'countdown';
  // The same camera the booth uses; Chrome lets both windows of the app share it.
  const cam = useCamera(b.camera, live);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!b.photo) return setUrl('');
    const u = URL.createObjectURL(b.photo);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [b.photo]);

  return (
    <section className={`cd-full cd-booth stage-${b.stage}`} aria-label="Photo booth">
      <div className="cd-booth-pic">
        {live ? (
          cam.error ? (
            <div className="cd-booth-nocam">
              <b>Look at the camera</b>
            </div>
          ) : (
            <FramePreview video={cam.video} frame={b.frame as BoothFrameKey} mirror={b.mirror} eventName={b.eventName} date={b.date} className="cd-booth-canvas" label="You, in the JoshWorks frame" />
          )
        ) : url ? (
          <img src={url} alt={b.number ? `Photo ${b.number}` : 'Your photo'} className={`cd-booth-photo frame-${b.frame}`} />
        ) : null}
        {b.stage === 'countdown' && b.count ? (
          <b key={b.count} className="cd-booth-count num" aria-live="assertive">
            {b.count}
          </b>
        ) : null}
      </div>
      <div className="cd-booth-text">
        {b.stage === 'live' ? (
          <>
            <span className="sl-eyebrow">Photo booth</span>
            <b>Strike a pose!</b>
            <span>Your photo in a JoshWorks frame, as a sticker.</span>
          </>
        ) : b.stage === 'countdown' ? (
          <>
            <span className="sl-eyebrow">Photo booth</span>
            <b>Smile!</b>
            <span>Look at the camera.</span>
          </>
        ) : b.stage === 'preview' ? (
          <>
            <span className="sl-eyebrow">Your sticker preview</span>
            <b>May we keep this photo?</b>
            <span>We use it only for your order. If you don’t order, we delete it after 30 days. Just tell us yes or no.</span>
          </>
        ) : (
          <>
            <span className="sl-eyebrow">Photo {b.number}</span>
            <b>Make it yours!</b>
            <span>Stickers, a pin, a keychain, or drawn as a sticker illustration{b.offer ? ` (${b.offer})` : ''}. Tell us your photo number.</span>
          </>
        )}
      </div>
    </section>
  );
}
