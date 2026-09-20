import { useRef, useState } from 'react';
import {
  CUSTOM_FIELD_ID,
  makeCustomField,
  parseAprilTagLayout,
  type AprilTag,
  type FieldPackage,
} from '@pathblender/core';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Current custom field (to prefill), if any. */
  current?: FieldPackage;
  currentImageUrl?: string;
  onApply: (field: FieldPackage, imageUrl: string | undefined) => void;
}

interface Draft {
  ppm: string;
  marginM: string;
  lengthM: string;
  widthM: string;
}

/**
 * Calibration panel for user-imported fields (GHPaths ADR-0008 FieldMap
 * concept): pick an image, set pixels-per-meter, margin, and playfield
 * size. Suggested sizes derive from the image's natural pixel size.
 */
export function CustomFieldPanel({ open, onClose, current, currentImageUrl, onApply }: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const tagsRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(currentImageUrl);
  const [imageError, setImageError] = useState(false);
  const [pixels, setPixels] = useState<{ w: number; h: number } | undefined>(
    current?.image
      ? { w: current.image.pixelWidth, h: current.image.pixelHeight }
      : undefined,
  );
  const [aprilTags, setAprilTags] = useState<AprilTag[] | undefined>(
    current?.aprilTags,
  );
  const [tagError, setTagError] = useState('');
  const [draft, setDraft] = useState<Draft>(() =>
    current?.image
      ? {
          ppm: String(current.image.ppm),
          marginM: String(current.image.marginM),
          lengthM: String(current.lengthM),
          widthM: String(current.widthM),
        }
      : { ppm: '200', marginM: '0', lengthM: '16.54', widthM: '8.07' },
  );

  if (!open) return null;

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    setImageError(false);
    setPixels(undefined);
    img.onload = () => {
      setPixels({ w: img.naturalWidth, h: img.naturalHeight });
      // Suggest playfield straight from calibration.
      const ppm = Number(draft.ppm) || 200;
      const margin = Number(draft.marginM) || 0;
      setDraft((d) => ({
        ...d,
        lengthM: (img.naturalWidth / ppm - 2 * margin).toFixed(2),
        widthM: (img.naturalHeight / ppm - 2 * margin).toFixed(2),
      }));
    };
    img.onerror = () => { setImageError(true); URL.revokeObjectURL(url); };
    img.src = url;
    setImageUrl(url);
  };

  const pickTags = async (file: File | undefined) => {
    if (!file) return;
    try {
      const layout = parseAprilTagLayout(await file.text());
      setAprilTags(layout.tags);
      setTagError('');
      // WPILib layouts carry authoritative sizes — offer them as defaults.
      if (layout.fieldLengthM && layout.fieldWidthM) {
        setDraft((d) => ({
          ...d,
          lengthM: layout.fieldLengthM!.toFixed(2),
          widthM: layout.fieldWidthM!.toFixed(2),
        }));
      }
    } catch (e) {
      setAprilTags(undefined);
      setTagError(e instanceof Error ? e.message : String(e));
    }
  };

  const validSize = ['ppm', 'lengthM', 'widthM'].every((key) => Number.isFinite(Number(draft[key as keyof Draft])) && Number(draft[key as keyof Draft]) > 0) && draft.marginM.trim() !== '' && Number.isFinite(Number(draft.marginM)) && Number(draft.marginM) >= 0;
  const apply = () => {
    if (!pixels || !validSize) return;
    const field = makeCustomField({
      lengthM: Number(draft.lengthM) || 16.54,
      widthM: Number(draft.widthM) || 8.07,
      ppm: Number(draft.ppm) || 200,
      marginM: Number(draft.marginM) || 0,
      pixelWidth: pixels.w,
      pixelHeight: pixels.h,
      aprilTags,
    });
    onApply(field, imageUrl);
    onClose();
  };

  const num = (label: string, key: keyof Draft, step = '0.01') => (
    <label className="cf-row">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <Dialog title={t('customField.title')} onClose={onClose}>
    <div className="cf-panel">
      <h3>{t('customField.title')}</h3>
      <button className="btn cf-file" onClick={() => fileRef.current?.click()}>{t('customField.pickImage')}</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
      {imageError && <p role="alert" className="cf-error">{t('customField.imageError')}</p>}
      {pixels && (
        <div className="cf-meta">
          {pixels.w}×{pixels.h}px
          {imageUrl && <img src={imageUrl} alt="" className="cf-thumb" />}
        </div>
      )}
      <button className="btn cf-file" onClick={() => tagsRef.current?.click()}>{t('customField.tags')}</button>
        <input
          ref={tagsRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => void pickTags(e.target.files?.[0])}
        />
      {tagError !== '' && <div className="cf-error">{tagError}</div>}
      {aprilTags && (
        <div className="cf-meta">
          {aprilTags.length} AprilTags
        </div>
      )}
      {num(t('customField.ppm'), 'ppm', '1')}
      {num(t('customField.margin'), 'marginM')}
      {num(t('customField.length'), 'lengthM')}
      {num(t('customField.width'), 'widthM')}
      <p className="cf-note">{t('customField.note')}</p>
      {!validSize && <p role="alert" className="cf-error">{t('customField.invalidSize')}</p>}
      <div className="cf-actions">
        <button className="btn accent" onClick={apply} disabled={!pixels || !validSize}>
          {t('customField.apply')}
        </button>
        <button className="btn small" onClick={onClose}>
          {t('customField.cancel')}
        </button>
      </div>
      <input type="hidden" data-field-id={CUSTOM_FIELD_ID} />
    </div>
    </Dialog>
  );
}
