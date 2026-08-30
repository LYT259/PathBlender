import { useRef, useState } from 'react';
import {
  CUSTOM_FIELD_ID,
  makeCustomField,
  parseAprilTagLayout,
  type AprilTag,
  type FieldPackage,
} from '@pathblender/core';
import { useI18n } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Current custom field (to prefill), if any. */
  current?: FieldPackage;
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
export function CustomFieldPanel({ open, onClose, current, onApply }: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
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

  const apply = () => {
    if (!pixels) return;
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
    <div className="cf-panel">
      <h3>{t('customField.title')}</h3>
      <label className="btn small cf-file">
        {t('customField.pickImage')}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
      </label>
      {pixels && (
        <div className="cf-meta">
          {pixels.w}×{pixels.h}px
          {imageUrl && <img src={imageUrl} alt="" className="cf-thumb" />}
        </div>
      )}
      <label className="btn small cf-file">
        {t('customField.tags')}
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => void pickTags(e.target.files?.[0])}
        />
      </label>
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
      <div className="cf-actions">
        <button className="btn small" onClick={apply} disabled={!pixels}>
          {t('customField.apply')}
        </button>
        <button className="btn small" onClick={onClose}>
          {t('customField.cancel')}
        </button>
      </div>
      <input type="hidden" data-field-id={CUSTOM_FIELD_ID} />
    </div>
  );
}
